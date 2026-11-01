import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { mkdir } from 'node:fs/promises'
import { cpus, freemem, totalmem } from 'node:os'
import { resolve } from 'node:path'
import { APP_VERSION } from '../../shared/constants'
import { EVENTS, IPC, type IpcResult } from '../../shared/ipc'
import type {
  AppConfig,
  AppSettings,
  CreateInstanceInput,
  InstallRunResult,
  InstancePatch,
  ContentInstallInput,
  ContentKind,
  ContentQuery,
  ContentUpdateInput,
  LoaderType,
  ModInstallInput,
  ModQuery,
  ModpackInstallInput,
  SystemInfo
} from '../../shared/types'
import { configStore } from '../services/config-store'
import { AppError, toFailure } from '../services/errors'
import { instances } from '../services/instances'
import { installer } from '../services/installer'
import { javaService } from '../services/java'
import { launcher } from '../services/launch'
import { logger } from '../services/logger'
import { modsService } from '../services/mods'
import { paths } from '../services/paths'
import { profileService } from '../services/profile'
import { tasks } from '../services/tasks'
import { updates } from '../services/updater'
import { versions } from '../services/versions'

function coded(code: string, message?: string): Error {
  const error = new Error(message ?? code)
  ;(error as Error & { code?: string }).code = code
  return error
}

export function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

function handle(channel: string, fn: (event: Electron.IpcMainInvokeEvent, ...args: never[]) => unknown): void {
  ipcMain.handle(channel, async (event, ...args): Promise<IpcResult<unknown>> => {
    try {
      return { ok: true, data: await fn(event, ...(args as never[])) }
    } catch (error) {
      const err = error as Error & { code?: string; file?: string }
      logger.error(`[${channel}] ${err.message}`)
      return {
        ok: false,
        error: {
          code: err.code ?? 'unknown',
          message: err.message || 'Неизвестная ошибка',
          detail: err.stack?.split('\n').slice(0, 3).join('\n'),
          file: err.file
        }
      }
    }
  })
}

export async function ensureDirectories(): Promise<void> {
  const current = paths.get()
  await Promise.all([
    mkdir(current.sharedDir, { recursive: true }),
    mkdir(current.instancesDir, { recursive: true }),
    mkdir(current.javaDir, { recursive: true }),
    mkdir(current.skinsDir, { recursive: true }),
    mkdir(current.logsDir, { recursive: true }),
    mkdir(current.cacheDir, { recursive: true }),
    mkdir(current.modpacksDir, { recursive: true })
  ])
}

export function registerIpc(): void {
  const pickedImages = new Set<string>()

  // ---------- app ----------
  handle(IPC.app.info, (): SystemInfo => ({
    appVersion: app.getVersion() || APP_VERSION,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    totalMemMB: Math.round(totalmem() / 1024 / 1024),
    freeMemMB: Math.round(freemem() / 1024 / 1024),
    cpus: cpus().length,
    dataRoot: paths.get().dataRoot,
    userData: app.getPath('userData'),
    locale: app.getLocale()
  }))

  handle(IPC.app.boot, async (): Promise<AppConfig> => {
    const config = configStore.get()
    return {
      profile: config.profile,
      settings: config.settings,
      selectedInstanceId: config.selectedInstanceId,
      instances: await instances.list()
    }
  })

  handle(IPC.app.minimize, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  handle(IPC.app.toggleMaximize, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })

  handle(IPC.app.isMaximized, (event) => BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false)

  handle(IPC.app.close, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  handle(IPC.app.openExternal, async (_event, url: string) => {
    if (!/^https?:\/\//i.test(url)) throw coded('invalid_url')
    await shell.openExternal(url)
  })

  handle(IPC.app.openPath, async (_event, target: string) => {
    if (!target) throw coded('invalid_path')
    const error = await shell.openPath(target)
    if (error) throw coded('open_path_failed', error)
  })

  handle(IPC.app.pickDirectory, async (event, title?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = win
      ? await dialog.showOpenDialog(win, { title, properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showOpenDialog({ title, properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })

  handle(IPC.app.pickImage, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Выберите изображение',
      properties: ['openFile'],
      filters: [{ name: 'PNG', extensions: ['png'] }]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const picked = result.canceled ? null : result.filePaths[0]
    if (picked) pickedImages.add(picked)
    return picked
  })

  handle(IPC.app.readImage, async (_event, path: string) => {
    if (!pickedImages.has(path)) throw coded('forbidden')
    const { readFile } = await import('node:fs/promises')
    const buffer = await readFile(path)
    if (buffer.length > 8 * 1024 * 1024) throw coded('image_too_large')
    return `data:image/png;base64,${buffer.toString('base64')}`
  })

  handle(IPC.app.relaunch, () => {
    app.relaunch()
    app.exit(0)
  })

  // ---------- profile ----------
  handle(IPC.profile.get, () => profileService.get())
  handle(IPC.profile.setNickname, (_event, name: string) => profileService.setNickname(name))
  handle(IPC.profile.setSkin, async (event, sourcePath?: string | null) => {
    let target = sourcePath ?? null
    if (!target) {
      const win = BrowserWindow.fromWebContents(event.sender)
      const options: Electron.OpenDialogOptions = {
        title: 'Выберите скин (PNG 64×64)',
        properties: ['openFile'],
        filters: [{ name: 'PNG', extensions: ['png'] }]
      }
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
      if (result.canceled) return profileService.readSkin()
      target = result.filePaths[0]
    }
    return profileService.setSkin(target)
  })
  handle(IPC.profile.setSkinBytes, (_event, data: Uint8Array) => profileService.setSkinBuffer(Buffer.from(data)))
  handle(IPC.profile.readSkin, () => profileService.readSkin())
  handle(IPC.profile.removeSkin, () => profileService.removeSkin())

  // ---------- settings ----------
  handle(IPC.settings.get, () => configStore.get().settings)

  handle(IPC.settings.update, async (_event, patch: Partial<AppSettings>): Promise<AppSettings> => {
    const previousRoot = paths.get().dataRoot
    if (typeof patch.dataRoot === 'string' && patch.dataRoot.trim() && resolve(patch.dataRoot) !== previousRoot) {
      const target = resolve(patch.dataRoot)
      await mkdir(target, { recursive: true })
      paths.setDataRoot(target)
      await ensureDirectories()
      instances.init(paths.get().instancesDir, paths.get().sharedDir)
      profileService.init(paths.get().skinsDir)
      logger.setFile(`${paths.get().logsDir}/launcher.log`)
      logger.info(`Папка данных изменена: ${target}`)
    }
    const settings = await configStore.updateSettings(patch, paths.defaultDataRoot())
    return settings
  })

  // ---------- instances ----------
  handle(IPC.instances.list, () => instances.list())
  handle(IPC.instances.refresh, () => instances.list())
  handle(IPC.instances.get, (_event, id: string) => instances.get(id))

  handle(IPC.instances.create, async (_event, input: CreateInstanceInput) => {
    const settings = configStore.get().settings
    const created = await instances.create(input, {
      memory: input.memory ?? settings.defaultMemory,
      jvmArgs: input.jvmArgs ?? settings.defaultJvmArgs
    })
    configStore.setSelectedInstance(created.id)
    return created
  })

  handle(IPC.instances.update, (_event, id: string, patch: InstancePatch) => instances.update(id, patch))

  handle(IPC.instances.remove, async (_event, id: string) => {
    if (launcher.isRunning() && launcher.instanceId === id) throw coded('game_running')
    await instances.remove(id)
    if (configStore.get().selectedInstanceId === id) configStore.setSelectedInstance(null)
  })

  handle(IPC.instances.clone, (_event, id: string, name?: string) => instances.clone(id, name))

  handle(IPC.instances.setIcon, async (_event, id: string, sourcePath: string | null) => {
    let target = sourcePath
    if (target === undefined) {
      const result = await dialog.showOpenDialog({
        title: 'Иконка сборки',
        properties: ['openFile'],
        filters: [{ name: 'PNG', extensions: ['png'] }]
      })
      target = result.canceled ? null : result.filePaths[0]
      if (!target) return instances.get(id)
    }
    return instances.setIcon(id, target)
  })

  handle(IPC.instances.openFolder, async (_event, id: string) => {
    const instance = await instances.get(id)
    await shell.openPath(instance.gameDir)
  })

  // ---------- versions ----------
  handle(IPC.versions.minecraft, () => versions.listMinecraft())
  handle(IPC.versions.loaders, (_event, mcVersion: string, loader: LoaderType) => versions.listLoaders(mcVersion, loader))

  // ---------- install ----------
  /**
   * Downloads an instance, then *verifies* it. The result is structured: the UI
   * needs to know whether to offer «Повторить» (network), «Ошибка загрузки»
   * (integrity) or nothing at all (cancelled / missing Java).
   */
  handle(IPC.install.run, async (_event, instanceId: string): Promise<InstallRunResult> => {
    const instance = await instances.get(instanceId)
    const settings = configStore.get().settings
    const sharedDir = paths.get().sharedDir
    try {
      const outcome = await installer.installInstance(instance, sharedDir, settings.javaPath)
      await instances.setVersionInfo(instance.id, outcome.versionId, outcome.loaderVersion, outcome.mcVersion)

      // Never trust the downloader: prove the files are on disk before the UI
      // is allowed to enable «Играть».
      const updated = await instances.get(instanceId)
      const report = await installer.verify(updated, sharedDir)
      if (!report.ok) {
        logger.error(
          `Установка «${instance.name}»: проверка целостности не прошла (${report.missing.length + report.truncatedIssues} файлов)`
        )
        return {
          ok: false,
          code: report.code ?? 'integrity_failed',
          message: report.error,
          file: report.missing[0]?.name,
          stage: 'libraries',
          retryable: true,
          report
        }
      }
      return { ok: true, report }
    } catch (error) {
      const failure = toFailure(error)
      if (failure.code === 'cancelled') return { ok: false, code: 'cancelled', message: failure.message, retryable: false }
      logger.error(`Установка не удалась: [${failure.code}] ${failure.message}`)
      return {
        ok: false,
        code: failure.code,
        message: failure.message,
        file: failure.file,
        stage: failure.stage,
        retryable: failure.retryable
      }
    }
  })

  handle(IPC.install.verify, async (_event, instanceId: string, options?: { deep?: boolean }) => {
    const instance = await instances.get(instanceId)
    return installer.verify(instance, paths.get().sharedDir, options ?? {})
  })

  handle(IPC.install.cancel, () => {
    installer.cancel()
  })

  // ---------- game ----------
  handle(IPC.game.state, () => launcher.state())

  handle(IPC.game.launch, async (event, instanceId: string) => {
    const profile = profileService.get()
    if (!profile) throw coded('profile_required', 'Сначала задайте никнейм')
    const settings = configStore.get().settings
    let instance = await instances.get(instanceId)

    if (!instance.installed) {
      try {
        const outcome = await installer.installInstance(instance, paths.get().sharedDir, settings.javaPath)
        await instances.setVersionInfo(instance.id, outcome.versionId, outcome.loaderVersion, outcome.mcVersion)
      } catch (error) {
        const failure = toFailure(error)
        throw new AppError(failure)
      }
      instance = await instances.get(instanceId)
    }

    const result = await launcher.launch({
      instance,
      profile,
      settings,
      sharedDir: paths.get().sharedDir,
      instanceDir: instance.gameDir,
      javaDir: paths.get().javaDir
    })

    if (!result.ok) {
      const failure = new AppError({
        code: result.error ?? 'launch_failed',
        message: result.error === 'not_installed' ? 'Сборка не установлена' : result.error ?? 'Не удалось запустить игру',
        file: result.file,
        retryable: true
      })
      throw failure
    }

    configStore.setSelectedInstance(instanceId)
    const win = BrowserWindow.fromWebContents(event.sender)
    if (settings.afterLaunch === 'minimize') win?.minimize()
    if (settings.afterLaunch === 'close') win?.hide()
    return result
  })

  handle(IPC.game.kill, () => launcher.kill())

  // ---------- logs ----------
  handle(IPC.logs.history, () => logger.history())
  handle(IPC.logs.clear, () => {
    logger.clear()
    broadcast(EVENTS.logsCleared, null)
  })
  handle(IPC.logs.openFolder, () => shell.openPath(paths.get().logsDir))

  // ---------- java ----------
  handle(IPC.java.scan, () => javaService.scan([paths.get().javaDir]))
  handle(IPC.java.validate, (_event, javaPath: string) => javaService.validate(javaPath))

  handle(IPC.java.download, async (_event, major: number) => {
    const task = tasks.create(`Установка Java ${major}`, { unit: 'steps', total: 2 })
    try {
      task.stage('Получение манифеста Mojang', 0, 2)
      const runtime = await javaService.download(major, paths.get().javaDir, (stage) => task.stage(stage, 1, 2))
      task.done(`Java ${runtime.version} установлена`)
      return runtime
    } catch (error) {
      task.fail((error as Error).message)
      throw error
    }
  })

  // ---------- mods ----------
  // ------------------------------------------------ content manager (instance window)
  handle(IPC.content.search, (_event, input: ContentQuery) => modsService.searchContent(input, configStore.get().settings))
  handle(IPC.content.install, (_event, input: ContentInstallInput) =>
    modsService.installContent(input, configStore.get().settings)
  )
  handle(IPC.content.installed, (_event, instanceId: string, kind: ContentKind) => modsService.installed(instanceId, kind))
  handle(IPC.content.remove, (_event, instanceId: string, kind: ContentKind, fileName: string) =>
    modsService.remove(instanceId, fileName, kind)
  )
  handle(IPC.content.toggle, (_event, instanceId: string, kind: ContentKind, fileName: string, enabled: boolean) =>
    modsService.toggle(instanceId, fileName, enabled, kind)
  )
  handle(IPC.content.updates, (_event, instanceId: string, kind: ContentKind) =>
    modsService.checkContentUpdates(instanceId, kind, configStore.get().settings)
  )
  handle(IPC.content.update, (_event, input: ContentUpdateInput) =>
    modsService.updateContent(input, configStore.get().settings)
  )
  handle(IPC.content.openFolder, async (_event, instanceId: string, kind: ContentKind) => {
    await shell.openPath(await modsService.contentFolder(instanceId, kind))
  })
  handle(IPC.content.openPage, async (_event, source: ModQuery['source'], kind: ContentKind, projectId: string) => {
    const segments: Record<ContentKind, string> = { mod: 'mod', resourcepack: 'resourcepack', shader: 'shader' }
    const cfSegments: Record<ContentKind, string> = { mod: 'mc-mods', resourcepack: 'texture-packs', shader: 'shaders' }
    const url =
      source === 'curseforge'
        ? `https://www.curseforge.com/minecraft/${cfSegments[kind]}/${encodeURIComponent(projectId)}`
        : `https://modrinth.com/${segments[kind]}/${encodeURIComponent(projectId)}`
    await shell.openExternal(url)
  })

  handle(IPC.mods.search, (_event, query: ModQuery) => modsService.search(query, configStore.get().settings))
  handle(IPC.mods.project, (_event, source: ModQuery['source'], id: string) =>
    modsService.project(source, id, configStore.get().settings)
  )
  handle(IPC.mods.versions, (_event, source: ModQuery['source'], projectId: string, mcVersion: string, loader: LoaderType) =>
    modsService.versions(source, projectId, mcVersion, loader, configStore.get().settings)
  )
  handle(IPC.mods.packVersions, (_event, source: ModQuery['source'], projectId: string, mcVersion?: string | null) =>
    modsService.packVersions(source, projectId, mcVersion ?? null, configStore.get().settings)
  )
  handle(IPC.mods.install, (_event, input: ModInstallInput) => modsService.install(input, configStore.get().settings))
  handle(IPC.mods.installed, (_event, instanceId: string) => modsService.installed(instanceId))
  handle(IPC.mods.remove, (_event, instanceId: string, fileName: string) => modsService.remove(instanceId, fileName))
  handle(IPC.mods.toggle, (_event, instanceId: string, fileName: string, enabled: boolean) =>
    modsService.toggle(instanceId, fileName, enabled)
  )
  handle(IPC.mods.openFolder, async (_event, instanceId: string) => {
    await shell.openPath(modsService.modsDir(instanceId))
  })
  handle(IPC.mods.installPack, async (_event, input: ModpackInstallInput) => {
    const instance = await modsService.installPack(input, configStore.get().settings)
    configStore.setSelectedInstance(instance.id)
    return instance
  })

  // ---------- launcher updates ----------
  handle(IPC.updates.state, () => updates.stateSnapshot())
  handle(IPC.updates.check, () => updates.check())
  handle(IPC.updates.download, () => updates.download())
  handle(IPC.updates.install, () => {
    updates.install()
  })
  handle(IPC.updates.defer, () => updates.defer())
  handle(IPC.updates.skip, () => updates.skip())
  handle(IPC.updates.resume, () => updates.resume())

  // ---------- push events ----------
  logger.subscribe((line) => broadcast(EVENTS.logsLine, line))
  updates.onState((state) => broadcast(EVENTS.updateChanged, state))
  tasks.subscribe((progress) => broadcast(EVENTS.tasksProgress, progress))

  launcher.onState((snapshot) => {
    broadcast(EVENTS.gameChanged, snapshot)
    if (snapshot.state === 'exited' && snapshot.instanceId && snapshot.startedAt) {
      void instances.touchPlayed(snapshot.instanceId, snapshot.startedAt).catch(() => undefined)
    }
  })
  launcher.onCrash((crash) => broadcast(EVENTS.gameCrash, crash))
}
