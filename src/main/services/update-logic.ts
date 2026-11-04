/**
 * Pure version / release helpers for the auto-updater.
 *
 * Kept free of `electron` so they can be unit-tested in Node (see
 * `tests/update-logic.test.ts`) — the decision "should we annoy the user with a
 * banner" is exactly the part that must never be wrong.
 */

export interface GitHubAsset {
  name?: string
  browser_download_url?: string
  size?: number
}

export interface GitHubRelease {
  tag_name?: string
  name?: string
  body?: string
  html_url?: string
  published_at?: string
  draft?: boolean
  prerelease?: boolean
  assets?: GitHubAsset[]
}

export interface NormalizedRelease {
  /** `1.2.0` — tag without the leading `v`. */
  version: string
  tag: string
  name: string
  notes: string
  publishedAt: string | null
  htmlUrl: string
  assetName: string | null
  assetUrl: string | null
  sizeBytes: number
}

export type UpdateDecision = 'notify' | 'skipped' | 'up-to-date' | 'deferred'

/** `v1.2.3-beta.1` → `[1, 2, 3, -1]` (prerelease sorts below the release). */
export function parseVersion(input: string): number[] | null {
  const clean = String(input ?? '')
    .trim()
    .replace(/^v/i, '')
  if (!clean) return null
  const [core, ...rest] = clean.split('+')
  const [numeric, prerelease] = core.split('-')
  const parts = numeric.split('.')
  if (parts.length === 0 || parts.some((part) => !/^\d+$/.test(part))) return null
  const numbers = parts.map((part) => Number.parseInt(part, 10))
  // A prerelease is "smaller" than the same numeric version.
  if (prerelease || rest.length > 0) numbers.push(-1)
  return numbers
}

/**
 * Semantic-ish comparison: `-1` when a < b, `0` when equal, `1` when a > b.
 * Missing segments count as zero, so `1.2` === `1.2.0`.
 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left && !right) return 0
  if (!left) return -1
  if (!right) return 1
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index++) {
    const l = left[index] ?? 0
    const r = right[index] ?? 0
    if (l !== r) return l > r ? 1 : -1
  }
  return 0
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0
}

/** Picks the Windows installer asset: the `.exe` that is not a blockmap/delta. */
export function pickInstallerAsset(assets: GitHubAsset[] = []): GitHubAsset | null {
  const candidates = assets.filter(
    (asset) => typeof asset.name === 'string' && /\.exe$/i.test(asset.name) && !/\.blockmap$/i.test(asset.name)
  )
  if (candidates.length === 0) return null
  const setup = candidates.find((asset) => /setup/i.test(asset.name ?? ''))
  return setup ?? candidates[0]
}

/** Turns a raw GitHub payload into what the UI needs, or `null` when unusable. */
export function normalizeRelease(raw: GitHubRelease | null | undefined): NormalizedRelease | null {
  if (!raw || raw.draft || !raw.tag_name) return null
  const version = raw.tag_name.trim().replace(/^v/i, '')
  if (!parseVersion(version)) return null
  const asset = pickInstallerAsset(raw.assets)
  return {
    version,
    tag: raw.tag_name,
    name: raw.name?.trim() || `Verdant Launcher ${version}`,
    notes: (raw.body ?? '').slice(0, 4000),
    publishedAt: raw.published_at ?? null,
    htmlUrl: raw.html_url ?? '',
    assetName: asset?.name ?? null,
    assetUrl: asset?.browser_download_url ?? null,
    sizeBytes: asset?.size ?? 0
  }
}

/**
 * The single rule that decides whether the renderer shows the update banner:
 * only a strictly newer, non-skipped, non-deferred release is announced.
 */
export function decideUpdate(input: {
  release: NormalizedRelease | null
  currentVersion: string
  skippedVersion?: string | null
  deferred?: boolean
}): UpdateDecision {
  const { release, currentVersion, skippedVersion, deferred } = input
  if (!release) return 'up-to-date'
  if (!isNewerVersion(release.version, currentVersion)) return 'up-to-date'
  if (skippedVersion && compareVersions(skippedVersion, release.version) === 0) return 'skipped'
  if (deferred) return 'deferred'
  return 'notify'
}

/** Stable key so repeated checks of the same release do not re-announce it. */
export function releaseKey(release: NormalizedRelease | null): string {
  return release ? `${release.tag}:${release.sizeBytes}` : ''
}
