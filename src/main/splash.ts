import { BrowserWindow, app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Startup splash (Task 4).
 *
 * Electron needs a moment for the renderer bundle, the config store and the
 * Java scan before the main window can paint. Instead of showing an empty dark
 * rectangle we show this small frameless card immediately, then hand over to
 * the main window on `ready-to-show`.
 *
 * The page is a plain HTML file with inline CSS — no React, no JS bundle — so it
 * paints on the first frame even on a cold start.
 */

let splash: BrowserWindow | null = null
let shownAt = 0

/** The splash must not flicker: keep it on screen for at least this long. */
const MIN_VISIBLE_MS = 550
/** Safety net if the renderer never reports `ready-to-show`. */
const HARD_TIMEOUT_MS = 15_000

function splashPath(): string | null {
  const candidates = [
    join(__dirname, '../renderer/splash.html'),
    join(process.cwd(), 'src/renderer/splash.html')
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

export function createSplash(): void {
  if (splash) return
  const file = splashPath()
  if (!file) return

  splash = new BrowserWindow({
    width: 420,
    height: 236,
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    center: true,
    transparent: false,
    backgroundColor: '#0b0d0c',
    title: app.getName(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: false
    }
  })

  splash.once('ready-to-show', () => {
    if (!splash) return
    shownAt = Date.now()
    splash.show()
    splash.focus()
  })

  splash.on('closed', () => {
    splash = null
  })

  void splash.loadFile(file)

  // Never leave the user staring at a splash if the window fails to appear.
  setTimeout(() => closeSplash(), HARD_TIMEOUT_MS)
}

/** Updates the caption under the progress bar (best effort, never throws). */
export function setSplashStatus(text: string): void {
  if (!splash || splash.isDestroyed()) return
  const payload = JSON.stringify(text)
  void splash.webContents
    .executeJavaScript(`(() => { const el = document.getElementById('status'); if (el) el.textContent = ${payload} })()`)
    .catch(() => undefined)
}

/** Closes the splash once the main window is ready to paint. */
export function closeSplash(): void {
  if (!splash || splash.isDestroyed()) {
    splash = null
    return
  }
  const remaining = shownAt > 0 ? MIN_VISIBLE_MS - (Date.now() - shownAt) : 0
  const finish = (): void => {
    if (splash && !splash.isDestroyed()) splash.destroy()
    splash = null
  }
  if (remaining > 0) setTimeout(finish, remaining)
  else finish()
}

export function isSplashOpen(): boolean {
  return Boolean(splash && !splash.isDestroyed())
}
