import { contextBridge, ipcRenderer } from 'electron'
import { EVENTS, IPC, type IpcResult, type LauncherApi } from '../shared/ipc'
import type {
  AppSettings,
  AppConfig,
  CreateInstanceInput,
  CrashInfo,
  FriendsState,
  GameSnapshot,
  InstallRunResult,
  InstalledMod,
  IntegrityReport,
  Instance,
  InstancePatch,
  JavaRuntime,
  LaunchResult,
  LoaderType,
  LoaderVersion,
  LogLine,
  ModHit,
  ModInstallInput,
  ModInstallResult,
  ModQuery,
  ModSearchResult,
  ModVersion,
  ModpackInstallInput,
  OfflineProfile,
  RecommendedInstallInput,
  RecommendedInstallResult,
  RecommendedPlan,
  SkinInfo,
  SystemInfo,
  TaskProgress,
  UpdateState,
  VersionSummary
} from '../shared/types'

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const payload = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T> | undefined
  if (!payload || typeof payload !== 'object' || !('ok' in payload)) {
    throw new Error(`Некорректный ответ IPC-канала ${channel}`)
  }
  if (!payload.ok) {
    const error = new Error(payload.error.message) as Error & { code?: string; detail?: string; file?: string }
    error.code = payload.error.code
    error.detail = payload.error.detail
    error.file = payload.error.file
    throw error
  }
  return payload.data
}

function on<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

const api: LauncherApi = {
  app: {
    info: () => invoke<SystemInfo>(IPC.app.info),
    boot: () => invoke<AppConfig>(IPC.app.boot),
    minimize: () => void invoke<void>(IPC.app.minimize),
    toggleMaximize: () => invoke<boolean>(IPC.app.toggleMaximize),
    close: () => void invoke<void>(IPC.app.close),
    isMaximized: () => invoke<boolean>(IPC.app.isMaximized),
    openExternal: (url: string) => invoke<void>(IPC.app.openExternal, url),
    openPath: (path: string) => invoke<void>(IPC.app.openPath, path),
    pickDirectory: (title?: string) => invoke<string | null>(IPC.app.pickDirectory, title),
    pickImage: () => invoke<string | null>(IPC.app.pickImage),
    readImage: (path: string) => invoke<string | null>(IPC.app.readImage, path),
    relaunch: () => void invoke<void>(IPC.app.relaunch)
  },
  profile: {
    get: () => invoke<OfflineProfile | null>(IPC.profile.get),
    setNickname: (name: string) => invoke<OfflineProfile>(IPC.profile.setNickname, name),
    setSkin: (sourcePath?: string | null) => invoke<SkinInfo>(IPC.profile.setSkin, sourcePath ?? null),
    setSkinBytes: (data: Uint8Array) => invoke<SkinInfo>(IPC.profile.setSkinBytes, data),
    readSkin: () => invoke<SkinInfo>(IPC.profile.readSkin),
    removeSkin: () => invoke<SkinInfo>(IPC.profile.removeSkin)
  },
  settings: {
    get: () => invoke<AppSettings>(IPC.settings.get),
    update: (patch: Partial<AppSettings>) => invoke<AppSettings>(IPC.settings.update, patch)
  },
  instances: {
    list: () => invoke<Instance[]>(IPC.instances.list),
    get: (id: string) => invoke<Instance>(IPC.instances.get, id),
    create: (input: CreateInstanceInput) => invoke<Instance>(IPC.instances.create, input),
    update: (id: string, patch: InstancePatch) => invoke<Instance>(IPC.instances.update, id, patch),
    remove: (id: string) => invoke<void>(IPC.instances.remove, id),
    clone: (id: string, name?: string) => invoke<Instance>(IPC.instances.clone, id, name),
    setIcon: (id: string, sourcePath: string | null) => invoke<Instance>(IPC.instances.setIcon, id, sourcePath),
    openFolder: (id: string) => invoke<void>(IPC.instances.openFolder, id),
    refresh: () => invoke<Instance[]>(IPC.instances.refresh)
  },
  versions: {
    minecraft: () => invoke<VersionSummary[]>(IPC.versions.minecraft),
    loaders: (mcVersion: string, loader: LoaderType) => invoke<LoaderVersion[]>(IPC.versions.loaders, mcVersion, loader)
  },
  install: {
    run: (instanceId: string) => invoke<InstallRunResult>(IPC.install.run, instanceId),
    verify: (instanceId: string, options?: { deep?: boolean }) =>
      invoke<IntegrityReport>(IPC.install.verify, instanceId, options),
    cancel: () => void invoke<void>(IPC.install.cancel)
  },
  game: {
    launch: (instanceId: string) => invoke<LaunchResult>(IPC.game.launch, instanceId),
    kill: () => void invoke<void>(IPC.game.kill),
    state: () => invoke<GameSnapshot>(IPC.game.state),
    onState: (listener: (snapshot: GameSnapshot) => void) => on<GameSnapshot>(EVENTS.gameChanged, listener),
    onCrash: (listener: (crash: CrashInfo) => void) => on<CrashInfo>(EVENTS.gameCrash, listener)
  },
  logs: {
    history: () => invoke<LogLine[]>(IPC.logs.history),
    clear: () => invoke<void>(IPC.logs.clear),
    openFolder: () => invoke<void>(IPC.logs.openFolder),
    onLine: (listener: (line: LogLine) => void) => on<LogLine>(EVENTS.logsLine, listener),
    onCleared: (listener: () => void) => on<null>(EVENTS.logsCleared, () => listener())
  },
  tasks: {
    onProgress: (listener: (progress: TaskProgress) => void) => on<TaskProgress>(EVENTS.tasksProgress, listener)
  },
  java: {
    scan: () => invoke<JavaRuntime[]>(IPC.java.scan),
    validate: (path: string) => invoke<JavaRuntime | null>(IPC.java.validate, path),
    download: (major: number) => invoke<JavaRuntime>(IPC.java.download, major)
  },
  feedback: {
    preview: () => invoke(IPC.feedback.preview),
    send: (input) => invoke(IPC.feedback.send, input)
  },
  content: {
    search: (input) => invoke(IPC.content.search, input),
    install: (input) => invoke(IPC.content.install, input),
    installed: (instanceId, kind) => invoke(IPC.content.installed, instanceId, kind),
    remove: (instanceId, kind, fileName) => invoke(IPC.content.remove, instanceId, kind, fileName),
    toggle: (instanceId, kind, fileName, enabled) => invoke(IPC.content.toggle, instanceId, kind, fileName, enabled),
    updates: (instanceId, kind) => invoke(IPC.content.updates, instanceId, kind),
    update: (input) => invoke(IPC.content.update, input),
    openFolder: (instanceId, kind) => invoke(IPC.content.openFolder, instanceId, kind),
    openPage: (source, kind, projectId) => invoke(IPC.content.openPage, source, kind, projectId)
  },
  mods: {
    search: (query: ModQuery) => invoke<ModSearchResult>(IPC.mods.search, query),
    project: (source: ModQuery['source'], id: string) => invoke<ModHit | null>(IPC.mods.project, source, id),
    versions: (source: ModQuery['source'], projectId: string, mcVersion: string, loader: LoaderType) =>
      invoke<ModVersion[]>(IPC.mods.versions, source, projectId, mcVersion, loader),
    packVersions: (source: ModQuery['source'], projectId: string, mcVersion?: string | null) =>
      invoke<ModVersion[]>(IPC.mods.packVersions, source, projectId, mcVersion ?? null),
    install: (input: ModInstallInput) => invoke<ModInstallResult>(IPC.mods.install, input),
    installed: (instanceId: string) => invoke<InstalledMod[]>(IPC.mods.installed, instanceId),
    remove: (instanceId: string, fileName: string) => invoke<void>(IPC.mods.remove, instanceId, fileName),
    toggle: (instanceId: string, fileName: string, enabled: boolean) =>
      invoke<void>(IPC.mods.toggle, instanceId, fileName, enabled),
    installPack: (input: ModpackInstallInput) => invoke<Instance>(IPC.mods.installPack, input),
    openFolder: (instanceId: string) => invoke<void>(IPC.mods.openFolder, instanceId),
    recommended: (mcVersion: string, loader: LoaderType) =>
      invoke<RecommendedPlan>(IPC.mods.recommended, mcVersion, loader),
    installRecommended: (input: RecommendedInstallInput) =>
      invoke<RecommendedInstallResult>(IPC.mods.installRecommended, input)
  },
  updates: {
    state: () => invoke<UpdateState>(IPC.updates.state),
    check: () => invoke<UpdateState>(IPC.updates.check),
    download: () => invoke<UpdateState>(IPC.updates.download),
    install: () => void invoke<void>(IPC.updates.install),
    defer: () => invoke<UpdateState>(IPC.updates.defer),
    skip: () => invoke<UpdateState>(IPC.updates.skip),
    resume: () => invoke<UpdateState>(IPC.updates.resume),
    onChange: (listener: (state: UpdateState) => void) => on<UpdateState>(EVENTS.updateChanged, listener)
  },
  friends: {
    state: () => invoke<FriendsState>(IPC.friends.state),
    setEnabled: (enabled: boolean) => invoke<FriendsState>(IPC.friends.setEnabled, enabled),
    sendRequest: (code: string) => invoke<FriendsState>(IPC.friends.sendRequest, code),
    accept: (id: string) => invoke<FriendsState>(IPC.friends.accept, id),
    decline: (id: string) => invoke<FriendsState>(IPC.friends.decline, id),
    cancel: (id: string) => invoke<FriendsState>(IPC.friends.cancel, id),
    remove: (id: string) => invoke<FriendsState>(IPC.friends.remove, id),
    startHosting: () => invoke<FriendsState>(IPC.friends.startHosting),
    stopHosting: () => invoke<FriendsState>(IPC.friends.stopHosting),
    join: (inviteId: string) => invoke<LaunchResult>(IPC.friends.join, inviteId),
    onChange: (listener: (state: FriendsState) => void) => on<FriendsState>(EVENTS.friendsChanged, listener)
  }
}

contextBridge.exposeInMainWorld('launcher', api)
