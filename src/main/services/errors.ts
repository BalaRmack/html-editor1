/**
 * Error plumbing for installs.
 *
 * The launcher talks to a lot of flaky remote services (Mojang, Fabric, Forge,
 * Maven mirrors, Modrinth), so every failure that reaches the UI has to answer
 * three questions: *what* broke (`code`), *which file* was in flight (`file`)
 * and *whether retrying makes sense* (`retryable`).
 */

export type ErrorCode =
  | 'network_error'
  | 'integrity_failed'
  | 'not_installed'
  | 'manifest_error'
  | 'loader_error'
  | 'java_required'
  | 'java_not_found'
  | 'version_not_found'
  | 'cancelled'
  | 'disk_error'
  | 'install_failed'

export interface FailureShape {
  code: string
  message: string
  file?: string
  stage?: string
  retryable: boolean
}

export class AppError extends Error {
  readonly code: string
  readonly file?: string
  readonly stage?: string
  readonly retryable: boolean

  constructor(failure: FailureShape) {
    super(failure.message)
    this.name = 'AppError'
    this.code = failure.code
    this.file = failure.file
    this.stage = failure.stage
    this.retryable = failure.retryable
  }
}

export function toFailure(error: unknown, stage?: string): FailureShape {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
      file: error.file,
      stage: error.stage ?? stage,
      retryable: error.retryable
    }
  }

  const err = error as (Error & { code?: string; url?: string }) | undefined
  const message = err?.message ? String(err.message) : String(error)
  const code = err?.code

  // Cancellation is a user action, never an error the user should retry.
  if (code === 'cancelled' || /отменена|cancel+ed/i.test(message)) {
    return { code: 'cancelled', message: 'Установка отменена', stage, retryable: false }
  }

  // Known, already-classified failures coming from the services.
  if (code && ['java_required', 'java_not_found', 'version_not_found', 'manifest_error'].includes(code)) {
    return { code, message, stage, retryable: code !== 'java_required' }
  }
  if (/enospc/i.test(message) || /no space left/i.test(message)) {
    return { code: 'disk_error', message, stage, retryable: false }
  }

  const networkLike =
    /ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|EPIPE|ESOCKETTIMEDOUT|socket hang up|getaddrinfo|premature close|aborted|network|fetch failed|fail to (download|fetch)|failed to (download|fetch)|status code 5\d\d|status code 429/i.test(
      message
    )

  const url = err?.url ?? extractUrl(message)
  if (networkLike) {
    return {
      code: 'network_error',
      message: url ? `Не удалось скачать файл ${fileNameFromUrl(url)}` : 'Сеть недоступна или сервер не отвечает',
      file: url ? fileNameFromUrl(url) : undefined,
      stage,
      retryable: true
    }
  }

  return { code: 'install_failed', message, stage, retryable: true }
}

const URL_RE = /https?:\/\/[^\s"'<>)\]]+/i

export function extractUrl(text: string): string | undefined {
  const match = text.match(URL_RE)
  // Log lines often glue punctuation to the URL: `...client.jar: ECONNRESET`.
  return match ? match[0].replace(/[.,;:!?]+$/, '') : undefined
}

/** `https://x/y/z/client.jar?q=1` → `client.jar`. */
export function fileNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const base = parsed.pathname.split('/').filter(Boolean).pop()
    return base ? decodeURIComponent(base.replace(/[.,;:!?]+$/, '')) : parsed.hostname
  } catch {
    const base = url.split('?')[0].split('/').filter(Boolean).pop()
    return base ?? url
  }
}

/** Wraps a stage so any throw is annotated with the stage that failed. */
export async function withStage<T>(stage: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    const failure = toFailure(error, stage)
    throw new AppError(failure)
  }
}
