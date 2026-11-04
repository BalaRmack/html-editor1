import type { SetupInfo, SetupProgress } from '../preload'

export type Bridge = {
  info: () => Promise<SetupInfo>
  chooseDir: () => Promise<string | null>
  install: (options: {
    installDir: string
    desktopShortcut: boolean
    startMenuShortcut: boolean
    launch?: boolean
  }) => Promise<{ ok: boolean; error?: string; dir: string }>
  uninstall: (options: { installDir: string; removeData: boolean }) => Promise<{ ok: boolean; error?: string }>
  launch: (dir: string) => Promise<boolean>
  openFolder: (dir: string) => Promise<void>
  cancel: () => Promise<void>
  minimize: () => void
  close: () => void
  onProgress: (listener: (progress: SetupProgress) => void) => () => void
}

const STAGES: Array<{ stage: SetupProgress['stage']; detail: string; weight: number }> = [
  { stage: 'preparing', detail: 'Подготовка папки установки', weight: 6 },
  { stage: 'extracting', detail: 'Распаковка файлов лаунчера', weight: 76 },
  { stage: 'shortcuts', detail: 'Создание ярлыков', weight: 10 },
  { stage: 'registry', detail: 'Запись в реестр Windows', weight: 6 },
  { stage: 'done', detail: 'Готово', weight: 2 }
]

/**
 * A browser-only stand-in for the Electron bridge. It exists so the installer
 * UI can be reviewed (and screenshotted) without packaging a Windows build —
 * the real window always talks to `preload.ts`.
 */
function demoBridge(): Bridge {
  const listeners = new Set<(progress: SetupProgress) => void>()
  const emit = (progress: SetupProgress): void => listeners.forEach((listener) => listener(progress))

  const run = async (): Promise<void> => {
    let percent = 0
    for (const phase of STAGES) {
      const steps = phase.weight
      for (let index = 0; index < steps; index++) {
        percent = Math.min(100, percent + 1)
        emit({ stage: phase.stage, percent, detail: phase.detail })
        await new Promise((resolve) => setTimeout(resolve, 32))
      }
    }
  }

  return {
    info: async () => ({
      // `?mode=uninstall` opens the removal flow in the browser preview.
      mode: new URLSearchParams(window.location.search).get('mode') === 'uninstall' ? 'uninstall' : 'install',
      version: '1.2.0',
      appName: 'Verdant Launcher',
      installDir: 'C:\\Users\\Player\\AppData\\Local\\VerdantLauncher',
      payloadBytes: 212_336_640,
      payloadFound: true,
      dev: true
    }),
    chooseDir: async () => null,
    install: async (options) => {
      await run()
      return { ok: true, dir: options.installDir }
    },
    uninstall: async () => {
      await run()
      return { ok: true }
    },
    launch: async () => true,
    openFolder: async () => undefined,
    cancel: async () => undefined,
    minimize: () => undefined,
    close: () => undefined,
    onProgress: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}

export function getBridge(): Bridge {
  const api = (window as unknown as { verdantSetup?: Bridge }).verdantSetup
  return api ?? demoBridge()
}

export function hasNativeBridge(): boolean {
  return Boolean((window as unknown as { verdantSetup?: Bridge }).verdantSetup)
}
