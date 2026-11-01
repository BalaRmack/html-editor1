import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Version } from '@xmcl/core'
import type { IntegrityIssue, IntegrityReport } from '../../shared/types'
import { logger } from './logger'

/**
 * Real integrity check for an instance.
 *
 * `Instance.installed` only says "the version json exists", which is why a
 * download that died half-way used to look installed and handed the user a
 * working «Играть» button. This module walks everything the game actually
 * needs — client jar, every resolved library (natives included) and every
 * asset object from the index — and reports what is missing or truncated.
 */

export interface IntegrityTarget {
  id: string
  versionId: string
  mcVersion: string
}

export interface IntegrityOptions {
  /** Verify sha1 of every file instead of only existence + size (slow). */
  deep?: boolean
  /** Stop recording issues after this many, keeps the IPC payload small. */
  maxIssues?: number
}

const DEFAULT_MAX_ISSUES = 40
/** Parallel `stat` calls — enough to be fast on spinning disks too. */
const CONCURRENCY = 24

async function mapWithLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, async () => {
    for (;;) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await worker(items[index])
    }
  })
  await Promise.all(runners)
  return results
}

async function fileSize(path: string): Promise<number | null> {
  try {
    const info = await stat(path)
    return info.isFile() ? info.size : null
  } catch {
    return null
  }
}

async function sha1(path: string): Promise<string | null> {
  try {
    return createHash('sha1').update(await readFile(path)).digest('hex')
  } catch {
    return null
  }
}

interface AssetObject {
  hash: string
  size: number
}

export async function checkIntegrity(
  target: IntegrityTarget,
  sharedDir: string,
  options: IntegrityOptions = {}
): Promise<IntegrityReport> {
  const started = Date.now()
  const maxIssues = options.maxIssues ?? DEFAULT_MAX_ISSUES
  const missing: IntegrityIssue[] = []
  let truncatedIssues = 0

  const push = (issue: IntegrityIssue): void => {
    if (missing.length < maxIssues) missing.push(issue)
    else truncatedIssues++
  }

  const report = (patch: Partial<IntegrityReport> & Pick<IntegrityReport, 'ok'>): IntegrityReport => ({
    instanceId: target.id,
    versionId: target.versionId,
    checkedAt: new Date().toISOString(),
    missing,
    truncatedIssues,
    counts: { libraries: 0, assets: 0, checked: 0 },
    durationMs: Date.now() - started,
    ...patch
  })

  if (!target.versionId) {
    return report({ ok: false, code: 'not_installed', error: 'Версия не выбрана' })
  }

  const versionJson = join(sharedDir, 'versions', target.versionId, `${target.versionId}.json`)
  const jsonSize = await fileSize(versionJson)
  if (!jsonSize) {
    return report({ ok: false, code: 'not_installed', error: `Нет файла версии ${target.versionId}.json` })
  }

  let resolved: Awaited<ReturnType<typeof Version.parse>>
  try {
    resolved = await Version.parse(sharedDir, target.versionId)
  } catch (error) {
    return report({ ok: false, code: 'version_corrupted', error: (error as Error).message })
  }

  let checked = 0
  let libraries = 0
  let assets = 0

  // ---- client jar -------------------------------------------------------
  const jarCandidates = [
    join(sharedDir, 'versions', target.versionId, `${target.versionId}.jar`),
    join(sharedDir, 'versions', resolved.minecraftVersion, `${resolved.minecraftVersion}.jar`),
    join(sharedDir, 'versions', target.mcVersion, `${target.mcVersion}.jar`)
  ]
  const expectedJar = resolved.downloads?.client?.size ?? 0
  let clientSize: number | null = null
  for (const candidate of jarCandidates) {
    const size = await fileSize(candidate)
    if (size && size > 0) {
      clientSize = size
      break
    }
  }
  checked++
  if (clientSize === null) {
    push({
      kind: 'client',
      name: `${target.mcVersion}.jar`,
      path: jarCandidates[0],
      expectedSize: expectedJar
    })
  } else if (expectedJar > 0 && clientSize !== expectedJar) {
    push({
      kind: 'client',
      name: `${target.mcVersion}.jar`,
      path: jarCandidates[0],
      expectedSize: expectedJar,
      actualSize: clientSize
    })
  }

  // ---- libraries (natives are libraries with a classifier) --------------
  const libEntries = resolved.libraries.filter((library) => library.path && /\.(jar|zip)$/i.test(library.path))
  libraries = libEntries.length
  await mapWithLimit(libEntries, CONCURRENCY, async (library) => {
    const path = join(sharedDir, 'libraries', library.path)
    const expected = library.download?.size ?? 0
    const size = await fileSize(path)
    checked++
    if (size === null) {
      push({ kind: 'library', name: library.path.split('/').pop() ?? library.name, path, expectedSize: expected })
      return
    }
    if (expected > 0 && size !== expected) {
      push({
        kind: 'library',
        name: library.path.split('/').pop() ?? library.name,
        path,
        expectedSize: expected,
        actualSize: size
      })
      return
    }
    if (options.deep && library.download?.sha1) {
      const digest = await sha1(path)
      if (digest && digest !== library.download.sha1) {
        push({ kind: 'library', name: library.path.split('/').pop() ?? library.name, path, hash: library.download.sha1 })
      }
    }
  })

  // ---- assets ----------------------------------------------------------
  const indexId = resolved.assetIndex?.id ?? resolved.assets
  if (indexId) {
    const indexPath = join(sharedDir, 'assets', 'indexes', `${indexId}.json`)
    const indexSize = await fileSize(indexPath)
    checked++
    if (!indexSize) {
      push({ kind: 'assetIndex', name: `${indexId}.json`, path: indexPath })
    } else {
      try {
        const index = JSON.parse(await readFile(indexPath, 'utf8')) as { objects?: Record<string, AssetObject> }
        const objects = Object.entries(index.objects ?? {})
        assets = objects.length
        await mapWithLimit(objects, CONCURRENCY, async ([name, object]) => {
          const path = join(sharedDir, 'assets', 'objects', object.hash.slice(0, 2), object.hash)
          const size = await fileSize(path)
          checked++
          if (size === null) {
            push({ kind: 'asset', name, path, expectedSize: object.size, hash: object.hash })
            return
          }
          if (object.size > 0 && size !== object.size) {
            push({ kind: 'asset', name, path, expectedSize: object.size, actualSize: size, hash: object.hash })
          } else if (options.deep) {
            const digest = await sha1(path)
            if (digest && digest !== object.hash) {
              push({ kind: 'asset', name, path, hash: object.hash })
            }
          }
        })
      } catch (error) {
        // Corrupt index = missing index: the installer deletes and re-downloads it.
        push({ kind: 'assetIndex', name: `${indexId}.json`, path: indexPath })
        logger.warn(
          `Индекс ассетов ${indexId} повреждён (${(error as Error).message.slice(0, 100)}) — ` +
            'будет скачан заново при повторе загрузки'
        )
      }
    }
  }

  const ok = missing.length === 0 && truncatedIssues === 0
  const result = report({
    ok,
    code: ok ? undefined : 'integrity_failed',
    error: ok ? undefined : `Не хватает файлов: ${missing.length + truncatedIssues}`,
    counts: { libraries, assets, checked }
  })
  logger.info(
    `Проверка «${target.versionId}»: ${ok ? 'OK' : `${missing.length + truncatedIssues} проблем`} ` +
      `(библиотек ${libraries}, ассетов ${assets}, проверено ${checked}, ${result.durationMs} мс)`
  )
  return result
}
