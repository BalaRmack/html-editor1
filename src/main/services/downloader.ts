import { createWriteStream } from 'node:fs'
import { mkdir, open, rename, rm, stat } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { USER_AGENT } from '../../shared/constants'
import { isMirrored, markNetworkFailure, markNetworkSuccess, urlCandidates, type ProbeResult } from './mirror'

/** Headers/connection timeout for the mirror: healthy, generous. */
export const CONNECT_TIMEOUT_MS = 8_000
/**
 * Headers/connection timeout for an *official* Mojang host. This is the 3–5 s
 * budget the user asked for: a blocked `libraries.minecraft.net` gives up after
 * 4 s and the same file is retried on BMCLAPI, still inside one attempt.
 */
export const OFFICIAL_CONNECT_TIMEOUT_MS = 4_000
/** Body stall timeout: no bytes for 15 s ⇒ abort this attempt and retry. */
export const DEFAULT_IDLE_TIMEOUT_MS = 15_000
/** Attempts per file: the first try plus three retries. */
export const DEFAULT_ATTEMPTS = 4

/* -------------------------------------------------------------------------- */
/*  Monotonic progress                                                        */
/* -------------------------------------------------------------------------- */

export interface ProgressSnapshot {
  /** 0..100, never smaller than the previous value. */
  percent: number
  /** Bytes done inside the current phase. */
  done: number
  /** Bytes of the current phase (stable snapshot, never grows mid-flight). */
  total: number
  /** Smoothed download speed in bytes/second. */
  bytesPerSecond: number
  /** Seconds left inside the current phase, `null` when unknown. */
  etaSeconds: number | null
  phaseKey: string | null
}

export interface PhaseRange {
  key: string
  /** Overall percent this phase starts at. */
  from: number
  /** Overall percent this phase ends at. */
  to: number
}

/**
 * Turns the noisy `progress`/`total` pairs of a task graph into one calm,
 * forward-only percentage.
 *
 * Two rules make the bar behave:
 *  · `total` is snapshotted the first time a phase reports it, so a task graph
 *    that discovers more work halfway through cannot shrink the ratio;
 *  · the emitted percent is clamped with `Math.max`, so even a re-downloaded
 *    file cannot move the bar backwards — the worst case is a short pause.
 */
export class ProgressTracker {
  private readonly now: () => number
  private phase: PhaseRange | null = null
  private phaseTotal = 0
  private phaseDone = 0
  private lastPercent = 0
  private percent = 0
  private speed = 0
  private samples: Array<{ t: number; done: number }> = []
  private startedAt = 0

  constructor(now: () => number = Date.now) {
    this.now = now
  }

  reset(): void {
    this.phase = null
    this.phaseTotal = 0
    this.phaseDone = 0
    this.lastPercent = 0
    this.percent = 0
    this.speed = 0
    this.samples = []
    this.startedAt = 0
  }

  beginPhase(range: PhaseRange): void {
    if (this.phase?.key === range.key) return
    if (!this.startedAt) this.startedAt = this.now()
    this.phase = range
    this.phaseTotal = 0
    this.phaseDone = 0
    this.samples = []
    // A new phase may never push the bar below what the user already sees.
    this.percent = Math.max(this.percent, range.from)
    this.lastPercent = this.percent
  }

  /**
   * Reports work inside the current phase. `total` may grow; the tracker keeps
   * the largest total it has seen for this phase and clamps `done` to it.
   */
  report(done: number, total: number): ProgressSnapshot {
    if (total > this.phaseTotal) this.phaseTotal = total
    if (done > this.phaseDone) this.phaseDone = done
    const totalUsed = this.phaseTotal
    const doneUsed = Math.min(this.phaseDone, totalUsed)
    const ratio = totalUsed > 0 ? Math.min(1, Math.max(0, doneUsed / totalUsed)) : 0
    const range = this.phase ?? { key: 'total', from: 0, to: 100 }
    const next = range.from + (range.to - range.from) * ratio
    this.percent = Math.max(this.lastPercent, Math.min(100, next))
    this.lastPercent = this.percent
    this.updateSpeed(doneUsed, this.now())
    return {
      percent: this.percent,
      done: doneUsed,
      total: totalUsed,
      bytesPerSecond: this.speed,
      etaSeconds: this.eta(doneUsed, totalUsed),
      phaseKey: this.phase?.key ?? null
    }
  }

  /** Jumps to an absolute percent (used by "fetched lazily" phases). */
  mark(percent: number): ProgressSnapshot {
    this.percent = Math.max(this.lastPercent, Math.min(100, percent))
    this.lastPercent = this.percent
    return {
      percent: this.percent,
      done: this.phaseDone,
      total: this.phaseTotal,
      bytesPerSecond: this.speed,
      etaSeconds: null,
      phaseKey: this.phase?.key ?? null
    }
  }

  get current(): ProgressSnapshot {
    return {
      percent: this.percent,
      done: this.phaseDone,
      total: this.phaseTotal,
      bytesPerSecond: this.speed,
      etaSeconds: this.eta(this.phaseDone, this.phaseTotal),
      phaseKey: this.phase?.key ?? null
    }
  }

  /** Sliding-window speed: smooth enough to read, honest enough to trust. */
  private updateSpeed(done: number, at: number): void {
    this.samples.push({ t: at, done })
    // 12 s window keeps the number stable while still reacting to a stall.
    while (this.samples.length > 2 && at - this.samples[0].t > 12_000) this.samples.shift()
    const first = this.samples[0]
    const elapsed = at - first.t
    if (elapsed >= 700) {
      const instant = ((done - first.done) * 1000) / elapsed
      // exponential smoothing so a single burst does not spike the label
      this.speed = this.speed > 0 ? this.speed * 0.65 + instant * 0.35 : instant
    }
  }

  private eta(done: number, total: number): number | null {
    if (this.speed <= 1024 || total <= done) return null
    return Math.round((total - done) / this.speed)
  }
}

export { formatEta, formatSpeed } from '../../shared/format'

/* -------------------------------------------------------------------------- */
/*  Concurrency                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A tiny semaphore: at most `limit` tasks run at once, the rest queue. Download
 * pools use it instead of firing 400 sockets at once.
 */
export class Limiter {
  private active = 0
  private queue: Array<() => void> = []

  constructor(readonly limit: number) {
    if (limit < 1) throw new Error('limit must be >= 1')
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await fn()
    } finally {
      this.release()
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.active += 1
        resolve()
      })
    })
  }

  private release(): void {
    this.active -= 1
    const next = this.queue.shift()
    if (next) next()
  }
}

export interface PoolResult<T> {
  value: T
  index: number
}

/**
 * `Promise.allSettled` with a concurrency cap. One rejected item never stops the
 * others — the caller decides what to do with the failures.
 */
export async function settleAll<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<{ ok: number; failed: Array<{ index: number; error: Error }> }> {
  const limiter = new Limiter(Math.max(1, limit))
  const failed: Array<{ index: number; error: Error }> = []
  let ok = 0
  await Promise.all(
    items.map((item, index) =>
      limiter
        .run(() => worker(item, index))
        .then(() => {
          ok += 1
        })
        .catch((error: unknown) => {
          failed.push({ index, error: error instanceof Error ? error : new Error(String(error)) })
        })
    )
  )
  return { ok, failed }
}

/* -------------------------------------------------------------------------- */
/*  Keep-alive HTTP client (no extra dependency, real socket reuse)            */
/* -------------------------------------------------------------------------- */

const agents = {
  http: new http.Agent({ keepAlive: true, maxSockets: 64, maxFreeSockets: 32, keepAliveMsecs: 30_000 }),
  https: new https.Agent({
    keepAlive: true,
    maxSockets: 64,
    maxFreeSockets: 32,
    keepAliveMsecs: 30_000,
    // TLS handshakes are the expensive part of a 400-file install
    sessionIdContext: 'verdant'
  })
}

/**
 * Per-host connect budget: 4 s for Mojang, 8 s for the mirror. Every call site
 * goes through this, so no official request can ever sit on a dead socket for
 * longer than `OFFICIAL_CONNECT_TIMEOUT_MS`.
 */
export function connectTimeoutFor(url: string): number {
  return isMirrored(url) ? CONNECT_TIMEOUT_MS : OFFICIAL_CONNECT_TIMEOUT_MS
}

export function destroyAgents(): void {
  agents.http.destroy()
  agents.https.destroy()
}

const REDIRECTS = new Set([301, 302, 303, 307, 308])

function toResponse(res: http.IncomingMessage, url: string): Response {
  const headers = new Headers()
  for (const [key, value] of Object.entries(res.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) value.forEach((entry) => headers.append(key, entry))
    else headers.set(key, value)
  }
  const status = res.statusCode ?? 0
  const body = status === 204 || status === 304 ? null : (Readable.toWeb(res) as unknown as ReadableStream)
  return new Response(body, { status, statusText: res.statusMessage ?? '', headers })
}

function requestOnce(
  url: string,
  init: RequestInit,
  agent: http.Agent | https.Agent,
  headerTimeoutMs: number,
  idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS
): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const target = new URL(url)
    const client = target.protocol === 'http:' ? http : https
    const request = client.request(
      target,
      {
        method: init.method ?? 'GET',
        agent,
        headers: init.headers as Record<string, string> | undefined
      },
      (res) => {
        // A socket that stops sending bytes is exactly the RU-blocked-host
        // picture: headers arrive, the body trickles to a halt. Without this
        // the promise never settles and the bar freezes at 40 MB.
        res.setTimeout(idleTimeoutMs, () => {
          res.destroy(new Error(`Таймаут ожидания данных ${idleTimeoutMs} мс: ${url}`))
        })
        res.once('error', reject)
        resolve(toResponse(res, url))
      }
    )
    request.setTimeout(headerTimeoutMs, () => {
      request.destroy(new Error(`Таймаут ${headerTimeoutMs} мс: ${url}`))
    })
    request.on('error', reject)
    const signal = init.signal
    if (signal) {
      if (signal.aborted) {
        request.destroy(new Error('aborted'))
        return
      }
      signal.addEventListener('abort', () => request.destroy(new Error('aborted')), { once: true })
    }
    request.end()
  })
}

/**
 * `fetch` built on a long-lived `https.Agent`. Node's global fetch re-opens the
 * TLS session aggressively; for a 400-file install that costs more than the
 * bytes themselves. This keeps 64 sockets warm and follows redirects (BMCLAPI
 * answers with 302 to its CDN).
 */
export async function keepAliveFetch(
  input: string | URL | Request,
  init: RequestInit = {},
  options: { idleTimeoutMs?: number; connectTimeoutMs?: number } = {}
): Promise<Response> {
  let url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  let method = init.method ?? 'GET'
  for (let hop = 0; hop < 5; hop++) {
    // The agent must match the protocol — an https agent on an http URL throws.
    const agent = url.startsWith('http:') ? agents.http : agents.https
    const headerTimeout = options.connectTimeoutMs ?? connectTimeoutFor(url)
    const response = await requestOnce(url, { ...init, method }, agent, headerTimeout, options.idleTimeoutMs)
    if (!REDIRECTS.has(response.status)) return response
    const location = response.headers.get('location')
    if (!location) return response
    url = new URL(location, url).href
    if (response.status === 303) method = 'GET'
  }
  throw new Error(`Слишком много перенаправлений: ${url}`)
}

/**
 * Mirror-aware fetch for `@xmcl/installer`: tries the official host, and the
 * moment it fails (DNS, timeout, 5xx) retries the same URL on BMCLAPI. Every
 * subsequent call goes to the mirror first, which is what makes the launcher
 * usable behind a blocked Mojang CDN.
 */
export async function mirrorFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  // 1.2.0: the mirror is the *primary* transport, not a retry path. Passing this
  // to `@xmcl/installer` means every metadata/library/asset request already has
  // BMCLAPI in front of it.
  return fetchWithCandidates(url, init, true)
}

/**
 * Goes through `urlCandidates(url)` in order and returns the first usable
 * response. `preferMirror` puts BMCLAPI in front — used from the second attempt
 * on, because a file that already failed once will keep failing on the same
 * blocked host.
 */
export async function fetchWithCandidates(
  url: string,
  init: RequestInit,
  preferMirror: boolean,
  options: { idleTimeoutMs?: number } = {}
): Promise<Response> {
  const candidates = [...new Set(urlCandidates(url))]
  // `urlCandidates` already puts BMCLAPI first; `preferMirror` only matters when
  // the session is pinned to the official host.
  const ordered = preferMirror ? [...candidates].sort((a, b) => Number(isMirrored(b)) - Number(isMirrored(a))) : candidates
  let lastError: Error | null = null
  for (const candidate of ordered) {
    try {
      const response = await keepAliveFetch(
        candidate,
        {
          ...init,
          headers: { 'User-Agent': USER_AGENT, Accept: '*/*', ...(init.headers as Record<string, string> | undefined) }
        },
        options
      )
      if (response.status >= 500) throw new Error(`HTTP ${response.status}: ${candidate}`)
      markNetworkSuccess(candidate !== url)
      return response
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      markNetworkFailure(lastError.message)
    }
  }
  throw lastError ?? new Error(`network_error: ${url}`)
}

/* -------------------------------------------------------------------------- */
/*  File downloads: streaming, resume, hashes                                 */
/* -------------------------------------------------------------------------- */

const hashCache = new Map<string, { size: number; mtimeMs: number; sha1: string }>()

export function cachedHash(fingerprint: { path: string; size: number; mtimeMs: number }): string | null {
  const hit = hashCache.get(fingerprint.path)
  if (hit && hit.size === fingerprint.size && hit.mtimeMs === fingerprint.mtimeMs) return hit.sha1
  return null
}

export function rememberHash(fingerprint: { path: string; size: number; mtimeMs: number; sha1: string }): void {
  hashCache.set(fingerprint.path, { size: fingerprint.size, mtimeMs: fingerprint.mtimeMs, sha1: fingerprint.sha1 })
}

export async function sha1File(path: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha1')
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024)
    let position = 0
    for (;;) {
      if (signal?.aborted) throw new Error('aborted')
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
      if (bytesRead === 0) break
      hash.update(buffer.subarray(0, bytesRead))
      position += bytesRead
    }
  } finally {
    await handle.close()
  }
  return hash.digest('hex')
}

export interface DownloadSpec {
  url: string
  /** Extra fallback URLs tried after `url` on every attempt. */
  urls?: string[]
  destination: string
  sha1?: string
  size?: number
  /** For error messages: a file name, not a full path. */
  name?: string
}

export interface DownloadOptions {
  headers?: Record<string, string>
  signal?: AbortSignal
  retries?: number
  /** Called for every written chunk with the number of bytes of *this* file. */
  onBytes?: (bytes: number) => void
  /** Called once the server told us the full file size (content-length + resume). */
  onTotal?: (bytes: number) => void
  /** `true` when the file was already present and valid. */
  onSkip?: (spec: DownloadSpec) => void
  /** Abort an attempt when the server stops sending bytes. */
  idleTimeoutMs?: number
}

export class DownloadError extends Error {
  readonly code = 'network_error'
  constructor(message: string, readonly file?: string, readonly retryable = true) {
    super(message)
  }
}

async function fileSize(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size
  } catch {
    return null
  }
}

/**
 * Streams one file to disk. The bytes go straight to a `.part` file, so an
 * interrupted download resumes with a `Range` request instead of starting over;
 * only a completed file is renamed to its final name.
 */
export async function downloadFile(spec: DownloadSpec, options: DownloadOptions = {}): Promise<'downloaded' | 'skipped'> {
  const { destination, sha1, size } = spec
  const existing = await fileSize(destination)
  // Size shortcut: an existing file of the right size is trusted without hashing.
  if (existing !== null && size !== undefined && existing === size) {
    options.onSkip?.(spec)
    return 'skipped'
  }

  // Three retries on top of the first attempt. Every attempt keeps the bytes
  // already on disk, so a file that dies at 60 % continues at 60 %.
  const retries = options.retries ?? DEFAULT_ATTEMPTS - 1
  const part = `${destination}.part`
  await mkdir(dirname(destination), { recursive: true })
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const already = (await fileSize(part)) ?? 0
      const headers: Record<string, string> = {
        'User-Agent': USER_AGENT,
        Accept: '*/*',
        ...options.headers
      }
      if (already > 0) headers.Range = `bytes=${already}-`
      // From the second attempt on the mirror is tried first: the official host
      // already proved it cannot deliver this file.
      const candidates = spec.urls?.length ? spec.urls : [spec.url]
      let response: Response | null = null
      let candidateError: Error | null = null
      for (const candidate of candidates) {
        try {
          response = await fetchWithCandidates(candidate, { headers, signal: options.signal }, attempt > 0, {
            idleTimeoutMs: options.idleTimeoutMs
          })
          break
        } catch (error) {
          candidateError = error instanceof Error ? error : new Error(String(error))
        }
      }
      if (!response) throw candidateError ?? new DownloadError('network_error', spec.name)
      if (!response.ok) {
        if (response.status === 416) await rm(part, { force: true })
        throw new DownloadError(`HTTP ${response.status}`, spec.name ?? destination)
      }
      const resuming = already > 0 && response.status === 206
      if (!resuming) await rm(part, { force: true })
      const onBytes = options.onBytes
      const length = Number(response.headers.get('content-length') ?? 0)
      if (length > 0) options.onTotal?.(length + (resuming ? already : 0))
      else if (size) options.onTotal?.(size)
      if (onBytes && length > 0) onBytes(-already)
      const body = response.body ? Readable.fromWeb(response.body as never) : Readable.from([])
      if (onBytes) body.on('data', (chunk: Buffer) => onBytes(chunk.length))
      await pipeline(body, createWriteStream(part, { flags: resuming ? 'a' : 'w' }))
      await rename(part, destination)
      if (sha1) {
        const actual = await sha1File(destination, options.signal)
        if (actual !== sha1.toLowerCase()) {
          await rm(destination, { force: true })
          throw new DownloadError(`SHA1 не совпал: ожидался ${sha1}, получен ${actual}`, spec.name ?? destination, false)
        }
        const info = await stat(destination)
        rememberHash({ path: destination, size: info.size, mtimeMs: info.mtimeMs, sha1: actual })
      }
      return 'downloaded'
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (options.signal?.aborted) throw lastError
      if (attempt < retries) await delay(400 * (attempt + 1))
    }
  }
  throw lastError instanceof DownloadError
    ? lastError
    : new DownloadError(lastError?.message ?? `Не удалось скачать ${spec.name ?? spec.url}`, spec.name ?? spec.url)
}

export interface BatchReport<T extends DownloadSpec = DownloadSpec> {
  downloaded: number
  skipped: number
  failed: Array<{ spec: T; error: Error }>
  bytes: number
}

/**
 * Downloads a batch with a bounded pool. A failed file is recorded and the rest
 * keep going — exactly what mod packs and asset sets need.
 */
export async function downloadBatch<T extends DownloadSpec>(
  specs: readonly T[],
  options: DownloadOptions & { concurrency?: number; onTotal?: (bytes: number) => void } = {}
): Promise<BatchReport<T>> {
  const concurrency = Math.max(1, Math.min(32, options.concurrency ?? 16))
  const onBytes = options.onBytes
  const report: BatchReport<T> = { downloaded: 0, skipped: 0, failed: [], bytes: 0 }
  await settleAll(specs, concurrency, async (spec) => {
    try {
      const outcome = await downloadFile(spec, {
        ...options,
        onBytes: (count) => {
          report.bytes += count
          onBytes?.(count)
        }
      })
      if (outcome === 'skipped') report.skipped += 1
      else report.downloaded += 1
    } catch (error) {
      report.failed.push({ spec, error: error instanceof Error ? error : new Error(String(error)) })
    }
  })
  return report
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Probe both the official host and the mirror; used by the settings screen. */
export async function measureEndpoint(url: string, timeoutMs = 4000): Promise<ProbeResult> {
  const started = Date.now()
  try {
    const response = await mirrorFetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    return { ok: response.ok, ms: Date.now() - started }
  } catch (error) {
    return { ok: false, ms: Date.now() - started, error: (error as Error).message }
  }
}
