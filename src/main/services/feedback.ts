/**
 * «Сообщить об ошибке» / «Предложить улучшение».
 *
 * Rules from the brief:
 *  - the bug report always carries the **last 100 lines of `latest.log`**;
 *  - system info (OS, launcher version, Java) is collected automatically;
 *  - delivery is a webhook POST or the GitHub API — **never** a browser redirect;
 *  - the user sees exactly what is attached before pressing «Отправить».
 *
 * The log file is read straight from disk (not from the in-memory ring buffer)
 * so a report still contains the session that just crashed.
 */

import { readFile, stat } from 'node:fs/promises'
import { arch as architecture, release, totalmem, type as osType } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { APP_VERSION, GITHUB_URL } from '../../shared/constants'
import type {
  AppSettings,
  FeedbackInput,
  FeedbackPreview,
  FeedbackResult,
  FeedbackSystemInfo,
  FeedbackKind,
  Instance
} from '../../shared/types'
import { LOG_TAIL_LINES, buildFeedbackBody, tailLines } from './feedback-format'
import { javaService } from './java'
import { logger } from './logger'
import { paths } from './paths'

/** Exactly what the brief asks for. */
export const MAX_DESCRIPTION = 4000
export const MIN_DESCRIPTION = 10
const RATE_LIMIT_MS = 30_000
const REQUEST_TIMEOUT_MS = 15_000


/** Reads `launcher.log` from disk; falls back to the live ring buffer. */
export async function readLogTail(file: string | null, fallback: string[] = []): Promise<string[]> {
  if (file) {
    try {
      const info = await stat(file)
      if (info.isFile() && info.size > 0) {
        // Logs stay small (a session is a few hundred KB), but never slurp a
        // runaway file: 2 MB is plenty for the last 100 lines.
        const handle = await readFile(file, 'utf8')
        const text = handle.length > 2_000_000 ? handle.slice(-2_000_000) : handle
        const lines = tailLines(text)
        if (lines.length > 0) return lines
      }
    } catch {
      /* fall through to the ring buffer */
    }
  }
  return fallback.slice(-LOG_TAIL_LINES)
}

export class FeedbackService {
  private lastSentAt = 0

  private logFile(): string {
    return join(paths.get().logsDir, 'launcher.log')
  }

  async systemInfo(instance: Instance | null): Promise<FeedbackSystemInfo> {
    let java: string | null = null
    try {
      const runtimes = await javaService.scan()
      const runtime = runtimes[0]
      if (runtime) java = `Java ${runtime.major}${runtime.version ? ` (${runtime.version})` : ''} · ${runtime.path}`
    } catch {
      /* no Java is a valid state, not an error */
    }

    return {
      os: `${osType()} ${release()}`,
      arch: architecture(),
      appVersion: app.getVersion() || APP_VERSION,
      electron: process.versions.electron ?? '—',
      java,
      totalMemMB: Math.round(totalmem() / 1024 / 1024),
      locale: app.getLocale(),
      instance: instance?.name ?? null
    }
  }

  /** Everything the modal previews; no network, no side effects. */
  async preview(instance: Instance | null, settings: AppSettings): Promise<FeedbackPreview> {
    const logLines = await readLogTail(this.logFile(), logger.history().map((line) => line.text))
    return {
      systemInfo: await this.systemInfo(instance),
      logLines,
      logFile: this.logFile(),
      configured: Boolean(this.webhook(settings) || this.githubToken())
    }
  }

  private webhook(settings: AppSettings): string {
    return (settings.feedbackWebhook || process.env.VERDANT_FEEDBACK_WEBHOOK || '').trim()
  }

  private githubToken(): string {
    return (process.env.VERDANT_GITHUB_TOKEN || '').trim()
  }

  /** `owner/repo` parsed from the project URL — the issue fallback target. */
  private repo(): string {
    const match = GITHUB_URL.match(/github\.com\/([^/]+\/[^/#?]+)/i)
    return match ? match[1].replace(/\.git$/, '') : 'BalaRmack/html-editor1'
  }

  async send(input: FeedbackInput, instance: Instance | null, settings: AppSettings): Promise<FeedbackResult> {
    const description = (input.description ?? '').trim()
    const logLines = await readLogTail(this.logFile(), logger.history().map((line) => line.text))
    const base: FeedbackResult = { ok: false, delivered: 'none', logLines: logLines.length }

    if (description.length < MIN_DESCRIPTION) {
      return { ...base, code: 'feedback_too_short' }
    }
    if (input.kind !== 'bug' && input.kind !== 'suggestion') {
      return { ...base, code: 'feedback_bad_kind' }
    }
    if (Date.now() - this.lastSentAt < RATE_LIMIT_MS) {
      return { ...base, code: 'feedback_rate_limited' }
    }

    const systemInfo = await this.systemInfo(instance)
    const { title, body, summary } = buildFeedbackBody({
      kind: input.kind,
      description: description.slice(0, MAX_DESCRIPTION),
      contact: input.kind === 'suggestion' ? (input.contact ?? '').trim().slice(0, 120) : undefined,
      systemInfo,
      logLines
    })

    const webhook = this.webhook(settings)
    const token = this.githubToken()

    try {
      if (webhook) {
        const response = await this.post(
          webhook,
          {
            // Discord/Slack friendly fields plus the raw report for anything else.
            content: summary,
            text: summary,
            title,
            kind: input.kind,
            contact: input.contact?.trim() ?? null,
            system: systemInfo,
            log: logLines.join('\n'),
            payload: { title, body }
          },
          {}
        )
        if (!response.ok) {
          logger.warn(`Вебхук отчётов ответил ${response.status}`)
          return { ...base, code: 'feedback_delivery_failed', message: `HTTP ${response.status}` }
        }
        this.lastSentAt = Date.now()
        logger.info(`Отчёт «${input.kind}» отправлен на вебхук (${logLines.length} строк лога)`)
        return { ...base, ok: true, delivered: 'webhook' }
      }

      if (token) {
        const response = await this.post(
          `https://api.github.com/repos/${this.repo()}/issues`,
          { title, body, labels: input.kind === 'bug' ? ['bug', 'from-launcher'] : ['enhancement', 'from-launcher'] },
          { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
        )
        if (!response.ok) {
          logger.warn(`GitHub API ответил ${response.status} при создании issue`)
          return { ...base, code: 'feedback_delivery_failed', message: `HTTP ${response.status}` }
        }
        this.lastSentAt = Date.now()
        const created = (await response.json().catch(() => null)) as { html_url?: string } | null
        logger.info(`Отчёт «${input.kind}» создан как issue${created?.html_url ? `: ${created.html_url}` : ''}`)
        return { ...base, ok: true, delivered: 'github', message: created?.html_url }
      }

      return { ...base, code: 'feedback_not_configured' }
    } catch (error) {
      logger.error(`Не удалось отправить отчёт: ${(error as Error).message}`)
      return { ...base, code: 'feedback_delivery_failed', message: (error as Error).message }
    }
  }

  private async post(url: string, payload: unknown, headers: Record<string, string>): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      return await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Verdant-Launcher', ...headers },
        body: JSON.stringify(payload),
        signal: controller.signal
      })
    } finally {
      clearTimeout(timer)
    }
  }
}

export const feedbackService = new FeedbackService()
