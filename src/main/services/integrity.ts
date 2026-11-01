import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Version } from '@xmcl/core'
import type { IntegrityIssue, IntegrityReport } from '../../shared/types'
import { logger } from './logger'
import {
  cacheIsUsable,
  loadVerifyCache,
  mergeCache,
  saveVerifyCache,
  verifyFiles,
  type ExpectedFile,
  type Fingerprint
} from './verify-cache'

/**
 * Real integrity check for an instance.
 *
 * `Instance.installed` only says «the version json exists», which is why a
 * download that died half-way used to look installed and handed the user a
 * working «Играть» button. This module walks everything the game actually
 * needs — client jar, every resolved library (natives included) and every
 * asset object from the index — and reports what is missing or truncated.
 *
 * Task 4: the walk is now **incremental**. Fingerprints (size + mtime + sha1)
 * are cached per instance in `.verdant-verified.json`, so a healthy install is
 * validated by `stat()` alone and only files whose stat changed are re-hashed.
 * A cold cache therefore costs exactly what the old check cost, and every
 * subsequent start is a fraction of it.
 */

export interface IntegrityTarget {
  id: string
  versionId: string
  mcVersion: string
  /** Instance folder — enables the fingerprint cache. */
  instanceDir?: string
}

export interface IntegrityOptions {
  /** Verify sha1 of every file instead of only files whose stat changed (slow). */
  deep?: boolean
  /** Stop recording issues after this many, keeps the IPC payload small. */
  maxIssues?: number
  /** Ignore the fingerprint cache and start from scratch. */
  fresh?: boolean
}

const DEFAULT_MAX_ISSUES = 40
/** Parallel file inspections — enough to be fast on spinning disks too. */
const CONCURRENCY = 24

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
  let resolved: Awaited<ReturnType<typeof Version.parse>>
  try {
    resolved = await Version.parse(sharedDir, target.versionId)
  } catch (error) {
    const message = (error as Error).message ?? ''
    const isMissing = /ENOENT|no such file/i.test(message)
    return report({
      ok: false,
      code: isMissing ? 'not_installed' : 'version_corrupted',
      error: isMissing ? `Нет файла версии ${target.versionId}.json` : message
    })
  }

  // ---- what the game needs, as data ------------------------------------
  const expected: ExpectedFile[] = []

  const jarCandidates = [
    join(sharedDir, 'versions', target.versionId, `${target.versionId}.jar`),
    join(sharedDir, 'versions', resolved.minecraftVersion, `${resolved.minecraftVersion}.jar`),
    join(sharedDir, 'versions', target.mcVersion, `${target.mcVersion}.jar`)
  ]
  const expectedJarSize = resolved.downloads?.client?.size ?? 0
  const expectedJarHash = resolved.downloads?.client?.sha1
  // Fabric/Quilt reuse the vanilla jar, so the client may sit under a different
  // version id — pick the first candidate that exists.
  const clientPath = (await firstExisting(jarCandidates)) ?? jarCandidates[0]
  expected.push({
    kind: 'client',
    name: `${target.mcVersion}.jar`,
    path: clientPath,
    size: expectedJarSize,
    sha1: expectedJarHash
  })

  const libEntries = resolved.libraries.filter((library) => library.path && /\.(jar|zip)$/i.test(library.path))
  for (const library of libEntries) {
    expected.push({
      kind: 'library',
      name: library.path.split('/').pop() ?? library.name,
      path: join(sharedDir, 'libraries', library.path),
      size: library.download?.size ?? 0,
      sha1: library.download?.sha1
    })
  }

  const indexId = resolved.assetIndex?.id ?? resolved.assets
  if (indexId) {
    const indexPath = join(sharedDir, 'assets', 'indexes', `${indexId}.json`)
    try {
      const index = JSON.parse(await readFile(indexPath, 'utf8')) as { objects?: Record<string, AssetObject> }
      for (const [name, object] of Object.entries(index.objects ?? {})) {
        expected.push({
          kind: 'asset',
          name,
          path: join(sharedDir, 'assets', 'objects', object.hash.slice(0, 2), object.hash),
          size: object.size,
          sha1: object.hash
        })
      }
    } catch (error) {
      // Corrupt index = missing index: the installer deletes and re-downloads it.
      push({ kind: 'assetIndex', name: `${indexId}.json`, path: indexPath })
      logger.warn(
        `Индекс ассетов ${indexId} повреждён (${(error as Error).message.slice(0, 100)}) — ` +
          'будет скачан заново при повторе загрузки'
      )
    }
  }

  // ---- fingerprints + verification --------------------------------------
  const previous = target.instanceDir && !options.fresh ? await loadVerifyCache(target.instanceDir) : null
  const cache = cacheIsUsable(previous, target.versionId) ? previous : null

  let stats = { checked: 0, hashed: 0, skipped: 0, missing: 0 }
  let files: Record<string, Fingerprint> = {}
  if (expected.length > 0) {
    const outcome = await verifyFiles(expected, cache, { deep: options.deep, concurrency: CONCURRENCY })
    stats = outcome.stats
    files = outcome.files
    for (const issue of outcome.issues) {
      const file = issue.file
      push({
        kind: file.kind,
        name: file.name,
        path: file.path,
        expectedSize: file.size || undefined,
        actualSize: issue.verdict === 'truncated' ? issue.actualSize : undefined,
        hash: file.sha1
      })
    }
  }

  // A healthy check refreshes the cache; a broken one keeps the old fingerprints
  // so the re-download can be compared against them next time.
  if (target.instanceDir && missing.length === 0 && truncatedIssues === 0) {
    await saveVerifyCache(target.instanceDir, mergeCache(target.versionId, files, cache))
  }

  const libraries = libEntries.length
  const assets = expected.filter((file) => file.kind === 'asset').length
  const checked = stats.checked

  const ok = missing.length === 0 && truncatedIssues === 0
  const result = report({
    ok,
    code: ok ? undefined : 'integrity_failed',
    error: ok ? undefined : `Не хватает файлов: ${missing.length + truncatedIssues}`,
    counts: { libraries, assets, checked, hashed: stats.hashed, skipped: stats.skipped }
  })
  logger.info(
    `Проверка «${target.versionId}»: ${ok ? 'OK' : `${missing.length + truncatedIssues} проблем`} ` +
      `(библиотек ${libraries}, ассетов ${assets}, проверено ${checked}, ` +
      `хэшировано ${stats.hashed}, по stat ${stats.skipped}, ${result.durationMs} мс)`
  )
  return result
}

async function firstExisting(paths: string[]): Promise<string | null> {
  const { stat } = await import('node:fs/promises')
  for (const path of paths) {
    try {
      const info = await stat(path)
      if (info.isFile() && info.size > 0) return path
    } catch {
      /* try the next candidate */
    }
  }
  return null
}
