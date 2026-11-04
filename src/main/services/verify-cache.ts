/**
 * Incremental file verification (Task 4).
 *
 * The pre-launch integrity check used to `stat()` every library and every asset
 * object on each start — on a 1.21.4 install that is well over a thousand syscalls
 * per click. This module keeps a small fingerprint cache per instance and only
 * hashes what actually changed:
 *
 *   1. `stat()` the file — missing / wrong size is an immediate problem;
 *   2. size **and** mtime match the cached fingerprint → the file is untouched,
 *      no hashing at all (the common case: 100 % of a healthy install after the
 *      first run);
 *   3. otherwise read the file, compare sha1 and refresh the fingerprint.
 *
 * The decision logic is pure (`judgeFile`, `mergeCache`) so it is unit-tested
 * without touching a disk.
 */

import { createHash } from 'node:crypto'
import { readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export type ExpectedFileKind = 'client' | 'library' | 'asset' | 'assetIndex'

export interface ExpectedFile {
  kind: ExpectedFileKind
  /** Absolute path on disk. */
  path: string
  /** Human readable name for the UI (`client.jar`, `assets/…`). */
  name: string
  /** Expected size in bytes, 0 when unknown. */
  size: number
  /** Expected sha1, undefined when the source does not publish one. */
  sha1?: string
}

export interface Fingerprint {
  size: number
  mtimeMs: number
  /** Kept so a later `deep` run can compare without re-hashing. */
  sha1?: string
}

export type FileStat = { size: number; mtimeMs: number } | null

export interface VerifyCache {
  versionId: string
  updatedAt: string
  files: Record<string, Fingerprint>
}

export const VERIFY_CACHE_FILE = '.verdant-verified.json'

export type Verdict =
  /** Size + mtime match the cache: nothing to do. */
  | 'unchanged'
  /** Not in the cache (first run after an install): trust stat, remember it. */
  | 'new'
  /** Stat changed: read the file and compare the hash. */
  | 'changed'
  /** Hash matched: refresh the fingerprint, file is fine. */
  | 'rehashed'
  | 'missing'
  | 'truncated'

export interface Judgement {
  verdict: Verdict
  /** True when the caller must read the file and compare `sha1`. */
  hash: boolean
  /** Fingerprint to store when the file turns out to be fine. */
  fingerprint?: Fingerprint
  reason?: 'missing' | 'size_changed'
}

/**
 * Decides what to do with a single file without reading it.
 *
 * `deep` turns the check into a full hash pass (used by «Проверить файлы» in the
 * UI and by CI), while the default launch path stays stat-first.
 */
export function judgeFile(file: ExpectedFile, info: FileStat, cached: Fingerprint | undefined, deep = false): Judgement {
  if (!info || info.size <= 0) return { verdict: 'missing', hash: false, reason: 'missing' }

  if (file.size > 0 && info.size !== file.size) {
    // A file that exists with the wrong size can only be fixed by re-downloading.
    return { verdict: 'truncated', hash: false, reason: 'size_changed' }
  }

  const fingerprint: Fingerprint = {
    size: info.size,
    mtimeMs: info.mtimeMs,
    sha1: cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs ? cached.sha1 : undefined
  }

  const statMatches = cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs

  // A cold cache (first run after an install) is stat-only on purpose: reading
  // every library and asset on the first click is exactly the startup cost this
  // task removes. From the second run on we have a baseline, and only files
  // whose stat moved are hashed.
  if (!cached) return { verdict: 'new', hash: false, fingerprint }
  if (!deep && statMatches) return { verdict: 'unchanged', hash: false, fingerprint }
  if (!file.sha1) return { verdict: 'unchanged', hash: false, fingerprint }

  return { verdict: 'changed', hash: true, fingerprint }
}

export interface VerifyStats {
  checked: number
  /** Files that needed a read + sha1. */
  hashed: number
  /** Files accepted from stat alone. */
  skipped: number
  missing: number
}

export interface VerifyOutcome {
  ok: boolean
  issues: Array<{ file: ExpectedFile; verdict: Verdict; actualSize?: number }>
  files: Record<string, Fingerprint>
  stats: VerifyStats
}

export interface VerifyIo {
  stat: (path: string) => Promise<FileStat>
  hash: (path: string) => Promise<string | null>
}

export const diskIo: VerifyIo = {
  stat: async (path) => {
    try {
      const info = await stat(path)
      return info.isFile() ? { size: info.size, mtimeMs: info.mtimeMs } : null
    } catch {
      return null
    }
  },
  hash: async (path) => {
    try {
      return createHash('sha1').update(await readFile(path)).digest('hex')
    } catch {
      return null
    }
  }
}

/**
 * Verifies a batch of expectations against the cache and returns the refreshed
 * fingerprints. Files are processed with a bounded worker pool so a spinning
 * disk is not thrashed by a thousand parallel reads.
 */
export async function verifyFiles(
  expected: ExpectedFile[],
  cache: VerifyCache | null,
  options: { deep?: boolean; concurrency?: number; io?: VerifyIo } = {}
): Promise<VerifyOutcome> {
  const io = options.io ?? diskIo
  const deep = options.deep ?? false
  const concurrency = options.concurrency ?? 24
  const files: Record<string, Fingerprint> = {}
  const issues: VerifyOutcome['issues'] = []
  const stats: VerifyStats = { checked: expected.length, hashed: 0, skipped: 0, missing: 0 }

  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, expected.length)) }, async () => {
    for (;;) {
      const index = cursor++
      if (index >= expected.length) return
      const file = expected[index]
      const cached = cache?.files[file.path]
      const info = await io.stat(file.path)
      const judgement = judgeFile(file, info, cached, deep)

      if (judgement.verdict === 'missing' || judgement.verdict === 'truncated') {
        stats.missing++
        issues.push({ file, verdict: judgement.verdict, actualSize: info?.size })
        continue
      }

      if (judgement.hash && file.sha1) {
        stats.hashed++
        const digest = await io.hash(file.path)
        if (!digest || digest !== file.sha1) {
          issues.push({ file, verdict: 'truncated', actualSize: info?.size })
          continue
        }
        if (judgement.fingerprint) judgement.fingerprint.sha1 = digest
      } else {
        stats.skipped++
      }

      if (judgement.fingerprint) files[file.path] = judgement.fingerprint
    }
  })
  await Promise.all(workers)

  return { ok: issues.length === 0, issues, files, stats }
}

/** Drops fingerprints of files that are no longer part of the install. */
export function mergeCache(
  versionId: string,
  files: Record<string, Fingerprint>,
  previous: VerifyCache | null
): VerifyCache {
  const merged: Record<string, Fingerprint> = {}
  for (const [path, fingerprint] of Object.entries(files)) {
    const old = previous?.files[path]
    merged[path] = old && old.sha1 && !fingerprint.sha1 ? { ...fingerprint, sha1: old.sha1 } : fingerprint
  }
  return { versionId, updatedAt: new Date().toISOString(), files: merged }
}

export function cacheIsUsable(cache: VerifyCache | null, versionId: string): cache is VerifyCache {
  return Boolean(cache && cache.versionId === versionId && cache.files)
}

export function cachePath(instanceDir: string): string {
  return join(instanceDir, VERIFY_CACHE_FILE)
}

export async function loadVerifyCache(instanceDir: string): Promise<VerifyCache | null> {
  try {
    const raw = await readFile(cachePath(instanceDir), 'utf8')
    const parsed = JSON.parse(raw) as VerifyCache
    if (!parsed || typeof parsed !== 'object' || typeof parsed.versionId !== 'string') return null
    if (!parsed.files || typeof parsed.files !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

export async function saveVerifyCache(instanceDir: string, cache: VerifyCache): Promise<void> {
  const target = cachePath(instanceDir)
  const temporary = `${target}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(cache), 'utf8')
    await rename(temporary, target)
  } catch {
    // A cache that cannot be written only costs speed, never correctness.
    await unlink(temporary).catch(() => undefined)
  }
}

/** Called by the installer: after files change, the old fingerprint set is a lie. */
export async function invalidateVerifyCache(instanceDir: string): Promise<void> {
  await unlink(cachePath(instanceDir)).catch(() => undefined)
}
