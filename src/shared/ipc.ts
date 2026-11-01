import type {
  AppSettings,
  AppConfig,
  CreateInstanceInput,
  GameSnapshot,
  ContentInstallInput,
  ContentKind,
  ContentQuery,
  ContentSearchResult,
  ContentUpdate,
  ContentUpdateInput,
  InstalledMod,
  InstallRunResult,
  Instance,
  InstancePatch,
  IntegrityReport,
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
  UpdateState,
  VersionSummary,
  CrashInfo
} from './types'

/** Every IPC channel used by the app. Keeping them in one place prevents typos. */
export const IPC = {
  app: {
    info: 'app:info',
    boot: 'app:boot',
    minimize: 'app:minimize',
    toggleMaximize: 'app:toggle-maximize',
    close: 'app:close',
    isMaximized: 'app:is-maximized',
    openExternal: 'app:open-external',
    openPath: 'app:open-path',
    pickDirectory: 'app:pick-directory',
    pickImage: 'app:pick-image',
    readImage: 'app:read-image',
    relaunch: 'app:relaunch'
  },
  profile: {
    get: 'profile:get',
    setNickname: 'profile:set-nickname',
    setSkin: 'profile:set-skin',
    setSkinBytes: 'profile:set-skin-bytes',
    readSkin: 'profile:read-skin',
    removeSkin: 'profile:remove-skin'
  },
  settings: {
    get: 'settings:get',
    update: 'settings:update'
  },
  instances: {
    list: 'instances:list',
    get: 'instances:get',
    create: 'instances:create',
    update: 'instances:update',
    remove: 'instances:remove',
    clone: 'instances:clone',
    setIcon: 'instances:set-icon',
    openFolder: 'instances:open-folder',
    refresh: 'instances:refresh'
  },
  versions: {
    minecraft: 'versions:minecraft',
    loaders: 'versions:loaders'
  },
  install: {
    run: 'install:run',
    verify: 'install:verify',
    cancel: 'install:cancel'
  },
  game: {
    launch: 'game:launch',
    kill: 'game:kill',
    state: 'game:state'
  },
  logs: {
    history: 'logs:history',
    clear: 'logs:clear',
    openFolder: 'logs:open-folder'
  },
  java: {
    scan: 'java:scan',
    validate: 'java:validate',
    download: 'java:download'
  },
  content: {
    search: 'content:search',
    install: 'content:install',
    installed: 'content:installed',
    remove: 'content:remove',
    toggle: 'content:toggle',
    updates: 'content:updates',
    update: 'content:update',
    openFolder: 'content:open-folder',
    openPage: 'content:open-page'
  },
  mods: {
    search: 'mods:search',
    project: 'mods:project',
    versions: 'mods:versions',
    packVersions: 'mods:pack-versions',
    install: 'mods:install',
    installed: 'mods:installed',
    remove: 'mods:remove',
    toggle: 'mods:toggle',
    installPack: 'mods:install-pack',
    openFolder: 'mods:open-folder'
  },
  updates: {
    state: 'updates:state',
    check: 'updates:check',
    download: 'updates:download',
    install: 'updates:install',
    defer: 'updates:defer',
    skip: 'updates:skip',
    resume: 'updates:resume'
  }
} as const

/** Push channels (main -> renderer). */
export const EVENTS = {
  logsLine: 'logs:line',
  logsCleared: 'logs:cleared',
  tasksProgress: 'tasks:progress',
  gameChanged: 'game:changed',
  gameCrash: 'game:crash',
  updateChanged: 'updates:changed'
} as const

export interface IpcError {
  code: string
  message: string
  detail?: string
  /** File that failed to download, used by the retry UI. */
  file?: string
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError }

type Unsubscribe = () => void

/**
 * The single API surface exposed to the renderer through `contextBridge`.
 * No generic `invoke` is exposed — only these fixed, validated methods.
 */
export interface LauncherApi {
  app: {
    info(): Promise<SystemInfo>
    boot(): Promise<AppConfig>
    minimize(): void
    toggleMaximize(): Promise<boolean>
    close(): void
    isMaximized(): Promise<boolean>
    openExternal(url: string): Promise<void>
    openPath(path: string): Promise<void>
    pickDirectory(title?: string): Promise<string | null>
    pickImage(): Promise<string | null>
    /** Reads a PNG that was just chosen through pickImage(), as a data-url. */
    readImage(path: string): Promise<string | null>
    relaunch(): void
  }
  profile: {
    get(): Promise<OfflineProfile | null>
    setNickname(name: string): Promise<OfflineProfile>
    setSkin(sourcePath?: string | null): Promise<SkinInfo>
    setSkinBytes(data: Uint8Array): Promise<SkinInfo>
    readSkin(): Promise<SkinInfo>
    removeSkin(): Promise<SkinInfo>
  }
  settings: {
    get(): Promise<AppSettings>
    update(patch: Partial<AppSettings>): Promise<AppSettings>
  }
  instances: {
    list(): Promise<Instance[]>
    get(id: string): Promise<Instance>
    create(input: CreateInstanceInput): Promise<Instance>
    update(id: string, patch: InstancePatch): Promise<Instance>
    remove(id: string): Promise<void>
    clone(id: string, name?: string): Promise<Instance>
    setIcon(id: string, sourcePath: string | null): Promise<Instance>
    openFolder(id: string): Promise<void>
    refresh(): Promise<Instance[]>
  }
  versions: {
    minecraft(): Promise<VersionSummary[]>
    loaders(mcVersion: string, loader: LoaderType): Promise<LoaderVersion[]>
  }
  install: {
    /** Downloads everything the instance needs and verifies it afterwards. */
    run(instanceId: string): Promise<InstallRunResult>
    /** Read-only integrity check; never downloads anything. */
    verify(instanceId: string, options?: { deep?: boolean }): Promise<IntegrityReport>
    cancel(): void
  }
  game: {
    launch(instanceId: string): Promise<LaunchResult>
    kill(): void
    state(): Promise<GameSnapshot>
    onState(listener: (snapshot: GameSnapshot) => void): Unsubscribe
    onCrash(listener: (crash: CrashInfo) => void): Unsubscribe
  }
  logs: {
    history(): Promise<LogLine[]>
    clear(): Promise<void>
    openFolder(): Promise<void>
    onLine(listener: (line: LogLine) => void): Unsubscribe
    onCleared(listener: () => void): Unsubscribe
  }
  tasks: {
    onProgress(listener: (progress: TaskProgress) => void): Unsubscribe
  }
  java: {
    scan(): Promise<JavaRuntime[]>
    validate(path: string): Promise<JavaRuntime | null>
    download(major: number): Promise<JavaRuntime>
  }
  content: {
    search(input: ContentQuery): Promise<ContentSearchResult>
    install(input: ContentInstallInput): Promise<ModInstallResult>
    installed(instanceId: string, kind: ContentKind): Promise<InstalledMod[]>
    remove(instanceId: string, kind: ContentKind, fileName: string): Promise<void>
    toggle(instanceId: string, kind: ContentKind, fileName: string, enabled: boolean): Promise<void>
    updates(instanceId: string, kind: ContentKind): Promise<ContentUpdate[]>
    update(input: ContentUpdateInput): Promise<void>
    openFolder(instanceId: string, kind: ContentKind): Promise<void>
    openPage(source: ModQuery['source'], kind: ContentKind, projectId: string): Promise<void>
  }
  mods: {
    search(query: ModQuery): Promise<ModSearchResult>
    project(source: ModQuery['source'], id: string): Promise<ModHit | null>
    versions(source: ModQuery['source'], projectId: string, mcVersion: string, loader: LoaderType): Promise<ModVersion[]>
    /** Versions of a modpack before an instance exists (no loader filter). */
    packVersions(source: ModQuery['source'], projectId: string, mcVersion?: string | null): Promise<ModVersion[]>
    install(input: ModInstallInput): Promise<ModInstallResult>
    installed(instanceId: string): Promise<InstalledMod[]>
    remove(instanceId: string, fileName: string): Promise<void>
    toggle(instanceId: string, fileName: string, enabled: boolean): Promise<void>
    installPack(input: ModpackInstallInput): Promise<Instance>
    openFolder(instanceId: string): Promise<void>
  }
  updates: {
    state(): Promise<UpdateState>
    check(): Promise<UpdateState>
    /** Starts the download and resolves once it finished (progress is pushed). */
    download(): Promise<UpdateState>
    /** Quits the app and installs the already-downloaded update. */
    install(): void
    /** «Отложить» — hide the banner until the next launch. */
    defer(): Promise<UpdateState>
    /** «Не скачивать эту версию» — persisted across launches. */
    skip(): Promise<UpdateState>
    resume(): Promise<UpdateState>
    onChange(listener: (state: UpdateState) => void): Unsubscribe
  }
}
