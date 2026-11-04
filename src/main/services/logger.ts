import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { LogLevel, LogLine } from '../../shared/types'

type LogListener = (line: LogLine) => void

const MAX_LINES = 5000

/**
 * Ring-buffer log store that broadcasts lines to the renderer and mirrors them
 * to a rotating-free daily file. Used by both launcher and game output.
 */
class LogService {
  private buffer: LogLine[] = []
  private seq = 0
  private listeners = new Set<LogListener>()
  private filePath: string | null = null
  private writing = false

  setFile(filePath: string): void {
    this.filePath = filePath
    void mkdir(dirname(filePath), { recursive: true }).catch(() => undefined)
  }

  push(level: LogLevel, text: string, source: 'launcher' | 'game' = 'launcher'): LogLine {
    const line: LogLine = { seq: ++this.seq, ts: Date.now(), level, source, text }
    this.buffer.push(line)
    if (this.buffer.length > MAX_LINES) this.buffer.splice(0, this.buffer.length - MAX_LINES)
    for (const listener of this.listeners) {
      try {
        listener(line)
      } catch {
        /* a broken listener must never break logging */
      }
    }
    this.appendToFile(line)
    return line
  }

  info(text: string, source: 'launcher' | 'game' = 'launcher'): LogLine {
    return this.push('info', text, source)
  }

  warn(text: string, source: 'launcher' | 'game' = 'launcher'): LogLine {
    return this.push('warn', text, source)
  }

  error(text: string, source: 'launcher' | 'game' = 'launcher'): LogLine {
    return this.push('error', text, source)
  }

  debug(text: string, source: 'launcher' | 'game' = 'launcher'): LogLine {
    return this.push('debug', text, source)
  }

  /** Classify raw Minecraft output into a level. */
  static classify(raw: string): LogLevel {
    if (/\b(ERROR|SEVERE|FATAL)\b|Exception|Error:|Caused by:|#@!@# Game crashed/.test(raw)) return 'error'
    if (/\bWARN(ING)?\b|Deprecated/.test(raw)) return 'warn'
    if (/\[DEBUG\]|\bDEBUG\b/.test(raw)) return 'debug'
    return 'info'
  }

  history(): LogLine[] {
    return [...this.buffer]
  }

  clear(): void {
    this.buffer = []
  }

  subscribe(listener: LogListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private appendToFile(line: LogLine): void {
    const target = this.filePath
    if (!target || this.writing) return
    this.writing = true
    const time = new Date(line.ts).toISOString()
    appendFile(target, `${time} [${line.level.toUpperCase()}] [${line.source}] ${line.text}\n`)
      .catch(() => undefined)
      .finally(() => {
        this.writing = false
      })
  }
}

export const logger = new LogService()
