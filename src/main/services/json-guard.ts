/**
 * Guard against half-downloaded / zero-filled JSON in the shared folder.
 *
 * A real-world report (see `launcher.log`) showed `assets/indexes/34.json` full
 * of `\u0000` bytes: the download was interrupted, xmcl saw an existing file and
 * never retried it, the integrity check only logged a WARN and the install hung.
 *
 * The rule implemented here: **a JSON file we cannot parse is a file we delete**,
 * so the next downloader pass has to fetch it again.
 */

import { open, readdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** NUL bytes are the signature of a truncated/zero-filled download. */
export function looksCorrupt(text: string): boolean {
  return text.length === 0 || text.includes('\u0000')
}

/**
 * Parses JSON text, treating NUL-padded content as corrupt rather than relying
 * on `JSON.parse`'s (version-dependent) error text.
 */
export function parseJsonGuard(text: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  if (text.trim().length === 0) return { ok: false, reason: 'empty file' }
  if (looksCorrupt(text)) return { ok: false, reason: 'NUL bytes in file' }
  try {
    return { ok: true, value: JSON.parse(text) as unknown }
  } catch (error) {
    return { ok: false, reason: (error as Error).message }
  }
}

/** `true` when the file exists and holds parsable JSON. */
export async function isJsonFileValid(path: string): Promise<boolean> {
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size === 0) return false
    const text = await readFile(path, 'utf8')
    return parseJsonGuard(text).ok
  } catch {
    return false
  }
}

/**
 * Deletes `path` when it is not valid JSON. Returns `true` when a file was
 * removed (i.e. the caller should re-download it).
 */
export async function dropIfBrokenJson(path: string): Promise<boolean> {
  let size = 0
  try {
    size = (await stat(path)).size
  } catch {
    return false // nothing there — nothing to drop
  }
  if (size === 0) {
    await rm(path, { force: true }).catch(() => undefined)
    return true
  }
  if (await isJsonFileValid(path)) return false
  await rm(path, { force: true }).catch(() => undefined)
  return true
}

/** Small helper: first 120 readable characters, for log messages. */
export async function brokenJsonReason(path: string): Promise<string> {
  try {
    const buffer = await readFile(path)
    const head = buffer.subarray(0, 64).toString('utf8')
    if (buffer.includes(0)) return 'NUL bytes (прерванная загрузка)'
    const parsed = parseJsonGuard(buffer.toString('utf8'))
    return parsed.ok ? 'ok' : parsed.reason.slice(0, 120)
  } catch (error) {
    return (error as Error).message.slice(0, 120)
  }
}

/**
 * Scans a folder one level deep (e.g. `assets/indexes`, `versions/<id>`) and
 * removes every `.json` that cannot be parsed. Returns the removed file names.
 */
export async function purgeBrokenJsonIn(folder: string, maxDepth = 1): Promise<string[]> {
  const removed: string[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    let entries: string[] = []
    try {
      entries = await readdir(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry)
      if (entry.toLowerCase().endsWith('.json')) {
        if (await dropIfBrokenJson(full)) removed.push(full)
        continue
      }
      if (depth > 0) {
        const info = await stat(full).catch(() => null)
        if (info?.isDirectory()) await walk(full, depth - 1)
      }
    }
  }
  await walk(folder, maxDepth)
  return removed
}

/** Keeps the OS from caching a half-written file we are about to re-download. */
export async function assertReadable(path: string): Promise<boolean> {
  try {
    const handle = await open(path, 'r')
    await handle.close()
    return true
  } catch {
    return false
  }
}
