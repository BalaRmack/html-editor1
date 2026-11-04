/**
 * «Рекомендуемые моды» при создании сборки.
 *
 * Ничего здесь не привязано к конкретной версии игры. Для каждой категории
 * задан список кандидатов по приоритету («Sodium, затем Embeddium, затем
 * Rubidium»), а под выбранные версию Minecraft и загрузчик подходящий релиз
 * ищется у Modrinth: берётся первый кандидат, у которого он есть, остальные
 * пропускаются. Нет релиза — мод просто не попадает в список.
 *
 * Всё, что нужно сети, идёт через `fetchJson` из ./net, поэтому модуль
 * тестируется с замоканной сетью и не знает про Electron.
 */

import { MODRINTH_API } from '../../shared/constants'
import type {
  LoaderType,
  RecommendedFailure,
  RecommendedGroupId,
  RecommendedMod,
  RecommendedPlan
} from '../../shared/types'
import { loaderMatches, versionMatches } from './content-logic'
import { fetchJson } from './net'

/* -------------------------------------------------------------------------- */
/*  Кандидаты                                                                 */
/* -------------------------------------------------------------------------- */

/** `name` — точное название проекта на Modrinth: по нему slug перепроверяется поиском. */
interface Candidate {
  slug: string
  name: string
}

/** Один «слот»: из кандидатов ставится максимум один (первый подходящий). */
interface Slot {
  candidates: Candidate[]
  /** Мод показывается, только если в наборе нашёлся один из этих slug-ов. */
  needs?: string[]
}

interface GroupSpec {
  id: RecommendedGroupId
  slots: Slot[]
}

const c = (slug: string, name: string): Candidate => ({ slug, name })
const slot = (...candidates: Candidate[]): Slot => ({ candidates })
const slotNeeding = (needs: string[], ...candidates: Candidate[]): Slot => ({ candidates, needs })

const SODIUM = c('sodium', 'Sodium')
const EMBEDDIUM = c('embeddium', 'Embeddium')
const RUBIDIUM = c('rubidium', 'Rubidium')
const ENTITY_CULLING = c('entityculling', 'Entity Culling')

const PERFORMANCE_FABRIC: Slot[] = [
  slot(SODIUM),
  slot(c('lithium', 'Lithium')),
  slot(c('ferrite-core', 'FerriteCore')),
  slot(c('modernfix', 'ModernFix')),
  slot(ENTITY_CULLING),
  slot(c('immediatelyfast', 'ImmediatelyFast')),
  slot(c('dynamic-fps', 'Dynamic FPS'))
]

const PERFORMANCE_FORGE: Slot[] = [
  // Embeddium — наследник Rubidium; на старых версиях живёт только Rubidium.
  slot(EMBEDDIUM, RUBIDIUM),
  slot(c('ferrite-core', 'FerriteCore')),
  slot(c('modernfix', 'ModernFix')),
  // Современный Entity Culling, затем его старые форки (вплоть до 1.7.10).
  slot(ENTITY_CULLING, c('entity-culling', 'Entity Culling'), c('entitycullingunofficial', 'Entity Culling Unofficial')),
  // Старые версии (Forge 1.12.2 и подобные).
  slot(c('vanillafix', 'VanillaFix')),
  slot(c('foamfix', 'FoamFix'))
]

const INTERFACE_COMMON: Slot[] = [
  slot(c('jei', 'Just Enough Items (JEI)'), c('emi', 'EMI')),
  slot(c('jade', 'Jade'), c('hwyla', 'Hwyla')),
  slot(c('appleskin', 'AppleSkin')),
  slot(c('mouse-tweaks', 'Mouse Tweaks')),
  slot(c('inventory-profiles-next', 'Inventory Profiles Next')),
  slot(c('xaeros-minimap', "Xaero's Minimap")),
  slot(c('xaeros-world-map', "Xaero's World Map")),
  slot(c('controlling', 'Controlling')),
  slot(c('shulkerboxtooltip', 'Shulker Box Tooltip')),
  slot(c('zoomify', 'Zoomify (Zoom)'))
]

const INTERFACE_FABRIC_EXTRA: Slot[] = [
  slotNeeding(['sodium'], c('sodium-extra', 'Sodium Extra')),
  slotNeeding(['sodium'], c('reeses-sodium-options', "Reese's Sodium Options")),
  slot(c('modmenu', 'Mod Menu')),
  slot(c('language-reload', 'Language Reload'))
]

const INTERFACE_FORGE_EXTRA: Slot[] = [
  slot(c('configured', 'Configured')),
  // Если проекта под этот загрузчик/версию нет — слот просто пропускается.
  slot(c('language-reload', 'Language Reload'))
]

/** Взаимоисключающие моды: вместе они не ставятся никогда. */
const CONFLICT_SETS: string[][] = [
  ['sodium', 'embeddium', 'rubidium'],
  ['jei', 'emi'],
  ['jade', 'hwyla']
]

export function candidateGroups(loader: LoaderType): GroupSpec[] {
  if (loader === 'vanilla') return []
  const fabricLike = loader === 'fabric' || loader === 'quilt'
  return [
    { id: 'performance', slots: fabricLike ? PERFORMANCE_FABRIC : PERFORMANCE_FORGE },
    { id: 'interface', slots: [...INTERFACE_COMMON, ...(fabricLike ? INTERFACE_FABRIC_EXTRA : INTERFACE_FORGE_EXTRA)] }
  ]
}

/** Fabric-моды работают и на Quilt, поэтому для него спрашиваем оба загрузчика. */
export function searchLoaders(loader: LoaderType): string[] {
  if (loader === 'quilt') return ['quilt', 'fabric']
  return loader === 'vanilla' ? [] : [loader]
}

/* -------------------------------------------------------------------------- */
/*  Сырые ответы Modrinth                                                     */
/* -------------------------------------------------------------------------- */

interface RawProject {
  id: string
  slug: string
  title: string
  description: string
  icon_url: string | null
  project_type: string
  client_side?: string
  game_versions?: string[]
  loaders?: string[]
}

interface RawFile {
  url: string
  filename: string
  primary: boolean
  size: number
  hashes?: { sha1?: string }
}

interface RawDep {
  project_id: string | null
  version_id: string | null
  dependency_type: string
}

export interface RawVersion {
  id: string
  project_id: string
  name: string
  version_number: string
  game_versions: string[]
  loaders: string[]
  date_published: string
  version_type: string
  files: RawFile[]
  dependencies: RawDep[]
}

interface RawSearchHit {
  project_id: string
  slug: string
  title: string
  description: string
  icon_url: string | null
  project_type: string
  client_side?: string
  versions?: string[]
  categories?: string[]
}

/** Подбор не должен подвешивать создание сборки: короткий таймаут и один повтор. */
const FAST = { timeoutMs: 8_000, retries: 1 }
const KNOWN_LOADERS = new Set(['fabric', 'quilt', 'forge', 'neoforge'])

class RecommendedUnavailable extends Error {}

function isNotFound(error: unknown): boolean {
  return (error as { status?: number } | null)?.status === 404
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      await fn(items[index])
    }
  })
  await Promise.all(workers)
}

function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

/* -------------------------------------------------------------------------- */
/*  Выбор версии                                                              */
/* -------------------------------------------------------------------------- */

function jarFile(version: RawVersion): RawFile | null {
  const jars = (version.files ?? []).filter((file) => file.url && /\.jar$/i.test(file.filename ?? ''))
  return jars.find((file) => file.primary) ?? jars[0] ?? null
}

function isUsable(version: RawVersion, mcVersion: string, loader: LoaderType): boolean {
  if (!jarFile(version)) return false
  if (!versionMatches(version.game_versions, mcVersion)) return false
  return loaderMatches(version.loaders, loader)
}

function newest(versions: RawVersion[]): RawVersion {
  return [...versions].sort((a, b) => (Date.parse(b.date_published) || 0) - (Date.parse(a.date_published) || 0))[0]
}

/**
 * Самый свежий подходящий билд: сначала только release, а если релизов под эту
 * версию нет (старые версии часто живут на beta) — beta. Alpha не берём никогда.
 * Точное совпадение версии игры и загрузчика проверяется ещё раз локально.
 */
export function pickRecommendedVersion(versions: RawVersion[], mcVersion: string, loader: LoaderType): RawVersion | null {
  const usable = versions.filter((version) => isUsable(version, mcVersion, loader))
  for (const tier of ['release', 'beta']) {
    const inTier = usable.filter((version) => version.version_type === tier)
    if (inTier.length > 0) return newest(inTier)
  }
  return null
}

function fetchVersions(projectId: string, mcVersion: string, loader: LoaderType): Promise<RawVersion[]> {
  const params = new URLSearchParams({
    game_versions: JSON.stringify([mcVersion]),
    loaders: JSON.stringify(searchLoaders(loader))
  })
  return fetchJson<RawVersion[]>(`${MODRINTH_API}/project/${encodeURIComponent(projectId)}/version?${params.toString()}`, FAST)
}

/* -------------------------------------------------------------------------- */
/*  Проекты: существование slug проверяется у Modrinth                        */
/* -------------------------------------------------------------------------- */

async function fetchProjectBatch(keys: string[]): Promise<RawProject[]> {
  if (keys.length === 0) return []
  return fetchJson<RawProject[]>(`${MODRINTH_API}/projects?ids=${encodeURIComponent(JSON.stringify(keys))}`, FAST)
}

function hitToProject(hit: RawSearchHit): RawProject {
  return {
    id: hit.project_id,
    slug: hit.slug,
    title: hit.title,
    description: hit.description,
    icon_url: hit.icon_url ?? null,
    project_type: hit.project_type,
    client_side: hit.client_side,
    game_versions: hit.versions ?? [],
    loaders: (hit.categories ?? []).filter((entry) => KNOWN_LOADERS.has(entry.toLowerCase()))
  }
}

/**
 * Находит проект каждого кандидата. Сначала пакетный запрос по slug; если slug
 * не найден (проект переименован), ищем по названию через поиск и принимаем
 * только точное совпадение названия. Сбой пакетного запроса — Modrinth недоступен.
 */
async function loadProjects(candidates: Candidate[]): Promise<Map<string, RawProject>> {
  const slugs = [...new Set(candidates.map((candidate) => candidate.slug))]
  let list: RawProject[]
  try {
    list = await fetchProjectBatch(slugs)
  } catch {
    throw new RecommendedUnavailable()
  }
  const bySlug = new Map(list.filter((project) => project.project_type === 'mod').map((project) => [project.slug.toLowerCase(), project]))
  const result = new Map<string, RawProject>()
  const missing: Candidate[] = []
  for (const candidate of candidates) {
    const found = bySlug.get(candidate.slug.toLowerCase())
    if (found) result.set(candidate.slug, found)
    else if (!missing.some((entry) => entry.slug === candidate.slug)) missing.push(candidate)
  }
  const known = new Set(slugs)
  await mapLimit(missing, 4, async (candidate) => {
    try {
      const facets = encodeURIComponent(JSON.stringify([['project_type:mod']]))
      const url = `${MODRINTH_API}/search?query=${encodeURIComponent(candidate.name)}&limit=5&facets=${facets}`
      const response = await fetchJson<{ hits: RawSearchHit[] }>(url, FAST)
      const hit = (response.hits ?? []).find(
        (entry) => normalizeTitle(entry.title) === normalizeTitle(candidate.name) && !known.has(entry.slug)
      )
      if (hit) result.set(candidate.slug, hitToProject(hit))
    } catch {
      /* без поиска кандидат просто пропускается */
    }
  })
  return result
}

function projectPlausible(project: RawProject, mcVersion: string, loader: LoaderType): boolean {
  if (project.project_type !== 'mod') return false
  // Серверные моды клиенту не нужны.
  if (project.client_side === 'unsupported') return false
  const versions = project.game_versions ?? []
  if (versions.length > 0 && !versions.includes(mcVersion)) return false
  const loaders = project.loaders ?? []
  if (loaders.length > 0 && !loaderMatches(loaders, loader)) return false
  return true
}

/* -------------------------------------------------------------------------- */
/*  План                                                                      */
/* -------------------------------------------------------------------------- */

interface Resolved {
  mod: RecommendedMod
  file: { url: string; sha1: string | null; size: number }
  deps: RawDep[]
  incompatible: string[]
}

interface CachedPlan {
  plan: RecommendedPlan
  resolved: Map<string, Resolved>
}

function conflicts(a: Resolved, b: Resolved): boolean {
  const left = a.mod.slug.toLowerCase()
  const right = b.mod.slug.toLowerCase()
  if (CONFLICT_SETS.some((set) => set.includes(left) && set.includes(right))) return true
  return a.incompatible.includes(b.mod.projectId) || b.incompatible.includes(a.mod.projectId)
}

async function buildPlan(mcVersion: string, loader: LoaderType): Promise<{ value: CachedPlan; cacheable: boolean }> {
  const empty = (unavailable: boolean): CachedPlan => ({
    plan: { mcVersion, loader, groups: [], unavailable },
    resolved: new Map()
  })
  const specs = candidateGroups(loader)
  if (specs.length === 0 || !mcVersion) return { value: empty(false), cacheable: true }

  const allCandidates = specs.flatMap((spec) => spec.slots.flatMap((entry) => entry.candidates))
  let projects: Map<string, RawProject>
  try {
    projects = await loadProjects(allCandidates)
  } catch {
    return { value: empty(true), cacheable: false }
  }

  let failures = 0
  const picks = new Map<Slot, { project: RawProject; version: RawVersion; groupId: RecommendedGroupId }>()
  const jobs = specs.flatMap((spec) => spec.slots.map((entry) => ({ spec, entry })))
  await mapLimit(jobs, 6, async ({ spec, entry }) => {
    for (const candidate of entry.candidates) {
      const project = projects.get(candidate.slug)
      if (!project || !projectPlausible(project, mcVersion, loader)) continue
      try {
        const version = pickRecommendedVersion(await fetchVersions(project.id, mcVersion, loader), mcVersion, loader)
        if (version) {
          picks.set(entry, { project, version, groupId: spec.id })
          return
        }
      } catch (error) {
        if (isNotFound(error)) continue
        // Сеть отвалилась: запасной кандидат здесь был бы случайным выбором.
        failures += 1
        return
      }
    }
  })

  let chosen: Resolved[] = []
  for (const spec of specs) {
    for (const entry of spec.slots) {
      const pick = picks.get(entry)
      if (!pick) continue
      const file = jarFile(pick.version)
      if (!file) continue
      chosen.push({
        mod: {
          projectId: pick.project.id,
          slug: pick.project.slug,
          name: pick.project.title,
          summary: pick.project.description ?? '',
          iconUrl: pick.project.icon_url ?? null,
          groupId: pick.groupId,
          versionId: pick.version.id,
          versionNumber: pick.version.version_number,
          fileName: file.filename,
          requires: null
        },
        file: { url: file.url, sha1: file.hashes?.sha1 ?? null, size: file.size ?? 0 },
        deps: pick.version.dependencies ?? [],
        incompatible: (pick.version.dependencies ?? [])
          .filter((dep) => dep.dependency_type === 'incompatible' && dep.project_id)
          .map((dep) => dep.project_id as string)
      })
    }
  }

  // Конфликты: побеждает тот, кто стоит раньше в списке приоритетов.
  const kept: Resolved[] = []
  for (const entry of chosen) {
    if (!kept.some((other) => conflicts(other, entry))) kept.push(entry)
  }
  chosen = kept

  // Надстройки (Sodium Extra и т.п.) нужны только вместе с основным модом.
  const needsBySlug = new Map<string, string[]>()
  for (const spec of specs) {
    for (const entry of spec.slots) {
      if (!entry.needs) continue
      for (const candidate of entry.candidates) needsBySlug.set(candidate.slug, entry.needs)
    }
  }
  let changed = true
  while (changed) {
    changed = false
    const slugs = new Map(chosen.map((entry) => [entry.mod.slug.toLowerCase(), entry]))
    chosen = chosen.filter((entry) => {
      const needs = needsBySlug.get(entry.mod.slug)
      if (!needs) return true
      const provider = needs.map((slug) => slugs.get(slug)).find(Boolean)
      if (!provider) {
        changed = true
        return false
      }
      entry.mod.requires = provider.mod.projectId
      return true
    })
  }

  const resolved = new Map(chosen.map((entry) => [entry.mod.projectId, entry]))
  const groups = specs
    .map((spec) => ({ id: spec.id, mods: chosen.filter((entry) => entry.mod.groupId === spec.id).map((entry) => entry.mod) }))
    .filter((group) => group.mods.length > 0)

  // Ничего не нашли, а часть запросов упала — это недоступность, а не «нет модов».
  const unavailable = groups.length === 0 && failures > 0
  return {
    value: { plan: { mcVersion, loader, groups, unavailable }, resolved },
    cacheable: failures === 0
  }
}

/* Кэш на время сессии. Неудачные (частичные) результаты не запоминаем. */
const cache = new Map<string, Promise<CachedPlan>>()

export function clearRecommendedCache(): void {
  cache.clear()
}

function getCachedPlan(mcVersion: string, loader: LoaderType): Promise<CachedPlan> {
  const key = `${mcVersion}|${loader}`
  let entry = cache.get(key)
  if (!entry) {
    entry = buildPlan(mcVersion, loader).then((outcome) => {
      if (!outcome.cacheable) cache.delete(key)
      return outcome.value
    })
    cache.set(key, entry)
  }
  return entry
}

/** Набор для окна «Добавить рекомендуемые моды?». Никогда не бросает. */
export async function planRecommended(mcVersion: string, loader: LoaderType): Promise<RecommendedPlan> {
  try {
    return (await getCachedPlan(mcVersion, loader)).plan
  } catch {
    return { mcVersion, loader, groups: [], unavailable: true }
  }
}

/* -------------------------------------------------------------------------- */
/*  Установка: выбранные моды + их обязательные зависимости                    */
/* -------------------------------------------------------------------------- */

export interface RecommendedDownload {
  projectId: string
  name: string
  kind: 'mod' | 'dependency'
  versionId: string
  versionNumber: string
  fileName: string
  url: string
  sha1: string | null
  size: number
  iconUrl: string | null
}

export interface RecommendedResolution {
  downloads: RecommendedDownload[]
  failed: RecommendedFailure[]
}

const MAX_DEPENDENCY_DEPTH = 4

async function resolveDependency(
  dep: RawDep,
  mcVersion: string,
  loader: LoaderType
): Promise<{ projectId: string; version: RawVersion } | { projectId: string | null; version: null }> {
  let projectId = dep.project_id
  let version: RawVersion | null = null
  if (dep.version_id) {
    try {
      const exact = await fetchJson<RawVersion>(`${MODRINTH_API}/version/${encodeURIComponent(dep.version_id)}`, FAST)
      projectId = projectId ?? exact.project_id
      if (isUsable(exact, mcVersion, loader)) version = exact
    } catch {
      /* попробуем подобрать по проекту */
    }
  }
  if (!version && projectId) {
    try {
      version = pickRecommendedVersion(await fetchVersions(projectId, mcVersion, loader), mcVersion, loader)
    } catch {
      version = null
    }
  }
  return version && projectId ? { projectId, version } : { projectId, version: null }
}

export async function resolveRecommendedInstall(
  mcVersion: string,
  loader: LoaderType,
  projectIds: string[]
): Promise<RecommendedResolution> {
  const cached = await getCachedPlan(mcVersion, loader)
  if (cached.plan.unavailable) {
    return { downloads: [], failed: projectIds.map((id) => ({ name: id, reason: 'unavailable' as const })) }
  }

  // Берём только то, что было в плане: произвольные id от окна игнорируются.
  const wanted = new Set(projectIds)
  let selected = [...cached.resolved.values()].filter((entry) => wanted.has(entry.mod.projectId))
  // Надстройка без своего основного мода не ставится (даже если окно прислало её).
  for (let again = true; again; ) {
    again = false
    const ids = new Set(selected.map((entry) => entry.mod.projectId))
    const next = selected.filter((entry) => !entry.mod.requires || ids.has(entry.mod.requires))
    if (next.length !== selected.length) again = true
    selected = next
  }

  const downloads: RecommendedDownload[] = selected.map((entry) => ({
    projectId: entry.mod.projectId,
    name: entry.mod.name,
    kind: 'mod',
    versionId: entry.mod.versionId,
    versionNumber: entry.mod.versionNumber,
    fileName: entry.mod.fileName,
    url: entry.file.url,
    sha1: entry.file.sha1,
    size: entry.file.size,
    iconUrl: entry.mod.iconUrl
  }))

  const failed: RecommendedFailure[] = []
  const seen = new Set(selected.map((entry) => entry.mod.projectId))
  const failedDeps = new Set<string>()
  const brokenRoots = new Set<string>()
  const depDownloads: Array<RecommendedDownload & { root: string }> = []

  let frontier = selected.flatMap((entry) => entry.deps.map((dep) => ({ dep, root: entry.mod.projectId })))
  for (let depth = 0; depth < MAX_DEPENDENCY_DEPTH && frontier.length > 0; depth++) {
    const next: typeof frontier = []
    for (const { dep, root } of frontier) {
      if (dep.dependency_type !== 'required') continue
      if (dep.project_id && seen.has(dep.project_id)) {
        if (failedDeps.has(dep.project_id)) brokenRoots.add(root)
        continue
      }
      const outcome = await resolveDependency(dep, mcVersion, loader)
      if (outcome.projectId && seen.has(outcome.projectId)) {
        if (failedDeps.has(outcome.projectId)) brokenRoots.add(root)
        continue
      }
      if (outcome.projectId) seen.add(outcome.projectId)
      if (!outcome.version) {
        if (outcome.projectId) failedDeps.add(outcome.projectId)
        brokenRoots.add(root)
        failed.push({ name: outcome.projectId ?? dep.version_id ?? '?', reason: 'dependency' })
        continue
      }
      const file = jarFile(outcome.version)
      if (!file) continue
      depDownloads.push({
        projectId: outcome.projectId,
        name: file.filename.replace(/\.jar$/i, ''),
        kind: 'dependency',
        versionId: outcome.version.id,
        versionNumber: outcome.version.version_number,
        fileName: file.filename,
        url: file.url,
        sha1: file.hashes?.sha1 ?? null,
        size: file.size ?? 0,
        iconUrl: null,
        root
      })
      for (const nested of outcome.version.dependencies ?? []) next.push({ dep: nested, root })
    }
    frontier = next
  }

  // Красивые названия зависимостей (Fabric API вместо fabric-api-0.100.jar).
  if (depDownloads.length > 0) {
    try {
      const titles = await fetchProjectBatch(depDownloads.map((entry) => entry.projectId))
      const byId = new Map(titles.map((project) => [project.id, project]))
      for (const entry of depDownloads) {
        const project = byId.get(entry.projectId)
        if (project) {
          entry.name = project.title
          entry.iconUrl = project.icon_url ?? null
        }
      }
    } catch {
      /* остаются имена файлов */
    }
  }

  // Мод, которому не нашлась обязательная зависимость, не ставим: он не запустится.
  const kept = downloads.filter((entry) => {
    if (!brokenRoots.has(entry.projectId)) return true
    failed.push({ name: entry.name, reason: 'dependency' })
    return false
  })
  for (const entry of depDownloads) {
    if (!brokenRoots.has(entry.root)) kept.push(entry)
  }
  return { downloads: kept, failed }
}
