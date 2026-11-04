import clsx, { type ClassValue } from 'clsx'
import type { Language, LoaderType, LogLevel } from '../../../shared/types'

export function cn(...values: ClassValue[]): string {
  return clsx(values)
}

export function relativeTime(iso: string | null, language: Language): string {
  if (!iso) return language === 'ru' ? 'никогда' : 'never'
  const diff = Date.now() - Date.parse(iso)
  if (Number.isNaN(diff)) return '—'
  const minutes = Math.round(diff / 60000)
  if (minutes < 1) return language === 'ru' ? 'только что' : 'just now'
  if (minutes < 60) return language === 'ru' ? `${minutes} мин назад` : `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return language === 'ru' ? `${hours} ч назад` : `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 31) return language === 'ru' ? `${days} дн назад` : `${days} d ago`
  const months = Math.round(days / 30)
  return language === 'ru' ? `${months} мес назад` : `${months} mo ago`
}

export const LOADER_COLORS: Record<LoaderType, { from: string; to: string; glow: string }> = {
  vanilla: { from: '#5d6b63', to: '#26302b', glow: 'rgba(148, 163, 160, 0.35)' },
  fabric: { from: '#c8b485', to: '#6c5a33', glow: 'rgba(238, 214, 158, 0.4)' },
  quilt: { from: '#c589e8', to: '#5b2d7a', glow: 'rgba(197, 137, 232, 0.42)' },
  forge: { from: '#6f93d8', to: '#2b4270', glow: 'rgba(111, 147, 216, 0.42)' },
  neoforge: { from: '#f3a15f', to: '#7c3f16', glow: 'rgba(243, 161, 95, 0.42)' }
}

export function instanceGradient(loader: LoaderType, seed: string): React.CSSProperties {
  const colors = LOADER_COLORS[loader] ?? LOADER_COLORS.vanilla
  const hash = [...seed].reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) % 360, 7)
  return {
    background: `radial-gradient(120% 140% at 12% 10%, ${colors.from}55 0%, transparent 55%), linear-gradient(135deg, ${colors.to}80 0%, rgba(10,14,12,0.94) 62%), linear-gradient(${hash}deg, rgba(47,226,140,0.16), transparent 60%)`,
    ['--banner-glow' as string]: colors.glow
  } as React.CSSProperties
}

export function logLevelColor(level: LogLevel): string {
  switch (level) {
    case 'error':
      return 'text-rose-300'
    case 'warn':
      return 'text-amber-300'
    case 'debug':
      return 'text-muted/70'
    default:
      return 'text-text/85'
  }
}

export function extractCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string') {
    return (error as { code: string }).code
  }
  if (error instanceof Error && error.message) return error.message
  return 'unknown'
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function formatGb(mb: number): string {
  return `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB`
}

export function initials(name: string): string {
  return (name || '?').slice(0, 2).toUpperCase()
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
