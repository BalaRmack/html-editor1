import { BrowserWindow, app, shell } from 'electron'
import { closeSplash } from './splash'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Icon lives next to the built main process (asar: .../resources/app.asar/build). */
export function appIconPath(): string | undefined {
  const candidates = [join(__dirname, '../../build/icon.png'), join(__dirname, '../../../build/icon.png')]
  return candidates.find((candidate) => existsSync(candidate))
}

let mainWindow: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

export function createMainWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin'
  const iconPath = appIconPath()

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    backgroundColor: '#0b0d0c',
    frame: false,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: isMac ? { x: 18, y: 20 } : undefined,
    roundedCorners: true,
    autoHideMenuBar: true,
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged || process.env['VERDANT_DEVTOOLS'] === '1'
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    // The main window painted — the splash has done its job.
    closeSplash()
    if (!app.isPackaged) mainWindow?.webContents.openDevTools({ mode: 'detach' })
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl && url.startsWith(devUrl)) return
    event.preventDefault()
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}
