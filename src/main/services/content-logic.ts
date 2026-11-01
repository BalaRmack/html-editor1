/**
 * Compatibility rules for the instance «Настроить» window.
 *
 * The requirement is absolute: **nothing that is not 100 % compatible with the
 * instance may be searched, listed or downloaded**. That is a single rule, so it
 * lives here as pure functions (no `electron`, no network) and is covered by
 * `tests/content-logic.test.ts`.
 *
 * "Compatible" means:
 *   mod          → the project supports the instance's exact game version AND
 *                  the instance's mod loader (Fabric mods never land in Forge).
 *   resourcepack → the project supports the instance's exact game version
 *                  (packs are loader-agnostic; Modrinth still publishes `loaders`).
 *   shader       → same as resourcepack.
 */

import type { ContentKind, InstalledMod, LoaderType, ModHit, ModVersion } from '../../shared/types'

export interface CompatContext {
  mcVersion: string
  loader: LoaderType
}

/** Folder inside `instance.gameDir` that holds this kind of content. */
export const CONTENT_DIR: Record<ContentKind, string> = {
  mod: 'mods',
  resourcepack: 'resourcepacks',
  shader: 'shaderpacks'
}

/** Modrinth project_type for each kind. */
export const CONTENT_PROJECT_TYPE: Record<ContentKind, 'mod' | 'resourcepack' | 'shader'> = {
  mod: 'mod',
  resourcepack: 'resourcepack',
  shader: 'shader'
}

const LOADER_KEYS: Record<Exclude<LoaderType, 'vanilla'>, string[]> = {
  fabric: ['fabric'],
  quilt: ['quilt', 'fabric'],
  forge: ['forge'],
  neoforge: ['neoforge']
}

/** Does the loader list of a project/version satisfy the instance loader? */
export function loaderMatches(loaders: string[] | null | undefined, loader: LoaderType): boolean {
  if (loader === 'vanilla') return false
  const wanted = LOADER_KEYS[loader]
  if (!wanted) return false
  if (!loaders || loaders.length === 0) {
    // Packs/shaders often have no loader list at all; mods must declare one.
    return false
  }
  return loaders.some((entry) => wanted.includes(String(entry).toLowerCase()))
}

/** Exact game version match — `1.21` must not accept a `1.21.4` build. */
export function versionMatches(gameVersions: string[] | null | undefined, mcVersion: string): boolean {
  if (!mcVersion) return true
  return (gameVersions ?? []).some((version) => version === mcVersion)
}

/** The one rule: is this project safe to show for this instance? */
export function isCompatible(
  project: Pick<ModHit, 'gameVersions' | 'loaders'>,
  context: CompatContext,
  kind: ContentKind
): boolean {
  if (!versionMatches(project.gameVersions, context.mcVersion)) return false
  if (kind === 'mod') return loaderMatches(project.loaders, context.loader)
  // Resource packs and shaders are loader-agnostic. Modrinth fills `loaders`
  // with `minecraft` for them, so only the game version is enforced here.
  return true
}

/** Defence in depth: the main process filters the API response too. */
export function filterCompatible<T extends Pick<ModHit, 'gameVersions' | 'loaders'>>(
  hits: T[],
  context: CompatContext,
  kind: ContentKind
): T[] {
  return hits.filter((hit) => isCompatible(hit, context, kind))
}

/**
 * Newest version that still fits the instance. The API is already filtered by
 * game version and loader, but CurseForge is looser — so re-check locally and
 * never silently hand back an incompatible build.
 */
export function pickCompatibleVersion(
  versions: ModVersion[],
  context: CompatContext,
  kind: ContentKind
): ModVersion | null {
  const usable = versions.filter((version) => {
    if (!version.downloadUrl) return false
    if (!versionMatches(version.gameVersions, context.mcVersion)) return false
    if (kind !== 'mod') return true
    return loaderMatches(version.loaders, context.loader)
  })
  if (usable.length === 0) return null
  return [...usable].sort((a, b) => {
    const left = Date.parse(a.datePublished ?? '') || 0
    const right = Date.parse(b.datePublished ?? '') || 0
    return right - left
  })[0]
}

/**
 * A build is «newer» when the published SHA-1 differs from the installed file —
 * that catches silent rebuilds of the same version number, which is exactly
 * what the user asked to detect.
 */
export function isNewerBuild(installed: Pick<InstalledMod, 'version' | 'sha1' | 'versionId'>, candidate: ModVersion): boolean {
  // Same source version id (Modrinth/CurseForge) → the very same build.
  if (candidate.id && installed.versionId && candidate.id === installed.versionId) return false
  if (candidate.sha1 && installed.sha1 && candidate.sha1 === installed.sha1) return false
  if (candidate.versionNumber && installed.version && candidate.versionNumber === installed.version) {
    // Same version number but a different hash → a rebuild, still an update.
    return Boolean(candidate.sha1 && installed.sha1 && candidate.sha1 !== installed.sha1)
  }
  return true
}

/** `mods` entries can live as `name.jar` or `name.jar.disabled`. */
export function baseFileName(fileName: string): string {
  return fileName.replace(/\.disabled$/i, '')
}
