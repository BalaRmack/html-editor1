import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import { cp, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import {
  APP_NAME,
  defaultInstallDir,
  installLauncher,
  resolvePaths,
  uninstallLauncher,
  type InstallPhaseEvent
} from './core'

/**
 * Verdant bootstrapper.
 *
 * A tiny Electron app whose only job is to install (or remove) the launcher with
 * a window that looks like the launcher itself: frameless, dark, emerald.
 * There is no NSIS wizard, no white caption bar and no system "Next / Cancel"
 * strip — the whole UI is React + Tailwind + Framer Motion inside this window.
 */

const argv = process.argv.slice(1)
const UNINSTALL_MODE = argv.includes('--uninstall')
const SILENT = argv.includes('--silent')

/** `--wait-pid 1234` — the launcher hands us its pid and says «wait for me». */
function waitPid(): number {
  const index = argv.findIndex((arg) => arg === '--wait-pid')
  const inline = argv.find((arg) => arg.startsWith('--wait-pid='))
  const raw = index >= 0 ? argv[index + 1] : inline?.split('=')[1]
  const pid = Number(raw)
  return Number.isInteger(pid) && pid > 0 ? pid : 0
}

async function waitForExit(pid: number, timeoutMs = 30_000): Promise<void> {
  if (!pid) return
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      process.kill(pid, 0)
    } catch {
      // The launcher is gone — its exe is no longer locked.
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}
const DEV = !app.isPackaged

const VERSION = app.getVersion()
let mainWindow: BrowserWindow | null = null
let cancelled = false

/** `app.zip` sits next to the exe in a packaged build, in dist-payload in dev. */
function payloadPath(): string {
  const packaged = join(process.resourcesPath, 'app.zip')
  if (existsSync(packaged)) return packaged
  return join(process.cwd(), 'dist-payload', 'app.zip')
}

/** The exe the user actually double-clicked — it becomes the uninstaller. */
function setupExe(): string | undefined {
  const portable = process.env['PORTABLE_EXECUTABLE_FILE']
  if (portable && existsSync(portable)) return portable
  if (app.isPackaged && /\.exe$/i.test(process.execPath)) return process.execPath
  return undefined
}

function send(channel: string, payload: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(channel, payload)
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 820,
    height: 560,
    minWidth: 820,
    minHeight: 560,
    maxWidth: 820,
    maxHeight: 560,
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: '#06110c',
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: APP_NAME,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  const devUrl = process.env['VITE_DEV_SERVER_URL']
  if (devUrl) void window.loadURL(devUrl)
  else void window.loadFile(join(__dirname, 'renderer', 'index.html'))

  window.once('ready-to-show', () => window.show())
  window.on('closed', () => {
    mainWindow = null
  })
  return window
}

async function runInstall(
  options: { installDir: string; desktopShortcut: boolean; startMenuShortcut: boolean; launch?: boolean },
  emit: (event: InstallPhaseEvent) => void
): Promise<{ ok: boolean; error?: string; dir: string }> {
  cancelled = false
  try {
    await installLauncher({
      installDir: options.installDir,
      payloadZip: payloadPath(),
      version: VERSION,
      setupExe: setupExe(),
      desktopShortcut: options.desktopShortcut,
      startMenuShortcut: options.startMenuShortcut,
      onProgress: emit
    })
    if (options.launch) {
      const paths = resolvePaths(options.installDir)
      spawn(paths.exe, [], { detached: true, stdio: 'ignore', cwd: options.installDir }).unref()
    }
    return { ok: true, dir: options.installDir }
  } catch (error) {
    return { ok: false, error: (error as Error).message, dir: options.installDir }
  }
}

async function runUninstall(
  options: { installDir: string; removeData: boolean },
  emit: (event: InstallPhaseEvent) => void
): Promise<{ ok: boolean; error?: string }> {
  try {
    await uninstallLauncher({
      installDir: options.installDir,
      removeData: options.removeData,
      onProgress: emit
    })
    return { ok: true }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}

function registerIpc(): void {
  ipcMain.handle('setup:info', async () => {
    const payload = payloadPath()
    let payloadBytes = 0
    try {
      payloadBytes = (await stat(payload)).size
    } catch {
      /* the payload is missing — the install will report it */
    }
    return {
      mode: UNINSTALL_MODE ? 'uninstall' : 'install',
      version: VERSION,
      appName: APP_NAME,
      installDir: defaultInstallDir(),
      payloadBytes,
      payloadFound: existsSync(payload),
      dev: DEV
    }
  })

  ipcMain.handle('setup:choose-dir', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Куда установить Verdant Launcher',
      defaultPath: defaultInstallDir(),
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Выбрать'
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle(
    'setup:install',
    async (
      _event,
      options: { installDir?: string; desktopShortcut?: boolean; startMenuShortcut?: boolean; launch?: boolean }
    ) => {
      const installDir = options?.installDir?.trim() || defaultInstallDir()
      return runInstall(
        {
          installDir,
          desktopShortcut: options?.desktopShortcut !== false,
          startMenuShortcut: options?.startMenuShortcut !== false,
          launch: options?.launch === true
        },
        (progress) => send('setup:progress', progress)
      )
    }
  )

  ipcMain.handle('setup:uninstall', async (_event, options: { installDir?: string; removeData?: boolean }) => {
    return runUninstall(
      { installDir: options?.installDir?.trim() || defaultInstallDir(), removeData: options?.removeData === true },
      (progress) => send('setup:progress', progress)
    )
  })

  ipcMain.handle('setup:cancel', () => {
    cancelled = true
    send('setup:cancelled', {})
    app.quit()
  })

  ipcMain.handle('setup:launch', async (_event, dir?: string) => {
    const paths = resolvePaths(dir?.trim() || defaultInstallDir())
    if (!existsSync(paths.exe)) return false
    spawn(paths.exe, [], { detached: true, stdio: 'ignore', cwd: paths.dir }).unref()
    return true
  })

  ipcMain.handle('setup:open-folder', async (_event, dir?: string) => {
    const target = dir?.trim() || defaultInstallDir()
    if (existsSync(target)) await shell.openPath(target)
  })

  ipcMain.on('setup:minimize', () => mainWindow?.minimize())
  ipcMain.on('setup:close', () => app.quit())
}

async function silentRun(): Promise<void> {
  // `--silent` is how the launcher's own updater runs the new setup exe.
  try {
    await waitForExit(waitPid())
    const result = await runInstall(
      { installDir: defaultInstallDir(), desktopShortcut: true, startMenuShortcut: true, launch: true },
      () => undefined
    )
    if (!result.ok) process.exitCode = 1
  } catch {
    process.exitCode = 1
  }
  app.quit()
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.whenReady().then(async () => {
    registerIpc()
    if (SILENT) {
      await silentRun()
      return
    }
    mainWindow = createWindow()
  })

  app.on('window-all-closed', () => app.quit())
}

/** Dev helper: copy a payload built by `npm run build:payload`. */
export async function copyPayloadForDev(from: string): Promise<void> {
  await cp(from, join(process.cwd(), 'dist-payload', 'app.zip'))
}
