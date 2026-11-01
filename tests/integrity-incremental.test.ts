import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkIntegrity } from '../src/main/services/integrity'
import { loadVerifyCache, VERIFY_CACHE_FILE } from '../src/main/services/verify-cache'

/**
 * Task 4, end to end on a real temp directory: the second check must not hash
 * anything, and a file that changed on disk must be re-hashed and caught.
 */

const sha1 = (data: string): string => createHash('sha1').update(data).digest('hex')

const CLIENT = 'client-jar-bytes'
const LIB = 'library-bytes!'
const ASSET = 'a'.repeat(128)
const LIB_PATH = 'com/example/testlib/1.0/testlib-1.0.jar'
const ASSET_HASH = sha1(ASSET)

let root = ''
let instanceDir = ''

async function fixture(): Promise<void> {
  const versionDir = join(root, 'versions', '1.21.4')
  await mkdir(versionDir, { recursive: true })

  const manifest = {
    id: '1.21.4',
    type: 'release',
    mainClass: 'net.minecraft.client.main.Main',
    assets: 'test-assets',
    assetIndex: { id: 'test-assets', sha1: '0'.repeat(40), size: 1, url: 'https://x/index.json' },
    downloads: { client: { sha1: sha1(CLIENT), size: CLIENT.length, url: 'https://x/client.jar' } },
    libraries: [
      {
        name: 'com.example:testlib:1.0',
        downloads: { artifact: { path: LIB_PATH, sha1: sha1(LIB), size: LIB.length, url: 'https://x/lib.jar' } }
      }
    ],
    arguments: { game: [], jvm: [] }
  }
  await writeFile(join(versionDir, '1.21.4.json'), JSON.stringify(manifest))
  await writeFile(join(versionDir, '1.21.4.jar'), CLIENT)

  await mkdir(join(root, 'libraries', 'com/example/testlib/1.0'), { recursive: true })
  await writeFile(join(root, 'libraries', LIB_PATH), LIB)

  await mkdir(join(root, 'assets', 'indexes'), { recursive: true })
  await writeFile(
    join(root, 'assets', 'indexes', 'test-assets.json'),
    JSON.stringify({ objects: { 'minecraft/sound.ogg': { hash: ASSET_HASH, size: ASSET.length } } })
  )
  await mkdir(join(root, 'assets', 'objects', ASSET_HASH.slice(0, 2)), { recursive: true })
  await writeFile(join(root, 'assets', 'objects', ASSET_HASH.slice(0, 2), ASSET_HASH), ASSET)
}

const target = (): { id: string; versionId: string; mcVersion: string; instanceDir: string } => ({
  id: 'instance-1',
  versionId: '1.21.4',
  mcVersion: '1.21.4',
  instanceDir
})

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'verdant-incremental-'))
  instanceDir = join(root, 'instances', 'instance-1', 'minecraft')
  await mkdir(instanceDir, { recursive: true })
  await fixture()
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('incremental integrity check', () => {
  it('validates by stat on the first run and writes the fingerprint cache', async () => {
    const report = await checkIntegrity(target(), root)

    expect(report.ok).toBe(true)
    expect(report.counts.checked).toBe(3) // client + library + asset
    expect(report.counts.hashed).toBe(0)
    expect(report.counts.skipped).toBe(3)

    const cache = await loadVerifyCache(instanceDir)
    expect(cache?.versionId).toBe('1.21.4')
    expect(Object.keys(cache?.files ?? {})).toHaveLength(3)
    expect(cache?.files[join(root, 'libraries', LIB_PATH)]).toMatchObject({ size: LIB.length })
  })

  it('does no reads at all on the second run', async () => {
    await checkIntegrity(target(), root)
    const second = await checkIntegrity(target(), root)

    expect(second.ok).toBe(true)
    expect(second.counts.hashed).toBe(0)
    expect(second.counts.skipped).toBe(second.counts.checked)
  })

  it('re-hashes only the file that changed and reports it', async () => {
    await checkIntegrity(target(), root)

    // Same size, different bytes, new mtime — exactly what a partial download or
    // a corrupted disk sector looks like.
    await writeFile(join(root, 'libraries', LIB_PATH), 'X'.repeat(LIB.length))

    const report = await checkIntegrity(target(), root)
    expect(report.ok).toBe(false)
    expect(report.missing).toHaveLength(1)
    expect(report.missing[0]).toMatchObject({ kind: 'library', name: 'testlib-1.0.jar' })
    // Only that one file was read; the client jar and the asset stayed stat-only.
    expect(report.counts.hashed).toBe(1)
    expect(report.counts.skipped).toBe(2)

    // Repairing the file clears the issue on the next run.
    await writeFile(join(root, 'libraries', LIB_PATH), LIB)
    const repaired = await checkIntegrity(target(), root)
    expect(repaired.ok).toBe(true)
  })

  it('still detects a missing file with a warm cache', async () => {
    await checkIntegrity(target(), root)
    await rm(join(root, 'assets', 'objects', ASSET_HASH.slice(0, 2), ASSET_HASH))

    const report = await checkIntegrity(target(), root)
    expect(report.ok).toBe(false)
    expect(report.missing[0]).toMatchObject({ kind: 'asset', hash: ASSET_HASH })
  })

  it('hashes everything when `deep` is asked for', async () => {
    await checkIntegrity(target(), root)
    const deep = await checkIntegrity(target(), root, { deep: true })

    expect(deep.ok).toBe(true)
    expect(deep.counts.hashed).toBe(3)
    expect(deep.counts.skipped).toBe(0)
  })

  it('ignores a corrupt cache instead of failing', async () => {
    await checkIntegrity(target(), root)
    await writeFile(join(instanceDir, VERIFY_CACHE_FILE), '\u0000\u0000\u0000', 'utf8')

    const report = await checkIntegrity(target(), root)
    expect(report.ok).toBe(true)
    // Cache unreadable → cold path, which is stat-only anyway.
    expect(report.counts.hashed).toBe(0)
  })

  it('keeps the report small when everything is broken', async () => {
    await rm(join(root, 'libraries'), { recursive: true, force: true })
    await rm(join(root, 'assets', 'objects'), { recursive: true, force: true })

    const report = await checkIntegrity(target(), root, { maxIssues: 1 })
    expect(report.ok).toBe(false)
    expect(report.missing).toHaveLength(1)
    expect(report.truncatedIssues).toBe(1)
    expect(await readFile(join(instanceDir, VERIFY_CACHE_FILE), 'utf8').catch(() => null)).toBeNull()
  })
})
