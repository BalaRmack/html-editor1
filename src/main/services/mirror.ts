/**
 * Mojang is not reachable directly from a big part of the world (RU included):
 * `piston-data.mojang.com` and `libraries.minecraft.net` simply time out. The
 * launcher therefore speaks to **BMCLAPI** (bmclapi2.bangbang93.com), which
 * mirrors every official endpoint 1:1 — version manifest, version json, client
 * jar, maven, assets and the Fabric/Quilt/Forge metadata.
 *
 * Rules of the game (1.2.0 — mirror is no longer an emergency fallback):
 *  · **every** official URL is rewritten to its BMCLAPI twin before the first
 *    socket is opened, so a blocked Mojang CDN never even gets a chance to hang
 *    the bar at 40 MB;
 *  · the official host stays behind as the *second* candidate — a mirror outage
 *    degrades the launcher instead of bricking it;
 *  · a dead official host is detected in ≤ 4 s (`OFFICIAL_CONNECT_TIMEOUT_MS`),
 *    and the whole session is pinned to the mirror on the spot;
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
 * Order in which a request should be attempted.
 *
 * BMCLAPI is **always** first — that is the whole point of 1.2.0: on a network
 * where `libraries.minecraft.net` answers with a 403 or trickles to a halt, a
 * "try official, fall back later" strategy burns the user's patience before it
 * ever reaches the working host. The official URL is kept as the second
 * candidate, and only a proven-dead mirror (`mode === 'official'`) flips the
 * order back.
 */
export function urlCandidates(url: string): string[] {
  if (isMirrored(url)) return [url]
  const mirrored = rewriteToMirror(url)
  if (mirrored === url) return [url]
  return state.mode === 'official' ? [url, mirrored] : [mirrored, url]
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
  if (usedMirror) {
    // Normal state in 1.2.0: the mirror answered, keep it in front.
    setNetworkMode('mirror', state.reason ?? 'работаем через BMCLAPI')
  } else if (state.mode !== 'official') {
    // The official host answered *despite* the mirror being first: the mirror
    // is the broken one, so pin the session to Mojang for the rest of the run.
    setNetworkMode('official', 'BMCLAPI не отвечает — работаем напрямую')
  }
}

/**
 * Consecutive failures switch the session to the mirror. One flaky request is
 * not enough, but three in a row mean Mojang is blocked for this user.
 */
export function markNetworkFailure(reason = 'Сеть недоступна'): void {
  state.failures += 1
  // Mirror-first is already the default, so a failure only matters for the
  // pinned-official mode: two dead official hosts in a row and we switch back.
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
 * Hosts that a full install actually touches. Probing only the version manifest
 * is not enough — that is how 1.1.2 ended up in "official" mode while
 * `libraries.minecraft.net` was dead, and the bar froze at 40 MB.
 */
const OFFICIAL_PROBES: Array<{ name: string; url: string }> = [
  { name: 'manifest', url: 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json' },
  {
    name: 'libraries',
    url: 'https://libraries.minecraft.net/com/google/code/gson/gson/2.10.1/gson-2.10.1.pom'
  },
  { name: 'assets', url: 'https://resources.download.minecraft.net/' }
]

export interface NetworkCheck {
  mode: NetworkMode
  official: Record<string, ProbeResult>
  mirror: ProbeResult
  reason: string
}

/**
 * Checks every host an install needs, in parallel, with a 3.5 s timeout each.
 * Any dead official host is enough to switch the whole session to BMCLAPI: one
 * blocked CDN stalls the entire install, so half-official mode does not exist.
 */
export async function checkNetwork(timeoutMs = 3500): Promise<NetworkCheck> {
  const [results, mirror] = await Promise.all([
    Promise.all(OFFICIAL_PROBES.map(async (entry) => [entry.name, await probe(entry.url, timeoutMs)] as const)),
    probe(`${BMCL_MIRROR}/`, timeoutMs)
  ])
  const official = Object.fromEntries(results)
  const dead = results.filter(([, result]) => !result.ok).map(([name]) => name)

  // The mirror answers → BMCLAPI for the whole session, even when Mojang is
  // reachable. Fewer moving parts, one predictable speed, no 403 lottery.
  if (mirror.ok) {
    const reason =
      dead.length === 0
        ? 'работаем через BMCLAPI (официальные серверы тоже живы)'
        : `недоступно: ${dead.join(', ')} — работаем через BMCLAPI`
    setNetworkMode('mirror', reason)
    return { mode: 'mirror', official, mirror, reason }
  }
  if (dead.length === 0) {
    setNetworkMode('official', null)
    return { mode: 'official', official, mirror, reason: 'BMCLAPI молчит, все серверы Mojang отвечают' }
  }
  // Both sides are broken: stay official (mirror-first would only add latency to
  // a request that is going to fail anyway) and let per-file failover work.
  setNetworkMode('official', `недоступно: ${dead.join(', ')}, зеркало тоже молчит`)
  return { mode: 'official', official, mirror, reason: `недоступно: ${dead.join(', ')}, зеркало тоже молчит` }
}

/**
 * Decides which mode the session starts in. A single dead host immediately
 * selects the mirror, so the very first install already works in RU.
 */
export async function ensureNetworkMode(force = false): Promise<NetworkMode> {
  if (!force && state.mode !== 'unknown' && Date.now() - state.checkedAt < 5 * 60 * 1000) {
    return state.mode
  }
  const check = await checkNetwork()
  return check.mode
}

/** Human readable line for the log / settings screen. */
export function networkSummary(): string {
  if (state.mode === 'mirror') return `BMCLAPI (${state.reason ?? 'официальные серверы недоступны'})`
  if (state.mode === 'official') return 'официальные серверы Mojang'
  return 'сеть ещё не проверялась'
}
