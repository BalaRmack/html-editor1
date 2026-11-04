/** Formatting helpers shared by the main process and the renderer. */

export function formatSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '0 КБ/с'
  if (bytesPerSecond >= 1024 * 1024) return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} МБ/с`
  return `${Math.max(1, Math.round(bytesPerSecond / 1024))} КБ/с`
}

export function formatEta(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '—'
  if (seconds < 60) return `${Math.round(seconds)} с`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  if (minutes < 60) return `${minutes}:${String(rest).padStart(2, '0')}`
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 МБ'
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} ГБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}
