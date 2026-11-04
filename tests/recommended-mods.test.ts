import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/main/services/net', () => ({ fetchJson: vi.fn() }))

import { fetchJson } from '../src/main/services/net'
import {
  clearRecommendedCache,
  pickRecommendedVersion,
  planRecommended,
  resolveRecommendedInstall,
  type RawVersion
} from '../src/main/services/recommended-mods'
import type { LoaderType, RecommendedPlan } from '../src/shared/types'

/* ----------------------------- fake Modrinth ----------------------------- */

interface FakeDep {
  project_id: string | null
  version_id: string | null
  dependency_type: string
}
interface FakeBuild {
  loader: string
  mcs: string[]
  type?: string
  deps?: FakeDep[]
}
interface FakeMod {
  slug: string
  title: string
  builds: FakeBuild[]
  clientSide?: string
}
interface FakeOptions {
  failAll?: boolean
  failVersions?: boolean
  failVersionsFor?: string[]
}

const idOf = (slug: string): string => `id-${slug}`
const build = (loader: string, mcs: string[], extra: Partial<FakeBuild> = {}): FakeBuild => ({ loader, mcs, ...extra })
const mod = (slug: string, title: string, ...builds: FakeBuild[]): FakeMod => ({ slug, title, builds })
const required = (slug: string): FakeDep => ({ project_id: idOf(slug), version_id: null, dependency_type: 'required' })
const norm = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '')

const BASE: FakeMod[] = [
  mod('sodium', 'Sodium', build('fabric', ['1.20.1', '1.21.1'], {
    deps: [required('fabric-api'), { project_id: idOf('optional-lib'), version_id: null, dependency_type: 'optional' }]
  })),
  mod('lithium', 'Lithium', build('fabric', ['1.20.1', '1.21.1'], { deps: [required('fabric-api')] })),
  mod('ferrite-core', 'FerriteCore',
    build('fabric', ['1.20.1', '1.21.1']), build('forge', ['1.16.5', '1.20.1']), build('neoforge', ['1.21.1'])),
  mod('modernfix', 'ModernFix', build('fabric', ['1.20.1']), build('forge', ['1.16.5', '1.20.1']), build('neoforge', ['1.21.1'])),
  mod('entityculling', 'Entity Culling', build('fabric', ['1.20.1', '1.21.1']), build('forge', ['1.20.1'])),
  mod('immediatelyfast', 'ImmediatelyFast', build('fabric', ['1.20.1'])),
  mod('embeddium', 'Embeddium', build('forge', ['1.20.1']), build('neoforge', ['1.21.1'])),
  mod('rubidium', 'Rubidium', build('forge', ['1.16.5', '1.20.1'])),
  mod('vanillafix', 'VanillaFix', build('forge', ['1.12.2'])),
  mod('foamfix', 'FoamFix', build('forge', ['1.8.9', '1.12.2'])),
  mod('jei', 'Just Enough Items (JEI)',
    build('forge', ['1.12.2', '1.16.5', '1.20.1']), build('fabric', ['1.20.1', '1.21.1']), build('neoforge', ['1.21.1'])),
  mod('emi', 'EMI', build('fabric', ['1.20.1']), build('forge', ['1.20.1'])),
  mod('hwyla', 'Hwyla', build('forge', ['1.12.2', '1.16.5'])),
  mod('jade', 'Jade', build('fabric', ['1.20.1', '1.21.1']), build('forge', ['1.20.1']), build('neoforge', ['1.21.1'])),
  mod('appleskin', 'AppleSkin',
    build('forge', ['1.12.2', '1.16.5', '1.20.1']), build('fabric', ['1.20.1', '1.21.1']), build('neoforge', ['1.21.1'])),
  mod('mouse-tweaks', 'Mouse Tweaks',
    build('forge', ['1.7.10', '1.8.9', '1.12.2', '1.16.5', '1.20.1']), build('fabric', ['1.20.1', '1.21.1']), build('neoforge', ['1.21.1'])),
  mod('controlling', 'Controlling', build('forge', ['1.16.5', '1.20.1'])),
  mod('xaeros-minimap', "Xaero's Minimap", build('fabric', ['1.20.1']), build('forge', ['1.20.1']), build('neoforge', ['1.21.1'])),
  mod('sodium-extra', 'Sodium Extra', build('fabric', ['1.20.1', '1.21.1'])),
  mod('reeses-sodium-options', "Reese's Sodium Options", build('fabric', ['1.20.1'])),
  mod('modmenu', 'Mod Menu', build('fabric', ['1.16.5', '1.20.1', '1.21.1'])),
  mod('language-reload', 'Language Reload', build('fabric', ['1.20.1'])),
  mod('configured', 'Configured', build('forge', ['1.16.5', '1.20.1']), build('neoforge', ['1.21.1'])),
  // Not a candidate: it only exists as a dependency.
  mod('fabric-api', 'Fabric API', build('fabric', ['1.20.1', '1.21.1']))
]

function withMod(catalog: FakeMod[], replacement: FakeMod): FakeMod[] {
  const rest = catalog.filter((entry) => entry.slug !== replacement.slug)
  return [...rest, replacement]
}

function notFound(): Error {
  return Object.assign(new Error('Not found'), { status: 404 })
}

function rawProject(m: FakeMod): Record<string, unknown> {
  return {
    id: idOf(m.slug),
    slug: m.slug,
    title: m.title,
    description: `${m.title} description`,
    icon_url: null,
    project_type: 'mod',
    client_side: m.clientSide ?? 'required',
    game_versions: [...new Set(m.builds.flatMap((entry) => entry.mcs))],
    loaders: [...new Set(m.builds.map((entry) => entry.loader))]
  }
}

function rawVersion(m: FakeMod, index: number): Record<string, unknown> {
  const entry = m.builds[index]
  return {
    id: `v-${m.slug}-${index}`,
    project_id: idOf(m.slug),
    name: `${m.title} ${index}`,
    version_number: `1.0.${index}`,
    game_versions: entry.mcs,
    loaders: [entry.loader],
    date_published: '2024-01-01T00:00:00Z',
    version_type: entry.type ?? 'release',
    files: [
      {
        url: `https://cdn.example/${m.slug}/${index}.jar`,
        filename: `${m.slug}-${index}.jar`,
        primary: true,
        size: 1000,
        hashes: { sha1: 'abc' }
      }
    ],
    dependencies: entry.deps ?? []
  }
}

function installFake(catalog: FakeMod[], options: FakeOptions = {}): void {
  const find = (key: string): FakeMod | undefined =>
    catalog.find((entry) => entry.slug === key || idOf(entry.slug) === key)

  const respond = (url: string): unknown => {
    if (options.failAll) throw new Error('offline')
    const parsed = new URL(url)
    const parts = parsed.pathname.split('/')
    const last = parts[parts.length - 1]

    if (last === 'projects') {
      const keys = JSON.parse(parsed.searchParams.get('ids') ?? '[]') as string[]
      return keys.map((key) => find(key)).filter((entry): entry is FakeMod => Boolean(entry)).map(rawProject)
    }
    if (last === 'search') {
      const query = norm(parsed.searchParams.get('query') ?? '')
      const hits = catalog.filter((entry) => norm(entry.title) === query)
      return {
        hits: hits.map((entry) => ({
          project_id: idOf(entry.slug),
          slug: entry.slug,
          title: entry.title,
          description: `${entry.title} description`,
          icon_url: null,
          project_type: 'mod',
          client_side: entry.clientSide ?? 'required',
          versions: [...new Set(entry.builds.flatMap((item) => item.mcs))],
          categories: [...new Set(entry.builds.map((item) => item.loader))]
        }))
      }
    }
    if (last === 'version' && parts[parts.length - 3] === 'project') {
      const entry = find(decodeURIComponent(parts[parts.length - 2]))
      if (!entry) throw notFound()
      if (options.failVersions || options.failVersionsFor?.includes(entry.slug)) throw new Error('boom')
      const games = JSON.parse(parsed.searchParams.get('game_versions') ?? '[]') as string[]
      const loaders = JSON.parse(parsed.searchParams.get('loaders') ?? '[]') as string[]
      return entry.builds
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.mcs.some((mc) => games.includes(mc)) && loaders.includes(item.loader))
        .map(({ index }) => rawVersion(entry, index))
    }
    if (parts[parts.length - 2] === 'version') {
      const id = decodeURIComponent(last)
      for (const entry of catalog) {
        const index = entry.builds.findIndex((_, position) => `v-${entry.slug}-${position}` === id)
        if (index >= 0) return rawVersion(entry, index)
      }
      throw notFound()
    }
    throw notFound()
  }

  vi.mocked(fetchJson).mockImplementation(async (url: string) => respond(url) as never)
}

const requestedUrls = (): string[] => vi.mocked(fetchJson).mock.calls.map((call) => decodeURIComponent(String(call[0])))
const slugsOf = (plan: RecommendedPlan, group: string): string[] =>
  plan.groups.find((entry) => entry.id === group)?.mods.map((entry) => entry.slug) ?? []
const allSlugs = (plan: RecommendedPlan): string[] => plan.groups.flatMap((entry) => entry.mods.map((item) => item.slug))

beforeEach(() => {
  vi.mocked(fetchJson).mockReset()
  clearRecommendedCache()
  installFake(BASE)
})

/* --------------------------------- plans --------------------------------- */

describe('recommended mods: plan per version and loader', () => {
  it('1.8.9 Forge: only what exists for that version', async () => {
    const plan = await planRecommended('1.8.9', 'forge')
    expect(plan.unavailable).toBe(false)
    expect(slugsOf(plan, 'performance')).toEqual(['foamfix'])
    expect(slugsOf(plan, 'interface')).toEqual(['mouse-tweaks'])
  })

  it('1.12.2 Forge: old performance mods and Hwyla instead of Jade', async () => {
    const plan = await planRecommended('1.12.2', 'forge')
    expect(slugsOf(plan, 'performance')).toEqual(['vanillafix', 'foamfix'])
    expect(slugsOf(plan, 'interface')).toEqual(['jei', 'hwyla', 'appleskin', 'mouse-tweaks'])
  })

  it('1.16.5 Forge: Rubidium because Embeddium has no build for it', async () => {
    const plan = await planRecommended('1.16.5', 'forge')
    expect(slugsOf(plan, 'performance')).toEqual(['rubidium', 'ferrite-core', 'modernfix'])
    expect(slugsOf(plan, 'interface')).toEqual(['jei', 'hwyla', 'appleskin', 'mouse-tweaks', 'controlling', 'configured'])
  })

  it('1.20.1 Fabric: full set with add-ons that need Sodium', async () => {
    const plan = await planRecommended('1.20.1', 'fabric')
    expect(slugsOf(plan, 'performance')).toEqual([
      'sodium', 'lithium', 'ferrite-core', 'modernfix', 'entityculling', 'immediatelyfast'
    ])
    expect(slugsOf(plan, 'interface')).toEqual([
      'jei', 'jade', 'appleskin', 'mouse-tweaks', 'xaeros-minimap',
      'sodium-extra', 'reeses-sodium-options', 'modmenu', 'language-reload'
    ])
    const sodium = plan.groups.flatMap((entry) => entry.mods).find((entry) => entry.slug === 'sodium')
    const extra = plan.groups.flatMap((entry) => entry.mods).find((entry) => entry.slug === 'sodium-extra')
    expect(extra?.requires).toBe(sodium?.projectId)
    expect(sodium?.requires).toBeNull()
  })

  it('1.21.1 Fabric and NeoForge differ from each other', async () => {
    const fabric = await planRecommended('1.21.1', 'fabric')
    const neo = await planRecommended('1.21.1', 'neoforge')
    expect(slugsOf(fabric, 'performance')).toEqual(['sodium', 'lithium', 'ferrite-core', 'entityculling'])
    expect(slugsOf(fabric, 'interface')).toEqual(['jei', 'jade', 'appleskin', 'mouse-tweaks', 'sodium-extra', 'modmenu'])
    expect(slugsOf(neo, 'performance')).toEqual(['embeddium', 'ferrite-core', 'modernfix'])
    expect(slugsOf(neo, 'interface')).toEqual(['jei', 'jade', 'appleskin', 'mouse-tweaks', 'xaeros-minimap', 'configured'])
  })

  it('different versions give different sets', async () => {
    const cases: Array<[string, LoaderType]> = [
      ['1.8.9', 'forge'],
      ['1.12.2', 'forge'],
      ['1.16.5', 'forge'],
      ['1.20.1', 'fabric'],
      ['1.21.1', 'fabric']
    ]
    const sets: string[] = []
    for (const [mc, loader] of cases) sets.push(allSlugs(await planRecommended(mc, loader)).join(','))
    expect(new Set(sets).size).toBe(cases.length)
  })

  it('asks Modrinth with the exact game version and loader', async () => {
    await planRecommended('1.20.1', 'fabric')
    const versionCalls = requestedUrls().filter((url) => url.includes('/version?'))
    expect(versionCalls.length).toBeGreaterThan(0)
    for (const url of versionCalls) {
      expect(url).toContain('game_versions=' + JSON.stringify(['1.20.1']))
      expect(url).toContain('loaders=' + JSON.stringify(['fabric']))
    }
  })

  it('Quilt accepts Fabric builds and asks for both loaders', async () => {
    const quilt = await planRecommended('1.20.1', 'quilt')
    const fabric = await planRecommended('1.20.1', 'fabric')
    expect(allSlugs(quilt)).toEqual(allSlugs(fabric))
    expect(requestedUrls().some((url) => url.includes('loaders=' + JSON.stringify(['quilt', 'fabric'])))).toBe(true)
  })

  it('finds a renamed project through search by exact title', async () => {
    installFake([mod('sodium-new', 'Sodium', build('fabric', ['1.20.1']))])
    const plan = await planRecommended('1.20.1', 'fabric')
    expect(slugsOf(plan, 'performance')).toEqual(['sodium-new'])
  })

  it('skips server-only projects', async () => {
    installFake(withMod(BASE, { ...mod('lithium', 'Lithium', build('fabric', ['1.20.1'])), clientSide: 'unsupported' }))
    const plan = await planRecommended('1.20.1', 'fabric')
    expect(slugsOf(plan, 'performance')).not.toContain('lithium')
    expect(slugsOf(plan, 'performance')).toContain('sodium')
  })
})

/* ------------------------ empty groups, no network ----------------------- */

describe('recommended mods: empty and unavailable', () => {
  it('hides a group that has nothing for this version', async () => {
    const plan = await planRecommended('1.7.10', 'forge')
    expect(plan.unavailable).toBe(false)
    expect(plan.groups.map((entry) => entry.id)).toEqual(['interface'])
    expect(slugsOf(plan, 'interface')).toEqual(['mouse-tweaks'])
  })

  it('returns no groups and is not unavailable when nothing exists', async () => {
    const plan = await planRecommended('1.6.4', 'forge')
    expect(plan.groups).toEqual([])
    expect(plan.unavailable).toBe(false)
  })

  it('Vanilla needs no requests at all', async () => {
    const plan = await planRecommended('1.20.1', 'vanilla')
    expect(plan.groups).toEqual([])
    expect(plan.unavailable).toBe(false)
    expect(vi.mocked(fetchJson)).not.toHaveBeenCalled()
  })

  it('Modrinth offline: unavailable, never throws, and is not cached', async () => {
    installFake(BASE, { failAll: true })
    const offline = await planRecommended('1.20.1', 'fabric')
    expect(offline.unavailable).toBe(true)
    expect(offline.groups).toEqual([])

    installFake(BASE)
    const online = await planRecommended('1.20.1', 'fabric')
    expect(online.unavailable).toBe(false)
    expect(online.groups.length).toBe(2)
  })

  it('version requests failing everywhere count as unavailable', async () => {
    installFake(BASE, { failVersions: true })
    const plan = await planRecommended('1.20.1', 'fabric')
    expect(plan.groups).toEqual([])
    expect(plan.unavailable).toBe(true)
  })

  it('a partial failure shows what was found and is not cached', async () => {
    installFake(BASE, { failVersionsFor: ['sodium'] })
    const partial = await planRecommended('1.20.1', 'fabric')
    expect(partial.unavailable).toBe(false)
    expect(allSlugs(partial)).not.toContain('sodium')
    expect(allSlugs(partial)).not.toContain('sodium-extra')
    expect(allSlugs(partial)).toContain('lithium')

    installFake(BASE)
    const full = await planRecommended('1.20.1', 'fabric')
    expect(allSlugs(full)).toContain('sodium')
  })

  it('caches a complete result for the session', async () => {
    await planRecommended('1.20.1', 'fabric')
    const first = vi.mocked(fetchJson).mock.calls.length
    expect(first).toBeGreaterThan(0)
    await planRecommended('1.20.1', 'fabric')
    expect(vi.mocked(fetchJson).mock.calls.length).toBe(first)
    await planRecommended('1.21.1', 'fabric')
    expect(vi.mocked(fetchJson).mock.calls.length).toBeGreaterThan(first)
  })
})

/* -------------------------------- conflicts ------------------------------ */

describe('recommended mods: conflicts', () => {
  it('never offers Embeddium next to Sodium on Fabric', async () => {
    installFake(withMod(BASE, mod('embeddium', 'Embeddium', build('fabric', ['1.20.1']), build('forge', ['1.20.1']))))
    const plan = await planRecommended('1.20.1', 'fabric')
    expect(allSlugs(plan)).toContain('sodium')
    expect(allSlugs(plan)).not.toContain('embeddium')
  })

  it('offers Embeddium or Rubidium on Forge, not both', async () => {
    const plan = await planRecommended('1.20.1', 'forge')
    const performance = slugsOf(plan, 'performance')
    expect(performance).toContain('embeddium')
    expect(performance).not.toContain('rubidium')
    expect(performance).not.toContain('sodium')
  })

  it('picks only one of JEI and EMI', async () => {
    const plan = await planRecommended('1.20.1', 'fabric')
    const list = allSlugs(plan)
    expect(list.filter((slug) => slug === 'jei' || slug === 'emi')).toEqual(['jei'])
  })

  it('drops the lower-priority mod when a version declares it incompatible', async () => {
    installFake(
      withMod(BASE, mod('modernfix', 'ModernFix', build('fabric', ['1.20.1'], {
        deps: [{ project_id: idOf('ferrite-core'), version_id: null, dependency_type: 'incompatible' }]
      })))
    )
    const plan = await planRecommended('1.20.1', 'fabric')
    expect(slugsOf(plan, 'performance')).toContain('ferrite-core')
    expect(slugsOf(plan, 'performance')).not.toContain('modernfix')
  })
})

/* ---------------------------- release selection -------------------------- */

function rv(over: Partial<RawVersion>): RawVersion {
  return {
    id: 'v',
    project_id: 'p',
    name: 'n',
    version_number: '1',
    game_versions: ['1.20.1'],
    loaders: ['fabric'],
    date_published: '2024-01-01T00:00:00Z',
    version_type: 'release',
    files: [{ url: 'https://cdn.example/a.jar', filename: 'a.jar', primary: true, size: 1 }],
    dependencies: [],
    ...over
  }
}

describe('pickRecommendedVersion', () => {
  it('prefers an older release over a newer beta', () => {
    const picked = pickRecommendedVersion(
      [rv({ id: 'beta', version_type: 'beta', date_published: '2024-06-01T00:00:00Z' }), rv({ id: 'rel' })],
      '1.20.1',
      'fabric'
    )
    expect(picked?.id).toBe('rel')
  })

  it('takes the newest release', () => {
    const picked = pickRecommendedVersion(
      [rv({ id: 'old' }), rv({ id: 'new', date_published: '2024-03-01T00:00:00Z' })],
      '1.20.1',
      'fabric'
    )
    expect(picked?.id).toBe('new')
  })

  it('falls back to beta but never to alpha', () => {
    expect(pickRecommendedVersion([rv({ id: 'b', version_type: 'beta' })], '1.20.1', 'fabric')?.id).toBe('b')
    expect(pickRecommendedVersion([rv({ id: 'a', version_type: 'alpha' })], '1.20.1', 'fabric')).toBeNull()
  })

  it('requires an exact game version, the loader and a jar file', () => {
    expect(pickRecommendedVersion([rv({ game_versions: ['1.20.4'] })], '1.20.1', 'fabric')).toBeNull()
    expect(pickRecommendedVersion([rv({ loaders: ['forge'] })], '1.20.1', 'fabric')).toBeNull()
    expect(
      pickRecommendedVersion(
        [rv({ files: [{ url: 'https://cdn.example/a.zip', filename: 'a.zip', primary: true, size: 1 }] })],
        '1.20.1',
        'fabric'
      )
    ).toBeNull()
    expect(pickRecommendedVersion([rv({ loaders: ['fabric'] })], '1.20.1', 'quilt')).not.toBeNull()
  })
})

/* -------------------------- install and dependencies --------------------- */

describe('resolveRecommendedInstall', () => {
  it('downloads the chosen mod and its required dependency once', async () => {
    const result = await resolveRecommendedInstall('1.20.1', 'fabric', [idOf('sodium'), idOf('lithium')])
    expect(result.failed).toEqual([])
    const mods = result.downloads.filter((entry) => entry.kind === 'mod').map((entry) => entry.name)
    expect(mods).toEqual(['Sodium', 'Lithium'])
    const deps = result.downloads.filter((entry) => entry.kind === 'dependency')
    expect(deps.length).toBe(1)
    expect(deps[0].name).toBe('Fabric API')
    expect(deps[0].projectId).toBe(idOf('fabric-api'))
    expect(result.downloads.some((entry) => entry.projectId === idOf('optional-lib'))).toBe(false)
    for (const entry of result.downloads) {
      expect(entry.url).toMatch(/^https:/)
      expect(entry.fileName).toMatch(/\.jar$/)
      expect(entry.sha1).toBe('abc')
    }
  })

  it('ignores ids that were not in the plan', async () => {
    const result = await resolveRecommendedInstall('1.20.1', 'fabric', [idOf('sodium'), 'id-not-in-plan', idOf('fabric-api')])
    const mods = result.downloads.filter((entry) => entry.kind === 'mod').map((entry) => entry.projectId)
    expect(mods).toEqual([idOf('sodium')])
  })

  it('does not install an add-on without its parent mod', async () => {
    const alone = await resolveRecommendedInstall('1.20.1', 'fabric', [idOf('sodium-extra')])
    expect(alone.downloads).toEqual([])
    const both = await resolveRecommendedInstall('1.20.1', 'fabric', [idOf('sodium-extra'), idOf('sodium')])
    expect(both.downloads.filter((entry) => entry.kind === 'mod').map((entry) => entry.name)).toEqual(['Sodium', 'Sodium Extra'])
  })

  it('skips a mod whose required library cannot be found and reports it', async () => {
    installFake(
      withMod(BASE, mod('modmenu', 'Mod Menu', build('fabric', ['1.20.1'], { deps: [required('ghost-lib')] })))
    )
    const result = await resolveRecommendedInstall('1.20.1', 'fabric', [idOf('modmenu'), idOf('lithium')])
    expect(result.downloads.some((entry) => entry.projectId === idOf('modmenu'))).toBe(false)
    expect(result.downloads.some((entry) => entry.projectId === idOf('lithium'))).toBe(true)
    expect(result.failed.some((entry) => entry.name === 'Mod Menu' && entry.reason === 'dependency')).toBe(true)
    expect(result.failed.some((entry) => entry.reason === 'dependency' && entry.name === idOf('ghost-lib'))).toBe(true)
  })

  it('reports every id as unavailable when Modrinth is down', async () => {
    installFake(BASE, { failAll: true })
    const result = await resolveRecommendedInstall('1.20.1', 'fabric', [idOf('sodium')])
    expect(result.downloads).toEqual([])
    expect(result.failed).toEqual([{ name: idOf('sodium'), reason: 'unavailable' }])
  })
})
