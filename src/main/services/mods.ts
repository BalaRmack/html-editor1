import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import AdmZip from 'adm-zip'
import type {
  AppSettings,
  Instance,
  InstalledMod,
  LoaderType,
  ModHit,
  ModInstallInput,
  ModInstallResult,
  ModQuery,
  ModSearchResult,
  ModVersion,
  ModpackInstallInput
} from '../../shared/types'
import { curseforgePackVersions, curseforgeProject, curseforgeSearch, curseforgeVersions } from './curseforge'
import { instances } from './instances'
import { installer } from './installer'
import { logger } from './logger'
import { downloadFile } from './net'
import {
  modrinthProject,
  modrinthSearch,
  modrinthVersionById,
  modrinthVersions,
  modrinthVersionsForPack,
  parseModrinthIndex
} from './modrinth'
import { paths } from './paths'
import { tasks } from './tasks'

interface ManifestEntry {
  projectId: string
  fileName: string
  name: string
  version: string
  iconUrl: string | null
  source: 'modrinth' | 'curseforge'
  installedAt: string
}

interface Manifest {
  mods: Record<string, ManifestEntry>
}

function safeJoin(root: string, relative: string): string {
  const normalizedRoot = resolve(root)
  const target = resolve(normalizedRoot, relative.replace(/^[\\/]+/, ''))
  if (target !== normalizedRoot && !target.startsWith(normalizedRoot + sep)) {
    throw new Error(`Небезопасный путь в архиве: ${relative}`)
  }
  return target
}

function shortName(fileName: string): string {
  return basename(fileName).replace(/\.jar(\.disabled)?$/i, '')
}

export class ModsService {
  private async manifestPath(instanceId: string): Promise<string> {
    return join(paths.instanceDir(instanceId), 'mods.json')
  }

  private async readManifest(instanceId: string): Promise<Manifest> {
    try {
      const raw = await readFile(await this.manifestPath(instanceId), 'utf8')
      const parsed = JSON.parse(raw) as Manifest
      return { mods: parsed.mods ?? {} }
    } catch {
      return { mods: {} }
    }
  }

  private async writeManifest(instanceId: string, manifest: Manifest): Promise<void> {
    const file = await this.manifestPath(instanceId)
    await mkdir(join(file, '..'), { recursive: true })
    await writeFile(file, JSON.stringify(manifest, null, 2), 'utf8')
  }

  async search(query: ModQuery, settings: AppSettings): Promise<ModSearchResult> {
    if (query.source === 'curseforge') return curseforgeSearch(query, settings.curseForgeApiKey)
    return modrinthSearch(query)
  }

  async project(source: ModQuery['source'], id: string, settings: AppSettings): Promise<ModHit | null> {
    return source === 'curseforge' ? curseforgeProject(id, settings.curseForgeApiKey) : modrinthProject(id)
  }

  async versions(
    source: ModQuery['source'],
    projectId: string,
    mcVersion: string,
    loader: LoaderType,
    settings: AppSettings
  ): Promise<ModVersion[]> {
    return source === 'curseforge'
      ? curseforgeVersions(projectId, mcVersion, loader, settings.curseForgeApiKey)
      : modrinthVersions(projectId, mcVersion, loader)
  }

  async installed(instanceId: string): Promise<InstalledMod[]> {
    const instance = await instances.get(instanceId)
    const manifest = await this.readManifest(instanceId)
    const modsDir = join(instance.gameDir, 'mods')
    let files: string[] = []
    try {
      files = (await readdir(modsDir)).filter((file) => /\.jar(\.disabled)?$/i.test(file))
    } catch {
      files = []
    }

    const byFile = new Map(Object.values(manifest.mods).map((entry) => [entry.fileName, entry]))
    const result: InstalledMod[] = []
    for (const file of files) {
      const entry = byFile.get(file) ?? byFile.get(file.replace(/\.disabled$/, ''))
      const info = await stat(join(modsDir, file)).catch(() => null)
      result.push({
        projectId: entry?.projectId ?? null,
        fileName: file,
        name: entry?.name ?? shortName(file),
        version: entry?.version ?? '',
        iconUrl: entry?.iconUrl ?? null,
        enabled: !file.endsWith('.disabled'),
        source: entry?.source ?? 'manual',
        size: info?.size ?? 0,
        installedAt: entry?.installedAt ?? new Date().toISOString()
      })
    }
    return result.sort((a, b) => a.name.localeCompare(b.name))
  }

  async remove(instanceId: string, fileName: string): Promise<void> {
    const instance = await instances.get(instanceId)
    const target = safeJoin(join(instance.gameDir, 'mods'), basename(fileName))
    await rm(target, { force: true }).catch(() => undefined)
    await rm(`${target}.disabled`, { force: true }).catch(() => undefined)

    const manifest = await this.readManifest(instanceId)
    for (const [key, entry] of Object.entries(manifest.mods)) {
      if (entry.fileName === fileName || `${entry.fileName}.disabled` === fileName) delete manifest.mods[key]
    }
    await this.writeManifest(instanceId, manifest)
    logger.info(`Мод ${fileName} удалён из «${instance.name}»`)
  }

  async toggle(instanceId: string, fileName: string, enabled: boolean): Promise<void> {
    const instance = await instances.get(instanceId)
    const modsDir = join(instance.gameDir, 'mods')
    const plain = join(modsDir, basename(fileName).replace(/\.disabled$/, ''))
    const disabled = `${plain}.disabled`
    if (enabled) {
      if (existsSync(disabled)) await rename(disabled, plain)
    } else if (existsSync(plain)) {
      await rename(plain, disabled)
    }
  }

  async install(input: ModInstallInput, settings: AppSettings): Promise<ModInstallResult> {
    const instance = await instances.get(input.instanceId)
    if (instance.loader === 'vanilla') {
      const error = new Error('Для установки модов нужна сборка с загрузчиком (Fabric, Forge, NeoForge или Quilt)')
      ;(error as Error & { code?: string }).code = 'needs_loader'
      throw error
    }

    const modsDir = join(instance.gameDir, 'mods')
    await mkdir(modsDir, { recursive: true })
    const manifest = await this.readManifest(instance.id)
    const result: ModInstallResult = { installed: [], skipped: [], warnings: [] }
    const task = tasks.create(`Моды для «${instance.name}»`, { instanceId: instance.id, unit: 'files' })
    const seen = new Set<string>()

    try {
      await this.installRecursive(
        instance,
        input.source,
        input.projectId,
        input.versionId ?? null,
        manifest,
        result,
        settings,
        seen,
        task
      )
      await this.writeManifest(instance.id, manifest)
      task.done(`Установлено модов: ${result.installed.length}`)
      return result
    } catch (error) {
      task.fail((error as Error).message)
      throw error
    }
  }

  private async installRecursive(
    instance: Instance,
    source: 'modrinth' | 'curseforge',
    projectId: string,
    versionId: string | null,
    manifest: Manifest,
    result: ModInstallResult,
    settings: AppSettings,
    seen: Set<string>,
    task: ReturnType<typeof tasks.create>,
    depth = 0
  ): Promise<void> {
    if (depth > 6 || seen.has(projectId)) return
    seen.add(projectId)
    if (manifest.mods[projectId]) {
      result.skipped.push(manifest.mods[projectId].name)
      return
    }

    const available = await this.versions(source, projectId, instance.mcVersion, instance.loader, settings)
    if (available.length === 0) {
      result.warnings.push(`Нет версии для ${instance.mcVersion}/${instance.loader}`)
      return
    }
    const version = versionId ? available.find((entry) => entry.id === versionId) ?? available[0] : available[0]
    if (!version.downloadUrl) {
      result.warnings.push(`Нет файла для ${version.name}`)
      return
    }

    const fileName = basename(version.fileName || `${projectId}.jar`)
    const destination = join(instance.gameDir, 'mods', fileName)
    task.stage(`Скачивание ${fileName}`, manifest.mods ? Object.keys(manifest.mods).length : 0, 0, 'files')

    if (!existsSync(destination)) {
      await downloadFile(version.downloadUrl, destination)
    }

    const project = await this.project(source, projectId, settings).catch(() => null)
    manifest.mods[projectId] = {
      projectId,
      fileName,
      name: project?.name ?? shortName(fileName),
      version: version.versionNumber,
      iconUrl: project?.iconUrl ?? null,
      source,
      installedAt: new Date().toISOString()
    }
    result.installed.push(fileName)
    task.bump()

    for (const dependency of version.dependencies) {
      if (dependency.kind !== 'required') continue
      let depProjectId = dependency.projectId
      if (!depProjectId && dependency.versionId) {
        const resolved = await modrinthVersionById(dependency.versionId).catch(() => null)
        depProjectId = resolved?.projectId ?? null
      }
      if (!depProjectId) continue
      await this.installRecursive(
        instance,
        source,
        depProjectId,
        dependency.versionId,
        manifest,
        result,
        settings,
        seen,
        task,
        depth + 1
      )
    }
  }

  /** Installs a Modrinth `.mrpack` or CurseForge modpack into a brand new instance. */
  async installPack(input: ModpackInstallInput, settings: AppSettings): Promise<Instance> {
    const task = tasks.create(`Загрузка сборки «${input.projectName}»`, { unit: 'files' })
    const tempDir = join(paths.get().cacheDir, 'packs', randomUUID())
    try {
      task.stage('Получение информации о сборке', 0, 0)
      const versions =
        input.source === 'modrinth'
          ? await modrinthVersionsForPack(input.projectId)
          : await curseforgePackVersions(input.projectId, null, settings.curseForgeApiKey)
      if (versions.length === 0) throw new Error('У сборки нет доступных версий')
      const version = input.versionId ? versions.find((entry) => entry.id === input.versionId) ?? versions[0] : versions[0]

      const archive = join(tempDir, basename(version.fileName) || 'pack.zip')
      task.stage('Скачивание архива', 0, 1)
      await downloadFile(version.downloadUrl, archive)
      task.bump()

      const zip = new AdmZip(archive)
      await mkdir(tempDir, { recursive: true })
      zip.extractAllTo(tempDir, true)

      let index: { name: string; mcVersion: string; loader: LoaderType; loaderVersion: string | null; files: { path: string; downloadUrl: string; client: string }[]; overridesDir: string; curseFiles?: { projectId: string; fileId: string; required: boolean }[] }

      if (input.source === 'modrinth') {
        const raw = JSON.parse(await readFile(join(tempDir, 'modrinth.index.json'), 'utf8'))
        const parsed = parseModrinthIndex(raw)
        if (!parsed.mcVersion) throw new Error('В сборке не указана версия Minecraft')
        index = {
          name: input.projectName || parsed.name,
          mcVersion: parsed.mcVersion,
          loader: parsed.loader,
          loaderVersion: parsed.loaderVersion,
          files: parsed.files.filter((file) => file.client !== 'unsupported'),
          overridesDir: 'overrides'
        }
      } else {
        const manifestRaw = JSON.parse(await readFile(join(tempDir, 'manifest.json'), 'utf8')) as {
          name?: string
          minecraft: { version: string; modLoaders?: { id: string; primary?: boolean }[] }
          files?: { projectID: number; fileID: number; required?: boolean }[]
        }
        const loaderId = manifestRaw.minecraft.modLoaders?.find((loader) => loader.primary)?.id ?? manifestRaw.minecraft.modLoaders?.[0]?.id ?? ''
        const [loaderName, loaderVersion] = loaderId.split('-')
        index = {
          name: input.projectName || manifestRaw.name || 'Modpack',
          mcVersion: manifestRaw.minecraft.version,
          loader: (loaderName === 'forge' || loaderName === 'neoforge' || loaderName === 'fabric' || loaderName === 'quilt'
            ? loaderName
            : 'vanilla') as LoaderType,
          loaderVersion: loaderVersion ?? null,
          files: [],
          overridesDir: 'overrides',
          curseFiles: (manifestRaw.files ?? []).map((file) => ({
            projectId: String(file.projectID),
            fileId: String(file.fileID),
            required: file.required !== false
          }))
        }
      }

      task.stage('Создание сборки', 0, 0)
      const created = await instances.create(
        {
          name: index.name.slice(0, 60),
          mcVersion: index.mcVersion,
          loader: index.loader,
          loaderVersion: index.loaderVersion,
          memory: settings.defaultMemory,
          jvmArgs: settings.defaultJvmArgs,
          javaPath: settings.javaPath,
          install: false
        },
        { memory: settings.defaultMemory, jvmArgs: settings.defaultJvmArgs }
      )

      task.stage('Установка загрузчика', 0, 0)
      const outcome = await installer.installInstance(created, paths.get().sharedDir, settings.javaPath)
      await instances.setVersionInfo(created.id, outcome.versionId, outcome.loaderVersion, outcome.mcVersion)

      const gameDir = created.gameDir
      if (input.source === 'modrinth') {
        task.stage('Скачивание файлов сборки', 0, index.files.length)
        for (const file of index.files) {
          const target = safeJoin(gameDir, file.path)
          await mkdir(resolve(target, '..'), { recursive: true })
          await downloadFile(file.downloadUrl, target)
          task.bump()
        }
      } else if (index.curseFiles) {
        task.stage('Скачивание модов CurseForge', 0, index.curseFiles.length)
        const manifest: Manifest = { mods: {} }
        for (const file of index.curseFiles) {
          const meta = await curseforgePackVersions(file.projectId, null, settings.curseForgeApiKey).catch(() => [])
          const matching = meta.find((entry) => entry.id === file.fileId) ?? meta[0]
          if (!matching) continue
          const target = join(gameDir, 'mods', basename(matching.fileName))
          await mkdir(join(gameDir, 'mods'), { recursive: true })
          await downloadFile(matching.downloadUrl, target)
          manifest.mods[file.projectId] = {
            projectId: file.projectId,
            fileName: basename(matching.fileName),
            name: matching.name,
            version: matching.versionNumber,
            iconUrl: null,
            source: 'curseforge',
            installedAt: new Date().toISOString()
          }
          task.bump()
        }
        await this.writeManifest(created.id, manifest)
      }

      const overrides = join(tempDir, index.overridesDir)
      if (existsSync(overrides)) {
        task.stage('Применение overrides', 0, 0)
        await cp(overrides, gameDir, { recursive: true, force: true })
      }

      task.done('Сборка установлена')
      logger.info(`Модпак «${index.name}» установлен как отдельный инстанс`)
      return instances.get(created.id)
    } catch (error) {
      task.fail((error as Error).message)
      throw error
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  modsDir(instanceId: string): string {
    return join(paths.instanceGameDir(instanceId), 'mods')
  }
}

export const modsService = new ModsService()
