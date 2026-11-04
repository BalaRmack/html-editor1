import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import AdmZip from 'adm-zip'
import type {
  AppSettings,
  ContentInstallInput,
  ContentKind,
  ContentQuery,
  ContentSearchResult,
  ContentUpdate,
  ContentUpdateInput,
  Instance,
  InstalledMod,
  LoaderType,
  ModHit,
  ModInstallInput,
  ModInstallResult,
  ModQuery,
  ModSearchResult,
  ModVersion,
  ModpackInstallInput,
  RecommendedFailure,
  RecommendedInstallInput,
  RecommendedInstallResult
} from '../../shared/types'
import {
  CONTENT_DIR,
  CONTENT_PROJECT_TYPE,
  filterCompatible,
  isNewerBuild,
  pickCompatibleVersion
} from './content-logic'
import { curseforgeFile, curseforgePackVersions, curseforgeProject, curseforgeSearch, curseforgeVersions } from './curseforge'
import { instances } from './instances'
import { installer } from './installer'
import { logger } from './logger'
import { downloadBatch, settleAll } from './downloader'
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
import { resolveRecommendedInstall } from './recommended-mods'
import { tasks } from './tasks'

interface ManifestEntry {
  projectId: string
  fileName: string
  name: string
  version: string
  iconUrl: string | null
  source: 'modrinth' | 'curseforge'
  installedAt: string
  /** What the entry belongs to; older manifests only had mods. */
  kind?: ContentKind
  /** Source version id — the basis of the update check. */
  versionId?: string | null
  /** SHA-1 of the file we installed (Modrinth/CurseForge both publish it). */
  sha1?: string | null
  author?: string | null
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

  /** Versions of a modpack (no instance context exists yet, so no loader filter). */
  async packVersions(source: ModQuery['source'], projectId: string, mcVersion: string | null, settings: AppSettings) {
    return source === 'curseforge'
      ? curseforgePackVersions(projectId, mcVersion, settings.curseForgeApiKey)
      : modrinthVersionsForPack(projectId, mcVersion)
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

  async installed(instanceId: string, kind: ContentKind = 'mod'): Promise<InstalledMod[]> {
    const instance = await instances.get(instanceId)
    const manifest = await this.readManifest(instanceId)
    const modsDir = join(instance.gameDir, CONTENT_DIR[kind])
    let files: string[] = []
    try {
      files = (await readdir(modsDir)).filter((file) => /\.jar(\.disabled)?$/i.test(file))
    } catch {
      files = []
    }

    const entries = Object.values(manifest.mods).filter((entry) => (entry.kind ?? 'mod') === kind)
    const byFile = new Map(entries.map((entry) => [entry.fileName, entry]))
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
        installedAt: entry?.installedAt ?? new Date().toISOString(),
        versionId: entry?.versionId ?? null,
        sha1: entry?.sha1 ?? null,
        author: entry?.author ?? null
      })
    }
    return result.sort((a, b) => a.name.localeCompare(b.name))
  }

  async remove(instanceId: string, fileName: string, kind: ContentKind = 'mod'): Promise<void> {
    const instance = await instances.get(instanceId)
    const target = safeJoin(join(instance.gameDir, CONTENT_DIR[kind]), basename(fileName))
    await rm(target, { force: true }).catch(() => undefined)
    await rm(`${target}.disabled`, { force: true }).catch(() => undefined)

    const manifest = await this.readManifest(instanceId)
    for (const [key, entry] of Object.entries(manifest.mods)) {
      if (entry.fileName === fileName || `${entry.fileName}.disabled` === fileName) delete manifest.mods[key]
    }
    await this.writeManifest(instanceId, manifest)
    logger.info(`Удалён файл ${fileName} из «${instance.name}»`)
  }

  async toggle(instanceId: string, fileName: string, enabled: boolean, kind: ContentKind = 'mod'): Promise<void> {
    const instance = await instances.get(instanceId)
    const modsDir = join(instance.gameDir, CONTENT_DIR[kind])
    const plain = join(modsDir, basename(fileName).replace(/\.disabled$/, ''))
    const disabled = `${plain}.disabled`
    if (enabled) {
      if (existsSync(disabled)) await rename(disabled, plain)
    } else if (existsSync(plain)) {
      await rename(plain, disabled)
    }
  }

  /** Per-instance queue: two installs must not read/write the same manifest at once. */
  private readonly locks = new Map<string, Promise<unknown>>()

  private withLock<T>(key: string, job: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve()
    const run = previous.catch(() => undefined).then(job)
    const tail = run.catch(() => undefined)
    this.locks.set(key, tail)
    void tail.then(() => {
      if (this.locks.get(key) === tail) this.locks.delete(key)
    })
    return run
  }

  async install(input: ModInstallInput, settings: AppSettings): Promise<ModInstallResult> {
    return this.withLock(input.instanceId, () => this.installUnlocked(input, settings))
  }

  private async installUnlocked(input: ModInstallInput, settings: AppSettings): Promise<ModInstallResult> {
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
      installedAt: new Date().toISOString(),
      versionId: version.id,
      sha1: version.sha1,
      author: project?.author ?? null
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

  // ---------------------------------------------------------------- recommended mods

  /**
   * Installs the mods picked in «Добавить рекомендуемые моды?» (plus their required
   * dependencies) into an existing instance. One failed download never aborts the
   * others: it ends up in `failed` and the instance stays usable.
   */
  async installRecommended(input: RecommendedInstallInput): Promise<RecommendedInstallResult> {
    return this.withLock(input.instanceId, () => this.installRecommendedUnlocked(input))
  }

  private async installRecommendedUnlocked(input: RecommendedInstallInput): Promise<RecommendedInstallResult> {
    const instance = await instances.get(input.instanceId)
    const result: RecommendedInstallResult = { installed: [], dependencies: [], failed: [] }
    if (instance.loader === 'vanilla' || input.projectIds.length === 0) return result

    const task = tasks.create(`Рекомендуемые моды для «${instance.name}»`, { instanceId: instance.id, unit: 'files' })
    try {
      task.stage('Подбор модов', 0, 0)
      const resolution = await resolveRecommendedInstall(instance.mcVersion, instance.loader, input.projectIds)
      const failed: RecommendedFailure[] = [...resolution.failed]

      const modsDir = join(instance.gameDir, 'mods')
      await mkdir(modsDir, { recursive: true })
      const manifest = await this.readManifest(instance.id)

      // A mod that is already tracked and still on disk is left alone.
      const pending = resolution.downloads.filter((download) => {
        const known = manifest.mods[download.projectId]
        return !(known && existsSync(join(modsDir, known.fileName)))
      })

      const plannedBytes = pending.reduce((sum, download) => sum + (download.size || 0), 0)
      let doneBytes = 0
      task.stage('Скачивание модов', 0, plannedBytes || pending.length, plannedBytes > 0 ? 'bytes' : 'files')

      const report = await downloadBatch(
        pending.map((download) => ({
          url: download.url,
          destination: safeJoin(modsDir, basename(download.fileName)),
          sha1: download.sha1 || undefined,
          size: download.size || undefined,
          name: download.name,
          projectId: download.projectId
        })),
        {
          concurrency: 6,
          onBytes: (bytes) => {
            if (plannedBytes <= 0) return
            doneBytes = Math.max(0, doneBytes + bytes)
            task.stage('Скачивание модов', Math.min(doneBytes, plannedBytes), plannedBytes, 'bytes')
          }
        }
      )

      const failedIds = new Set(report.failed.map((failure) => failure.spec.projectId))
      for (const download of pending) {
        if (failedIds.has(download.projectId)) {
          failed.push({ name: download.name, reason: download.kind === 'dependency' ? 'dependency' : 'download' })
          continue
        }
        manifest.mods[download.projectId] = {
          projectId: download.projectId,
          fileName: basename(download.fileName),
          name: download.name,
          version: download.versionNumber,
          iconUrl: download.iconUrl,
          source: 'modrinth',
          installedAt: new Date().toISOString(),
          versionId: download.versionId,
          sha1: download.sha1 || null,
          author: null
        }
        if (download.kind === 'dependency') result.dependencies.push(download.name)
        else result.installed.push(download.name)
      }
      await this.writeManifest(instance.id, manifest)

      result.failed = failed
      if (failed.length > 0) {
        logger.warn(`Рекомендуемые моды: не установлено ${failed.length}: ${failed.map((item) => item.name).join(', ')}`)
        task.metrics({ failedFiles: failed.length })
      }
      logger.info(
        `Рекомендуемые моды для «${instance.name}»: установлено ${result.installed.length}, зависимостей ${result.dependencies.length}, ошибок ${failed.length}`
      )
      task.done(`Установлено модов: ${result.installed.length}`)
      return result
    } catch (error) {
      task.fail((error as Error).message)
      throw error
    }
  }

  // ---------------------------------------------------------------- content manager

  /**
   * Search for the instance «Настроить» window.
   *
   * The instance's own `mcVersion` + `loader` are injected here, on the trusted
   * side, and the response is filtered again — the renderer cannot ask for an
   * incompatible catalogue even by mistake.
   */
  async searchContent(input: ContentQuery, settings: AppSettings): Promise<ContentSearchResult> {
    const instance = await instances.get(input.instanceId)
    const empty: ContentSearchResult = {
      hits: [],
      total: 0,
      offset: 0,
      limit: input.limit ?? 20,
      mcVersion: instance.mcVersion,
      loader: instance.loader,
      kind: input.kind
    }
    // No loader → mods cannot work at all; packs and shaders still can.
    if (input.kind === 'mod' && instance.loader === 'vanilla') return empty

    const query: ModQuery = {
      source: settings.modSource,
      query: input.query,
      mcVersion: instance.mcVersion,
      loader: input.kind === 'mod' ? instance.loader : null,
      projectType: CONTENT_PROJECT_TYPE[input.kind],
      offset: input.offset ?? 0,
      limit: input.limit ?? 20,
      sort: 'relevance'
    }
    const result = await this.search(query, settings)
    const hits = filterCompatible(result.hits, { mcVersion: instance.mcVersion, loader: instance.loader }, input.kind)
    return { ...empty, hits, total: result.total }
  }

  /** Installs one project into the right folder, with required dependencies for mods. */
  async installContent(input: ContentInstallInput, settings: AppSettings): Promise<ModInstallResult> {
    if (input.kind === 'mod') {
      return this.install(
        {
          instanceId: input.instanceId,
          source: input.source,
          projectId: input.projectId,
          projectName: input.projectName,
          projectIcon: input.projectIcon,
          versionId: input.versionId,
          withDependencies: true
        },
        settings
      )
    }

    const instance = await instances.get(input.instanceId)
    const versions = await this.versionsFor(input.kind, input.source, input.projectId, instance, settings)
    const version = input.versionId
      ? versions.find((entry) => entry.id === input.versionId) ?? null
      : pickCompatibleVersion(versions, { mcVersion: instance.mcVersion, loader: instance.loader }, input.kind)
    if (!version) {
      const error = new Error(`Нет версии для ${instance.mcVersion}`)
      ;(error as Error & { code?: string }).code = 'incompatible'
      throw error
    }

    const dir = join(instance.gameDir, CONTENT_DIR[input.kind])
    await mkdir(dir, { recursive: true })
    const fileName = basename(version.fileName || `${input.projectId}.zip`)
    const destination = join(dir, fileName)
    const task = tasks.create(`Установка ${fileName}`, { instanceId: instance.id, unit: 'files' })
    try {
      await downloadFile(version.downloadUrl, destination)
      const manifest = await this.readManifest(instance.id)
      const project = await this.project(input.source, input.projectId, settings).catch(() => null)
      manifest.mods[`${input.kind}:${input.projectId}`] = {
        projectId: input.projectId,
        fileName,
        name: project?.name ?? input.projectName ?? shortName(fileName),
        version: version.versionNumber,
        iconUrl: project?.iconUrl ?? input.projectIcon ?? null,
        source: input.source,
        installedAt: new Date().toISOString(),
        kind: input.kind,
        versionId: version.id,
        sha1: version.sha1,
        author: project?.author ?? null
      }
      await this.writeManifest(instance.id, manifest)
      task.done(`Установлено: ${fileName}`)
      return { installed: [fileName], skipped: [], warnings: [] }
    } catch (error) {
      task.fail((error as Error).message)
      throw error
    }
  }

  /** Versions of a project filtered for this instance and kind. */
  private async versionsFor(
    kind: ContentKind,
    source: 'modrinth' | 'curseforge',
    projectId: string,
    instance: Instance,
    settings: AppSettings
  ): Promise<ModVersion[]> {
    if (kind === 'mod') return this.versions(source, projectId, instance.mcVersion, instance.loader, settings)
    // Packs/shaders are loader-agnostic: filter by game version only.
    return source === 'curseforge'
      ? curseforgeVersions(projectId, instance.mcVersion, 'vanilla', settings.curseForgeApiKey)
      : modrinthVersionsForPack(projectId, instance.mcVersion)
  }

  /**
   * «Проверить обновления»: every tracked file (project + version + SHA-1) is
   * compared with the newest build that still supports this instance.
   */
  async checkContentUpdates(instanceId: string, kind: ContentKind, settings: AppSettings): Promise<ContentUpdate[]> {
    const instance = await instances.get(instanceId)
    const manifest = await this.readManifest(instanceId)
    const entries = Object.values(manifest.mods).filter((entry) => (entry.kind ?? 'mod') === kind)
    const updates: ContentUpdate[] = []

    for (const entry of entries) {
      if (!entry.projectId) continue
      const versions = await this.versionsFor(kind, entry.source, entry.projectId, instance, settings).catch(() => [])
      const candidate = pickCompatibleVersion(
        versions,
        { mcVersion: instance.mcVersion, loader: instance.loader },
        kind
      )
      if (!candidate) continue
      if (!isNewerBuild({ version: entry.version, sha1: entry.sha1 ?? null, versionId: entry.versionId ?? null }, candidate)) {
        continue
      }
      updates.push({
        kind,
        projectId: entry.projectId,
        fileName: entry.fileName,
        name: entry.name,
        iconUrl: entry.iconUrl,
        currentVersion: entry.version,
        latestVersion: candidate.versionNumber,
        versionId: candidate.id,
        sha1: candidate.sha1,
        publishedAt: candidate.datePublished
      })
    }
    return updates
  }

  /** Applies one update: downloads the new build and removes the replaced file. */
  async updateContent(input: ContentUpdateInput, settings: AppSettings): Promise<void> {
    const instance = await instances.get(input.instanceId)
    const manifest = await this.readManifest(instance.id)
    const key = Object.keys(manifest.mods).find((entryKey) => {
      const entry = manifest.mods[entryKey]
      return entry.projectId === input.projectId && (entry.kind ?? 'mod') === input.kind
    })
    const entry = key ? manifest.mods[key] : null
    if (!entry) throw new Error('Файл не найден в манифесте сборки')

    const versions = await this.versionsFor(input.kind, entry.source, input.projectId, instance, settings)
    const version = input.versionId
      ? versions.find((item) => item.id === input.versionId) ?? null
      : pickCompatibleVersion(versions, { mcVersion: instance.mcVersion, loader: instance.loader }, input.kind)
    if (!version) throw new Error(`Нет версии для ${instance.mcVersion}`)

    const dir = join(instance.gameDir, CONTENT_DIR[input.kind])
    const fileName = basename(version.fileName || entry.fileName)
    const destination = join(dir, fileName)
    const task = tasks.create(`Обновление ${entry.name}`, { instanceId: instance.id, unit: 'files' })
    try {
      await downloadFile(version.downloadUrl, destination)
      if (fileName !== entry.fileName) {
        await rm(join(dir, entry.fileName), { force: true }).catch(() => undefined)
        await rm(join(dir, `${entry.fileName}.disabled`), { force: true }).catch(() => undefined)
      }
      manifest.mods[key!] = {
        ...entry,
        fileName,
        version: version.versionNumber,
        versionId: version.id,
        sha1: version.sha1,
        installedAt: new Date().toISOString()
      }
      await this.writeManifest(instance.id, manifest)
      task.done(`Обновлено: ${fileName}`)
      logger.info(`${entry.name} обновлён до ${version.versionNumber} в «${instance.name}»`)
    } catch (error) {
      task.fail((error as Error).message)
      throw error
    }
  }

  /** Absolute path of the folder that holds this kind of content. */
  async contentFolder(instanceId: string, kind: ContentKind): Promise<string> {
    const instance = await instances.get(instanceId)
    const dir = join(instance.gameDir, CONTENT_DIR[kind])
    await mkdir(dir, { recursive: true })
    return dir
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
      task.stage('Скачивание архива', 0, version.fileSize || 0, 'bytes', 'packDownload')
      await downloadFile(version.downloadUrl, archive, (received, total) => {
        task.stage('Скачивание архива', received, total || version.fileSize || 0, 'bytes', 'packDownload')
      })

      const zip = new AdmZip(archive)
      await mkdir(tempDir, { recursive: true })
      zip.extractAllTo(tempDir, true)

      let index: { name: string; mcVersion: string; loader: LoaderType; loaderVersion: string | null; files: { path: string; downloadUrl: string; fileSize: number; client: string }[]; overridesDir: string; curseFiles?: { projectId: string; fileId: string; required: boolean }[] }

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

      task.stage('Установка загрузчика', 0, 0, 'steps', 'loader')
      const outcome = await installer.installInstance(created, paths.get().sharedDir, settings.javaPath)
      await instances.setVersionInfo(created.id, outcome.versionId, outcome.loaderVersion, outcome.mcVersion)

      const gameDir = created.gameDir
      // One failed mod must never abort the pack: every file is downloaded inside
      // a bounded pool, failures are collected per file and reported at the end.
      const failedMods: string[] = []
      if (input.source === 'modrinth') {
        const plannedBytes = index.files.reduce((sum, file) => sum + (file.fileSize || 0), 0)
        let doneBytes = 0
        for (const file of index.files) {
          await mkdir(resolve(safeJoin(gameDir, file.path), '..'), { recursive: true })
        }
        task.stage('Файлы сборки', 0, plannedBytes, 'bytes', 'packFiles')
        const report = await downloadBatch(
          index.files.map((file) => ({
            url: file.downloadUrl,
            destination: safeJoin(gameDir, file.path),
            size: file.fileSize || undefined,
            name: basename(file.path)
          })),
          {
            // 12 sockets: fast on a good line, still polite to the CDN.
            concurrency: 12,
            onBytes: (bytes) => {
              doneBytes = Math.max(0, doneBytes + bytes)
              task.stage('Файлы сборки', Math.min(doneBytes, plannedBytes || doneBytes), plannedBytes || doneBytes, 'bytes', 'packFiles')
            }
          }
        )
        for (const failure of report.failed) failedMods.push(failure.spec.name ?? failure.spec.url)
        logger.info(`Сборка: скачано ${report.downloaded}, уже было ${report.skipped}, ошибок ${report.failed.length}`)
      } else if (index.curseFiles && index.curseFiles.length > 0) {
        task.stage('Скачивание модов CurseForge', 0, index.curseFiles.length, 'files', 'packFiles')
        const manifest: Manifest = { mods: {} }
        let fetched = 0
        const modsDir = join(gameDir, 'mods')
        await mkdir(modsDir, { recursive: true })
        // CurseForge needs a metadata round-trip per file, so the pool wraps the
        // lookup *and* the download; a 404 on one mod is just one red line.
        const curseFiles = index.curseFiles
        await settleAll(curseFiles, 8, async (file) => {
          const matching = await curseforgeFile(file.projectId, file.fileId, settings.curseForgeApiKey).catch(() => null)
          if (!matching) {
            failedMods.push(`CurseForge #${file.projectId}`)
            return
          }
          const target = join(modsDir, basename(matching.fileName))
          await downloadFile(
            matching.downloadUrl,
            target,
            undefined,
            { name: basename(matching.fileName), size: matching.fileSize }
          )
          fetched += 1
          task.stage('Скачивание модов CurseForge', fetched, curseFiles.length, 'files', 'packFiles')
          manifest.mods[file.projectId] = {
            projectId: file.projectId,
            fileName: basename(matching.fileName),
            name: matching.name,
            version: matching.versionNumber,
            iconUrl: null,
            source: 'curseforge',
            installedAt: new Date().toISOString()
          }
        }).then((outcome) => {
          for (const failure of outcome.failed) failedMods.push(failure.error.message.slice(0, 80))
        })
        await this.writeManifest(created.id, manifest)
      }

      if (failedMods.length > 0) {
        // The pack is playable — the missing mods are reported, not thrown away.
        logger.warn(`Не удалось скачать ${failedMods.length} файл(ов): ${failedMods.slice(0, 8).join(', ')}`)
        task.metrics({ failedFiles: failedMods.length })
        task.stage(`Сборка установлена без ${failedMods.length} файл(ов)`, 0, 0, 'steps', 'packFiles')
      }

      const overrides = join(tempDir, index.overridesDir)
      if (existsSync(overrides)) {
        task.stage('Применение overrides', 0, 0, 'steps', 'overrides')
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
