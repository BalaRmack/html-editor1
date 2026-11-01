import { create } from 'zustand'
import { DEFAULT_SETTINGS } from '../../../shared/constants'
import type {
  AppSettings,
  CrashInfo,
  GameSnapshot,
  InstallRunResult,
  FeedbackKind,
  Instance,
  InstancePatch,
  IntegrityReport,
  LogLine,
  ModpackInstallInput,
  OfflineProfile,
  SkinInfo,
  SystemInfo,
  TaskProgress,
  UpdateState
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
  /** Optional retry affordance rendered inside the toast. */
  action?: { labelKey: string; icon?: 'retry' | 'open'; run: () => void }
  /** Error toasts with an action stay until the user closes them. */
  sticky?: boolean
}

/**
 * Per-instance download state. `missing` means "nothing on disk yet, offer
 * install"; `error` means "files are absent/corrupted, «Играть» must be locked".
 */
export type IntegrityState =
  | { status: 'unknown' }
  | { status: 'checking' }
  | { status: 'ok'; report: IntegrityReport }
  | { status: 'missing'; report?: IntegrityReport }
  | { status: 'error'; code: string; message?: string; file?: string; report?: IntegrityReport }

/** Settings sections that other screens can deep-link into. */
export type SettingsTab = 'general' | 'java' | 'memory' | 'jvm' | 'mods' | 'about'

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

  integrity: Record<string, IntegrityState>
  /** Launcher self-update state pushed from the main process. */
  update: UpdateState | null

  profileModalOpen: boolean
  createOpen: boolean
  createTab: CreateTab
  toasts: ToastItem[]

  init: () => Promise<void>
  setScreen: (screen: Screen) => void
  /** Which settings tab to open; screens deep-link here (e.g. CurseForge key). */
  settingsTab: SettingsTab
  openSettings: (tab?: SettingsTab) => void
  /** Open feedback modal for a kind; `null` closes it. */
  feedbackKind: FeedbackKind | null
  openFeedback: (kind: FeedbackKind) => void
  closeFeedback: () => void
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
  checkForUpdates: () => Promise<void>
  downloadUpdate: () => Promise<void>
  installUpdate: () => void
  deferUpdate: () => Promise<void>
  skipUpdate: () => Promise<void>
  pushToast: (toast: Omit<ToastItem, 'id'>) => void
  dismissToast: (id: number) => void
  toastError: (error: unknown, titleKey?: string) => void
  createInstance: (input: Parameters<typeof api.instances.create>[0]) => Promise<Instance>
  installInstance: (id: string) => Promise<boolean>
  retryInstall: (id: string) => Promise<boolean>
  checkIntegrity: (id: string, options?: { silent?: boolean }) => Promise<IntegrityState>
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
  settingsTab: 'general',
  feedbackKind: null,
  logs: [],
  task: null,
  game: { state: 'idle', instanceId: null, startedAt: null, exitCode: null, crashReportLocation: null },
  crash: null,

  integrity: {},
  update: null,

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

    // Self-update: pull the current state and follow every push.
    void api.updates
      .state()
      .then((update) => set({ update }))
      .catch(() => undefined)
    api.updates.onChange((update) => set({ update }))

    // Prove the files are really on disk before the UI offers «Играть».
    // Selected instance first, the rest in the background so boot stays instant.
    const state = get()
    const ordered = [
      ...(state.selectedId ? [state.selectedId] : []),
      ...state.instances.map((item) => item.id).filter((id) => id !== state.selectedId)
    ]
    void (async () => {
      for (const id of ordered) {
        await get().checkIntegrity(id, { silent: true })
      }
    })()
  },

  setScreen: (screen) => set({ screen }),
  openSettings: (tab) => set({ screen: 'settings', settingsTab: tab ?? 'general' }),
  openFeedback: (kind) => set({ feedbackKind: kind }),
  closeFeedback: () => set({ feedbackKind: null }),
  setSelected: (id) => set({ selectedId: id }),

  async refreshInstances() {
    const list = await api.instances.list().catch(() => [])
    const current = get().selectedId
    const stillExists = current && list.some((instance) => instance.id === current)
    set((state) => {
      const known = new Set(list.map((instance) => instance.id))
      const integrity = Object.fromEntries(Object.entries(state.integrity).filter(([id]) => known.has(id)))
      return { instances: list, selectedId: stillExists ? current : list[0]?.id ?? null, integrity }
    })
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

  async checkForUpdates() {
    const update = await api.updates.check().catch((error) => {
      get().toastError(error, 'update.error')
      return null
    })
    if (update) set({ update })
  },

  async downloadUpdate() {
    const update = await api.updates.download().catch((error) => {
      get().toastError(error, 'update.error')
      return null
    })
    if (update) set({ update })
  },

  installUpdate() {
    api.updates.install()
  },

  async deferUpdate() {
    set({ update: await api.updates.defer() })
  },

  async skipUpdate() {
    set({ update: await api.updates.skip() })
    get().pushToast({ kind: 'info', titleKey: 'update.skipped' })
  },

  pushToast: (toast) => {
    const id = ++toastSeq
    set((state) => ({ toasts: [...state.toasts.slice(-3), { ...toast, id }] }))
    // Errors that carry a retry action wait for the user — disappearing on their
    // own is exactly how a failed download used to go unnoticed.
    if (toast.sticky) return
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

  async checkIntegrity(id, options = {}) {
    const instance = get().instances.find((item) => item.id === id)
    if (!instance) return { status: 'unknown' as const }
    if (!options.silent) set((state) => ({ integrity: { ...state.integrity, [id]: { status: 'checking' } } }))

    let report: IntegrityReport
    try {
      report = await api.install.verify(id)
    } catch (error) {
      const state: IntegrityState = {
        status: 'error',
        code: extractCode(error),
        message: (error as Error).message,
        file: (error as { file?: string }).file
      }
      set((prev) => ({ integrity: { ...prev.integrity, [id]: state } }))
      return state
    }

    const state: IntegrityState = report.ok
      ? { status: 'ok', report }
      : report.code === 'not_installed'
        ? { status: 'missing', report }
        : {
            status: 'error',
            code: report.code ?? 'integrity_failed',
            message: report.error,
            file: report.missing[0]?.name,
            report
          }
    set((prev) => ({ integrity: { ...prev.integrity, [id]: state } }))
    return state
  },

  async retryInstall(id) {
    return get().installInstance(id)
  },

  async installInstance(id) {
    const instance = get().instances.find((item) => item.id === id)
    if (instance) {
      set((prev) => ({ integrity: { ...prev.integrity, [id]: { status: 'checking' } } }))
    }

    const result = await api.install
      .run(id)
      .catch((error) => ({ ok: false, code: extractCode(error), message: (error as Error).message }) as InstallRunResult)
    const list = await get().refreshInstances()

    if (result.ok) {
      const report = result.report ?? (await api.install.verify(id).catch(() => null))
      const state: IntegrityState = report
        ? report.ok
          ? { status: 'ok', report }
          : { status: 'error', code: report.code ?? 'integrity_failed', message: report.error, report }
        : { status: 'ok', report: undefined as never }
      set((prev) => ({ integrity: { ...prev.integrity, [id]: state } }))
      get().pushToast({ kind: 'success', titleKey: 'toast.installDone' })
      return true
    }

    if (result.code === 'cancelled') {
      set((prev) => ({ integrity: { ...prev.integrity, [id]: { status: 'unknown' } } }))
      get().pushToast({ kind: 'info', titleKey: 'toast.installCancelled' })
      return false
    }

    const code = result.code ?? 'install_failed'
    const state: IntegrityState = {
      status: 'error',
      code,
      message: result.message,
      file: result.file,
      report: result.report
    }
    set((prev) => ({ integrity: { ...prev.integrity, [id]: state } }))

    void list
    get().pushToast({
      kind: 'error',
      titleKey: code === 'network_error' ? 'toast.downloadFailed' : 'toast.installFailed',
      errorCode: code,
      vars: result.file ? { file: result.file } : undefined,
      description: result.message,
      sticky: true,
      // A network drop is resumable: the button continues the install from the
      // bytes already on disk instead of starting from zero.
      action: { labelKey: code === 'network_error' ? 'common.resume' : 'common.retry', icon: 'retry', run: () => void get().retryInstall(id) }
    })
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

    // Hard gate: never spawn the client on unverified files. A failed install
    // leaves the instance at `status: 'error'`, and pressing «Играть» right after
    // (the bug from launcher.log) must explain itself instead of launching.
    const known = get().integrity[target]
    if (!known || known.status !== 'ok') {
      const current = known && known.status !== 'checking' ? known : await get().checkIntegrity(target)
      if (current.status !== 'ok') {
        const code = current.status === 'error' ? current.code : 'not_installed'
        get().pushToast({
          kind: 'error',
          titleKey: 'toast.notReady',
          errorCode: code,
          description: current.status === 'error' ? current.message : undefined,
          sticky: true,
          action: { labelKey: 'common.retry', icon: 'retry', run: () => void get().retryInstall(target) }
        })
        return
      }
    }

    try {
      await api.game.launch(target)
      const settings = get().settings
      if (settings.showConsoleOnLaunch) set({ screen: 'console' })
    } catch (error) {
      const code = extractCode(error)
      const file = (error as { file?: string }).file
      if (code === 'network_error' || code === 'integrity_failed' || code === 'not_installed') {
        set((prev) => ({
          integrity: {
            ...prev.integrity,
            [target]: { status: 'error', code, message: (error as Error).message, file }
          }
        }))
        get().pushToast({
          kind: 'error',
          titleKey: 'toast.downloadFailed',
          errorCode: code,
          vars: file ? { file } : undefined,
          sticky: true,
          action: { labelKey: 'common.retry', icon: 'retry', run: () => void get().retryInstall(target) }
        })
      } else {
        get().toastError(error, 'toast.launchError')
      }
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
