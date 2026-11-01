/**
 * Mojang is not reachable directly from a big part of the world (RU included):
 * `piston-data.mojang.com` and `libraries.minecraft.net` simply time out. The
 * launcher therefore speaks to **BMCLAPI** (bmclapi2.bangbang93.com), which
 * mirrors every official endpoint 1:1 — version manifest, version json, client
 * jar, maven, assets and the Fabric/Quilt/Forge metadata.
 *
 * Rules of the game:
 *  · the official host is always tried first;
 *  · a timeout / DNS / 5xx switches the whole session to the mirror instantly;
 *  · every URL keeps its shape, only the host (and a few path prefixes) change,
 *    so the same `rewrite()` can be applied to a version json, an asset index or
 *    a single library URL.
 */

export const BMCL_MIRROR = 'https://bmclapi2.bangbang93.com'

/** Host/path replacements, longest prefix first (order matters). */
const RULES: Array<[RegExp, string]> = [
  // maven repositories → BMCLAPI maven proxy. Only real `/maven` paths are
  // rewritten: `files.minecraftforge.net/...promotions.json` is a web endpoint,
  // not a maven artifact, and lives nowhere on the mirror.
  [/^https?:\/\/(?:maven|files)\.minecraftforge\.net\/maven/i, `${BMCL_MIRROR}/maven`],
  [/^https?:\/\/maven\.minecraftforge\.net/i, `${BMCL_MIRROR}/maven`],
  [/^https?:\/\/maven\.neoforged\.net\/releases/i, `${BMCL_MIRROR}/maven`],
  [/^https?:\/\/maven\.fabricmc\.net/i, `${BMCL_MIRROR}/maven`],
  [/^https?:\/\/maven\.quiltmc\.org\/repository\/release/i, `${BMCL_MIRROR}/maven`],
  [/^https?:\/\/libraries\.minecraft\.net/i, `${BMCL_MIRROR}/maven`],
  // assets
  [/^https?:\/\/resources\.download\.minecraft\.net/i, `${BMCL_MIRROR}/assets`],
  // metadata
  [/^https?:\/\/launchermeta\.mojang\.com/i, BMCL_MIRROR],
  [/^https?:\/\/piston-meta\.mojang\.com/i, BMCL_MIRROR],
  [/^https?:\/\/piston-data\.mojang\.com/i, BMCL_MIRROR],
  [/^https?:\/\/launcher\.mojang\.com/i, BMCL_MIRROR],
  [/^https?:\/\/meta\.fabricmc\.net/i, `${BMCL_MIRROR}/fabric-meta`],
  [/^https?:\/\/meta\.quiltmc\.org/i, `${BMCL_MIRROR}/quilt-meta`],
  [/^https?:\/\/meta\.minecraftforge\.net/i, `${BMCL_MIRROR}/forge-meta`]
]

export type NetworkMode = 'unknown' | 'official' | 'mirror'

export interface NetworkState {
  mode: NetworkMode
  /** Why the mode changed — surfaced in the log and in the UI hint. */
  reason: string | null
  checkedAt: number
  failures: number
  successes: number
}

const state: NetworkState = {
  mode: 'unknown',
  reason: null,
  checkedAt: 0,
  failures: 0,
  successes: 0
}

/** Rewrites an official Mojang URL to its BMCLAPI twin. Pure. */
export function rewriteToMirror(url: string): string {
  for (const [pattern, replacement] of RULES) {
    if (pattern.test(url)) return url.replace(pattern, replacement)
  }
  return url
}

/** True when the URL already points at the mirror. */
export function isMirrored(url: string): boolean {
  return url.includes('bmclapi')
}

/** Every host we are able to mirror, for diagnostics. */
export function mirrorableHosts(): string[] {
  return [
    'launchermeta.mojang.com',
    'piston-meta.mojang.com',
    'piston-data.mojang.com',
    'libraries.minecraft.net',
    'resources.download.minecraft.net',
    'maven.fabricmc.net',
    'meta.fabricmc.net',
    'maven.minecraftforge.net',
    'maven.neoforged.net',
    'meta.quiltmc.org'
  ]
}

/**
 * Order in which a request should be attempted. In mirror mode the mirror goes
 * first and the official host is the fallback (and vice versa).
 */
export function urlCandidates(url: string): string[] {
  if (isMirrored(url)) return [url]
  const mirrored = rewriteToMirror(url)
  if (mirrored === url) return [url]
  return state.mode === 'mirror' ? [mirrored, url] : [url, mirrored]
}

export function getNetworkState(): Readonly<NetworkState> {
  return state
}

export function setNetworkMode(mode: NetworkMode, reason: string | null = null): void {
  if (state.mode !== mode) {
    state.mode = mode
    state.reason = reason
    state.checkedAt = Date.now()
  }
}

/** A successful request: enough to leave mirror mode only on explicit probes. */
export function markNetworkSuccess(usedMirror: boolean): void {
  state.successes += 1
  if (usedMirror) setNetworkMode('mirror', 'Официальные серверы недоступны')
  else if (state.mode !== 'official') setNetworkMode('official', null)
}

/**
 * Consecutive failures switch the session to the mirror. One flaky request is
 * not enough, but three in a row mean Mojang is blocked for this user.
 */
export function markNetworkFailure(reason = 'Сеть недоступна'): void {
  state.failures += 1
  if (state.failures >= 2 && state.mode !== 'mirror') {
    setNetworkMode('mirror', `${reason} — переключаюсь на зеркало BMCLAPI`)
  }
}

/** Test hook. */
export function resetNetworkState(): void {
  state.mode = 'unknown'
  state.reason = null
  state.checkedAt = 0
  state.failures = 0
  state.successes = 0
}

export interface ProbeResult {
  ok: boolean
  /** Milliseconds it took to get a reply. */
  ms: number
  error?: string
}

/**
 * Pings a URL with a hard timeout. Used on start-up to decide whether the
 * official host is usable at all — `AbortSignal.timeout` is what keeps the
 * launcher from waiting 30 s on a blocked host.
 */
export async function probe(url: string, timeoutMs = 3500): Promise<ProbeResult> {
  const started = Date.now()
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'VerdantLauncher/probe', Range: 'bytes=0-64' },
      signal: AbortSignal.timeout(timeoutMs)
    })
    return { ok: response.ok || response.status === 206, ms: Date.now() - started }
  } catch (error) {
    return { ok: false, ms: Date.now() - started, error: (error as Error).message }
  }
}

/**
 * Decides which mode the session starts in. A failed probe against the official
 * metadata endpoint immediately selects the mirror, so the very first install
 * already works in RU.
 */
export async function ensureNetworkMode(force = false): Promise<NetworkMode> {
  if (!force && state.mode !== 'unknown' && Date.now() - state.checkedAt < 5 * 60 * 1000) {
    return state.mode
  }
  const official = await probe('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json')
  if (official.ok) {
    setNetworkMode('official', null)
    return 'official'
  }
  setNetworkMode('mirror', `Mojang не отвечает (${official.error ?? 'таймаут'}) — используется зеркало BMCLAPI`)
  return 'mirror'
}

/** Human readable line for the log / settings screen. */
export function networkSummary(): string {
  if (state.mode === 'mirror') return `BMCLAPI (${state.reason ?? 'официальные серверы недоступны'})`
  if (state.mode === 'official') return 'официальные серверы Mojang'
  return 'сеть ещё не проверялась'
}
