import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { OfflineProfile, SkinInfo } from '../../shared/types'
import { configStore } from './config-store'
import { logger } from './logger'
import { offlineUuid, validateNickname } from './offline'

/** Reads PNG width/height straight from the IHDR chunk — no image library needed. */
export function readPngSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24) return null
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  for (let i = 0; i < signature.length; i++) {
    if (buffer[i] !== signature[i]) return null
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

export class ProfileService {
  private skinsDir = ''

  init(skinsDir: string): void {
    this.skinsDir = skinsDir
  }

  get(): OfflineProfile | null {
    return configStore.get().profile
  }

  private skinPath(profile: OfflineProfile | null): string | null {
    if (!profile?.skinPath) return null
    return join(this.skinsDir, profile.skinPath)
  }

  async setNickname(raw: string): Promise<OfflineProfile> {
    const validation = validateNickname(raw)
    if (!validation.ok) {
      const error = new Error(validation.error)
      ;(error as Error & { code?: string }).code = `nickname_${validation.error}`
      throw error
    }
    const previous = this.get()
    const profile: OfflineProfile = {
      name: validation.name,
      uuid: offlineUuid(validation.name),
      createdAt: previous?.createdAt ?? new Date().toISOString(),
      skinPath: previous?.skinPath ?? null,
      skinVariant: previous?.skinVariant ?? 'classic'
    }
    if (previous && previous.uuid !== profile.uuid && previous.skinPath) {
      // carry the skin over to the new file name
      const oldFile = join(this.skinsDir, previous.skinPath)
      const nextFile = join(this.skinsDir, `${profile.uuid}.png`)
      try {
        await mkdir(this.skinsDir, { recursive: true })
        const buffer = await readFile(oldFile)
        await writeFile(nextFile, buffer)
        await rm(oldFile, { force: true })
        profile.skinPath = `${profile.uuid}.png`
      } catch {
        profile.skinPath = null
      }
    }
    configStore.setProfile(profile)
    logger.info(`Профиль: ${profile.name} (${profile.uuid})`)
    return profile
  }

  async setSkin(sourcePath: string): Promise<SkinInfo> {
    return this.setSkinBuffer(await readFile(sourcePath))
  }

  async setSkinBuffer(buffer: Buffer): Promise<SkinInfo> {
    const profile = this.get()
    if (!profile) throw new Error('profile_required')
    if (buffer.length > 2 * 1024 * 1024) {
      const error = new Error('Скин слишком большой')
      ;(error as Error & { code?: string }).code = 'skin_invalid_size'
      throw error
    }
    const size = readPngSize(buffer)
    if (!size) {
      const error = new Error('Скин должен быть PNG-файлом')
      ;(error as Error & { code?: string }).code = 'skin_invalid_format'
      throw error
    }
    const valid = (size.width === 64 && size.height === 64) || (size.width === 64 && size.height === 32)
    if (!valid) {
      const error = new Error(`Неверный размер скина ${size.width}×${size.height}. Нужен 64×64 или 64×32.`)
      ;(error as Error & { code?: string }).code = 'skin_invalid_size'
      throw error
    }
    await mkdir(this.skinsDir, { recursive: true })
    const fileName = `${profile.uuid}.png`
    await writeFile(join(this.skinsDir, fileName), buffer)
    profile.skinPath = fileName
    profile.skinVariant = size.height === 32 ? 'classic' : 'classic'
    configStore.setProfile(profile)
    logger.info('Скин обновлён')
    return this.readSkin()
  }

  async readSkin(): Promise<SkinInfo> {
    const profile = this.get()
    const file = this.skinPath(profile)
    if (!file) return { dataUrl: null, variant: 'classic', path: null }
    try {
      const info = await stat(file)
      if (!info.isFile()) return { dataUrl: null, variant: 'classic', path: null }
      const buffer = await readFile(file)
      return {
        dataUrl: `data:image/png;base64,${buffer.toString('base64')}`,
        variant: profile?.skinVariant ?? 'classic',
        path: file
      }
    } catch {
      return { dataUrl: null, variant: 'classic', path: null }
    }
  }

  async removeSkin(): Promise<SkinInfo> {
    const profile = this.get()
    const file = this.skinPath(profile)
    if (file) await rm(file, { force: true }).catch(() => undefined)
    if (profile) {
      profile.skinPath = null
      configStore.setProfile(profile)
    }
    return { dataUrl: null, variant: 'classic', path: null }
  }
}

export const profileService = new ProfileService()
