import type { LauncherApi } from '../../../shared/ipc'
import { createMockApi } from './mock'

declare global {
  interface Window {
    launcher?: LauncherApi
  }
}

/** In the packaged app the preload bridge is always present. */
export const isDesktop = typeof window !== 'undefined' && Boolean(window.launcher)

export const api: LauncherApi = window.launcher ?? createMockApi()
