import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cacheIsUsable,
  invalidateVerifyCache,
  judgeFile,
  loadVerifyCache,
  mergeCache,
  saveVerifyCache,
  verifyFiles,
  type ExpectedFile,
  type VerifyCache,
  type VerifyIo
} from '../src/main/services/verify-cache'

function file(overrides: Partial<ExpectedFile> = {}): ExpectedFile {
  return {
    kind: 'library',
    path: 'C:/Verdant/shared/libraries/org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3.jar',
    name: 'lwjgl-3.3.3.jar',
    size: 1000,
    sha1: 'a'.repeat(40),
    ...overrides
  }
}

describe('judgeFile', () => {
  it('reports a missing file', () => {
    expect(judgeFile(file(), null, undefined)).toMatchObject({ verdict: 'missing', hash: false })
  })

  it('reports a zero-byte file as missing (half-finished download)', () => {
    expect(judgeFile(file(), { size: 0, mtimeMs: 1 }, undefined).verdict).toBe('missing')
  })

  it('reports a size mismatch without reading the file', () => {
    const result = judgeFile(file(), { size: 512, mtimeMs: 1 }, undefined)
    expect(result).toMatchObject({ verdict: 'truncated', hash: false, reason: 'size_changed' })
  })

  it('trusts the cache when size and mtime are unchanged (no hashing)', () => {
    const cache = { size: 1000, mtimeMs: 1700000000000, sha1: 'a'.repeat(40) }
    const result = judgeFile(file(), { size: 1000, mtimeMs: 1700000000000 }, cache)
    expect(result).toMatchObject({ verdict: 'unchanged', hash: false })
  })

  it('hashes when the mtime changed', () => {
    const cache = { size: 1000, mtimeMs: 1, sha1: 'a'.repeat(40) }
    const result = judgeFile(file(), { size: 1000, mtimeMs: 2 }, cache)
    expect(result).toMatchObject({ verdict: 'changed', hash: true })
  })

  it('does not read a file that is not in the cache yet (cold start stays stat-only)', () => {
    expect(judgeFile(file(), { size: 1000, mtimeMs: 5 }, undefined)).toMatchObject({ verdict: 'new', hash: false })
  })

  it('falls back to stat when the source publishes no sha1', () => {
    const noHash = file({ sha1: undefined })
    const cache = { size: 1000, mtimeMs: 5 }
    expect(judgeFile(noHash, { size: 1000, mtimeMs: 9 }, cache)).toMatchObject({ verdict: 'unchanged', hash: false })
  })

  it('hashes everything in deep mode', () => {
    const cache = { size: 1000, mtimeMs: 5, sha1: 'a'.repeat(40) }
    expect(judgeFile(file(), { size: 1000, mtimeMs: 5 }, cache, true).hash).toBe(true)
  })
})

describe('verifyFiles', () => {
  const expected = [
    file({ path: '/a.jar', name: 'a.jar' }),
    file({ path: '/b.jar', name: 'b.jar', sha1: 'b'.repeat(40) }),
    file({ path: '/c.jar', name: 'c.jar', size: 10, sha1: 'c'.repeat(40) })
  ]

  function io(overrides: Partial<VerifyIo> = {}): VerifyIo {
    return {
      stat: async (path) => {
        if (path === '/c.jar') return { size: 4, mtimeMs: 1 } // truncated
        return { size: 1000, mtimeMs: 100 }
      },
      hash: async (path) => (path === '/b.jar' ? 'b'.repeat(40) : 'a'.repeat(40)),
      ...overrides
    }
  }

  it('never reads files on a cold cache, and still reports real problems', async () => {
    const hash = vi.fn(async (path: string) => (path === '/b.jar' ? 'b'.repeat(40) : 'a'.repeat(40)))
    const outcome = await verifyFiles(expected, null, { io: io({ hash }) })

    expect(outcome.ok).toBe(false)
    expect(outcome.issues).toHaveLength(1)
    expect(outcome.issues[0].file.name).toBe('c.jar')
    expect(outcome.issues[0].verdict).toBe('truncated')
    expect(outcome.issues[0].actualSize).toBe(4)
    // nothing was hashed: the first check costs one stat per file
    expect(hash).not.toHaveBeenCalled()
    expect(outcome.stats.hashed).toBe(0)
    expect(outcome.stats.skipped).toBe(2)
  })

  it('skips hashing entirely on a warm cache', async () => {
    const cache: VerifyCache = {
      versionId: 'fabric-1.21.4',
      updatedAt: new Date().toISOString(),
      files: {
        '/a.jar': { size: 1000, mtimeMs: 100, sha1: 'a'.repeat(40) },
        '/b.jar': { size: 1000, mtimeMs: 100, sha1: 'b'.repeat(40) }
      }
    }
    const hash = vi.fn(async () => 'a'.repeat(40))
    const outcome = await verifyFiles(expected.slice(0, 2), cache, { io: io({ hash }) })

    expect(outcome.ok).toBe(true)
    expect(hash).not.toHaveBeenCalled()
    expect(outcome.stats.skipped).toBe(2)
    expect(outcome.stats.hashed).toBe(0)
  })

  it('re-hashes a file whose mtime moved and keeps it when the hash still matches', async () => {
    const cache: VerifyCache = {
      versionId: 'v',
      updatedAt: '',
      files: { '/a.jar': { size: 1000, mtimeMs: 1, sha1: 'a'.repeat(40) } }
    }
    const outcome = await verifyFiles([expected[0]], cache, { io: io() })
    expect(outcome.ok).toBe(true)
    expect(outcome.stats.hashed).toBe(1)
    expect(outcome.files['/a.jar']).toMatchObject({ size: 1000, mtimeMs: 100, sha1: 'a'.repeat(40) })
  })

  it('flags a file whose hash no longer matches', async () => {
    const cache: VerifyCache = {
      versionId: 'v',
      updatedAt: '',
      files: { '/a.jar': { size: 1000, mtimeMs: 1, sha1: 'a'.repeat(40) } }
    }
    const outcome = await verifyFiles([expected[0]], cache, {
      io: io({ hash: async () => 'deadbeef' })
    })
    expect(outcome.ok).toBe(false)
    expect(outcome.issues[0].verdict).toBe('truncated')
  })

  it('handles an empty expectation list', async () => {
    const outcome = await verifyFiles([], null)
    expect(outcome).toMatchObject({ ok: true, issues: [], stats: { checked: 0, hashed: 0 } })
  })
})

describe('cache persistence', () => {
  let dir = ''

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'verdant-verify-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('round-trips through .verdant-verified.json', async () => {
    const cache = mergeCache('1.21.4', { '/a.jar': { size: 1, mtimeMs: 2, sha1: 'x' } }, null)
    await saveVerifyCache(dir, cache)
    const loaded = await loadVerifyCache(dir)
    expect(loaded?.versionId).toBe('1.21.4')
    expect(loaded?.files['/a.jar']).toEqual({ size: 1, mtimeMs: 2, sha1: 'x' })
    expect(cacheIsUsable(loaded, '1.21.4')).toBe(true)
    expect(cacheIsUsable(loaded, '1.21.5')).toBe(false)
  })

  it('ignores a corrupt cache instead of throwing', async () => {
    await writeFile(join(dir, '.verdant-verified.json'), '\u0000\u0000', 'utf8')
    expect(await loadVerifyCache(dir)).toBeNull()
  })

  it('is invalidated before a reinstall', async () => {
    await saveVerifyCache(dir, mergeCache('1.21.4', {}, null))
    await invalidateVerifyCache(dir)
    expect(await loadVerifyCache(dir)).toBeNull()
  })

  it('drops fingerprints of files that are no longer part of the install', () => {
    const previous = mergeCache('v', { '/old.jar': { size: 1, mtimeMs: 1 } }, null)
    const next = mergeCache('v', { '/new.jar': { size: 2, mtimeMs: 2 } }, previous)
    expect(Object.keys(next.files)).toEqual(['/new.jar'])
  })
})
