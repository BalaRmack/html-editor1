/**
 * Pure formatting helpers for feedback reports.
 *
 * Kept free of `electron` so they can be unit-tested directly
 * (see `tests/feedback.test.ts`).
 */

import type { FeedbackKind, FeedbackSystemInfo } from '../../shared/types'

/** Exactly what the brief asks for. */
export const LOG_TAIL_LINES = 100
const ANSI_RE = /\u001b\[[0-9;]*m/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '')
}

/** Keeps the last `count` lines, dropping blank trailing lines. */
export function tailLines(text: string, count = LOG_TAIL_LINES): string[] {
  const lines = stripAnsi(text)
    .split(/\r?\n/)
    .filter((line, index, all) => line.trim().length > 0 || index < all.length - 1)
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
  return lines.slice(-count)
}

/** Markdown body of the report — pure, so it is unit-tested. */
export function buildFeedbackBody(input: {
  kind: FeedbackKind
  description: string
  contact?: string
  systemInfo: FeedbackSystemInfo
  logLines: string[]
}): { title: string; body: string; summary: string } {
  const isBug = input.kind === 'bug'
  const firstLine = input.description.trim().split(/\r?\n/)[0] ?? ''
  const title = `${isBug ? '[Bug]' : '[Idea]'} ${firstLine.slice(0, 80)}`
  const info = input.systemInfo
  const rows = [
    ['OS', `${info.os} (${info.arch})`],
    ['Launcher', info.appVersion],
    ['Electron', info.electron],
    ['Java', info.java ?? 'не найдена'],
    ['RAM', `${info.totalMemMB} MB`],
    ['Locale', info.locale],
    ['Instance', info.instance ?? '—']
  ]

  const body = [
    isBug ? '### Ошибка' : '### Предложение',
    '',
    input.description.trim(),
    '',
    input.contact ? `**Контакт:** ${input.contact.trim()}` : '',
    '',
    '---',
    '### Система',
    ...rows.map(([label, value]) => `- **${label}:** ${value}`),
    '',
    `### Последние ${input.logLines.length} строк latest.log`,
    '```',
    ...input.logLines,
    '```'
  ]
    .filter((line) => line !== null)
    .join('\n')

  // One-line version for chat webhooks that only render `content`.
  const summary = `${isBug ? 'Ошибка' : 'Предложение'}: ${firstLine.slice(0, 120)} · ${info.os}, launcher ${info.appVersion}`

  return { title, body, summary }
}
