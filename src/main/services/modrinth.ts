import { MODRINTH_API } from '../../shared/constants'
import type { LoaderType, ModHit, ModQuery, ModSearchResult, ModVersion } from '../../shared/types'
import { fetchJson } from './net'

interface ModrinthHit {
  project_id: string
  project_type: string
  slug: string
  author: string
  title: string
  description: string
  categories: string[]
  versions: string[]
  downloads: number
  follows: number
  icon_url: string | null
  date_modified?: string
  client_side?: string
}

interface ModrinthSearchResponse {
  hits: ModrinthHit[]
  offset: number
  limit: number
  total_hits: number
}

interface ModrinthProject {
  id: string
  slug: string
  title: string
  description: string
  categories: string[]
  client_side: string
  server_side: string
  downloads: number
  followers: number
  icon_url: string | null
  updated: string
  project_type: string
  team?: string
  game_versions: string[]
  loaders: string[]
}

interface ModrinthVersionFile {
  url: string
  filename: string
  primary: boolean
  size: number
  file_type?: string | null
}

interface ModrinthVersion {
  id: string
  project_id: string
  name: string
  version_number: string
  game_versions: string[]
  loaders: string[]
  date_published: string
  files: ModrinthVersionFile[]
  dependencies: { version_id: string | null; project_id: string | null; dependency_type: string }[]
  version_type: string
}

const LOADER_FACET: Record<Exclude<LoaderType, 'vanilla'>, string> = {
  fabric: 'fabric',
  quilt: 'quilt',
  forge: 'forge',
  neoforge: 'neoforge'
}

const SORT_INDEX: Record<string, string> = {
  relevance: 'relevance',
  downloads: 'downloads',
  follows: 'follows',
  newest: 'newest',
  updated: 'updated'
}

function toHit(hit: ModrinthHit, source: 'modrinth' = 'modrinth'): ModHit {
  return {
    id: hit.project_id,
    slug: hit.slug,
    name: hit.title,
    summary: hit.description,
    author: hit.author,
    downloads: hit.downloads ?? 0,
    follows: hit.follows ?? 0,
    iconUrl: hit.icon_url ?? null,
    categories: hit.categories ?? [],
    loaders: [],
    gameVersions: hit.versions ?? [],
    projectType: hit.project_type === 'modpack' ? 'modpack' : 'mod',
    updatedAt: hit.date_modified ?? null,
    source
  }
}

export async function modrinthSearch(query: ModQuery): Promise<ModSearchResult> {
  const facets: string[][] = [[`project_type:${query.projectType ?? 'mod'}`]]
  if (query.loader && query.loader !== 'vanilla') facets.push([`categories:${LOADER_FACET[query.loader]}`])
  if (query.mcVersion) facets.push([`versions:${query.mcVersion}`])
  if (query.category) facets.push([`categories:${query.category}`])

  const params = new URLSearchParams({
    query: query.query ?? '',
    index: SORT_INDEX[query.sort ?? 'relevance'] ?? 'relevance',
    offset: String(query.offset ?? 0),
    limit: String(Math.min(query.limit ?? 20, 50)),
    facets: JSON.stringify(facets)
  })

  const response = await fetchJson<ModrinthSearchResponse>(`${MODRINTH_API}/search?${params.toString()}`)
  return {
    hits: response.hits.map((hit) => toHit(hit)),
    total: response.total_hits,
    offset: response.offset,
    limit: response.limit
  }
}

export async function modrinthProject(id: string): Promise<ModHit | null> {
  try {
    const project = await fetchJson<ModrinthProject>(`${MODRINTH_API}/project/${encodeURIComponent(id)}`)
    return {
      id: project.id,
      slug: project.slug,
      name: project.title,
      summary: project.description,
      author: '',
      downloads: project.downloads ?? 0,
      follows: project.followers ?? 0,
      iconUrl: project.icon_url,
      categories: project.categories ?? [],
      loaders: project.loaders ?? [],
      gameVersions: project.game_versions ?? [],
      projectType: project.project_type === 'modpack' ? 'modpack' : 'mod',
      updatedAt: project.updated,
      source: 'modrinth'
    }
  } catch {
    return null
  }
}

export function normalizeModrinthVersion(version: ModrinthVersion): ModVersion {
  const file = version.files.find((entry) => entry.primary) ?? version.files[0]
  return {
    id: version.id,
    projectId: version.project_id,
    name: version.name,
    versionNumber: version.version_number,
    gameVersions: version.game_versions,
    loaders: version.loaders,
    datePublished: version.date_published,
    downloadUrl: file?.url ?? '',
    fileName: file?.filename ?? '',
    fileSize: file?.size ?? 0,
    dependencies: version.dependencies
      .filter((dep) => dep.dependency_type === 'required')
      .map((dep) => ({
        projectId: dep.project_id,
        versionId: dep.version_id,
        kind: 'required' as const
      }))
  }
}

export async function modrinthVersions(projectId: string, mcVersion: string, loader: LoaderType): Promise<ModVersion[]> {
  const params = new URLSearchParams()
  if (mcVersion) params.set('game_versions', JSON.stringify([mcVersion]))
  if (loader !== 'vanilla') params.set('loaders', JSON.stringify([loader]))
  const url = `${MODRINTH_API}/project/${encodeURIComponent(projectId)}/version?${params.toString()}`
  const versions = await fetchJson<ModrinthVersion[]>(url)
  return versions.map(normalizeModrinthVersion)
}

export async function modrinthVersionsForPack(projectId: string, mcVersion?: string | null): Promise<ModVersion[]> {
  const params = new URLSearchParams()
  if (mcVersion) params.set('game_versions', JSON.stringify([mcVersion]))
  const versions = await fetchJson<ModrinthVersion[]>(
    `${MODRINTH_API}/project/${encodeURIComponent(projectId)}/version?${params.toString()}`
  )
  return versions.map(normalizeModrinthVersion)
}

export async function modrinthVersionById(versionId: string): Promise<ModVersion> {
  const version = await fetchJson<ModrinthVersion>(`${MODRINTH_API}/version/${encodeURIComponent(versionId)}`)
  return normalizeModrinthVersion(version)
}

export interface ModrinthPackFile {
  path: string
  downloadUrl: string
  fileSize: number
  client: string
}

export interface ModrinthPackIndex {
  name: string
  versionId: string
  mcVersion: string
  loader: LoaderType
  loaderVersion: string | null
  files: ModrinthPackFile[]
}

export function parseModrinthIndex(raw: unknown): ModrinthPackIndex {
  const index = raw as {
    name?: string
    versionId?: string
    files?: { path?: string; downloads?: string[]; fileSize?: number; env?: { client?: string } }[]
    dependencies?: Record<string, string>
  }
  const deps = index.dependencies ?? {}
  const mcVersion = deps['minecraft'] ?? ''
  let loader: LoaderType = 'vanilla'
  let loaderVersion: string | null = null
  if (deps['fabric-loader']) {
    loader = 'fabric'
    loaderVersion = deps['fabric-loader']
  } else if (deps['quilt-loader']) {
    loader = 'quilt'
    loaderVersion = deps['quilt-loader']
  } else if (deps['neoforge']) {
    loader = 'neoforge'
    loaderVersion = deps['neoforge']
  } else if (deps['forge']) {
    loader = 'forge'
    loaderVersion = deps['forge']
  }
  return {
    name: index.name ?? 'Modpack',
    versionId: index.versionId ?? '',
    mcVersion,
    loader,
    loaderVersion,
    files: (index.files ?? [])
      .filter((file) => file.path && Array.isArray(file.downloads) && file.downloads.length > 0)
      .map((file) => ({
        path: file.path as string,
        downloadUrl: (file.downloads as string[])[0],
        fileSize: file.fileSize ?? 0,
        client: file.env?.client ?? 'required'
      }))
  }
}
