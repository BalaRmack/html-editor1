import { contextBridge, ipcRenderer } from 'electron'
import { EVENTS, IPC, type IpcResult, type LauncherApi } from '../shared/ipc'
import type {
  AppSettings,
  AppConfig,
  CreateInstanceInput,
  CrashInfo,
  GameSnapshot,
  InstalledMod,
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
  SkinInfo,
  SystemInfo,
  TaskProgress,
  VersionSummary
} from '../shared/types'

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const payload = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T> | undefined
  if (!payload || typeof payload !== 'object' || !('ok' in payload)) {
    throw new Error(`Некорректный ответ IPC-канала ${channel}`)
  }
  if (!payload.ok) {
    const error = new Error(payload.error.message) as Error & { code?: string; detail?: string }
    error.code = payload.error.code
    error.detail = payload.error.detail
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
    run: (instanceId: string) => invoke<{ ok: boolean; error?: string }>(IPC.install.run, instanceId),
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
  mods: {
    search: (query: ModQuery) => invoke<ModSearchResult>(IPC.mods.search, query),
    project: (source: ModQuery['source'], id: string) => invoke<ModHit | null>(IPC.mods.project, source, id),
    versions: (source: ModQuery['source'], projectId: string, mcVersion: string, loader: LoaderType) =>
      invoke<ModVersion[]>(IPC.mods.versions, source, projectId, mcVersion, loader),
    install: (input: ModInstallInput) => invoke<ModInstallResult>(IPC.mods.install, input),
    installed: (instanceId: string) => invoke<InstalledMod[]>(IPC.mods.installed, instanceId),
    remove: (instanceId: string, fileName: string) => invoke<void>(IPC.mods.remove, instanceId, fileName),
    toggle: (instanceId: string, fileName: string, enabled: boolean) =>
      invoke<void>(IPC.mods.toggle, instanceId, fileName, enabled),
    installPack: (input: ModpackInstallInput) => invoke<Instance>(IPC.mods.installPack, input),
    openFolder: (instanceId: string) => invoke<void>(IPC.mods.openFolder, instanceId)
  }
}

contextBridge.exposeInMainWorld('launcher', api)
