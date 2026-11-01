/**
 * Shared domain types. This module is imported by the Electron main process,
 * the preload bridge and the React renderer, so it must never import `node:*`,
 * `electron` or any DOM-specific API.
 */

export type LoaderType = 'vanilla' | 'fabric' | 'quilt' | 'forge' | 'neoforge'

export const LOADER_TYPES: LoaderType[] = ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge']

export const LOADER_LABELS: Record<LoaderType, string> = {
  vanilla: 'Vanilla',
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge'
}

export type Language = 'ru' | 'en'

export interface MemorySettings {
  /** megabytes */
  min: number
  /** megabytes */
  max: number
}

export interface Instance {
  id: string
  name: string
  mcVersion: string
  loader: LoaderType
  loaderVersion: string | null
  /** resolved version id that lives in shared/versions */
  versionId: string
  /** data-url of the instance icon or null */
  icon: string | null
  createdAt: string
  lastPlayedAt: string | null
  playTimeMs: number
  memory: MemorySettings
  javaPath: string | null
  jvmArgs: string
  /** absolute path to the isolated game directory */
  gameDir: string
  modsCount: number
  installed: boolean
  notes: string
}

export interface CreateInstanceInput {
  name: string
  mcVersion: string
  loader: LoaderType
  loaderVersion?: string | null
  memory?: MemorySettings
  jvmArgs?: string
  javaPath?: string | null
  iconPath?: string | null
  /** skip automatic download of game files right after creation */
  install?: boolean
}

export type InstancePatch = Partial<
  Pick<Instance, 'name' | 'memory' | 'javaPath' | 'jvmArgs' | 'notes' | 'mcVersion' | 'loader' | 'loaderVersion'>
>

export interface OfflineProfile {
  name: string
  uuid: string
  createdAt: string
  skinPath: string | null
  skinVariant: 'classic' | 'slim'
}

export type ModSource = 'modrinth' | 'curseforge'

export type AfterLaunchAction = 'stay' | 'minimize' | 'close'

export interface AppSettings {
  language: Language
  reduceMotion: boolean
  showConsoleOnLaunch: boolean
  afterLaunch: AfterLaunchAction
  dataRoot: string
  defaultMemory: MemorySettings
  javaPath: string | null
  defaultJvmArgs: string
  modSource: ModSource
  curseForgeApiKey: string
  autoDownloadJava: boolean
  confirmOnDelete: boolean
  animations: boolean
}

export interface JavaRuntime {
  path: string
  home: string
  version: string
  major: number
  vendor: string
  arch: string
  source: 'manual' | 'registry' | 'path' | 'common' | 'launcher' | 'mojang'
}

export interface VersionSummary {
  id: string
  type: string
  releaseTime: string
}

export interface LoaderVersion {
  version: string
  stable: boolean
}

export interface SystemInfo {
  appVersion: string
  electron: string
  chrome: string
  node: string
  platform: string
  arch: string
  totalMemMB: number
  freeMemMB: number
  cpus: number
  dataRoot: string
  userData: string
  locale: string
}

export type ModSort = 'relevance' | 'downloads' | 'follows' | 'newest' | 'updated'

export interface ModQuery {
  source: ModSource
  query: string
  mcVersion?: string | null
  loader?: LoaderType | null
  category?: string | null
  sort?: ModSort
  offset?: number
  limit?: number
  projectType?: 'mod' | 'modpack'
}

export interface ModHit {
  id: string
  slug: string
  name: string
  summary: string
  author: string
  downloads: number
  follows: number
  iconUrl: string | null
  categories: string[]
  loaders: string[]
  gameVersions: string[]
  projectType: 'mod' | 'modpack'
  updatedAt: string | null
  source: ModSource
}

export interface ModSearchResult {
  hits: ModHit[]
  total: number
  offset: number
  limit: number
}

export interface ModDependency {
  projectId: string | null
  versionId: string | null
  kind: 'required' | 'optional' | 'incompatible' | 'embedded'
  name?: string
}

export interface ModVersion {
  id: string
  projectId: string
  name: string
  versionNumber: string
  gameVersions: string[]
  loaders: string[]
  datePublished: string | null
  downloadUrl: string
  fileName: string
  fileSize: number
  dependencies: ModDependency[]
}

export interface InstalledMod {
  projectId: string | null
  fileName: string
  name: string
  version: string
  iconUrl: string | null
  enabled: boolean
  source: ModSource | 'manual'
  size: number
  installedAt: string
}

export interface ModInstallInput {
  instanceId: string
  source: ModSource
  projectId: string
  projectName?: string
  projectIcon?: string | null
  versionId?: string | null
  /** recursive required-dependency install */
  withDependencies?: boolean
}

export interface ModInstallResult {
  installed: string[]
  skipped: string[]
  warnings: string[]
}

export interface ModpackInstallInput {
  source: ModSource
  projectId: string
  projectName: string
  projectIcon?: string | null
  versionId?: string | null
}

export type LogLevel = 'info' | 'warn' | 'error' | 'debug'

export interface LogLine {
  seq: number
  ts: number
  level: LogLevel
  source: 'launcher' | 'game'
  text: string
}

export type TaskStatus = 'running' | 'done' | 'error'

export interface TaskProgress {
  id: string
  label: string
  stage: string
  current: number
  total: number
  unit: 'files' | 'bytes' | 'steps'
  status: TaskStatus
  message?: string
  instanceId?: string
}

export type GameState = 'idle' | 'checking' | 'downloading' | 'starting' | 'running' | 'exited'

export interface GameSnapshot {
  state: GameState
  instanceId: string | null
  startedAt: number | null
  exitCode: number | null
  crashReportLocation: string | null
}

export interface CrashInfo {
  instanceId: string
  code: number | null
  report: string
  location: string
}

export interface AppConfig {
  profile: OfflineProfile | null
  instances: Instance[]
  selectedInstanceId: string | null
  settings: AppSettings
}

export interface InstanceCreateResult {
  instance: Instance
  installed: boolean
  error?: string
}

export interface LaunchResult {
  ok: boolean
  error?: string
  crash?: CrashInfo
}

export interface SkinInfo {
  dataUrl: string | null
  variant: 'classic' | 'slim'
  path: string | null
}

export interface DirEntryInfo {
  name: string
  path: string
}

export type ThemeAccent = 'emerald' | 'gold'
