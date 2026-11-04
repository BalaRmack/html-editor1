import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ResolvedVersion } from '@xmcl/core'
import type { DownloadSpec } from './downloader'
import { downloadFile } from './downloader'
import { BMCL_MIRROR } from './mirror'

/**
 * Planning of the ~400 files an install needs.
 *
 * `@xmcl/installer` downloads libraries and assets on its own, with undici and
 * its default timeouts. Against a blocked Mojang CDN that means a silent stall:
 * the process waits minutes for a socket that will never deliver, the bar sits
 * at 40 MB and only then an error appears. (This is exactly the 40.9 / 199 MB
 * report from 1.1.2.)
 *
 * So we plan the file list ourselves and download it with our own transport:
 * known total size before the first byte, mirror-first URLs, an abort signal per
 * request, resumable `.part` files and a pool of 16 sockets.
 */

export type FileKind = 'library' | 'native' | 'asset' | 'index' | 'logging'

export interface PlannedFile extends DownloadSpec {
  kind: FileKind
  /** Path relative to the shared folder — used in logs and error messages. */
  path: string
}

/** Candidate URLs of a vanilla version json: BMCLAPI form first, then original. */
export function versionJsonUrls(versionId: string, originalUrl?: string): string[] {
  const urls = [`${BMCL_MIRROR}/version/${versionId}/json`]
  if (originalUrl) urls.push(originalUrl, originalUrl.replace('https://piston-meta.mojang.com', BMCL_MIRROR))
  return [...new Set(urls)]
}

/** Candidate URLs of the client jar (BMCLAPI serves `/version/<id>/client`). */
export function clientJarUrls(versionId: string, originalUrl?: string): string[] {
  const urls = [`${BMCL_MIRROR}/version/${versionId}/client`]
  if (originalUrl) {
    urls.push(originalUrl)
    urls.push(originalUrl.replace('https://piston-data.mojang.com', BMCL_MIRROR))
  }
  return [...new Set(urls)]
}

export interface AssetIndexLike {
  objects: Record<string, { hash: string; size: number }>
}

/** Absolute path of the asset index json. */
export function assetIndexPath(sharedDir: string, id: string): string {
  return join(sharedDir, 'assets', 'indexes', `${id}.json`)
}

/** Candidate URLs for the asset index — the mirror serves it by id. */
export function assetIndexUrls(version: Pick<ResolvedVersion, 'assetIndex' | 'assets'>): string[] {
  const id = version.assetIndex?.id ?? version.assets
  const urls = id ? [`${BMCL_MIRROR}/assets/indexes/${id}.json`] : []
  if (version.assetIndex?.url) urls.push(version.assetIndex.url)
  return [...new Set(urls)]
}

/**
 * Every library file of a resolved version, natives included (a native shows up
 * as its own `ResolvedLibrary` with `isNative: true`).
 */
export function planLibraries(version: Pick<ResolvedVersion, 'libraries'>, sharedDir: string): PlannedFile[] {
  const files: PlannedFile[] = []
  const seen = new Set<string>()
  for (const library of version.libraries) {
    const artifact = library.download
    if (!artifact?.path || !artifact.url) continue
    if (seen.has(artifact.path)) continue
    seen.add(artifact.path)
    files.push({
      kind: library.isNative ? 'native' : 'library',
      url: artifact.url,
      destination: join(sharedDir, 'libraries', artifact.path),
      path: `libraries/${artifact.path}`,
      sha1: artifact.sha1 && artifact.sha1.length === 40 ? artifact.sha1 : undefined,
      size: artifact.size > 0 ? artifact.size : undefined,
      name: artifact.path.split('/').pop() ?? artifact.path
    })
  }
  return files
}

/** Every asset object referenced by an index. */
export function planAssets(index: AssetIndexLike, sharedDir: string): PlannedFile[] {
  const files: PlannedFile[] = []
  for (const [name, object] of Object.entries(index.objects ?? {})) {
    if (!object?.hash) continue
    const prefix = object.hash.slice(0, 2)
    files.push({
      kind: 'asset',
      url: `https://resources.download.minecraft.net/${prefix}/${object.hash}`,
      destination: join(sharedDir, 'assets', 'objects', prefix, object.hash),
      path: `assets/objects/${prefix}/${object.hash}`,
      sha1: object.hash,
      size: object.size,
      // The visible name is the asset path; the hash is noise in a toast.
      name: name.split('/').pop() ?? name
    })
  }
  return files
}

/** The log4j config a version uses, if any. */
export function planLogging(version: Pick<ResolvedVersion, 'logging'>, sharedDir: string): PlannedFile[] {
  const entries = Object.values(version.logging ?? {})
  return entries
    .filter((entry) => entry?.file?.url && entry.file.id)
    .map((entry) => ({
      kind: 'logging' as const,
      url: entry.file.url,
      destination: join(sharedDir, 'assets', 'log_configs', entry.file.id),
      path: `assets/log_configs/${entry.file.id}`,
      sha1: entry.file.sha1,
      size: entry.file.size,
      name: entry.file.id
    }))
}

async function sizeOf(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size
  } catch {
    return null
  }
}

export interface MissingPlan {
  todo: PlannedFile[]
  /** Bytes that still have to come over the wire. */
  bytes: number
  present: number
}

/**
 * Keeps only what is really missing. A file of the expected size is considered
 * done — that is the "resume" half of the feature: a retry after a network drop
 * skips the 40 MB already on disk and continues with the rest.
 */
export async function planMissing(files: readonly PlannedFile[]): Promise<MissingPlan> {
  const todo: PlannedFile[] = []
  let bytes = 0
  let present = 0
  await Promise.all(
    files.map(async (file) => {
      const size = await sizeOf(file.destination)
      if (file.size !== undefined && size === file.size) {
        present += 1
        return
      }
      // Unknown size: a non-empty file without metadata is still a finished one
      // only if we have a hash to compare later; otherwise re-download.
      if (file.size === undefined && size !== null && size > 0) {
        present += 1
        return
      }
      todo.push(file)
      bytes += file.size ?? 0
    })
  )
  // `Promise.all` finishes in whatever order the disk answers, so the queue is
  // sorted by path: a resume run then shows the same list on every machine and
  // the error message ("не удалось скачать X") is reproducible.
  todo.sort((a, b) => a.path.localeCompare(b.path))
  return { todo, bytes, present }
}

export interface AssetIndexResult {
  index: AssetIndexLike | null
  file: string | null
  error?: string
}

/**
 * Makes sure `assets/indexes/<id>.json` exists and parses. The mirror is asked
 * first: it answers `<mirror>/assets/indexes/<id>.json` without a redirect.
 */
export async function ensureAssetIndex(
  version: Pick<ResolvedVersion, 'assetIndex' | 'assets'>,
  sharedDir: string,
  options: { signal?: AbortSignal } = {}
): Promise<AssetIndexResult> {
  const id = version.assetIndex?.id ?? version.assets
  if (!id) return { index: null, file: null, error: 'В версии нет asset index' }
  const target = assetIndexPath(sharedDir, id)

  const readIndex = async (): Promise<AssetIndexLike | null> => {
    try {
      const text = await (await import('node:fs/promises')).readFile(target, 'utf8')
      const parsed = JSON.parse(text) as AssetIndexLike
      return parsed?.objects ? parsed : null
    } catch {
      return null
    }
  }

  const cached = await readIndex()
  if (cached) return { index: cached, file: target }

  const urls = assetIndexUrls(version)
  let lastError = 'нет доступных адресов'
  for (const url of urls) {
    try {
      await downloadFile({ url, destination: target, name: `${id}.json` }, { signal: options.signal, retries: 1 })
      const parsed = await readIndex()
      if (parsed) return { index: parsed, file: target }
      lastError = 'файл индекса не разобрался'
    } catch (error) {
      lastError = (error as Error).message
    }
  }
  return { index: null, file: null, error: lastError }
}
