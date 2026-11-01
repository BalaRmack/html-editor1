import { getLoaderArtifactListFor, getQuiltLoaderVersionsByMinecraft, getVersionList } from '@xmcl/installer'
import { FORGE_MAVEN, NEOFORGE_MAVEN } from '../../shared/constants'
import type { LoaderType, LoaderVersion, VersionSummary } from '../../shared/types'
import { fetchJson, fetchText } from './net'
import { logger } from './logger'

interface CacheEntry<T> {
  at: number
  value: T
}

const TTL = 10 * 60 * 1000

function cached<T>(store: Map<string, CacheEntry<T>>, key: string, loader: () => Promise<T>): Promise<T> {
  const hit = store.get(key)
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.value)
  return loader().then((value) => {
    store.set(key, { at: Date.now(), value })
    return value
  })
}

const minecraftCache = new Map<string, CacheEntry<VersionSummary[]>>()
const loaderCache = new Map<string, CacheEntry<LoaderVersion[]>>()

/** Parses `<version>..</version>` entries out of a maven-metadata.xml document. */
export function parseMavenVersions(xml: string): string[] {
  const versions: string[] = []
  const re = /<version>([^<]+)<\/version>/g
  let match: RegExpExecArray | null
  while ((match = re.exec(xml))) {
    const value = match[1].trim()
    if (value) versions.push(value)
  }
  return versions
}

export function compareVersionsDesc(a: string, b: string): number {
  const pa = a.split(/[.\-+]/).map((part) => (/^\d+$/.test(part) ? Number(part) : part))
  const pb = b.split(/[.\-+]/).map((part) => (/^\d+$/.test(part) ? Number(part) : part))
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i]
    const vb = pb[i]
    if (va === undefined) return -1
    if (vb === undefined) return 1
    if (typeof va === 'number' && typeof vb === 'number') {
      if (va !== vb) return vb - va
    } else if (String(va) !== String(vb)) {
      return String(vb).localeCompare(String(va))
    }
  }
  return 0
}

/** NeoForge maven versions are numbered after the MC minor: 1.21.1 -> 21.1.x */
export function neoForgePrefix(mcVersion: string): string {
  if (mcVersion === '1.20.1') return '47.1.'
  const parts = mcVersion.split('.')
  const minor = parts[1] ?? '0'
  const patch = parts[2] ?? '0'
  return `${minor}.${patch}.`
}

export class VersionService {
  async listMinecraft(): Promise<VersionSummary[]> {
    return cached(minecraftCache, 'all', async () => {
      const list = await getVersionList()
      return list.versions
        .map((version) => ({ id: version.id, type: version.type, releaseTime: version.releaseTime }))
        .sort((a, b) => Date.parse(b.releaseTime) - Date.parse(a.releaseTime))
    })
  }

  async latestRelease(): Promise<string | null> {
    const list = await this.listMinecraft()
    return list.find((version) => version.type === 'release')?.id ?? null
  }

  async listLoaders(mcVersion: string, loader: LoaderType): Promise<LoaderVersion[]> {
    if (loader === 'vanilla') return [{ version: mcVersion, stable: true }]
    return cached(loaderCache, `${loader}:${mcVersion}`, () => this.fetchLoaders(mcVersion, loader))
  }

  private async fetchLoaders(mcVersion: string, loader: LoaderType): Promise<LoaderVersion[]> {
    switch (loader) {
      case 'fabric': {
        const artifacts = await getLoaderArtifactListFor(mcVersion)
        return artifacts
          .map((artifact) => ({ version: artifact.loader.version, stable: artifact.loader.stable }))
          .sort((a, b) => compareVersionsDesc(a.version, b.version))
      }
      case 'quilt': {
        const artifacts = await getQuiltLoaderVersionsByMinecraft({ minecraftVersion: mcVersion })
        return artifacts
          .map((artifact) => ({ version: artifact.loader.version, stable: artifact.loader.stable }))
          .sort((a, b) => compareVersionsDesc(a.version, b.version))
      }
      case 'forge': {
        const xml = await fetchText(`${FORGE_MAVEN}/net/minecraftforge/forge/maven-metadata.xml`)
        const promos = await fetchJson<{ promos: Record<string, string> }>(
          'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json'
        ).catch(() => ({ promos: {} as Record<string, string> }))
        const recommended = promos.promos[`${mcVersion}-recommended`]
        const versions = parseMavenVersions(xml)
          .filter((version) => version.startsWith(`${mcVersion}-`))
          .map((version) => version.slice(mcVersion.length + 1))
          .filter((version) => version.length > 0)
          .sort(compareVersionsDesc)
        return versions.map((version) => ({ version, stable: recommended ? version === recommended : !version.includes('beta') }))
      }
      case 'neoforge': {
        const xml = await fetchText(`${NEOFORGE_MAVEN}/net/neoforged/neoforge/maven-metadata.xml`)
        const prefix = neoForgePrefix(mcVersion)
        let versions = parseMavenVersions(xml).filter((version) => version.startsWith(prefix))
        if (versions.length === 0) {
          // 1.20.1 NeoForge ships under the legacy `forge` artifact
          const legacy = await fetchText(`${NEOFORGE_MAVEN}/net/neoforged/forge/maven-metadata.xml`).catch(() => '')
          versions = parseMavenVersions(legacy).filter((version) => version.startsWith('1.20.1-'))
        }
        return versions.sort(compareVersionsDesc).map((version) => ({ version, stable: !/beta/i.test(version) }))
      }
      default:
        return []
    }
  }

  async resolveLoaderVersion(mcVersion: string, loader: LoaderType): Promise<string | null> {
    if (loader === 'vanilla') return null
    try {
      const list = await this.listLoaders(mcVersion, loader)
      const stable = list.find((entry) => entry.stable)
      return stable?.version ?? list[0]?.version ?? null
    } catch (error) {
      logger.warn(`Не удалось получить список ${loader} для ${mcVersion}: ${(error as Error).message}`)
      return null
    }
  }
}

export const versions = new VersionService()
