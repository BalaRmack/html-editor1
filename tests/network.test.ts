import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateArguments, Version } from '@xmcl/core'
import { getVersionList, installVersion } from '@xmcl/installer'
import { afterAll, describe, expect, it } from 'vitest'
import { buildJvmArgs } from '../src/main/services/launch'
import { modrinthSearch, modrinthVersions } from '../src/main/services/modrinth'
import { offlineToken, offlineUuid } from '../src/main/services/offline'
import { versions } from '../src/main/services/versions'

/**
 * Live integration tests against Mojang / Modrinth / Fabric meta.
 * They need internet access, so they are skipped unless VERDANT_NET_TESTS=1
 * (CI runs them with that flag set).
 */
const enabled = process.env.VERDANT_NET_TESTS === '1'
const dirs: string[] = []

afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

describe.skipIf(!enabled)('live: mojang metadata', () => {
  it('lists minecraft versions, newest release first', async () => {
    const list = await versions.listMinecraft()
    expect(list.length).toBeGreaterThan(100)
    const firstRelease = list.find((entry) => entry.type === 'release')
    expect(firstRelease?.id).toMatch(/^\d+\.\d+/)
    expect(Date.parse(list[0].releaseTime)).toBeGreaterThan(Date.parse('2009-01-01'))
  }, 30000)

  it('downloads a vanilla version json + client jar and builds launch args', async () => {
    const root = await mkdtemp(join(tmpdir(), 'verdant-net-'))
    dirs.push(root)
    const list = await getVersionList()
    const meta = list.versions.find((entry) => entry.id === '1.20.1')
    expect(meta).toBeTruthy()

    await installVersion(meta!, root)
    const resolved = await Version.parse(root, '1.20.1')
    expect(resolved.mainClass).toBeTruthy()
    expect(resolved.libraries.length).toBeGreaterThan(10)
    expect(resolved.javaVersion?.majorVersion ?? 17).toBeGreaterThanOrEqual(17)

    const uuid = offlineUuid('Notch')
    const args = await generateArguments({
      gamePath: join(root, 'instances', 'smoke', 'minecraft'),
      resourcePath: root,
      javaPath: 'java',
      version: resolved,
      gameProfile: { name: 'Notch', id: uuid },
      accessToken: offlineToken(uuid),
      maxMemory: 4096,
      minMemory: 1024,
      extraJVMArgs: buildJvmArgs(''),
      nativeRoot: join(root, 'natives')
    })
    const line = args.join(' ')
    expect(line.toLowerCase()).toContain('-xmx4096m')
    expect(line).toContain(`--uuid ${uuid}`)
    expect(line).toContain(resolved.mainClass)
    expect(args).toContain('-cp')
  }, 180000)
})

describe.skipIf(!enabled)('live: loader metadata', () => {
  it('resolves fabric loader versions for 1.21.1', async () => {
    const list = await versions.listLoaders('1.21.1', 'fabric')
    expect(list.length).toBeGreaterThan(0)
    expect(list[0].version).toMatch(/^\d+\.\d+\.\d+/)
  }, 30000)

  it('resolves forge versions for 1.20.1', async () => {
    const list = await versions.listLoaders('1.20.1', 'forge')
    expect(list.length).toBeGreaterThan(0)
    expect(list.some((entry) => entry.stable)).toBe(true)
  }, 60000)

  it('resolves neoforge versions for 1.21.1', async () => {
    const list = await versions.listLoaders('1.21.1', 'neoforge')
    expect(list.length).toBeGreaterThan(0)
    expect(list[0].version.startsWith('21.1.')).toBe(true)
  }, 60000)
})

describe.skipIf(!enabled)('live: modrinth', () => {
  it('searches mods with loader + version facets', async () => {
    const result = await modrinthSearch({
      source: 'modrinth',
      query: 'sodium',
      mcVersion: '1.21.1',
      loader: 'fabric',
      sort: 'downloads',
      limit: 5
    })
    expect(result.hits.length).toBeGreaterThan(0)
    expect(result.total).toBeGreaterThan(0)
    const sodium = result.hits.find((hit) => hit.slug === 'sodium' || hit.name.toLowerCase().includes('sodium'))
    expect(sodium).toBeTruthy()
    expect(sodium!.iconUrl).toMatch(/^https:\/\//)
  }, 30000)

  it('resolves installable versions of a mod for an instance', async () => {
    const result = await modrinthSearch({
      source: 'modrinth',
      query: 'fabric api',
      mcVersion: '1.21.1',
      loader: 'fabric',
      limit: 5
    })
    const project = result.hits[0]
    expect(project).toBeTruthy()
    const list = await modrinthVersions(project.id, '1.21.1', 'fabric')
    expect(list.length).toBeGreaterThan(0)
    expect(list[0].downloadUrl).toMatch(/^https:\/\//)
    expect(list[0].fileName).toMatch(/\.jar$/)
  }, 45000)
})
