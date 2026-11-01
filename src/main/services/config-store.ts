import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { DEFAULT_SETTINGS } from '../../shared/constants'
import type { AppSettings, OfflineProfile } from '../../shared/types'
import { logger } from './logger'

export interface PersistedConfig {
  profile: OfflineProfile | null
  settings: AppSettings
  selectedInstanceId: string | null
}

/** Settings are merged so a config written by an older version keeps working. */
export function normalizeSettings(raw: unknown, fallbackDataRoot: string): AppSettings {
  const input = (raw ?? {}) as Partial<AppSettings>
  const memory = input.defaultMemory
  return {
    ...DEFAULT_SETTINGS,
    ...input,
    language: input.language === 'en' ? 'en' : 'ru',
    dataRoot: input.dataRoot && input.dataRoot.trim().length > 0 ? input.dataRoot : fallbackDataRoot,
    defaultMemory: {
      min: Number(memory?.min) > 0 ? Number(memory?.min) : DEFAULT_SETTINGS.defaultMemory.min,
      max: Number(memory?.max) > 0 ? Number(memory?.max) : DEFAULT_SETTINGS.defaultMemory.max
    },
    defaultJvmArgs: typeof input.defaultJvmArgs === 'string' ? input.defaultJvmArgs : '',
    curseForgeApiKey: typeof input.curseForgeApiKey === 'string' ? input.curseForgeApiKey : '',
    modSource: input.modSource === 'curseforge' ? 'curseforge' : 'modrinth',
    afterLaunch: input.afterLaunch === 'minimize' || input.afterLaunch === 'close' ? input.afterLaunch : 'stay'
  }
}

/**
 * Persists profile, settings and the selected instance to a single JSON file.
 * `instances` themselves live in their own `instance.json` files (single source
 * of truth), so a manually deleted instance folder simply disappears from the UI.
 */
export class ConfigStore {
  private config: PersistedConfig | null = null
  private saveTimer: NodeJS.Timeout | null = null
  private file = ''

  init(file: string): void {
    this.file = file
  }

  async load(fallbackDataRoot: string): Promise<PersistedConfig> {
    try {
      const raw = await readFile(this.file, 'utf8')
      const parsed = JSON.parse(raw) as Partial<PersistedConfig>
      this.config = {
        profile: parsed.profile ?? null,
        settings: normalizeSettings(parsed.settings, fallbackDataRoot),
        selectedInstanceId: parsed.selectedInstanceId ?? null
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        logger.warn(`Не удалось прочитать config.json: ${(error as Error).message} — создан новый конфиг.`)
        await copyFile(this.file, `${this.file}.corrupt-${Date.now()}`).catch(() => undefined)
      }
      this.config = {
        profile: null,
        settings: normalizeSettings(null, fallbackDataRoot),
        selectedInstanceId: null
      }
    }
    return this.config
  }

  get(): PersistedConfig {
    if (!this.config) {
      this.config = { profile: null, settings: normalizeSettings(null, ''), selectedInstanceId: null }
    }
    return this.config
  }

  setProfile(profile: OfflineProfile | null): void {
    this.get().profile = profile
    this.saveSoon()
  }

  setSelectedInstance(id: string | null): void {
    this.get().selectedInstanceId = id
    this.saveSoon()
  }

  async updateSettings(patch: Partial<AppSettings>, fallbackDataRoot: string): Promise<AppSettings> {
    const current = this.get()
    current.settings = normalizeSettings({ ...current.settings, ...patch }, fallbackDataRoot)
    await this.save()
    return current.settings
  }

  saveSoon(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.save()
    }, 250)
  }

  async save(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (!this.file) return
    const payload = JSON.stringify(this.get(), null, 2)
    const tmp = `${this.file}.tmp`
    try {
      await mkdir(dirname(this.file), { recursive: true })
      await writeFile(tmp, payload, 'utf8')
      await rename(tmp, this.file)
    } catch (error) {
      logger.error(`Ошибка сохранения конфигурации: ${(error as Error).message}`)
    }
  }
}

export const configStore = new ConfigStore()
