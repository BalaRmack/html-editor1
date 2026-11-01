import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assetIndexUrls,
  clientJarUrls,
  ensureAssetIndex,
  planAssets,
  planLibraries,
  planMissing,
  versionJsonUrls
} from '../src/main/services/assets'

type Lib = Parameters<typeof planLibraries>[0]['libraries'][number]

function library(path: string, url: string, extra: Partial<Lib> = {}): Lib {
  return {
    name: path,
    path,
    isNative: false,
    download: { path, url, sha1: 'a'.repeat(40), size: 1024 },
    ...extra
  } as unknown as Lib
}

describe('planLibraries', () => {
  it('maps every artifact to libraries/<path> with its own name', () => {
    const shared = join('C:', 'Verdant', 'shared')
    const files = planLibraries(
      {
        libraries: [
          library('com/google/guava/guava-31.jar', 'https://libraries.minecraft.net/com/google/guava/guava-31.jar'),
          library(
            'org/lwjgl/lwjgl-3.3.3-natives-windows.jar',
            'https://libraries.minecraft.net/org/lwjgl/lwjgl-3.3.3-natives-windows.jar',
            { isNative: true }
          )
        ]
      },
      shared
    )
    expect(files).toHaveLength(2)
    expect(files[0].kind).toBe('library')
    expect(files[1].kind).toBe('native')
    expect(files[0].destination).toBe(join(shared, 'libraries', 'com/google/guava/guava-31.jar'))
    expect(files[0].name).toBe('guava-31.jar')
    expect(files[0].sha1).toHaveLength(40)
  })

  it('de-duplicates and skips entries without a path or url', () => {
    const files = planLibraries(
      {
        libraries: [
          library('a/b.jar', 'https://libraries.minecraft.net/a/b.jar'),
          library('a/b.jar', 'https://libraries.minecraft.net/a/b.jar'),
          { name: 'broken', isNative: false, download: { path: '', url: '', sha1: '', size: 0 } } as unknown as Lib
        ]
      },
      'shared'
    )
    expect(files).toHaveLength(1)
  })
})

describe('planAssets', () => {
  it('builds the <2>/<hash> layout and the official object url', () => {
    const files = planAssets(
      { objects: { 'minecraft/sounds/click.ogg': { hash: 'abcdef0123456789', size: 4096 } } },
      'shared'
    )
    expect(files).toHaveLength(1)
    expect(files[0].url).toBe('https://resources.download.minecraft.net/ab/abcdef0123456789')
    expect(files[0].destination).toBe(join('shared', 'assets', 'objects', 'ab', 'abcdef0123456789'))
    expect(files[0].name).toBe('click.ogg')
    expect(files[0].sha1).toBe('abcdef0123456789')
  })

  it('skips nameless objects', () => {
    expect(planAssets({ objects: { 'x/y.ogg': { hash: '', size: 1 } } }, 'shared')).toHaveLength(0)
  })
})

describe('planMissing — resume skips what is already on disk', () => {
  it('keeps only files with a size mismatch and sums their bytes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'verdant-plan-'))
    try {
      const good = join(dir, 'good.jar')
      const wrong = join(dir, 'wrong.jar')
      await writeFile(good, Buffer.alloc(2048))
      await writeFile(wrong, Buffer.alloc(10))
      const files = [
        { kind: 'library' as const, url: 'https://x/good.jar', destination: good, path: 'libraries/good.jar', size: 2048, name: 'good.jar' },
        { kind: 'library' as const, url: 'https://x/wrong.jar', destination: wrong, path: 'libraries/wrong.jar', size: 999_999, name: 'wrong.jar' },
        {
          kind: 'library' as const,
          url: 'https://x/missing.jar',
          destination: join(dir, 'missing.jar'),
          path: 'libraries/missing.jar',
          size: 5_000,
          name: 'missing.jar'
        }
      ]
      const plan = await planMissing(files)
      expect(plan.present).toBe(1)
      // sorted by path, not by the order the disk happened to answer
      expect(plan.todo.map((file) => file.name)).toEqual(['missing.jar', 'wrong.jar'])
      expect(plan.bytes).toBe(999_999 + 5_000)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('mirror-first candidate lists', () => {
  it('asks BMCLAPI for the version json and the client jar first', () => {
    const json = versionJsonUrls('1.21.4', 'https://piston-meta.mojang.com/v1/packages/aa/1.21.4.json')
    expect(json[0]).toBe('https://bmclapi2.bangbang93.com/version/1.21.4/json')
    expect(json).toContain('https://piston-meta.mojang.com/v1/packages/aa/1.21.4.json')

    const jar = clientJarUrls('1.21.4', 'https://piston-data.mojang.com/v1/objects/bb/client.jar')
    expect(jar[0]).toBe('https://bmclapi2.bangbang93.com/version/1.21.4/client')
    expect(jar[1]).toBe('https://piston-data.mojang.com/v1/objects/bb/client.jar')
  })

  it('asks the mirror for the asset index by id', () => {
    const urls = assetIndexUrls({ assets: '19', assetIndex: { id: '19', url: 'https://piston-meta.mojang.com/x/19.json', sha1: '', size: 1, totalSize: 1 } })
    expect(urls[0]).toBe('https://bmclapi2.bangbang93.com/assets/indexes/19.json')
  })
})

describe('ensureAssetIndex', () => {
  it('reads a cached index without any request', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'verdant-index-'))
    try {
      const target = join(dir, 'assets', 'indexes', '19.json')
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'assets', 'indexes'), { recursive: true })
      await writeFile(target, JSON.stringify({ objects: { 'a/b.png': { hash: 'cc', size: 12 } } }))
      const result = await ensureAssetIndex({ assets: '19', assetIndex: { id: '19', url: '', sha1: '', size: 1, totalSize: 1 } }, dir)
      expect(result.index?.objects['a/b.png'].size).toBe(12)
      expect(result.file).toBe(target)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
