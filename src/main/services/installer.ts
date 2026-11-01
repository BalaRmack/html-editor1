import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { MinecraftFolder, Version } from '@xmcl/core'
import {
  getVersionList,
  install,
  installDependencies,
  installFabric,
  installForge,
  installNeoForged,
  installQuiltVersion
} from '@xmcl/installer'
import { FORGE_MAVEN, NEOFORGE_MAVEN } from '../../shared/constants'
import type { Instance, LoaderType } from '../../shared/types'
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

export class InstallerService {
  private cancelled = false

  cancel(): void {
    this.cancelled = true
  }

  private checkCancelled(): void {
    if (this.cancelled) throw new CancelledError()
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

  async ensureVanilla(mcVersion: string, sharedDir: string, task?: TaskHandle): Promise<void> {
    const list = await getVersionList()
    const meta = list.versions.find((entry) => entry.id === mcVersion)
    if (!meta) {
      const error = new Error(`Версия ${mcVersion} не найдена в манифесте Mojang`)
      ;(error as Error & { code?: string }).code = 'version_not_found'
      throw error
    }
    task?.stage('Проверка версии', 0, 3)
    logger.info(`Установка Minecraft ${mcVersion}`)
    await install(meta, sharedDir)
    task?.bump()
    this.checkCancelled()
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

  async installInstance(
    instance: Instance,
    sharedDir: string,
    javaPath: string | null,
    options: { verifyOnly?: boolean } = {}
  ): Promise<InstallOutcome> {
    this.cancelled = false
    const task = tasks.create(`Установка «${instance.name}»`, { instanceId: instance.id, total: 5, unit: 'steps' })
    try {
      task.stage('Проверка версии', 0, 5)
      if (!options.verifyOnly) {
        await this.ensureVanilla(instance.mcVersion, sharedDir, task)
      }

      this.checkCancelled()
      task.stage(`Установка ${instance.loader}`, 2, 5)
      let versionId = instance.versionId
      let loaderVersion = instance.loaderVersion
      if (!options.verifyOnly || !(await exists(join(sharedDir, 'versions', versionId, `${versionId}.json`)))) {
        const loaderResult = await this.installLoader(
          instance.mcVersion,
          instance.loader,
          instance.loaderVersion,
          sharedDir,
          javaPath
        )
        versionId = loaderResult.versionId
        loaderVersion = loaderResult.loaderVersion
      }

      this.checkCancelled()
      task.stage('Проверка библиотек и ассетов', 3, 5)
      const resolved = await Version.parse(sharedDir, versionId)
      await installDependencies(resolved, {})

      task.done('Готово к запуску')
      logger.info(`Сборка «${instance.name}» готова (${versionId})`)
      return { versionId, loaderVersion, mcVersion: instance.mcVersion, loader: instance.loader }
    } catch (error) {
      task.fail((error as Error).message)
      throw error
    }
  }

  /** Re-checks every library/asset of an installed instance and downloads broken files. */
  async repair(instance: Instance, sharedDir: string): Promise<void> {
    const task = tasks.create(`Проверка «${instance.name}»`, { instanceId: instance.id, total: 2, unit: 'steps' })
    try {
      task.stage('Разбор версии', 0, 2)
      const resolved = await Version.parse(sharedDir, instance.versionId)
      task.stage('Проверка файлов', 1, 2)
      await installDependencies(resolved, {})
      task.done('Файлы в порядке')
    } catch (error) {
      task.fail((error as Error).message)
      throw error
    }
  }

  sharedFolder(sharedDir: string): MinecraftFolder {
    return new MinecraftFolder(sharedDir)
  }
}

export const installer = new InstallerService()
