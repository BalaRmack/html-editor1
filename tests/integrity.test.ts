import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { toFailure } from '../src/main/services/errors'
import { checkIntegrity } from '../src/main/services/integrity'

const roots: string[] = []

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
})

const LIB_PATH = 'com/example/testlib/1.0/testlib-1.0.jar'
const CLIENT_JAR = 'not-a-real-jar'
const ASSET_HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
const ASSET_SIZE = 128

interface FakeOptions {
  withClient?: boolean
  withLibrary?: boolean
  withIndex?: boolean
  withAsset?: boolean
}

async function createFakeInstance(id: string, options: FakeOptions = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'verdant-integrity-'))
  roots.push(root)
  const versionDir = join(root, 'versions', id)
  await mkdir(versionDir, { recursive: true })

  const manifest = {
    id,
    type: 'release',
    mainClass: 'net.minecraft.client.main.Main',
    assets: 'test-assets',
    assetIndex: { id: 'test-assets', sha1: '0'.repeat(40), size: 1, totalSize: ASSET_SIZE, url: 'https://x/index.json' },
    downloads: { client: { sha1: '0'.repeat(40), size: CLIENT_JAR.length, url: 'https://x/client.jar' } },
    libraries: [
      {
        name: 'com.example:testlib:1.0',
        downloads: {
          artifact: { path: LIB_PATH, sha1: '0'.repeat(40), size: 4, url: 'https://x/lib.jar' }
        }
      }
    ],
    arguments: { game: [], jvm: [] }
  }
  await writeFile(join(versionDir, `${id}.json`), JSON.stringify(manifest))

  if (options.withClient !== false) await writeFile(join(versionDir, `${id}.jar`), CLIENT_JAR)
  if (options.withLibrary !== false) {
    await mkdir(join(root, 'libraries', 'com/example/testlib/1.0'), { recursive: true })
    await writeFile(join(root, 'libraries', LIB_PATH), 'lib!')
  }
  if (options.withIndex !== false) {
    await mkdir(join(root, 'assets', 'indexes'), { recursive: true })
    await writeFile(
      join(root, 'assets', 'indexes', 'test-assets.json'),
      JSON.stringify({ objects: { 'minecraft/sounds/click.ogg': { hash: ASSET_HASH, size: ASSET_SIZE } } })
    )
  }
  if (options.withAsset !== false) {
    await mkdir(join(root, 'assets', 'objects', ASSET_HASH.slice(0, 2)), { recursive: true })
    await writeFile(join(root, 'assets', 'objects', ASSET_HASH.slice(0, 2), ASSET_HASH), 'a'.repeat(ASSET_SIZE))
  }
  return root
}

describe('integrity check', () => {
  it('passes when every file is present with the right size', async () => {
    const root = await createFakeInstance('ok-1')
    const report = await checkIntegrity({ id: 'a', versionId: 'ok-1', mcVersion: 'ok-1' }, root)

    expect(report.ok).toBe(true)
    expect(report.missing).toEqual([])
    expect(report.counts.libraries).toBe(1)
    expect(report.counts.assets).toBe(1)
    expect(report.counts.checked).toBeGreaterThanOrEqual(3)
  })

  it('reports a half-downloaded instance (the bug that enabled «Играть»)', async () => {
    const root = await createFakeInstance('broken-1', { withLibrary: false, withAsset: false })
    const report = await checkIntegrity({ id: 'b', versionId: 'broken-1', mcVersion: 'broken-1' }, root)

    expect(report.ok).toBe(false)
    expect(report.code).toBe('integrity_failed')
    expect(report.missing.map((issue) => issue.kind).sort()).toEqual(['asset', 'library'])
    expect(report.missing.find((issue) => issue.kind === 'library')?.name).toBe('testlib-1.0.jar')
  })

  it('detects a truncated file via its expected size', async () => {
    const root = await createFakeInstance('trunc-1', { withAsset: false })
    // Asset exists but is shorter than the index says.
    const dir = join(root, 'assets', 'objects', ASSET_HASH.slice(0, 2))
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, ASSET_HASH), 'short')

    const report = await checkIntegrity({ id: 'c', versionId: 'trunc-1', mcVersion: 'trunc-1' }, root)
    expect(report.ok).toBe(false)
    const asset = report.missing.find((issue) => issue.kind === 'asset')
    expect(asset).toMatchObject({ name: 'minecraft/sounds/click.ogg', expectedSize: ASSET_SIZE, actualSize: 5 })
  })

  it('detects a missing client jar and asset index', async () => {
    const root = await createFakeInstance('nojar-1', { withClient: false, withIndex: false })
    const report = await checkIntegrity({ id: 'd', versionId: 'nojar-1', mcVersion: 'nojar-1' }, root)
    const kinds = report.missing.map((issue) => issue.kind)
    expect(kinds).toContain('client')
    expect(kinds).toContain('assetIndex')
  })

  it('flags an instance that was never installed', async () => {
    const root = await createFakeInstance('ghost-1')
    const report = await checkIntegrity({ id: 'e', versionId: 'missing-version', mcVersion: '1.21.4' }, root)
    expect(report.ok).toBe(false)
    expect(report.code).toBe('not_installed')
  })
})

describe('install error mapping', () => {
  it('turns a download failure into a file-aware network error', () => {
    const failure = toFailure(
      new Error('Fail to download https://piston-data.mojang.com/v1/objects/abc/client.jar: ECONNRESET'),
      'libraries'
    )
    expect(failure).toMatchObject({
      code: 'network_error',
      file: 'client.jar',
      stage: 'libraries',
      retryable: true
    })
    expect(failure.message).toContain('client.jar')
  })

  it('keeps the file name for fetch-style errors', () => {
    const failure = toFailure(new Error('request to https://maven.fabricmc.net/net/fabricmc/fabric-loader/0.16.10/fabric-loader-0.16.10.jar failed, reason: getaddrinfo ENOTFOUND'))
    expect(failure.code).toBe('network_error')
    expect(failure.file).toBe('fabric-loader-0.16.10.jar')
  })

  it('never offers a retry for cancellation', () => {
    const failure = toFailure(new Error('Установка отменена'))
    expect(failure.code).toBe('cancelled')
    expect(failure.retryable).toBe(false)
  })

  it('keeps disk-full errors separate from network errors', () => {
    const failure = toFailure(new Error('ENOSPC: no space left on device'))
    expect(failure).toMatchObject({ code: 'disk_error', retryable: false })
  })
})
