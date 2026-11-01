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
  /** Сюда уходят отчёты об ошибках и предложения (Discord/Slack/вебхук). */
  feedbackWebhook: string
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
  projectType?: 'mod' | 'modpack' | 'resourcepack' | 'shader'
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
  projectType: 'mod' | 'modpack' | 'resourcepack' | 'shader'
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
  /** SHA-1 of the primary file — how we prove a build is really newer. */
  sha1: string | null
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
  /** Version id on the source (`null` for hand-dropped jars). */
  versionId: string | null
  /** SHA-1 of the installed file, used for the update check. */
  sha1: string | null
  /** Author shown in the content-manager table. */
  author: string | null
}

/** Everything the instance «Настроить» window can manage. */
export type ContentKind = 'mod' | 'resourcepack' | 'shader'

export interface ContentQuery {
  instanceId: string
  kind: ContentKind
  query: string
  offset?: number
  limit?: number
}

export interface ContentSearchResult extends ModSearchResult {
  /** The filters the main process applied — shown as a badge in the window. */
  mcVersion: string
  loader: LoaderType
  kind: ContentKind
}

export interface ContentInstallInput {
  instanceId: string
  kind: ContentKind
  source: ModSource
  projectId: string
  projectName?: string
  projectIcon?: string | null
  versionId?: string | null
}

export interface ContentUpdate {
  kind: ContentKind
  projectId: string
  fileName: string
  name: string
  iconUrl: string | null
  currentVersion: string
  latestVersion: string
  versionId: string
  sha1: string | null
  publishedAt: string | null
}

export interface ContentUpdateInput {
  instanceId: string
  kind: ContentKind
  projectId: string
  versionId?: string | null
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
  /** Machine-readable stage id so the renderer can localise it. */
  stageKey?: string
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

/* ---------------------------------------------------------------- integrity */

export type IntegrityIssueKind = 'version' | 'client' | 'library' | 'asset' | 'assetIndex'

/** One file that is missing or has the wrong size/hash. */
export interface IntegrityIssue {
  kind: IntegrityIssueKind
  /** Short file name shown in the UI, e.g. `sodium-fabric.jar`. */
  name: string
  /** Absolute path on disk. */
  path: string
  expectedSize?: number
  actualSize?: number
  hash?: string
}

/** Result of the post-download integrity check that gates the «Играть» button. */
export interface IntegrityReport {
  ok: boolean
  instanceId: string
  versionId: string
  checkedAt: string
  code?: string
  error?: string
  missing: IntegrityIssue[]
  /** Issues above the reporting cap are counted but not listed. */
  truncatedIssues: number
  counts: {
    libraries: number
    assets: number
    checked: number
    /** Files that had to be read and hashed (Task 4: everything else is stat-only). */
    hashed?: number
    /** Files accepted from size + mtime alone. */
    skipped?: number
  }
  durationMs: number
}

/**
 * Outcome of `install.run`. Failures are structured so the renderer can show
 * «Ошибка сети. Не удалось скачать файл X» and offer a meaningful retry.
 */
export interface InstallRunResult {
  ok: boolean
  code?: string
  message?: string
  /** File that was being downloaded when the install died. */
  file?: string
  /** Stage key the failure happened in (`version` / `loader` / `libraries`). */
  stage?: string
  retryable?: boolean
  /** Integrity report — present when the download finished but the files are bad. */
  report?: IntegrityReport
}

export interface LaunchResult {
  ok: boolean
  /** Machine-readable failure code (`network_error`, `integrity_failed`, …). */
  error?: string
  /** File that failed to download, when the launch died on a download. */
  file?: string
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

/* ---------------------------------------------------------------- updates */

export type UpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'up-to-date' | 'error'

export interface UpdateRelease {
  /** Normalised version without the leading `v`, e.g. `1.2.0`. */
  version: string
  tag: string
  name: string
  notes: string
  publishedAt: string | null
  htmlUrl: string
  assetName: string | null
  assetUrl: string | null
  sizeBytes: number
}

export interface UpdateProgress {
  /** 0…100 */
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

export interface UpdateState {
  phase: UpdatePhase
  currentVersion: string
  release: UpdateRelease | null
  progress: UpdateProgress | null
  error?: string
  checkedAt: string | null
  /** Version the user asked never to be offered again. */
  skippedVersion: string | null
}

/* ------------------------------------------------------------------ feedback */

export type FeedbackKind = 'bug' | 'suggestion'

/** Everything we collect automatically — shown to the user before sending. */
export interface FeedbackSystemInfo {
  os: string
  arch: string
  appVersion: string
  electron: string
  /** First usable Java runtime, e.g. `Java 21 · C:\Program Files\…\javaw.exe`. */
  java: string | null
  totalMemMB: number
  locale: string
  /** Selected instance, when the launcher knows one. */
  instance: string | null
}

export interface FeedbackInput {
  kind: FeedbackKind
  description: string
  /** Optional Discord/Telegram handle — suggestions only. */
  contact?: string
}

/** What the modal shows before the user presses «Отправить». */
export interface FeedbackPreview {
  systemInfo: FeedbackSystemInfo
  /** Last 100 lines of `launcher.log` (never empty: a placeholder is included). */
  logLines: string[]
  logFile: string | null
  /** `true` when a webhook or GitHub token is configured. */
  configured: boolean
}

export interface FeedbackResult {
  ok: boolean
  delivered: 'webhook' | 'github' | 'none'
  /** `feedback_not_configured`, `feedback_too_short`, `feedback_rate_limited`, … */
  code?: string
  message?: string
  logLines: number
}

