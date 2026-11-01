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
import { FORGE_MAVEN, NEOFORGE_MAVEN } from '../../shared/constants'
import type { Instance, IntegrityReport, LoaderType } from '../../shared/types'
import { AppError, toFailure, withStage } from './errors'
import { checkIntegrity } from './integrity'
import { brokenJsonReason, dropIfBrokenJson, purgeBrokenJsonIn } from './json-guard'
import { javaService } from './java'
import { logger } from './logger'
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
 * Runs an `@xmcl/task` tree and mirrors its aggregated byte progress into our own
 * task bus. The xmcl task graph sums `progress`/`total` of every child download,
 * so the UI gets a real progress bar instead of a "spinning forever" step.
 */
export async function runXmclTask<T>(
  root: Task<T>,
  handle: TaskHandle,
  stage: { label: string; key: string },
  onStart?: (task: Task<T>) => void
): Promise<T> {
  let lastReported = -1
  const timer = setInterval(() => {
    const total = root.total
    const progress = root.progress
    if (total > 0 && progress >= 0 && progress !== lastReported) {
      lastReported = progress
      handle.stage(stage.label, Math.min(progress, total), total, 'bytes', stage.key)
    }
  }, 250)

  onStart?.(root)
  try {
    return await root.startAndWait({ fork: createFork() })
  } finally {
    clearInterval(timer)
  }
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
    const list = await getVersionList()
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

    switch (loader) {
      case 'fabric': {
        const versionId = await installFabric({
          minecraftVersion: mcVersion,
          version: loaderVersion,
          minecraft: sharedDir,
          side: 'client'
        })
        return { versionId, loaderVersion }
      }
      case 'quilt': {
        const versionId = await installQuiltVersion({
          minecraftVersion: mcVersion,
          version: loaderVersion,
          minecraft: sharedDir,
          side: 'client'
        })
        return { versionId, loaderVersion }
      }
      case 'forge': {
        if (!java) {
          const error = new Error('Для установки Forge нужна Java. Установите Java в настройках')
          ;(error as Error & { code?: string }).code = 'java_required'
          throw error
        }
        const versionId = await installForge(
          {
            mcversion: mcVersion,
            version: loaderVersion,
            installer: {
              path: `${FORGE_MAVEN}/net/minecraftforge/forge/${mcVersion}-${loaderVersion}/forge-${mcVersion}-${loaderVersion}-installer.jar`
            }
          },
          sharedDir,
          { java: java.path, mavenHost: [FORGE_MAVEN] }
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
          mavenHost: [NEOFORGE_MAVEN]
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

    try {
      handle.stage('Проверка локальных файлов', 0, 0, 'bytes', 'manifest')
      await this.sanitizeShared(sharedDir)

      handle.stage('Получение манифеста Mojang', 0, 0, 'bytes', 'manifest')
      const meta = await withStage('manifest', () => this.findVersionMeta(instance.mcVersion))
      this.checkCancelled()

      handle.stage(`Версия Minecraft ${instance.mcVersion}`, 0, 0, 'bytes', 'version')
      await withStage('version', () =>
        runXmclTask(
          installVersionTask(meta, sharedDir),
          handle,
          { label: `Версия Minecraft ${instance.mcVersion}`, key: 'version' },
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
        handle.stage(`Установка ${instance.loader}`, 0, 0, 'steps', 'loader')
        const result = await withStage('loader', () =>
          this.installLoader(instance.mcVersion, instance.loader, instance.loaderVersion, sharedDir, javaPath)
        )
        versionId = result.versionId
        loaderVersion = result.loaderVersion
        this.checkCancelled()
      }

      const resolved = await withStage('libraries', () => Version.parse(sharedDir, versionId))
      await withStage('libraries', () =>
        runXmclTask(
          installDependenciesTask(resolved),
          handle,
          { label: 'Библиотеки и ассеты', key: 'libraries' },
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
        await withStage('libraries', () =>
          runXmclTask(
            installDependenciesTask(resolved),
            handle,
            { label: 'Повторная загрузка', key: 'libraries' },
            (task) => {
              this.current = task as Task<unknown>
            }
          )
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

      handle.done('Готово к запуску')
      logger.info(`Сборка «${instance.name}» готова (${versionId})`)
      return { versionId, loaderVersion, mcVersion: instance.mcVersion, loader: instance.loader }
    } catch (error) {
      this.current = null
      const failure = toFailure(error)
      handle.fail(failure.message)
      logger.error(`Установка «${instance.name}» прервана: [${failure.code}] ${failure.message}`)
      throw error instanceof AppError ? error : new AppError(failure)
    }
  }

  /** Re-checks every library/asset of an installed instance and downloads broken files. */
  async repair(instance: Instance, sharedDir: string): Promise<void> {
    const handle = tasks.create(`Проверка «${instance.name}»`, { instanceId: instance.id, unit: 'bytes' })
    try {
      await this.sanitizeShared(sharedDir)
      const resolved = await withStage('libraries', () => Version.parse(sharedDir, instance.versionId))
      await withStage('libraries', () =>
        runXmclTask(
          installDependenciesTask(resolved),
          handle,
          { label: 'Проверка файлов', key: 'libraries' },
          (task) => {
            this.current = task as Task<unknown>
          }
        )
      )
      this.current = null
      handle.done('Файлы в порядке')
    } catch (error) {
      this.current = null
      const failure = toFailure(error)
      handle.fail(failure.message)
      throw error instanceof AppError ? error : new AppError(failure)
    }
  }

  sharedFolder(sharedDir: string): MinecraftFolder {
    return new MinecraftFolder(sharedDir)
  }
}

export const installer = new InstallerService()
