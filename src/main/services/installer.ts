import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { MinecraftFolder, Version } from '@xmcl/core'
import {
  getVersionList,
  installDependenciesTask,
  installFabric,
  installForge,
  installNeoForged,
  installQuiltVersion,
  installVersionTask,
  type MinecraftVersion
} from '@xmcl/installer'
import { createFork, type Task } from '@xmcl/task'
import { FORGE_MAVEN, NEOFORGE_MAVEN, USER_AGENT } from '../../shared/constants'
import type { Instance, IntegrityReport, LoaderType, TaskProgress } from '../../shared/types'
import { delay, mirrorFetch, ProgressTracker } from './downloader'
import { AppError, toFailure, withStage } from './errors'
import { checkIntegrity } from './integrity'
import { brokenJsonReason, dropIfBrokenJson, purgeBrokenJsonIn } from './json-guard'
import { javaService } from './java'
import { logger } from './logger'
import { BMCL_MIRROR, ensureNetworkMode, getNetworkState, rewriteToMirror } from './mirror'
import { tasks, type TaskHandle } from './tasks'
import { versions } from './versions'

export interface InstallOutcome {
  versionId: string
  loaderVersion: string | null
  mcVersion: string
  loader: LoaderType
}

export class CancelledError extends Error {
  readonly code = 'cancelled'
  constructor() {
    super('Установка отменена')
  }
}

/** Best-effort guess used when the version json does not declare javaVersion. */
export function requiredJavaMajor(mcVersion: string): number {
  const parts = mcVersion.split('.').map((part) => Number(part))
  const minor = parts[1] ?? 0
  const patch = parts[2] ?? 0
  if (minor >= 21) return 21
  if (minor === 20 && patch >= 5) return 21
  if (minor >= 18) return 17
  if (minor === 17) return 16
  if (minor === 16 && patch >= 5) return 8
  return 8
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Overall install budget. Each phase owns a slice of the single bar the user
 * sees, so moving from "client jar" to "libraries" climbs instead of resetting.
 */
export const INSTALL_PHASES = {
  manifest: { key: 'manifest', from: 0, to: 3 },
  version: { key: 'version', from: 3, to: 38 },
  loader: { key: 'loader', from: 38, to: 55 },
  libraries: { key: 'libraries', from: 55, to: 96 },
  finish: { key: 'finish', from: 96, to: 100 }
} as const

/**
 * Runs an `@xmcl/task` tree and mirrors its aggregated byte progress into our own
 * task bus.
 *
 * The graph sums `progress`/`total` over every child download and — this is the
 * bug that shipped in 1.1.1 — the *total grows* as new downloads are discovered.
 * Feeding that ratio straight into the UI made the bar jump 90% → 70%. Here the
 * ratio goes through {@link ProgressTracker}, which snapshots the total per phase
 * and clamps the result so it can only ever move forward.
 */
export async function runXmclTask<T>(
  root: Task<T>,
  handle: TaskHandle,
  stage: { label: string; key: string },
  tracker: ProgressTracker,
  onStart?: (task: Task<T>) => void
): Promise<T> {
  let lastPercent = -1
  const timer = setInterval(() => {
    const total = root.total
    const progress = root.progress
    if (total > 0 && progress >= 0) {
      const snapshot = tracker.report(progress, total)
      // Speed/ETA refresh on every tick, the stage text only when the integer
      // percent changes (otherwise the label re-renders five times a second).
      handle.metrics({
        percent: snapshot.percent,
        bytesPerSecond: snapshot.bytesPerSecond,
        etaSeconds: snapshot.etaSeconds
      })
      if (Math.round(snapshot.percent) !== lastPercent) {
        lastPercent = Math.round(snapshot.percent)
        handle.stage(stage.label, snapshot.done, snapshot.total, 'bytes', stage.key)
      }
    }
  }, 200)

  onStart?.(root)
  try {
    return await root.startAndWait({ fork: createFork() })
  } finally {
    clearInterval(timer)
  }
}

/** True for errors that are worth retrying after switching to the mirror. */
function isNetworkFailure(error: unknown): boolean {
  const failure = toFailure(error)
  return failure.code === 'network_error' || /network|fetch|socket|timeout|ETIMEDOUT|ENOTFOUND|ECONN|EAI_AGAIN/i.test(failure.message)
}

/**
 * Download options for every xmcl task.
 *
 * Concurrency is raised to 16 parallel sockets (the default is 4), the session
 * keeps TCP connections alive, and one small probe decides whether we talk to
 * Mojang or to BMCLAPI for the rest of the run.
 */
export function xmclDownloadOptions(): Record<string, unknown> {
  const mirrorFirst = getNetworkState().mode !== 'official'
  return {
    fetch: mirrorFetch,
    headers: { 'User-Agent': USER_AGENT },
    librariesDownloadConcurrency: 16,
    assetsDownloadConcurrency: 16,
    // Size check instead of a full SHA1 pass: the hash of an already downloaded
    // library never changes, and hashing 400 files at every launch is what made
    // "Проверка файлов" feel frozen.
    prevalidSizeOnly: true,
    ...(mirrorFirst
      ? {
          mavenHost: [`${BMCL_MIRROR}/maven`],
          assetsHost: [`${BMCL_MIRROR}/assets`],
          assetsIndexUrl: (version: { assetIndex?: { url?: string; id?: string } }): string[] => {
            const urls: string[] = []
            if (version.assetIndex?.url) urls.push(version.assetIndex.url, rewriteToMirror(version.assetIndex.url))
            else if (version.assetIndex?.id) urls.push(`https://launchermeta.mojang.com/v1/packages/x/${version.assetIndex.id}.json`)
            return [...new Set(urls.filter(Boolean))]
          }
        }
      : {})
  }
}

/** Official URL first, mirrored twin second. */
function urlPair(url: string | undefined): string[] {
  if (!url) return []
  const mirrored = rewriteToMirror(url)
  return mirrored === url ? [url] : [url, mirrored]
}

export class InstallerService {
  private cancelled = false
  private current: Task<unknown> | null = null

  cancel(): void {
    this.cancelled = true
    void this.current?.cancel?.().catch(() => undefined)
  }

  private checkCancelled(): void {
    if (this.cancelled) throw new CancelledError()
  }

  /** Verifies every file of an instance without downloading anything. */
  async verify(
    instance: Instance,
    sharedDir: string,
    options: { deep?: boolean; fresh?: boolean; instanceDir?: string } = {}
  ): Promise<IntegrityReport> {
    return checkIntegrity(
      { id: instance.id, versionId: instance.versionId, mcVersion: instance.mcVersion, instanceDir: options.instanceDir },
      sharedDir,
      { deep: options.deep, fresh: options.fresh }
    )
  }

  /** Reads the java major declared by the vanilla version json, if present. */
  async readJavaRequirement(mcVersion: string, sharedDir: string): Promise<number> {
    try {
      const resolved = await Version.parse(sharedDir, mcVersion)
      const major = resolved.javaVersion?.majorVersion
      if (major && major > 0) return major
    } catch {
      /* fall back to the heuristic */
    }
    return requiredJavaMajor(mcVersion)
  }

  async findVersionMeta(mcVersion: string): Promise<MinecraftVersion> {
    const list = await getVersionList({ fetch: mirrorFetch })
    const meta = list.versions.find((entry) => entry.id === mcVersion)
    if (!meta) {
      const error = new Error(`Версия ${mcVersion} не найдена в манифесте Mojang`)
      ;(error as Error & { code?: string }).code = 'version_not_found'
      throw error
    }
    return meta
  }

  private async installLoader(
    mcVersion: string,
    loader: LoaderType,
    requestedLoaderVersion: string | null,
    sharedDir: string,
    javaPath: string | null
  ): Promise<{ versionId: string; loaderVersion: string | null }> {
    if (loader === 'vanilla') return { versionId: mcVersion, loaderVersion: null }

    const loaderVersion = requestedLoaderVersion ?? (await versions.resolveLoaderVersion(mcVersion, loader))
    if (!loaderVersion) throw new Error(`Не удалось определить версию ${loader} для ${mcVersion}`)
    logger.info(`Установка ${loader} ${loaderVersion} для Minecraft ${mcVersion}`)

    const javaMajor = await this.readJavaRequirement(mcVersion, sharedDir)
    const java = await javaService.pick(javaPath, javaMajor)

    const request = { fetch: mirrorFetch, headers: { 'User-Agent': USER_AGENT } }

    switch (loader) {
      case 'fabric': {
        // meta.fabricmc.net is mirrored by BMCLAPI; mirrorFetch rewrites it and
        // falls back to the official host automatically.
        const versionId = await installFabric({
          minecraftVersion: mcVersion,
          version: loaderVersion,
          minecraft: sharedDir,
          side: 'client',
          ...request
        })
        return { versionId, loaderVersion }
      }
      case 'quilt': {
        const versionId = await installQuiltVersion({
          minecraftVersion: mcVersion,
          version: loaderVersion,
          minecraft: sharedDir,
          side: 'client',
          ...request
        })
        return { versionId, loaderVersion }
      }
      case 'forge': {
        if (!java) {
          const error = new Error('Для установки Forge нужна Java. Установите Java в настройках')
          ;(error as Error & { code?: string }).code = 'java_required'
          throw error
        }
        const installerPath = `/net/minecraftforge/forge/${mcVersion}-${loaderVersion}/forge-${mcVersion}-${loaderVersion}-installer.jar`
        const versionId = await installForge(
          {
            mcversion: mcVersion,
            version: loaderVersion,
            // BMCLAPI mirrors the Forge maven 1:1 — the RU-blocked host never
            // has to be touched, while the official one stays as a fallback.
            installer: { path: `${BMCL_MIRROR}/maven${installerPath}` }
          },
          sharedDir,
          {
            java: java.path,
            mavenHost: [`${BMCL_MIRROR}/maven`, FORGE_MAVEN],
            ...request
          }
        )
        return { versionId, loaderVersion }
      }
      case 'neoforge': {
        if (!java) {
          const error = new Error('Для установки NeoForge нужна Java. Установите Java в настройках')
          ;(error as Error & { code?: string }).code = 'java_required'
          throw error
        }
        const project = loaderVersion.startsWith('1.') ? 'forge' : 'neoforge'
        const versionId = await installNeoForged(project, loaderVersion, sharedDir, {
          java: java.path,
          mavenHost: [`${BMCL_MIRROR}/maven`, NEOFORGE_MAVEN],
          ...request
        })
        return { versionId, loaderVersion }
      }
      default:
        return { versionId: mcVersion, loaderVersion: null }
    }
  }

  /**
   * Deletes JSON files in the shared folder that we cannot parse, so xmcl
   * re-downloads them instead of skipping them as "already present".
   *
   * This is the fix for the `assets/indexes/34.json` full of NUL bytes from the
   * real-world log: the file existed, so nothing fetched it again, and the
   * integrity check only warned.
   */
  private async sanitizeShared(sharedDir: string): Promise<void> {
    const targets = [join(sharedDir, 'assets', 'indexes'), join(sharedDir, 'versions')]
    for (const folder of targets) {
      const removed = await purgeBrokenJsonIn(folder, folder.endsWith('versions') ? 1 : 0)
      for (const file of removed) {
        logger.warn(`Повреждённый JSON удалён — будет скачан заново: ${file}`)
      }
    }
  }

  /**
   * Post-install check: every `assets/indexes/*.json` and the version json of
   * the resolved id must parse. A corrupt one is deleted and reported so the
   * caller can retry the download instead of "succeeding" with a broken folder.
   */
  private async findBrokenJson(sharedDir: string, versionId: string): Promise<string[]> {
    const candidates = [
      ...(await purgeBrokenJsonIn(join(sharedDir, 'assets', 'indexes'), 0)).map((file) => file),
      ...(await this.checkVersionJson(sharedDir, versionId))
    ]
    return candidates
  }

  private async checkVersionJson(sharedDir: string, versionId: string): Promise<string[]> {
    const file = join(sharedDir, 'versions', versionId, `${versionId}.json`)
    if (await dropIfBrokenJson(file)) {
      logger.warn(`Повреждённый version.json удалён: ${file} (${await brokenJsonReason(file)})`)
      return [file]
    }
    return []
  }

  /**
   * Installs everything an instance needs to launch:
   *  1. vanilla version json + client jar,
   *  2. the mod loader (Forge/NeoForge run their processors here),
   *  3. every library and asset for the resolved version.
   * Progress is reported in bytes so the UI can render a real progress bar.
   */
  async installInstance(
    instance: Instance,
    sharedDir: string,
    javaPath: string | null,
    options: { verifyOnly?: boolean } = {}
  ): Promise<InstallOutcome> {
    this.cancelled = false
    const handle = tasks.create(`Установка «${instance.name}»`, { instanceId: instance.id, unit: 'bytes' })
    const tracker = new ProgressTracker()
    tracker.beginPhase(INSTALL_PHASES.manifest)
    handle.metrics({ percent: 0 })

    try {
      handle.stage('Проверка локальных файлов', 0, 0, 'bytes', 'manifest')
      await this.sanitizeShared(sharedDir)

      // One probe decides Mojang vs BMCLAPI for the whole run. Without it the
      // first install in RU stalls on a TCP timeout before any fallback exists.
      const mode = await ensureNetworkMode()
      tracker.mark(1)
      handle.metrics({ percent: 1 })
      logger.info(`Канал загрузки: ${mode === 'mirror' ? `BMCLAPI (${BMCL_MIRROR})` : 'официальные серверы Mojang'}`)

      handle.stage('Получение манифеста Mojang', 0, 0, 'bytes', 'manifest')
      const meta = await withStage('manifest', () => this.findVersionMeta(instance.mcVersion))
      this.checkCancelled()
      tracker.mark(3)
      handle.metrics({ percent: 3 })

      handle.stage(`Версия Minecraft ${instance.mcVersion}`, 0, 0, 'bytes', 'version')
      tracker.beginPhase(INSTALL_PHASES.version)
      await this.runPhase(handle, tracker, `Версия Minecraft ${instance.mcVersion}`, 'version', () =>
        runXmclTask(
          installVersionTask(meta, sharedDir, {
            ...xmclDownloadOptions(),
            json: () => urlPair(meta.url),
            client: (version: { downloads?: { client?: { url?: string } } }) => urlPair(version.downloads?.client?.url)
          }),
          handle,
          { label: `Версия Minecraft ${instance.mcVersion}`, key: 'version' },
          tracker,
          (task) => {
            this.current = task as Task<unknown>
          }
        )
      )
      this.checkCancelled()

      let versionId = instance.versionId
      let loaderVersion = instance.loaderVersion
      const loaderJson = join(sharedDir, 'versions', instance.versionId, `${instance.versionId}.json`)
      const loaderReady =
        instance.loader === 'vanilla' ||
        (instance.versionId !== instance.mcVersion && (await exists(loaderJson)))
      // A freshly created instance points at the vanilla id, so the loader is installed here.
      // Re-running install (verify/repair) only reinstalls it if its version json disappeared.
      const needsLoader = !loaderReady

      if (needsLoader) {
        tracker.beginPhase(INSTALL_PHASES.loader)
        handle.stage(`Установка ${instance.loader}`, 0, 0, 'steps', 'loader')
        handle.metrics({ percent: tracker.mark(INSTALL_PHASES.loader.from).percent })
        const result = await this.runPhase(handle, tracker, `Установка ${instance.loader}`, 'loader', () =>
          withStage('loader', () =>
            this.installLoader(instance.mcVersion, instance.loader, instance.loaderVersion, sharedDir, javaPath)
          )
        )
        versionId = result.versionId
        loaderVersion = result.loaderVersion
        this.checkCancelled()
      }

      tracker.beginPhase(INSTALL_PHASES.libraries)
      const resolved = await withStage('libraries', () => Version.parse(sharedDir, versionId))
      await this.runPhase(handle, tracker, 'Библиотеки и ассеты', 'libraries', () =>
        runXmclTask(
          installDependenciesTask(resolved, xmclDownloadOptions()),
          handle,
          { label: 'Библиотеки и ассеты', key: 'libraries' },
          tracker,
          (task) => {
            this.current = task as Task<unknown>
          }
        )
      )
      this.current = null

      // A corrupt index would silently break asset loading in game — verify and,
      // if the downloader left us with garbage, force exactly one re-download.
      const broken = await this.findBrokenJson(sharedDir, versionId)
      if (broken.length > 0) {
        logger.warn(`Повреждённых JSON после установки: ${broken.length} — повторная загрузка`)
        handle.stage('Повторная загрузка повреждённых файлов', 0, 0, 'bytes', 'libraries')
        await runXmclTask(
          installDependenciesTask(resolved, xmclDownloadOptions()),
          handle,
          { label: 'Повторная загрузка', key: 'libraries' },
          tracker,
          (task) => {
            this.current = task as Task<unknown>
          }
        )
        this.current = null
        const stillBroken = await this.findBrokenJson(sharedDir, versionId)
        if (stillBroken.length > 0) {
          throw new AppError({
            code: 'json_corrupt',
            message: `Файлы метаданных повреждены после повторной загрузки: ${stillBroken
              .map((file) => file.split(/[\\/]/).pop())
              .join(', ')}`,
            file: stillBroken[0].split(/[\\/]/).pop(),
            stage: 'libraries',
            retryable: true
          })
        }
      }

      tracker.beginPhase(INSTALL_PHASES.finish)
      handle.metrics({ percent: 100 })
      handle.done('Готово к запуску')
      logger.info(`Сборка «${instance.name}» готова (${versionId})`)
      return { versionId, loaderVersion, mcVersion: instance.mcVersion, loader: instance.loader }
    } catch (error) {
      this.current = null
      const failure = toFailure(error)
      // A network failure is *not* a cancelled install: the partial files stay,
      // the task offers «Повторить», and the retry resumes from where it stopped.
      const waiting = isNetworkFailure(error) && !this.cancelled
      if (waiting) {
        handle.waiting('Ожидание сети — нажмите «Повторить»', {
          percent: tracker.current.percent,
          retryable: true
        })
      } else {
        handle.fail(failure.message, { percent: tracker.current.percent, retryable: failure.retryable })
      }
      logger.error(`Установка «${instance.name}» прервана: [${failure.code}] ${failure.message}`)
      throw error instanceof AppError ? error : new AppError({ ...failure, retryable: failure.retryable ?? true })
    }
  }

  /**
   * Runs one phase and retries it when the network drops. The retry usually
   * happens after {@link mirror} switched the session to BMCLAPI, so attempt #2
   * is the one that actually finishes for RU users.
   */
  private async runPhase<T>(
    handle: TaskHandle,
    tracker: ProgressTracker,
    label: string,
    key: string,
    run: () => Promise<T>,
    attempts = 3
  ): Promise<T> {
    let lastError: unknown
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await run()
      } catch (error) {
        lastError = error
        this.checkCancelled()
        if (!isNetworkFailure(error) || attempt === attempts) throw error
        const snapshot = tracker.current
        handle.waiting(`Ожидание сети — повтор ${attempt}/${attempts - 1}`, {
          percent: snapshot.percent,
          bytesPerSecond: 0,
          etaSeconds: null
        })
        logger.warn(`[${key}] сеть подвела (${(error as Error).message}), повтор ${attempt + 1}/${attempts}`)
        // Give the fallback a moment, then re-enter the phase. Already downloaded
        // files are skipped by size, so the retry continues instead of restarting.
        await delay(1200 * attempt)
        handle.stage(label, 0, 0, 'bytes', key)
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  /** Re-checks every library/asset of an installed instance and downloads broken files. */
  async repair(instance: Instance, sharedDir: string): Promise<void> {
    const handle = tasks.create(`Проверка «${instance.name}»`, { instanceId: instance.id, unit: 'bytes' })
    const tracker = new ProgressTracker()
    try {
      await this.sanitizeShared(sharedDir)
      await ensureNetworkMode()
      tracker.beginPhase({ key: 'libraries', from: 0, to: 98 })
      const resolved = await withStage('libraries', () => Version.parse(sharedDir, instance.versionId))
      await runXmclTask(
        installDependenciesTask(resolved, xmclDownloadOptions()),
        handle,
        { label: 'Проверка файлов', key: 'libraries' },
        tracker,
        (task) => {
          this.current = task as Task<unknown>
        }
      )
      this.current = null
      handle.metrics({ percent: 100 })
      handle.done('Файлы в порядке')
    } catch (error) {
      this.current = null
      const failure = toFailure(error)
      if (isNetworkFailure(error)) handle.waiting('Ожидание сети — нажмите «Повторить»', { retryable: true })
      else handle.fail(failure.message, { retryable: failure.retryable })
      throw error instanceof AppError ? error : new AppError({ ...failure, retryable: failure.retryable ?? true })
    }
  }

  sharedFolder(sharedDir: string): MinecraftFolder {
    return new MinecraftFolder(sharedDir)
  }
}

export const installer = new InstallerService()
