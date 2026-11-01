import { CURSEFORGE_API, CURSEFORGE_GAME_ID } from '../../shared/constants'
import type { LoaderType, ModHit, ModQuery, ModSearchResult, ModVersion } from '../../shared/types'
import { fetchJson } from './net'

interface CfAuthor {
  name: string
}

interface CfLogo {
  thumbnailUrl?: string
  url?: string
}

interface CfMod {
  id: number
  name: string
  slug: string
  summary: string
  downloadCount: number
  thumpsUpCount?: number
  categories?: { name: string }[]
  authors?: CfAuthor[]
  logo?: CfLogo
  dateModified?: string
  latestFilesIndexes?: { gameVersion: string; modLoader?: number }[]
  classId?: number
  links?: { websiteUrl?: string }
}

interface CfFile {
  id: number
  displayName: string
  fileName: string
  fileDate: string
  fileLength: number
  downloadUrl: string | null
  gameVersions: string[]
  releaseType: number
  dependencies?: { modId: number; relationType: number }[]
}

export class CurseForgeKeyError extends Error {
  readonly code = 'curseforge_key_required'
  constructor() {
    super('Для CurseForge нужен API-ключ. Добавьте его в настройках лаунчера.')
  }
}

const LOADER_ID: Record<Exclude<LoaderType, 'vanilla'>, number> = {
  forge: 1,
  fabric: 4,
  quilt: 5,
  neoforge: 6
}

const SORT_FIELD: Record<string, number> = {
  relevance: 2,
  downloads: 6,
  follows: 2,
  newest: 11,
  updated: 3
}

async function cfFetch<T>(path: string, apiKey: string): Promise<T> {
  if (!apiKey) throw new CurseForgeKeyError()
  return fetchJson<T>(`${CURSEFORGE_API}${path}`, { headers: { 'x-api-key': apiKey } })
}

function toHit(mod: CfMod): ModHit {
  const loaders = [...new Set((mod.latestFilesIndexes ?? []).map((index) => index.modLoader).filter(Boolean))]
  const loaderNames = loaders
    .map((id) => Object.entries(LOADER_ID).find(([, value]) => value === id)?.[0])
    .filter((value): value is string => Boolean(value))
  return {
    id: String(mod.id),
    slug: mod.slug,
    name: mod.name,
    summary: mod.summary,
    author: mod.authors?.[0]?.name ?? '',
    downloads: mod.downloadCount ?? 0,
    follows: mod.thumpsUpCount ?? 0,
    iconUrl: mod.logo?.thumbnailUrl ?? mod.logo?.url ?? null,
    categories: (mod.categories ?? []).map((category) => category.name),
    loaders: loaderNames,
    gameVersions: [...new Set((mod.latestFilesIndexes ?? []).map((index) => index.gameVersion).filter(Boolean))],
    projectType: mod.classId === 4471 ? 'modpack' : 'mod',
    updatedAt: mod.dateModified ?? null,
    source: 'curseforge'
  }
}

export async function curseforgeSearch(query: ModQuery, apiKey: string): Promise<ModSearchResult> {
  if (!apiKey) throw new CurseForgeKeyError()
  const params = new URLSearchParams({
    gameId: String(CURSEFORGE_GAME_ID),
    searchFilter: query.query ?? '',
    sortField: String(SORT_FIELD[query.sort ?? 'relevance'] ?? 2),
    sortOrder: 'desc',
    index: String(query.offset ?? 0),
    pageSize: String(Math.min(query.limit ?? 20, 50)),
    classId: String(query.projectType === 'modpack' ? 4471 : 6)
  })
  if (query.mcVersion) params.set('gameVersion', query.mcVersion)
  if (query.loader && query.loader !== 'vanilla') params.set('modLoaderType', String(LOADER_ID[query.loader]))

  const response = await cfFetch<{ data: CfMod[]; pagination: { totalCount: number; index: number; pageSize: number } }>(
    `/mods/search?${params.toString()}`,
    apiKey
  )
  return {
    hits: response.data.map(toHit),
    total: response.pagination.totalCount,
    offset: response.pagination.index,
    limit: response.pagination.pageSize
  }
}

export async function curseforgeProject(id: string, apiKey: string): Promise<ModHit | null> {
  try {
    const response = await cfFetch<{ data: CfMod }>(`/mods/${id}`, apiKey)
    return toHit(response.data)
  } catch {
    return null
  }
}

function toVersion(projectId: string, file: CfFile): ModVersion {
  const fallbackUrl =
    file.downloadUrl ??
    `https://edge.forgecdn.net/files/${Math.floor(file.id / 1000)}/${file.id % 1000}/${encodeURIComponent(file.fileName)}`
  return {
    id: String(file.id),
    projectId,
    name: file.displayName,
    versionNumber: file.displayName,
    gameVersions: file.gameVersions.filter((version) => /^\d+\.\d+(\.\d+)?$/.test(version)),
    loaders: [],
    datePublished: file.fileDate ?? null,
    downloadUrl: fallbackUrl,
    fileName: file.fileName,
    fileSize: file.fileLength,
    dependencies: (file.dependencies ?? [])
      .filter((dependency) => dependency.relationType === 3)
      .map((dependency) => ({
        projectId: String(dependency.modId),
        versionId: null,
        kind: 'required' as const
      }))
  }
}

export async function curseforgeVersions(
  projectId: string,
  mcVersion: string,
  loader: LoaderType,
  apiKey: string
): Promise<ModVersion[]> {
  const params = new URLSearchParams()
  if (mcVersion) params.set('gameVersion', mcVersion)
  if (loader !== 'vanilla') params.set('modLoaderType', String(LOADER_ID[loader]))
  const response = await cfFetch<{ data: CfFile[] }>(`/mods/${projectId}/files?${params.toString()}`, apiKey)
  return response.data.sort((a, b) => Date.parse(b.fileDate) - Date.parse(a.fileDate)).map((file) => toVersion(projectId, file))
}

/** Fetch a single file of a project (used by modpack manifests). */
export async function curseforgeFile(projectId: string, fileId: string, apiKey: string): Promise<ModVersion | null> {
  try {
    const response = await cfFetch<{ data: CfFile }>(`/mods/${projectId}/files/${fileId}`, apiKey)
    return toVersion(projectId, response.data)
  } catch {
    return null
  }
}

export async function curseforgePackVersions(
  projectId: string,
  mcVersion: string | null | undefined,
  apiKey: string
): Promise<ModVersion[]> {
  const params = new URLSearchParams()
  if (mcVersion) params.set('gameVersion', mcVersion)
  const response = await cfFetch<{ data: CfFile[] }>(`/mods/${projectId}/files?${params.toString()}`, apiKey)
  return response.data.sort((a, b) => Date.parse(b.fileDate) - Date.parse(a.fileDate)).map((file) => toVersion(projectId, file))
}
