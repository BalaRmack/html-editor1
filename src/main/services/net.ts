import { USER_AGENT } from '../../shared/constants'
import { downloadFile as downloadSpec, mirrorFetch } from './downloader'
import { urlCandidates } from './mirror'

export class NetworkError extends Error {
  readonly code = 'network_error'
  constructor(
    message: string,
    readonly status?: number,
    readonly file?: string
  ) {
    super(message)
  }
}

export interface FetchOptions {
  timeoutMs?: number
  retries?: number
  headers?: Record<string, string>
}

/**
 * Runs one request against the official host and its BMCLAPI twin, in the order
 * the network state prefers. A blocked Mojang endpoint therefore costs one fast
 * timeout, not a dead installer.
 */
async function requestWithFallback(url: string, options: FetchOptions, accept: string): Promise<Response> {
  const { timeoutMs = 20000, headers } = options
  const candidates = urlCandidates(url)
  let lastError: Error | null = null
  for (const candidate of candidates) {
    try {
      const response = await mirrorFetch(candidate, {
        headers: { 'User-Agent': USER_AGENT, Accept: accept, ...headers },
        signal: AbortSignal.timeout(timeoutMs)
      })
      if (!response.ok) {
        lastError = new NetworkError(`HTTP ${response.status} для ${candidate}`, response.status)
        // 4xx is a real answer — retrying the mirror will not change it.
        if (response.status < 500 && response.status !== 403 && response.status !== 408) break
        continue
      }
      return response
    } catch (error) {
      lastError = error as Error
      if ((error as Error).name === 'AbortError') lastError = new NetworkError(`Таймаут ${timeoutMs} мс: ${candidate}`)
    }
  }
  throw lastError instanceof NetworkError ? lastError : new NetworkError(lastError?.message ?? `network_error: ${url}`)
}

export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const { retries = 2 } = options
  let lastError: Error | null = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await requestWithFallback(url, options, 'application/json')
      return (await response.json()) as T
    } catch (error) {
      lastError = error as Error
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)))
    }
  }
  throw lastError instanceof NetworkError ? lastError : new NetworkError(lastError?.message ?? 'network_error')
}

export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  const { retries = 2 } = options
  let lastError: Error | null = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await requestWithFallback(url, options, 'text/plain')
      return await response.text()
    } catch (error) {
      lastError = error as Error
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)))
    }
  }
  throw lastError instanceof NetworkError ? lastError : new NetworkError(lastError?.message ?? 'network_error')
}

/**
 * Streams a file to disk (never into RAM), resumes a `.part` file when one is
 * left over and checks the SHA1 only when the caller supplies one.
 */
export async function downloadFile(
  url: string,
  destination: string,
  onProgress?: (received: number, total: number) => void,
  options: { signal?: AbortSignal; retries?: number; headers?: Record<string, string>; name?: string; sha1?: string; size?: number } = {}
): Promise<void> {
  let total = options.size ?? 0
  let received = 0
  await downloadSpec(
    { url, destination, sha1: options.sha1, size: options.size, name: options.name ?? destination.split(/[\\/]/).pop() },
    {
      signal: options.signal,
      headers: options.headers,
      retries: options.retries,
      onTotal: (bytes) => {
        total = bytes
        onProgress?.(received, total)
      },
      onBytes: (bytes) => {
        if (bytes < 0) return
        received += bytes
        // eslint-disable-next-line no-param-reassign -- progress totals grow with resume
        onProgress?.(received, Math.max(total, received))
      }
    }
  )
}
