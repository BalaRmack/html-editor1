import { describe, expect, it } from 'vitest'
import { buildFeedbackBody, stripAnsi, tailLines, LOG_TAIL_LINES } from '../src/main/services/feedback-format'
import { NICKNAME_RE, nicknameErrorKey, validateNickname } from '../src/shared/validation'
import type { FeedbackSystemInfo } from '../src/shared/types'

const systemInfo: FeedbackSystemInfo = {
  os: 'Windows 11 10.0.22631',
  arch: 'x64',
  appVersion: '1.2.0',
  electron: '45.2.1',
  java: 'Java 21 · C:\\Java\\bin\\javaw.exe',
  totalMemMB: 16384,
  locale: 'ru-RU',
  instance: 'Выживание 1.21.4'
}

describe('tailLines', () => {
  it('keeps exactly the last 100 lines', () => {
    const text = Array.from({ length: 350 }, (_, index) => `line ${index + 1}`).join('\n')
    const lines = tailLines(text)
    expect(lines).toHaveLength(LOG_TAIL_LINES)
    expect(lines[0]).toBe('line 251')
    expect(lines[99]).toBe('line 350')
  })

  it('returns short logs untouched and drops trailing blanks', () => {
    expect(tailLines('a\nb\nc\n\n')).toEqual(['a', 'b', 'c'])
    expect(tailLines('')).toEqual([])
  })

  it('handles CRLF files (Windows)', () => {
    expect(tailLines('one\r\ntwo\r\nthree')).toEqual(['one', 'two', 'three'])
  })

  it('strips ANSI colour codes written by the game', () => {
    expect(stripAnsi('\u001b[31mERROR\u001b[0m oops')).toBe('ERROR oops')
    expect(tailLines('\u001b[32mok\u001b[0m')).toEqual(['ok'])
  })
})

describe('buildFeedbackBody', () => {
  const log = ['[INFO] started', '[WARN] asset index 34 corrupt', '[ERROR] install failed']

  it('builds a bug report with system info and the log', () => {
    const { title, body, summary } = buildFeedbackBody({
      kind: 'bug',
      description: '  Установка упала на ассетах\nвторая строка',
      systemInfo,
      logLines: log
    })
    expect(title).toBe('[Bug] Установка упала на ассетах')
    expect(body).toContain('### Система')
    expect(body).toContain('**OS:** Windows 11 10.0.22631 (x64)')
    expect(body).toContain('**Java:** Java 21')
    expect(body).toContain('### Последние 3 строк latest.log')
    expect(body).toContain('asset index 34 corrupt')
    expect(summary).toContain('Ошибка')
    expect(summary).toContain('launcher 1.2.0')
  })

  it('labels suggestions and includes the contact', () => {
    const { title, body } = buildFeedbackBody({
      kind: 'suggestion',
      description: 'Добавьте горячие клавиши',
      contact: '@verdant',
      systemInfo,
      logLines: []
    })
    expect(title).toBe('[Idea] Добавьте горячие клавиши')
    expect(body).toContain('**Контакт:** @verdant')
    expect(body).toContain('### Последние 0 строк latest.log')
  })

  it('truncates a very long first line in the title', () => {
    const { title } = buildFeedbackBody({
      kind: 'bug',
      description: 'x'.repeat(300),
      systemInfo,
      logLines: []
    })
    expect(title.length).toBeLessThanOrEqual(6 + 80)
  })
})

describe('nickname validation', () => {
  it('accepts valid Minecraft names', () => {
    for (const name of ['Steve', 'abc', 'Notch_99', 'A_1', 'abcdefghijklmnop']) {
      expect(validateNickname(name)).toEqual({ ok: true, name })
    }
  })

  it('rejects too short, too long and non-latin names', () => {
    expect(validateNickname('')).toEqual({ ok: false, error: 'empty' })
    expect(validateNickname('  ')).toEqual({ ok: false, error: 'empty' })
    expect(validateNickname('ab')).toEqual({ ok: false, error: 'too_short' })
    expect(validateNickname('abcdefghijklmnopq')).toEqual({ ok: false, error: 'too_long' })
    expect(validateNickname('вцф')).toEqual({ ok: false, error: 'invalid_chars' })
    expect(validateNickname('Steve!')).toEqual({ ok: false, error: 'invalid_chars' })
    expect(validateNickname('ste ve')).toEqual({ ok: false, error: 'invalid_chars' })
  })

  it('trims surrounding spaces before validating', () => {
    expect(validateNickname('  Steve  ')).toEqual({ ok: true, name: 'Steve' })
  })

  it('exposes the regex used by the UI and the i18n key for each error', () => {
    expect(NICKNAME_RE.test('Steve')).toBe(true)
    expect(NICKNAME_RE.test('вцф')).toBe(false)
    expect(nicknameErrorKey('invalid_chars')).toBe('errors.nickname_invalid_chars')
  })
})
