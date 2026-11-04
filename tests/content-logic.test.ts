import { describe, expect, it } from 'vitest'
import {
  CONTENT_DIR,
  filterCompatible,
  isCompatible,
  isNewerBuild,
  loaderMatches,
  pickCompatibleVersion,
  versionMatches
} from '../src/main/services/content-logic'
import type { InstalledMod, ModHit, ModVersion } from '../src/shared/types'

const FABRIC_1214 = { mcVersion: '1.21.4', loader: 'fabric' as const }

function hit(partial: Partial<ModHit>): ModHit {
  return {
    id: 'id',
    slug: 'slug',
    name: 'Name',
    summary: '',
    author: '',
    downloads: 0,
    follows: 0,
    iconUrl: null,
    categories: [],
    loaders: ['fabric'],
    gameVersions: ['1.21.4'],
    projectType: 'mod',
    updatedAt: null,
    source: 'modrinth',
    ...partial
  }
}

function version(partial: Partial<ModVersion>): ModVersion {
  return {
    id: 'v2',
    projectId: 'p',
    name: 'name',
    versionNumber: '2.0.0',
    gameVersions: ['1.21.4'],
    loaders: ['fabric'],
    datePublished: '2026-01-01T00:00:00Z',
    downloadUrl: 'https://example.invalid/a.jar',
    fileName: 'a.jar',
    fileSize: 10,
    sha1: 'sha1-v2',
    dependencies: [],
    ...partial
  }
}

function installed(partial: Partial<InstalledMod>): InstalledMod {
  return {
    projectId: 'p',
    fileName: 'a.jar',
    name: 'A',
    version: '1.0.0',
    iconUrl: null,
    enabled: true,
    source: 'modrinth',
    size: 1,
    installedAt: '2026-01-01T00:00:00Z',
    versionId: 'v1',
    sha1: 'sha1-v1',
    author: null,
    ...partial
  }
}

describe('loaderMatches', () => {
  it('accepts the exact loader', () => {
    expect(loaderMatches(['fabric'], 'fabric')).toBe(true)
    expect(loaderMatches(['forge'], 'forge')).toBe(true)
    expect(loaderMatches(['neoforge'], 'neoforge')).toBe(true)
  })

  it('lets Quilt run Fabric mods but never the other way around', () => {
    expect(loaderMatches(['fabric'], 'quilt')).toBe(true)
    expect(loaderMatches(['quilt'], 'fabric')).toBe(false)
  })

  it('rejects a different loader and a vanilla instance', () => {
    expect(loaderMatches(['forge'], 'fabric')).toBe(false)
    expect(loaderMatches(['fabric', 'forge'], 'neoforge')).toBe(false)
    expect(loaderMatches(['fabric'], 'vanilla')).toBe(false)
    expect(loaderMatches([], 'fabric')).toBe(false)
    expect(loaderMatches(undefined, 'fabric')).toBe(false)
  })
})

describe('versionMatches', () => {
  it('needs the exact game version', () => {
    expect(versionMatches(['1.21.4'], '1.21.4')).toBe(true)
    expect(versionMatches(['1.21'], '1.21.4')).toBe(false)
    expect(versionMatches(['1.21.4', '1.21.1'], '1.21.1')).toBe(true)
    expect(versionMatches([], '1.21.4')).toBe(false)
  })
})

describe('isCompatible', () => {
  it('requires version + loader for mods', () => {
    expect(isCompatible(hit({}), FABRIC_1214, 'mod')).toBe(true)
    expect(isCompatible(hit({ gameVersions: ['1.21.1'] }), FABRIC_1214, 'mod')).toBe(false)
    expect(isCompatible(hit({ loaders: ['forge'] }), FABRIC_1214, 'mod')).toBe(false)
    expect(isCompatible(hit({ loaders: [] }), FABRIC_1214, 'mod')).toBe(false)
  })

  it('only checks the game version for packs and shaders', () => {
    const pack = hit({ loaders: ['minecraft'], projectType: 'resourcepack' })
    expect(isCompatible(pack, { mcVersion: '1.21.4', loader: 'vanilla' }, 'resourcepack')).toBe(true)
    expect(isCompatible(pack, FABRIC_1214, 'shader')).toBe(true)
    expect(isCompatible({ ...pack, gameVersions: ['1.20.1'] }, FABRIC_1214, 'resourcepack')).toBe(false)
  })
})

describe('filterCompatible', () => {
  it('drops everything that is not a 100 % match', () => {
    const hits = [
      hit({ id: 'ok' }),
      hit({ id: 'old-mc', gameVersions: ['1.20.1'] }),
      hit({ id: 'forge-only', loaders: ['forge'] }),
      hit({ id: 'ok-2', gameVersions: ['1.21.4'] })
    ]
    expect(filterCompatible(hits, FABRIC_1214, 'mod').map((entry) => entry.id)).toEqual(['ok', 'ok-2'])
  })
})

describe('pickCompatibleVersion', () => {
  it('takes the newest build that still supports the instance', () => {
    const versions = [
      version({ id: 'newest-but-forge', loaders: ['forge'], datePublished: '2026-03-01T00:00:00Z' }),
      version({ id: 'newest-fabric', datePublished: '2026-02-01T00:00:00Z' }),
      version({ id: 'older-fabric', datePublished: '2025-12-01T00:00:00Z' })
    ]
    expect(pickCompatibleVersion(versions, FABRIC_1214, 'mod')?.id).toBe('newest-fabric')
  })

  it('skips builds without a download url and wrong game versions', () => {
    const versions = [
      version({ id: 'no-url', downloadUrl: '' }),
      version({ id: 'wrong-mc', gameVersions: ['1.21.1'] }),
      version({ id: 'good' })
    ]
    expect(pickCompatibleVersion(versions, FABRIC_1214, 'mod')?.id).toBe('good')
  })

  it('returns null when nothing fits', () => {
    expect(pickCompatibleVersion([], FABRIC_1214, 'mod')).toBeNull()
    expect(pickCompatibleVersion([version({ loaders: ['forge'] })], FABRIC_1214, 'mod')).toBeNull()
  })

  it('ignores the loader for packs', () => {
    const versions = [version({ id: 'pack', loaders: ['minecraft'] })]
    expect(pickCompatibleVersion(versions, FABRIC_1214, 'resourcepack')?.id).toBe('pack')
  })
})

describe('isNewerBuild', () => {
  it('detects a new version number', () => {
    expect(isNewerBuild(installed({}), version({ versionNumber: '2.0.0' }))).toBe(true)
  })

  it('ignores the same build', () => {
    expect(isNewerBuild(installed({ version: '2.0.0', sha1: 'sha1-v2' }), version({ versionNumber: '2.0.0' }))).toBe(false)
    expect(isNewerBuild(installed({ sha1: 'same' }), version({ sha1: 'same' }))).toBe(false)
    expect(isNewerBuild(installed({}), version({ id: 'v1' }))).toBe(false)
  })

  it('treats a rebuilt file with the same version number as an update', () => {
    expect(
      isNewerBuild(installed({ version: '2.0.0', sha1: 'sha1-old' }), version({ versionNumber: '2.0.0', sha1: 'sha1-rebuilt' }))
    ).toBe(true)
  })
})

describe('CONTENT_DIR', () => {
  it('maps each kind to the folder Minecraft reads', () => {
    expect(CONTENT_DIR).toEqual({ mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' })
  })
})
