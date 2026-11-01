import { Menu, Tray, app, nativeImage } from 'electron'
import { createMainWindow, appIconPath, getMainWindow } from './window'

let tray: Tray | null = null

export function showWindow(): void {
  const win = getMainWindow() ?? createMainWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  destroyTray()
}

export function ensureTray(): void {
  if (tray) return
  const iconPath = appIconPath()
  if (!iconPath) return
  const image = nativeImage.createFromPath(iconPath)
  if (image.isEmpty()) return
  try {
    tray = new Tray(image.resize({ width: 18, height: 18 }))
  } catch {
    return
  }
  tray.setToolTip('Verdant Launcher — игра запущена')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Открыть лаунчер', click: showWindow },
      { type: 'separator' },
      {
        label: 'Выход',
        click: () => {
          destroyTray()
          app.quit()
        }
      }
    ])
  )
  tray.on('click', showWindow)
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
