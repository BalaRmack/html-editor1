import { randomUUID } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  CreateInstanceInput,
  Instance,
  InstancePatch,
  LoaderType,
  MemorySettings
} from '../../shared/types'
import { LOADER_TYPES } from '../../shared/types'
import { logger } from './logger'

interface StoredInstance {
  schema: 1
  id: string
  name: string
  mcVersion: string
  loader: LoaderType
  loaderVersion: string | null
  versionId: string
  createdAt: string
  lastPlayedAt: string | null
  playTimeMs: number
  memory: MemorySettings
  javaPath: string | null
  jvmArgs: string
  notes: string
  iconFile: string | null
}

export interface InstanceDefaults {
  memory: MemorySettings
  jvmArgs: string
}

const ICON_CACHE = new Map<string, { mtimeMs: number; dataUrl: string | null }>()

function sanitizeName(raw: string): string {
  return (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 64)
}

export class InstanceService {
  private instancesDir = ''
  private sharedDir = ''

  init(instancesDir: string, sharedDir: string): void {
    this.instancesDir = instancesDir
    this.sharedDir = sharedDir
  }

  private async readStored(id: string): Promise<StoredInstance | null> {
    try {
      const raw = await readFile(join(this.instancesDir, id, 'instance.json'), 'utf8')
      return JSON.parse(raw) as StoredInstance
    } catch {
      return null
    }
  }

  private async writeStored(instance: StoredInstance): Promise<void> {
    const dir = join(this.instancesDir, instance.id)
    await mkdir(dir, { recursive: true })
    const file = join(dir, 'instance.json')
    const tmp = `${file}.tmp`
    await writeFile(tmp, JSON.stringify(instance, null, 2), 'utf8')
    await rename(tmp, file)
  }

  private async iconDataUrl(id: string, iconFile: string | null): Promise<string | null> {
    if (!iconFile) return null
    const full = join(this.instancesDir, id, iconFile)
    try {
      const info = await stat(full)
      const cached = ICON_CACHE.get(full)
      if (cached && cached.mtimeMs === info.mtimeMs) return cached.dataUrl
      const buffer = await readFile(full)
      const dataUrl = `data:image/png;base64,${buffer.toString('base64')}`
      ICON_CACHE.set(full, { mtimeMs: info.mtimeMs, dataUrl })
      return dataUrl
    } catch {
      return null
    }
  }

  private async countMods(id: string): Promise<number> {
    try {
      const entries = await readdir(join(this.instancesDir, id, 'minecraft', 'mods'))
      return entries.filter((file) => file.endsWith('.jar') || file.endsWith('.jar.disabled')).length
    } catch {
      return 0
    }
  }

  private async isInstalled(versionId: string): Promise<boolean> {
    if (!versionId) return false
    try {
      await stat(join(this.sharedDir, 'versions', versionId, `${versionId}.json`))
      return true
    } catch {
      return false
    }
  }

  gameDir(id: string): string {
    return join(this.instancesDir, id, 'minecraft')
  }

  iconPath(id: string): string {
    return join(this.instancesDir, id, 'icon.png')
  }

  configPath(id: string): string {
    return join(this.instancesDir, id, 'instance.json')
  }

  async toPublic(stored: StoredInstance): Promise<Instance> {
    return {
      id: stored.id,
      name: stored.name,
      mcVersion: stored.mcVersion,
      loader: stored.loader,
      loaderVersion: stored.loaderVersion,
      versionId: stored.versionId,
      icon: await this.iconDataUrl(stored.id, stored.iconFile),
      createdAt: stored.createdAt,
      lastPlayedAt: stored.lastPlayedAt,
      playTimeMs: stored.playTimeMs,
      memory: stored.memory,
      javaPath: stored.javaPath,
      jvmArgs: stored.jvmArgs,
      gameDir: this.gameDir(stored.id),
      modsCount: await this.countMods(stored.id),
      installed: await this.isInstalled(stored.versionId),
      notes: stored.notes
    }
  }

  async list(): Promise<Instance[]> {
    let dirs: string[] = []
    try {
      dirs = await readdir(this.instancesDir)
    } catch {
      return []
    }
    const items: Instance[] = []
    for (const dir of dirs) {
      const stored = await this.readStored(dir)
      if (stored) items.push(await this.toPublic(stored))
    }
    return items.sort((a, b) => {
      const aTime = a.lastPlayedAt ? Date.parse(a.lastPlayedAt) : Date.parse(a.createdAt)
      const bTime = b.lastPlayedAt ? Date.parse(b.lastPlayedAt) : Date.parse(b.createdAt)
      return bTime - aTime
    })
  }

  async get(id: string): Promise<Instance> {
    const stored = await this.readStored(id)
    if (!stored) throw new Error(`instance_not_found:${id}`)
    return this.toPublic(stored)
  }

  async getStored(id: string): Promise<StoredInstance> {
    const stored = await this.readStored(id)
    if (!stored) throw new Error(`instance_not_found:${id}`)
    return stored
  }

  async create(input: CreateInstanceInput, defaults: InstanceDefaults): Promise<Instance> {
    const name = sanitizeName(input.name)
    if (!name) throw new Error('instance_name_required')
    if (!input.mcVersion) throw new Error('instance_version_required')

    const loader: LoaderType = LOADER_TYPES.includes(input.loader) ? input.loader : 'vanilla'
    const id = randomUUID()
    const now = new Date().toISOString()
    const stored: StoredInstance = {
      schema: 1,
      id,
      name,
      mcVersion: input.mcVersion,
      loader,
      loaderVersion: input.loaderVersion ?? null,
      versionId: input.mcVersion, // replaced by the installer once a loader is resolved
      createdAt: now,
      lastPlayedAt: null,
      playTimeMs: 0,
      memory: input.memory ?? defaults.memory,
      javaPath: input.javaPath ?? null,
      jvmArgs: input.jvmArgs ?? defaults.jvmArgs,
      notes: '',
      iconFile: null
    }

    await mkdir(join(this.gameDir(id), 'mods'), { recursive: true })
    await mkdir(join(this.gameDir(id), 'saves'), { recursive: true })
    await mkdir(join(this.gameDir(id), 'resourcepacks'), { recursive: true })
    await mkdir(join(this.gameDir(id), 'shaderpacks'), { recursive: true })

    if (input.iconPath) {
      try {
        const buffer = await readFile(input.iconPath)
        await writeFile(this.iconPath(id), buffer)
        stored.iconFile = 'icon.png'
      } catch (error) {
        logger.warn(`Не удалось установить иконку сборки: ${(error as Error).message}`)
      }
    }

    await this.writeStored(stored)
    logger.info(`Создана сборка «${name}» (${input.mcVersion}, ${loader})`)
    return this.toPublic(stored)
  }

  async update(id: string, patch: InstancePatch): Promise<Instance> {
    const stored = await this.getStored(id)
    if (typeof patch.name === 'string') {
      const name = sanitizeName(patch.name)
      if (!name) throw new Error('instance_name_required')
      stored.name = name
    }
    if (patch.memory) stored.memory = patch.memory
    if (patch.javaPath !== undefined) stored.javaPath = patch.javaPath
    if (typeof patch.jvmArgs === 'string') stored.jvmArgs = patch.jvmArgs
    if (typeof patch.notes === 'string') stored.notes = patch.notes
    await this.writeStored(stored)
    return this.toPublic(stored)
  }

  async setVersionInfo(id: string, versionId: string, loaderVersion: string | null, mcVersion?: string): Promise<void> {
    const stored = await this.getStored(id)
    stored.versionId = versionId
    stored.loaderVersion = loaderVersion
    if (mcVersion) stored.mcVersion = mcVersion
    await this.writeStored(stored)
  }

  async touchPlayed(id: string, startedAt: number): Promise<void> {
    const stored = await this.getStored(id)
    stored.lastPlayedAt = new Date().toISOString()
    stored.playTimeMs = (stored.playTimeMs ?? 0) + Math.max(0, Date.now() - startedAt)
    await this.writeStored(stored)
  }

  async clone(id: string, name?: string): Promise<Instance> {
    const stored = await this.getStored(id)
    const newId = randomUUID()
    const target = join(this.instancesDir, newId)
    await mkdir(this.instancesDir, { recursive: true })
    await cp(join(this.instancesDir, id, 'minecraft'), join(target, 'minecraft'), { recursive: true, force: true })
    if (stored.iconFile) {
      try {
        await cp(join(this.instancesDir, id, stored.iconFile), join(target, 'icon.png'))
      } catch {
        /* icon is optional */
      }
    }
    const copy: StoredInstance = {
      ...stored,
      id: newId,
      name: sanitizeName(name ?? `${stored.name} копия`),
      createdAt: new Date().toISOString(),
      lastPlayedAt: null,
      playTimeMs: 0
    }
    await this.writeStored(copy)
    logger.info(`Сборка «${stored.name}» клонирована`)
    return this.toPublic(copy)
  }

  async setIcon(id: string, sourcePath: string | null): Promise<Instance> {
    const stored = await this.getStored(id)
    if (!sourcePath) {
      await rm(this.iconPath(id), { force: true })
      stored.iconFile = null
    } else {
      const buffer = await readFile(sourcePath)
      const isPng = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      if (!isPng) throw new Error('icon_must_be_png')
      await writeFile(this.iconPath(id), buffer)
      stored.iconFile = 'icon.png'
    }
    await this.writeStored(stored)
    return this.toPublic(stored)
  }

  async remove(id: string): Promise<void> {
    const stored = await this.readStored(id)
    await rm(join(this.instancesDir, id), { recursive: true, force: true })
    if (stored) logger.info(`Сборка «${stored.name}» удалена`)
  }
}

export const instances = new InstanceService()
