import type { AppSettings, Language, LoaderType, MemorySettings } from './types'

export const APP_NAME = 'Verdant Launcher'
export const APP_SHORT_NAME = 'Verdant'
export const APP_ID = 'app.verdant.launcher'
export const APP_VERSION = '1.2.0'

export const GITHUB_OWNER = 'BalaRmack'
export const GITHUB_REPO = 'html-editor1'
export const GITHUB_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`

export const USER_AGENT = `${APP_NAME}/${APP_VERSION} (${GITHUB_URL})`

export const MODRINTH_API = 'https://api.modrinth.com/v2'
export const CURSEFORGE_API = 'https://api.curseforge.com/v1'
export const CURSEFORGE_GAME_ID = 432 // Minecraft
export const FORGE_MAVEN = 'https://maven.minecraftforge.net'
export const NEOFORGE_MAVEN = 'https://maven.neoforged.net/releases'

export const DEFAULT_MEMORY: MemorySettings = { min: 1024, max: 4096 }
export const MIN_MEMORY = 512
export const MAX_MEMORY_LIMIT = 32768

export const LOADERS: LoaderType[] = ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge']

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'ru',
  reduceMotion: false,
  showConsoleOnLaunch: false,
  afterLaunch: 'stay',
  dataRoot: '',
  defaultMemory: DEFAULT_MEMORY,
  javaPath: null,
  defaultJvmArgs: '',
  modSource: 'modrinth',
  curseForgeApiKey: '',
  autoDownloadJava: true,
  confirmOnDelete: true,
  animations: true,
  feedbackWebhook: ''
}

export const LANGUAGES: { value: Language; label: string }[] = [
  { value: 'ru', label: 'Русский' },
  { value: 'en', label: 'English' }
]

/** Nicely formatted playtime: 0м -> "—" */
export function formatDuration(ms: number, locale: Language = 'ru'): string {
  if (!ms || ms < 60_000) return '—'
  const totalMinutes = Math.round(ms / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (locale === 'ru') {
    if (hours <= 0) return `${minutes} мин`
    return minutes > 0 ? `${hours} ч ${minutes} мин` : `${hours} ч`
  }
  if (hours <= 0) return `${minutes} min`
  return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, exp)
  return `${value >= 100 || exp === 0 ? Math.round(value) : value.toFixed(1)} ${units[exp]}`
}

export function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`
  return String(value)
}
