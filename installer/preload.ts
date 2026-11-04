import { contextBridge, ipcRenderer } from 'electron'

/**
 * Whitelisted bridge only — the bootstrapper window has no `nodeIntegration`
 * and no generic `invoke`, same rule as the launcher itself.
 */
export interface SetupProgress {
  stage: 'preparing' | 'extracting' | 'shortcuts' | 'registry' | 'done'
  percent: number
  detail?: string
}

export interface SetupInfo {
  mode: 'install' | 'uninstall'
  version: string
  appName: string
  installDir: string
  payloadBytes: number
  payloadFound: boolean
  dev: boolean
}

const api = {
  info: (): Promise<SetupInfo> => ipcRenderer.invoke('setup:info'),
  chooseDir: (): Promise<string | null> => ipcRenderer.invoke('setup:choose-dir'),
  install: (options: {
    installDir: string
    desktopShortcut: boolean
    startMenuShortcut: boolean
    launch?: boolean
  }): Promise<{ ok: boolean; error?: string; dir: string }> => ipcRenderer.invoke('setup:install', options),
  uninstall: (options: { installDir: string; removeData: boolean }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('setup:uninstall', options),
  launch: (dir: string): Promise<boolean> => ipcRenderer.invoke('setup:launch', dir),
  openFolder: (dir: string): Promise<void> => ipcRenderer.invoke('setup:open-folder', dir),
  cancel: (): Promise<void> => ipcRenderer.invoke('setup:cancel'),
  minimize: (): void => ipcRenderer.send('setup:minimize'),
  close: (): void => ipcRenderer.send('setup:close'),
  onProgress: (listener: (progress: SetupProgress) => void): (() => void) => {
    const handler = (_event: unknown, payload: SetupProgress): void => listener(payload)
    ipcRenderer.on('setup:progress', handler)
    return () => ipcRenderer.removeListener('setup:progress', handler)
  }
}

contextBridge.exposeInMainWorld('verdantSetup', api)

export type VerdantSetupApi = typeof api
