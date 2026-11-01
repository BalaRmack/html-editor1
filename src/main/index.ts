import { BrowserWindow, Menu, app, session } from 'electron'
import { join } from 'node:path'
import { APP_ID, APP_NAME } from '../shared/constants'
import { ensureDirectories, registerIpc } from './ipc'
import { configStore } from './services/config-store'
import { instances } from './services/instances'
import { javaService } from './services/java'
import { launcher } from './services/launch'
import { logger } from './services/logger'
import { paths } from './services/paths'
import { profileService } from './services/profile'
import { updates } from './services/updater'
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

  Menu.setApplicationMenu(null)
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })

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

  // Warm the Java cache in the background so the settings screen opens instantly.
  void javaService.scan([paths.get().javaDir]).catch((error: Error) => logger.warn(`Сканирование Java: ${error.message}`))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
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
