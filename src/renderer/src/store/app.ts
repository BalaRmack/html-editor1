import { create } from 'zustand'
import { DEFAULT_SETTINGS } from '../../../shared/constants'
import type {
  AppSettings,
  CrashInfo,
  GameSnapshot,
  Instance,
  InstancePatch,
  LogLine,
  ModpackInstallInput,
  OfflineProfile,
  SkinInfo,
  SystemInfo,
  TaskProgress
} from '../../../shared/types'
import { api } from '../lib/api'
import { extractCode } from '../lib/utils'

export type Screen = 'play' | 'instances' | 'mods' | 'skins' | 'settings' | 'console'
export type CreateTab = 'versions' | 'modpacks'

export interface ToastItem {
  id: number
  kind: 'success' | 'error' | 'info' | 'warning'
  titleKey: string
  vars?: Record<string, string | number>
  errorCode?: string
  description?: string
}

interface AppStore {
  ready: boolean
  settings: AppSettings
  profile: OfflineProfile | null
  instances: Instance[]
  selectedId: string | null
  skin: SkinInfo
  systemInfo: SystemInfo | null

  screen: Screen
  logs: LogLine[]
  task: TaskProgress | null
  game: GameSnapshot
  crash: CrashInfo | null

  profileModalOpen: boolean
  createOpen: boolean
  createTab: CreateTab
  toasts: ToastItem[]

  init: () => Promise<void>
  setScreen: (screen: Screen) => void
  setSelected: (id: string | null) => void
  refreshInstances: () => Promise<Instance[]>
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>
  setNickname: (name: string) => Promise<OfflineProfile>
  uploadSkin: (path?: string) => Promise<void>
  refreshSkin: () => Promise<void>
  removeSkin: () => Promise<void>
  openProfileModal: (open: boolean) => void
  openCreate: (tab?: CreateTab) => void
  closeCreate: () => void
  setCreateTab: (tab: CreateTab) => void
  pushToast: (toast: Omit<ToastItem, 'id'>) => void
  dismissToast: (id: number) => void
  toastError: (error: unknown, titleKey?: string) => void
  createInstance: (input: Parameters<typeof api.instances.create>[0]) => Promise<Instance>
  installInstance: (id: string) => Promise<boolean>
  installModpack: (input: ModpackInstallInput) => Promise<Instance>
  launch: (id?: string) => Promise<void>
  stopGame: () => void
  removeInstance: (id: string) => Promise<void>
  cloneInstance: (id: string) => Promise<void>
  updateInstance: (id: string, patch: InstancePatch) => Promise<void>
  setInstanceIcon: (id: string) => Promise<void>
  setCrash: (crash: CrashInfo | null) => void
  clearLogs: () => Promise<void>
}

let toastSeq = 0
/** Guards the one-time bootstrap: React StrictMode mounts effects twice in dev. */
let bootstrapped = false

export const useAppStore = create<AppStore>((set, get) => ({
  ready: false,
  settings: DEFAULT_SETTINGS,
  profile: null,
  instances: [],
  selectedId: null,
  skin: { dataUrl: null, variant: 'classic', path: null },
  systemInfo: null,

  screen: 'play',
  logs: [],
  task: null,
  game: { state: 'idle', instanceId: null, startedAt: null, exitCode: null, crashReportLocation: null },
  crash: null,

  profileModalOpen: false,
  createOpen: false,
  createTab: 'versions',
  toasts: [],

  async init() {
    if (bootstrapped) return
    bootstrapped = true
    try {
      const [config, info, history, skin] = await Promise.all([
        api.app.boot(),
        api.app.info().catch(() => null),
        api.logs.history().catch(() => []),
        api.profile.readSkin().catch(() => ({ dataUrl: null, variant: 'classic' as const, path: null }))
      ])
      const selected = config.selectedInstanceId && config.instances.some((i) => i.id === config.selectedInstanceId)
        ? config.selectedInstanceId
        : config.instances[0]?.id ?? null
      set({
        settings: config.settings,
        profile: config.profile,
        instances: config.instances,
        selectedId: selected,
        systemInfo: info,
        logs: history,
        skin,
        ready: true
      })
    } catch (error) {
      set({ ready: true })
      get().toastError(error)
    }

    // A line can arrive both in the history snapshot and on the live channel
    // (the push is broadcast while `logs:history` is in flight) — de-dupe by seq.
    api.logs.onLine((line) =>
      set((state) => {
        if (state.logs.some((item) => item.seq === line.seq)) return state
        return { logs: [...state.logs.slice(-1999), line] }
      })
    )
    api.logs.onCleared(() => set({ logs: [] }))
    api.tasks.onProgress((task) => {
      set({ task })
      if (task.status === 'done') {
        window.setTimeout(() => {
          if (get().task?.id === task.id) set({ task: null })
        }, 2600)
      }
    })
    api.game.onState((game) => {
      set({ game })
      if (game.state === 'exited') {
        void get().refreshInstances()
      }
    })
    api.game.onCrash((crash) => set({ crash }))
  },

  setScreen: (screen) => set({ screen }),
  setSelected: (id) => set({ selectedId: id }),

  async refreshInstances() {
    const list = await api.instances.list().catch(() => [])
    const current = get().selectedId
    const stillExists = current && list.some((instance) => instance.id === current)
    set({ instances: list, selectedId: stillExists ? current : list[0]?.id ?? null })
    return list
  },

  async updateSettings(patch) {
    const next = await api.settings.update(patch).catch((error) => {
      get().toastError(error)
      return get().settings
    })
    set({ settings: next })
  },

  async setNickname(name) {
    const profile = await api.profile.setNickname(name)
    set({ profile })
    await get().refreshSkin()
    get().pushToast({ kind: 'success', titleKey: 'toast.nicknameSaved', vars: { name: profile.name } })
    return profile
  },

  async uploadSkin(path) {
    const skin = await api.profile.setSkin(path ?? null).catch((error) => {
      get().toastError(error)
      return null
    })
    if (skin) {
      set({ skin })
      get().pushToast({ kind: 'success', titleKey: 'toast.skinSaved' })
    }
  },

  async refreshSkin() {
    const skin = await api.profile.readSkin().catch(() => ({ dataUrl: null, variant: 'classic' as const, path: null }))
    set({ skin })
  },

  async removeSkin() {
    const skin = await api.profile.removeSkin()
    set({ skin })
  },

  openProfileModal: (open) => set({ profileModalOpen: open }),
  openCreate: (tab) => set({ createOpen: true, createTab: tab ?? 'versions' }),
  closeCreate: () => set({ createOpen: false }),
  setCreateTab: (tab) => set({ createTab: tab }),

  pushToast: (toast) => {
    const id = ++toastSeq
    set((state) => ({ toasts: [...state.toasts.slice(-3), { ...toast, id }] }))
    window.setTimeout(() => {
      if (get().toasts.some((item) => item.id === id)) get().dismissToast(id)
    }, toast.kind === 'error' ? 8000 : 4200)
  },

  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),

  toastError: (error, titleKey = 'toast.error') => {
    get().pushToast({ kind: 'error', titleKey, errorCode: extractCode(error) })
  },

  async createInstance(input) {
    const instance = await api.instances.create(input)
    await get().refreshInstances()
    set({ selectedId: instance.id })
    return instance
  },

  async installModpack(input) {
    const instance = await api.mods.installPack(input)
    await get().refreshInstances()
    set({ selectedId: instance.id })
    return instance
  },

  async installInstance(id) {
    const result = await api.install.run(id).catch((error) => ({ ok: false, error: extractCode(error) }))
    await get().refreshInstances()
    if (result.ok) {
      get().pushToast({ kind: 'success', titleKey: 'toast.installDone' })
      return true
    }
    if (result.error && result.error !== 'cancelled') {
      get().pushToast({ kind: 'error', titleKey: 'toast.error', errorCode: result.error })
    }
    return false
  },

  async launch(id) {
    const state = get()
    if (state.game.state === 'running' || state.game.state === 'starting') return
    const target = id ?? state.selectedId ?? state.instances[0]?.id
    if (!target) {
      state.openCreate()
      return
    }
    if (!state.profile) {
      state.openProfileModal(true)
      return
    }
    if (target !== state.selectedId) set({ selectedId: target })
    try {
      await api.game.launch(target)
      const settings = get().settings
      if (settings.showConsoleOnLaunch) set({ screen: 'console' })
    } catch (error) {
      get().toastError(error, 'toast.launchError')
    }
  },

  stopGame: () => {
    api.game.kill()
  },

  async removeInstance(id) {
    await api.instances.remove(id)
    await get().refreshInstances()
    get().pushToast({ kind: 'info', titleKey: 'toast.instanceDeleted' })
  },

  async cloneInstance(id) {
    const copy = await api.instances.clone(id)
    await get().refreshInstances()
    set({ selectedId: copy.id })
    get().pushToast({ kind: 'success', titleKey: 'toast.cloned' })
  },

  async updateInstance(id, patch) {
    const updated = await api.instances.update(id, patch)
    await get().refreshInstances()
    get().pushToast({ kind: 'success', titleKey: 'toast.instanceUpdated', vars: { name: updated.name } })
  },

  async setInstanceIcon(id) {
    const path = await api.app.pickImage()
    if (!path) return
    await api.instances.setIcon(id, path).catch((error) => get().toastError(error))
    await get().refreshInstances()
  },

  setCrash: (crash) => set({ crash }),

  async clearLogs() {
    await api.logs.clear()
    set({ logs: [] })
  }
}))
