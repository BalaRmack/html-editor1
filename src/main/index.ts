import { BrowserWindow, Menu, app, session } from 'electron'
import { join } from 'node:path'
import { APP_ID, APP_NAME } from '../shared/constants'
import { ensureDirectories, registerIpc } from './ipc'
import { configStore } from './services/config-store'
import { instances } from './services/instances'
import { installer } from './services/installer'
import { javaService } from './services/java'
import { launcher } from './services/launch'
import { logger } from './services/logger'
import { paths } from './services/paths'
import { profileService } from './services/profile'
import { updates } from './services/updater'
import { closeSplash, createSplash, setSplashStatus } from './splash'
import { ensureTray } from './tray'
import { createMainWindow, getMainWindow } from './window'

app.setName(APP_NAME)
if (process.platform === 'win32') app.setAppUserModelId(APP_ID)

const hasLock = app.requestSingleInstanceLock()
if (!hasLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = getMainWindow()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })

  void bootstrap()
}

async function bootstrap(): Promise<void> {
  await app.whenReady()

  // Splash first: it needs nothing but the app binary, and it covers the
  // config load + service init that follow.
  createSplash()

  Menu.setApplicationMenu(null)
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })

  setSplashStatus('Чтение настроек')
  const defaultDataRoot = paths.defaultDataRoot()
  configStore.init(paths.get().configFile)
  const config = await configStore.load(defaultDataRoot)
  paths.setDataRoot(config.settings.dataRoot || defaultDataRoot)
  await ensureDirectories()

  logger.setFile(join(paths.get().logsDir, 'launcher.log'))
  logger.info(`${APP_NAME} ${app.getVersion()} — старт`)
  logger.info(`Данные: ${paths.get().dataRoot}`)

  instances.init(paths.get().instancesDir, paths.get().sharedDir)
  profileService.init(paths.get().skinsDir)
  updates.init()
  registerIpc()

  setSplashStatus('Загрузка интерфейса')
  createMainWindow()

  launcher.onState((snapshot) => {
    if (snapshot.state === 'running' && !getMainWindow()?.isVisible()) ensureTray()
    if (snapshot.state === 'exited' && !getMainWindow()) {
      void configStore.save()
      app.quit()
    }
  })

  // Update check on boot + every hour (the first one never blocks the window).
  updates.start()

  // Warm the fingerprint cache in the background (Task 4): the first «Играть»
  // then only has to stat files instead of reading every library and asset.
  setTimeout(() => void warmIntegrityCache(), 1200)

  // Warm the Java cache in the background so the settings screen opens instantly.
  void javaService.scan([paths.get().javaDir]).catch((error: Error) => logger.warn(`Сканирование Java: ${error.message}`))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
}

/**
 * Verifies every installed instance once after start, sequentially and with a
 * delay, so it never competes with the first paint of the window. The result is
 * persisted in each instance's `.verdant-verified.json`.
 */
async function warmIntegrityCache(): Promise<void> {
  try {
    const sharedDir = paths.get().sharedDir
    const list = await instances.list()
    for (const instance of list) {
      if (!instance.installed || !instance.versionId) continue
      const report = await installer.verify(instance, sharedDir, { instanceDir: instances.gameDir(instance.id) })
      if (!report.ok) logger.warn(`Проверка «${instance.name}» при старте: проблем ${report.missing.length}`)
    }
  } catch (error) {
    logger.warn(`Фоновая проверка файлов: ${(error as Error).message}`)
  }
}

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return
  if (launcher.isRunning()) {
    logger.info('Окно закрыто — игра продолжает работать, лаунчер свёрнут в трей')
    ensureTray()
    return
  }
  void configStore.save()
  app.quit()
})

app.on('before-quit', () => {
  void configStore.save()
})
