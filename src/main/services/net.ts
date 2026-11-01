import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { USER_AGENT } from '../../shared/constants'

export class NetworkError extends Error {
  readonly code = 'network_error'
  constructor(message: string, readonly status?: number) {
    super(message)
  }
}

export interface FetchOptions {
  timeoutMs?: number
  retries?: number
  headers?: Record<string, string>
}

export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const { timeoutMs = 20000, retries = 2, headers } = options
  let lastError: Error | null = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers },
        signal: AbortSignal.timeout(timeoutMs)
      })
      if (!response.ok) {
        throw new NetworkError(`HTTP ${response.status} для ${url}`, response.status)
      }
      return (await response.json()) as T
    } catch (error) {
      lastError = error as Error
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)))
    }
  }
  throw lastError instanceof NetworkError ? lastError : new NetworkError(lastError?.message ?? 'network_error')
}

export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  const { timeoutMs = 20000, retries = 2 } = options
  let lastError: Error | null = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs)
      })
      if (!response.ok) throw new NetworkError(`HTTP ${response.status} для ${url}`, response.status)
      return await response.text()
    } catch (error) {
      lastError = error as Error
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)))
    }
  }
  throw lastError instanceof NetworkError ? lastError : new NetworkError(lastError?.message ?? 'network_error')
}

export async function downloadFile(
  url: string,
  destination: string,
  onProgress?: (received: number, total: number) => void,
  options: { signal?: AbortSignal; retries?: number; headers?: Record<string, string> } = {}
): Promise<void> {
  const retries = options.retries ?? 2
  await mkdir(dirname(destination), { recursive: true })
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= retries; attempt++) {
    const tmp = `${destination}.part`
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, ...options.headers },
        signal: options.signal ?? AbortSignal.timeout(120_000)
      })
      if (!response.ok || !response.body) {
        throw new NetworkError(`HTTP ${response.status} для ${url}`, response.status)
      }
      const total = Number(response.headers.get('content-length') ?? 0)
      let received = 0
      const nodeStream = Readable.fromWeb(response.body as never)
      if (onProgress) {
        nodeStream.on('data', (chunk: Buffer) => {
          received += chunk.length
          onProgress(received, total)
        })
      }
      await pipeline(nodeStream, createWriteStream(tmp))
      await rename(tmp, destination)
      return
    } catch (error) {
      lastError = error as Error
      await rm(tmp, { force: true }).catch(() => undefined)
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
    }
  }
  throw lastError instanceof NetworkError ? lastError : new NetworkError(lastError?.message ?? `download_failed: ${url}`)
}
