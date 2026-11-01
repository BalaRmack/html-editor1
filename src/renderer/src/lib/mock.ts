import type { LauncherApi } from '../../../shared/ipc'
import { APP_VERSION, DEFAULT_SETTINGS } from '../../../shared/constants'
import type {
  AppSettings,
  ContentUpdate,
  GameSnapshot,
  InstallRunResult,
  InstalledMod,
  Instance,
  IntegrityReport,
  JavaRuntime,
  LogLine,
  ModHit,
  ModVersion,
  OfflineProfile,
  TaskProgress,
  UpdateState
} from '../../../shared/types'
import { sleep } from './utils'

const now = new Date().toISOString()

function makeInstance(id: string, name: string, mcVersion: string, loader: Instance['loader'], mods: number): Instance {
  return {
    id,
    name,
    mcVersion,
    loader,
    loaderVersion: loader === 'vanilla' ? null : loader === 'fabric' ? '0.16.10' : '21.1.77',
    versionId: loader === 'vanilla' ? mcVersion : `${loader}-loader-${mcVersion}`,
    icon: null,
    createdAt: now,
    lastPlayedAt: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
    playTimeMs: 1000 * 60 * 60 * 42,
    memory: { min: 1024, max: 6144 },
    javaPath: null,
    jvmArgs: '',
    gameDir: `C:\\Users\\Player\\AppData\\Roaming\\Verdant\\data\\instances\\${id}\\minecraft`,
    modsCount: mods,
    installed: true,
    notes: ''
  }
}


/** Deterministic ~140-line launch log so the 100-line attachment is visible. */
function mockLogTail(): string[] {
  const lines: string[] = []
  const push = (ts: string, level: string, text: string): void => {
    lines.push(`2026-11-01T08:${ts}Z [${level}] [launcher] ${text}`)
  }
  push('08:52.265', 'INFO', 'Verdant Launcher 1.1.1 — старт')
  push('08:52.402', 'INFO', 'Платформа: Windows 11 10.0.22631 (x64), Electron 45.2.1')
  push('08:52.611', 'INFO', 'Каталог данных: C:\\Users\\Player\\AppData\\Roaming\\Verdant')
  push('08:52.780', 'INFO', 'Java 21 (21.0.5) найдена: C:\\Program Files\\Java\\jdk-21\\bin\\javaw.exe')
  for (let i = 0; i < 118; i += 1) {
    const sec = String(53 + Math.floor(i / 20)).padStart(2, '0')
    const ms = String((i * 37) % 1000).padStart(3, '0')
    const name = `assets/objects/${(i * 7919).toString(16).padStart(2, '0')}/${(i * 104729).toString(16)}`
    push(`${sec}:${ms}`, 'INFO', `Проверка ${name} — OK (${(0.4 + (i % 17) * 0.9).toFixed(1)} МБ)`)
  }
  push(
    '09:01.599',
    'WARN',
    "Не удалось прочитать индекс ассетов 34: Unexpected token '\\u0000' — файл удалён, будет скачан заново"
  )
  push('09:01.640', 'INFO', 'Загрузка индекса ассетов 34 (assets-index-34.json)')
  push('09:07.404', 'INFO', 'Установка fabric 0.20.1 для Minecraft 1.21.4')
  push('09:09.118', 'WARN', 'Повторная попытка 1/3 для client-1.21.4.jar')
  push('09:11.906', 'WARN', 'Повторная попытка 2/3 для client-1.21.4.jar')
  push('09:17.306', 'ERROR', 'Установка «вцф» прервана: [network_error] Headers Timeout Error (C:\\Users\\Player\\AppData\\Roaming\\Verdant\\assets\\indexes\\34.json)')
  push('09:17.480', 'ERROR', 'AggregateError: fetch failed / Connect Timeout Error (10000ms)')
  return lines.slice(-100)
}

const instances: Instance[] = [
  makeInstance('a1', 'Выживание 1.21.4', '1.21.4', 'fabric', 14),
  makeInstance('a2', 'Create: Above & Beyond', '1.20.1', 'forge', 87),
  makeInstance('a3', 'Классика 1.20.1', '1.20.1', 'vanilla', 0)
]

const settings: AppSettings = { ...DEFAULT_SETTINGS, dataRoot: 'C:\\Users\\Player\\AppData\\Roaming\\Verdant\\data' }

let profile: OfflineProfile | null = {
  name: 'Steve',
  uuid: '8b0e0d2e-12f4-3a9d-9a63-9d5c1e6f2f2a',
  createdAt: now,
  skinPath: null,
  skinVariant: 'classic'
}

const logLines: LogLine[] = []
let seq = 0
function pushLog(text: string, level: LogLine['level'] = 'info', source: LogLine['source'] = 'launcher'): void {
  const line: LogLine = { seq: ++seq, ts: Date.now(), level, source, text }
  logLines.push(line)
  logListeners.forEach((listener) => listener(line))
}
const logListeners = new Set<(line: LogLine) => void>()
const taskListeners = new Set<(progress: TaskProgress) => void>()
const stateListeners = new Set<(snapshot: GameSnapshot) => void>()
const crashListeners = new Set<(crash: { instanceId: string; code: number | null; report: string; location: string }) => void>()

let game: GameSnapshot = { state: 'idle', instanceId: null, startedAt: null, exitCode: null, crashReportLocation: null }

/**
 * Preview-only simulation knobs. The browser preview has no disk, so the mock
 * keeps a per-instance "broken files" list that `install.verify` reports.
 * Exposed on `window.__verdantMock` so screenshots / manual QA can force the
 * error state without editing code.
 */
interface MockFailure {
  code: string
  file?: string
  message?: string
}
const brokenFiles: Record<string, string[]> = {}
let failNextInstall: MockFailure | null = null
let failNextLaunch: MockFailure | null = null

/** The mock has no push channel for instances; kept as a no-op for clarity. */
const emitInstances = (): void => undefined

let mockUpdate: UpdateState = {
  phase: 'idle',
  currentVersion: APP_VERSION,
  release: null,
  progress: null,
  checkedAt: null,
  skippedVersion: null
}
let updateTimer: number | null = null
const updateListeners = new Set<(state: UpdateState) => void>()

function emitUpdate(patch: Partial<UpdateState>): UpdateState {
  mockUpdate = { ...mockUpdate, ...patch }
  for (const listener of updateListeners) listener(mockUpdate)
  return mockUpdate
}

// Demo banner: always *one minor ahead* of the shipped build, never the shipped
// version itself (tests/installer.test.ts forbids embedding the real version).
const DEMO_RELEASE = {
  version: '1.3.0',
  tag: 'v1.3.0',
  name: 'Verdant Launcher 1.3.0',
  notes: 'Новый менеджер контента, автообновление и ускоренная проверка файлов.',
  publishedAt: now,
  htmlUrl: 'https://github.com/BalaRmack/html-editor1/releases',
  assetName: 'Verdant-Launcher-1.3.0-Setup.exe',
  assetUrl: 'https://example.invalid/Verdant-Launcher-1.3.0-Setup.exe',
  sizeBytes: 118_000_000
}

const mockControl = {
  /** Restores the demo content lists — used by UI tests to stay independent. */
  resetContent(): void {
    for (const [instanceId, list] of Object.entries(DEMO_INSTALLED)) installedMods[instanceId] = list.map((entry) => ({ ...entry }))
    installedExtras.resourcepack = DEMO_EXTRAS.resourcepack.map((entry) => ({ ...entry }))
    installedExtras.shader = DEMO_EXTRAS.shader.map((entry) => ({ ...entry }))
  },
  /** Shows the update banner as if GitHub had a newer release. */
  offerUpdate(version = '1.3.0'): UpdateState {
    return emitUpdate({
      phase: 'available',
      release: { ...DEMO_RELEASE, version, tag: `v${version}` },
      progress: null,
      checkedAt: now
    })
  },
  /** Pushes the banner into the "downloading" phase (100% = ready). */
  updateProgress(percent = 42): UpdateState {
    const total = 118_000_000
    const clamped = Math.max(0, Math.min(100, Math.round(percent)))
    if (clamped >= 100) {
      return emitUpdate({
        phase: 'ready',
        progress: { percent: 100, transferred: total, total, bytesPerSecond: 0 }
      })
    }
    return emitUpdate({
      phase: 'downloading',
      progress: {
        percent: clamped,
        transferred: Math.round((total * clamped) / 100),
        total,
        bytesPerSecond: 6_400_000
      }
    })
  },
  /** Marks an instance as half-downloaded: verify() will fail for it. */
  breakInstance(id: string, files = ['client-1.21.4.jar', 'lwjgl-3.3.3.jar', 'assets/objects/1f/1f8c…']): void {
    brokenFiles[id] = files
    const instance = instances.find((item) => item.id === id)
    if (instance) instance.installed = true
    emitInstances()
  },
  /** Forces the next `install.run` to fail with a network error. */
  failInstall(code = 'network_error', file = 'client-1.21.4.jar', message = 'Не удалось скачать файл'): void {
    failNextInstall = { code, file, message }
  },
  /** Forces the next launch's pre-flight download to fail (same code path as a real one). */
  failLaunch(code = 'network_error', file = 'client-1.21.4.jar', message = 'Fail to download client jar'): void {
    failNextLaunch = { code, file, message }
  },
  repair(id: string): void {
    delete brokenFiles[id]
  },
  /** Demo only: replays the install progress stream so the UI can be reviewed. */
  demoInstall(instanceId = 'a1'): void {
    void tick(
      'Установка «Verdant Tech 1.21.4»',
      [
        { key: 'manifest', label: 'Чтение манифеста версии', total: 6, unit: 'files', ms: 400 },
        { key: 'version', label: 'Загрузка файлов игры', total: 268 * MB, ms: 1800 },
        { key: 'loader', label: 'Установка загрузчика', total: 24 * MB, ms: 900 },
        { key: 'libraries', label: 'Библиотеки, ассеты и natives', total: 940 * MB, ms: 4200, steps: 20 }
      ],
      instanceId
    )
  },
  /** Demo only: shows the «Ожидание сети» state with the resume hint. */
  demoWaiting(instanceId = 'a1'): void {
    const id = `mock-wait-${Date.now()}`
    taskListeners.forEach((listener) =>
      listener({
        id,
        label: 'Установка «Verdant Tech 1.21.4»',
        stage: 'Библиотеки, ассеты и natives',
        stageKey: 'libraries',
        current: 612 * MB,
        total: 940 * MB,
        unit: 'bytes',
        status: 'waiting',
        instanceId,
        percent: 62,
        bytesPerSecond: 0,
        etaSeconds: null,
        retryable: true
      })
    )
  }
}

if (typeof window !== 'undefined') {
  ;(window as unknown as { __verdantMock?: typeof mockControl }).__verdantMock = mockControl
  // `?broken=a1` boots the preview straight into the corrupted-instance state,
  // which is how the error UI is reviewed without editing code.
  const broken = new URLSearchParams(window.location.search).get('broken')
  if (broken) mockControl.breakInstance(broken)
}


const MODS: Omit<ModHit, 'source'>[] = [
  {
    id: 'sodium',
    slug: 'sodium',
    name: 'Sodium',
    summary: 'Modern rendering engine and performance mod, dramatically improving frame rates and micro-stutter.',
    author: 'CaffeineMC',
    downloads: 38_400_000,
    follows: 61_000,
    iconUrl: null,
    categories: ['optimization'],
    loaders: ['fabric', 'quilt'],
    gameVersions: ['1.21.4', '1.21.1', '1.20.1'],
    projectType: 'mod',
    updatedAt: now
  },
  {
    id: 'iris',
    slug: 'iris',
    name: 'Iris Shaders',
    summary: 'A modern shaders mod compatible with OptiFine shaderpacks, built for speed.',
    author: 'IrisShaders',
    downloads: 24_900_000,
    follows: 44_500,
    iconUrl: null,
    categories: ['decoration', 'optimization'],
    loaders: ['fabric', 'quilt'],
    gameVersions: ['1.21.4', '1.21.1'],
    projectType: 'mod',
    updatedAt: now
  },
  {
    id: 'fabric-api',
    slug: 'fabric-api',
    name: 'Fabric API',
    summary: 'Essential hooks and interoperability for Fabric-based mods.',
    author: 'FabricMC',
    downloads: 210_000_000,
    follows: 82_000,
    iconUrl: null,
    categories: ['library'],
    loaders: ['fabric'],
    gameVersions: ['1.21.4', '1.21.1'],
    projectType: 'mod',
    updatedAt: now
  },
  {
    id: 'jei',
    slug: 'jei',
    name: 'Just Enough Items (JEI)',
    summary: 'View items and recipes — the classic recipe browser for every modpack.',
    author: 'mezz',
    downloads: 178_000_000,
    follows: 55_000,
    iconUrl: null,
    categories: ['utility'],
    loaders: ['forge', 'neoforge', 'fabric'],
    gameVersions: ['1.20.1', '1.21.1'],
    projectType: 'mod',
    updatedAt: now
  },
  {
    id: 'create',
    slug: 'create',
    name: 'Create',
    summary: 'Aesthetic technology: rotational power, contraptions and automation with style.',
    author: 'simibubi',
    downloads: 62_000_000,
    follows: 98_000,
    iconUrl: null,
    categories: ['technology'],
    loaders: ['forge', 'neoforge', 'fabric'],
    gameVersions: ['1.20.1', '1.21.1'],
    projectType: 'mod',
    updatedAt: now
  },
  {
    id: 'modmenu',
    slug: 'modmenu',
    name: 'Mod Menu',
    summary: 'Adds a mod menu to view the list of mods installed and configure them.',
    author: 'Prospector',
    downloads: 88_000_000,
    follows: 37_000,
    iconUrl: null,
    categories: ['utility'],
    loaders: ['fabric', 'quilt'],
    gameVersions: ['1.21.4', '1.21.1', '1.20.1'],
    projectType: 'mod',
    updatedAt: now
  },
  {
    id: 'sodium-extra',
    slug: 'sodium-extra',
    name: 'Sodium Extra',
    summary: 'Additional options for Sodium: particles, weather, fog and more.',
    author: 'FlashyReese',
    downloads: 12_100_000,
    follows: 18_200,
    iconUrl: null,
    categories: ['optimization'],
    loaders: ['fabric'],
    gameVersions: ['1.21.4', '1.20.1'],
    projectType: 'mod',
    updatedAt: now
  },
  {
    id: 'xaeros-minimap',
    slug: 'xaeros-minimap',
    name: "Xaero's Minimap",
    summary: 'A clean, fast minimap with waypoints and entity radar.',
    author: 'xaero96',
    downloads: 45_600_000,
    follows: 29_500,
    iconUrl: null,
    categories: ['map'],
    loaders: ['forge', 'fabric', 'neoforge'],
    gameVersions: ['1.21.4', '1.20.1'],
    projectType: 'mod',
    updatedAt: now
  },
  {
    id: 'cobblemon',
    slug: 'cobblemon',
    name: 'Cobblemon',
    summary: 'Open-source Pokémon-inspired mod with a complete dex, battles and breeding.',
    author: 'Cobblemon',
    downloads: 9_800_000,
    follows: 41_000,
    iconUrl: null,
    categories: ['adventure'],
    loaders: ['fabric', 'forge', 'neoforge'],
    gameVersions: ['1.21.1', '1.20.1'],
    projectType: 'mod',
    updatedAt: now
  }
]


/** Resource packs & shaders shown by the instance «Настроить» window in the demo. */
const CONTENT_CATALOG: Record<'resourcepack' | 'shader', Omit<ModHit, 'source'>[]> = {
  resourcepack: [
    {
      id: 'fresh-animations',
      slug: 'fresh-animations',
      name: 'Fresh Animations',
      summary: 'Living, breathing mob animations that stay true to vanilla.',
      author: 'FreshLX',
      downloads: 41_200_000,
      follows: 88_000,
      iconUrl: null,
      categories: ['16x'],
      loaders: ['minecraft'],
      gameVersions: ['1.21.4', '1.21.1'],
      projectType: 'resourcepack',
      updatedAt: now
    },
    {
      id: 'stay-true',
      slug: 'stay-true',
      name: 'Stay True',
      summary: 'A classic vanilla-flavoured pack with hand-drawn textures.',
      author: 'Amb',
      downloads: 12_800_000,
      follows: 21_000,
      iconUrl: null,
      categories: ['16x'],
      loaders: ['minecraft'],
      gameVersions: ['1.21.4'],
      projectType: 'resourcepack',
      updatedAt: now
    }
  ],
  shader: [
    {
      id: 'complementary',
      slug: 'complementary',
      name: 'Complementary Reimagined',
      summary: 'Soft lighting, volumetric clouds and clean water.',
      author: 'EminGT',
      downloads: 22_400_000,
      follows: 47_000,
      iconUrl: null,
      categories: ['shaders'],
      loaders: ['minecraft'],
      gameVersions: ['1.21.4', '1.21.1'],
      projectType: 'shader',
      updatedAt: now
    },
    {
      id: 'bliss',
      slug: 'bliss',
      name: 'Bliss Shaders',
      summary: 'Cinematic golden-hour look with a light performance footprint.',
      author: 'Xonk',
      downloads: 6_100_000,
      follows: 12_400,
      iconUrl: null,
      categories: ['shaders'],
      loaders: ['minecraft'],
      gameVersions: ['1.21.4'],
      projectType: 'shader',
      updatedAt: now
    }
  ]
}

/** Installed packs/shaders for the demo instance — mods live in `installedMods`. */
const installedExtras: Record<'resourcepack' | 'shader', InstalledMod[]> = {
  resourcepack: [
    {
      projectId: 'fresh-animations',
      fileName: 'FreshAnimations_v1.9.zip',
      name: 'Fresh Animations',
      version: 'v1.9',
      iconUrl: null,
      enabled: true,
      source: 'modrinth',
      size: 4_800_000,
      installedAt: now,
      versionId: 'fresh-animations-v1',
      sha1: 'fresh-animations-sha1-1.9',
      author: 'FreshLX'
    }
  ],
  shader: []
}

const installedMods: Record<string, InstalledMod[]> = {
  a1: [
    {
      projectId: 'sodium',
      fileName: 'sodium-fabric-0.6.5+mc1.21.4.jar',
      name: 'Sodium',
      version: '0.6.5',
      iconUrl: null,
      enabled: true,
      source: 'modrinth',
      size: 1_240_000,
      installedAt: now,
      versionId: null,
      sha1: null,
      author: 'jellysquid3'
    },
    {
      projectId: 'iris',
      fileName: 'iris-fabric-1.8.0+mc1.21.4.jar',
      name: 'Iris Shaders',
      version: '1.8.0',
      iconUrl: null,
      enabled: true,
      source: 'modrinth',
      size: 3_400_000,
      installedAt: now,
      versionId: null,
      sha1: null,
      author: 'coderbot'
    },
    {
      projectId: 'fabric-api',
      fileName: 'fabric-api-0.114.0+1.21.4.jar',
      name: 'Fabric API',
      version: '0.114.0',
      iconUrl: null,
      enabled: true,
      source: 'modrinth',
      size: 2_100_000,
      installedAt: now,
      versionId: null,
      sha1: null,
      author: 'modmuss50'
    },
    {
      projectId: 'modmenu',
      fileName: 'modmenu-11.0.3.jar',
      name: 'Mod Menu',
      version: '11.0.3',
      iconUrl: null,
      enabled: false,
      source: 'modrinth',
      size: 620_000,
      installedAt: now,
      versionId: null,
      sha1: null,
      author: 'Prospector'
    }
  ],
  a2: [],
  a3: []
}

/** Frozen copies of the demo lists, so `resetContent()` can bring deletions back. */
const DEMO_INSTALLED: Record<string, InstalledMod[]> = JSON.parse(JSON.stringify(installedMods)) as Record<string, InstalledMod[]>
const DEMO_EXTRAS: Record<'resourcepack' | 'shader', InstalledMod[]> = JSON.parse(
  JSON.stringify(installedExtras)
) as Record<'resourcepack' | 'shader', InstalledMod[]>

/** A simulated install stage: byte-based so the UI can show real-looking progress. */
interface MockStage {
  key: string
  label: string
  total: number
  unit?: 'bytes' | 'files'
  steps?: number
  ms?: number
}

const MB = 1024 * 1024

/**
 * Drives the task listeners the same way the main process does: several chunks
 * per stage with a `stageKey`, then a final `done` payload. Timings are short
 * enough to stay pleasant in the preview but long enough to read.
 */
const tick = async (
  label: string,
  stages: (MockStage | string)[],
  instanceId?: string
): Promise<void> => {
  const id = `mock-task-${Date.now()}`
  // Mirrors the payload the real main process sends: one monotonic percent for
  // the whole install plus the live speed/ETA of the byte phases.
  const emit = (
    stage: string,
    current: number,
    total: number,
    unit: 'bytes' | 'files',
    stageKey: string | undefined,
    overall: number,
    speed: number,
    eta: number | null
  ): void => {
    taskListeners.forEach((listener) =>
      listener({
        id,
        label,
        stage,
        stageKey,
        current,
        total,
        unit,
        status: 'running',
        instanceId,
        percent: overall,
        bytesPerSecond: unit === 'bytes' ? speed : undefined,
        etaSeconds: unit === 'bytes' ? eta : null
      })
    )
  }

  const stageCount = stages.length
  for (const [index, entry] of stages.entries()) {
    const stage: MockStage =
      typeof entry === 'string' ? { key: '', label: entry, total: 6, unit: 'files', ms: 420 } : entry
    const total = stage.total
    const unit = stage.unit ?? 'bytes'
    const frames = stage.steps ?? 14
    const stepMs = Math.max(60, (stage.ms ?? 1500) / frames)
    for (let frame = 0; frame <= frames; frame++) {
      const ratio = total > 0 ? frame / frames : 0
      const current = Math.round(total * ratio)
      const overall = Math.min(99, Math.round(((index + ratio) / stageCount) * 100))
      // 9–13 MB/s with a gentle wobble: reads like a real CDN, not a spinner.
      const speed = (9.4 + Math.sin(frame / 2.2) * 1.8) * MB
      const eta = total > current && unit === 'bytes' ? Math.round((total - current) / speed) : null
      emit(stage.label, current, total, unit, stage.key || undefined, overall, speed, eta)
      if (frame < frames) await sleep(stepMs)
    }
  }

  taskListeners.forEach((listener) =>
    listener({ id, label, stage: 'Готово', current: 1, total: 1, unit: 'steps', status: 'done', instanceId, percent: 100 })
  )
  await sleep(260)
}

function setGame(patch: Partial<GameSnapshot>): void {
  game = { ...game, ...patch }
  stateListeners.forEach((listener) => listener(game))
}

const PACKS: ModHit[] = [
  {
    id: 'fabulously-optimized',
    slug: 'fabulously-optimized',
    name: 'Fabulously Optimized',
    summary: 'A lightweight, performance-focused Fabric pack that stays close to vanilla — Sodium, Iris, Lithium and friends.',
    author: 'robotkoer',
    downloads: 12_400_000,
    follows: 24_800,
    iconUrl: null,
    categories: ['optimization', 'lightweight'],
    loaders: ['fabric'],
    gameVersions: ['1.21.4', '1.21.1'],
    projectType: 'modpack',
    updatedAt: now,
    source: 'modrinth'
  },
  {
    id: 'better-mc',
    slug: 'better-mc-fabric',
    name: 'Better MC [FABRIC]',
    summary: 'The classic all-in-one adventure pack: new biomes, dungeons, bosses and quests on top of Fabric.',
    author: 'LunaPixelStudios',
    downloads: 8_900_000,
    follows: 31_200,
    iconUrl: null,
    categories: ['adventure', 'kitchen-sink'],
    loaders: ['fabric'],
    gameVersions: ['1.21.1', '1.20.1'],
    projectType: 'modpack',
    updatedAt: now,
    source: 'modrinth'
  },
  {
    id: 'all-of-fabric',
    slug: 'all-of-fabric-6',
    name: 'All of Fabric 6',
    summary: 'Kitchen-sink tech and magic pack with quests, balanced progression and over 350 mods.',
    author: 'Hrry',
    downloads: 3_200_000,
    follows: 14_100,
    iconUrl: null,
    categories: ['technology', 'quests'],
    loaders: ['fabric'],
    gameVersions: ['1.20.1'],
    projectType: 'modpack',
    updatedAt: now,
    source: 'modrinth'
  },
  {
    id: 'create-above-beyond',
    slug: 'create-above-and-beyond',
    name: 'Create: Above and Beyond',
    summary: 'A technology- and automation-focused pack built entirely around the Create mod.',
    author: 'simibubi',
    downloads: 5_600_000,
    follows: 19_400,
    iconUrl: null,
    categories: ['technology', 'hardcore'],
    loaders: ['forge'],
    gameVersions: ['1.20.1'],
    projectType: 'modpack',
    updatedAt: now,
    source: 'modrinth'
  },
  {
    id: 'cobblemon-official',
    slug: 'cobblemon-official',
    name: 'Cobblemon [Official]',
    summary: 'The official Cobblemon experience: catch, battle and breed Pokémon in Minecraft.',
    author: 'Cobblemon',
    downloads: 2_700_000,
    follows: 26_900,
    iconUrl: null,
    categories: ['adventure'],
    loaders: ['fabric', 'neoforge'],
    gameVersions: ['1.21.1'],
    projectType: 'modpack',
    updatedAt: now,
    source: 'modrinth'
  }
]

const LOADER_CATALOGUE: Record<string, string[]> = {
  fabric: ['0.16.10', '0.16.9', '0.16.5', '0.15.11', '0.14.24'],
  quilt: ['0.27.2', '0.26.4', '0.25.0', '0.24.0'],
  forge: ['52.0.7', '52.0.2', '51.0.33', '47.2.0', '43.2.14'],
  neoforge: ['21.1.77', '21.1.72', '21.1.65', '20.4.237']
}

const MC_VERSIONS = [
  ['1.21.4', 'release'],
  ['1.21.3', 'release'],
  ['1.21.1', 'release'],
  ['1.21', 'release'],
  ['1.20.6', 'release'],
  ['1.20.4', 'release'],
  ['1.20.2', 'release'],
  ['1.20.1', 'release'],
  ['1.19.4', 'release'],
  ['1.19.2', 'release'],
  ['1.18.2', 'release'],
  ['1.17.1', 'release'],
  ['1.16.5', 'release'],
  ['1.15.2', 'release'],
  ['1.14.4', 'release'],
  ['1.12.2', 'release'],
  ['25w46a', 'snapshot'],
  ['25w45a', 'snapshot'],
  ['25w44a', 'snapshot'],
  ['24w49a', 'snapshot']
] as const

const modVersions = (projectId: string, mcVersion: string, loader: string): ModVersion[] => {
  const base = MODS.find((mod) => mod.id === projectId)
  return [
    {
      id: `${projectId}-v1`,
      projectId,
      name: `${base?.name ?? projectId} 2.1.0`,
      versionNumber: '2.1.0',
      gameVersions: [mcVersion],
      loaders: [loader],
      datePublished: now,
      downloadUrl: `https://example.invalid/${projectId}.jar`,
      fileName: `${projectId}-2.1.0.jar`,
      fileSize: 1_800_000,
      sha1: `${projectId}-sha1-2.1.0`,
      dependencies: projectId === 'iris' ? [{ projectId: 'sodium', versionId: null, kind: 'required' }] : []
    },
    {
      id: `${projectId}-v0`,
      projectId,
      name: `${base?.name ?? projectId} 1.1.4`,
      versionNumber: '1.1.4',
      gameVersions: [mcVersion],
      loaders: [loader],
      datePublished: now,
      downloadUrl: `https://example.invalid/${projectId}-old.jar`,
      fileName: `${projectId}-1.1.4.jar`,
      fileSize: 1_700_000,
      sha1: `${projectId}-sha1-1.1.4`,
      dependencies: []
    }
  ]
}

export function createMockApi(): LauncherApi {
  const tag = (): void => {
    /* keep the preview alive with a couple of log lines */
  }
  window.setTimeout(() => {
    pushLog(`Verdant Launcher ${APP_VERSION} — демонстрационный режим (браузер)`, 'info')
    pushLog('[main/INFO] Setting user: Steve', 'info', 'game')
    pushLog('[Render thread/INFO] OpenAL initialized', 'info', 'game')
    tag()
  }, 700)

  return {
    app: {
      info: async () => ({
        appVersion: APP_VERSION,
        electron: '45.2.1',
        chrome: '142',
        node: '22.20.0',
        platform: 'win32',
        arch: 'x64',
        totalMemMB: 16384,
        freeMemMB: 9420,
        cpus: 8,
        dataRoot: settings.dataRoot,
        userData: 'C:\\Users\\Player\\AppData\\Roaming\\Verdant',
        locale: 'ru-RU'
      }),
      boot: async () => {
        await sleep(320)
        return { profile, settings, selectedInstanceId: instances[0].id, instances }
      },
      minimize: () => undefined,
      toggleMaximize: async () => false,
      close: () => undefined,
      isMaximized: async () => false,
      openExternal: async () => undefined,
      openPath: async () => undefined,
      pickDirectory: async () => null,
      pickImage: async () => null,
      readImage: async () => null,
      relaunch: () => undefined
    },
    profile: {
      get: async () => profile,
      setNickname: async (name: string) => {
        profile = {
          name,
          uuid: '8b0e0d2e-12f4-3a9d-9a63-9d5c1e6f2f2a',
          createdAt: now,
          skinPath: null,
          skinVariant: 'classic'
        }
        return profile
      },
      setSkin: async () => ({ dataUrl: null, variant: 'classic', path: null }),
      setSkinBytes: async () => ({ dataUrl: null, variant: 'classic', path: null }),
      readSkin: async () => ({ dataUrl: null, variant: 'classic', path: null }),
      removeSkin: async () => ({ dataUrl: null, variant: 'classic', path: null })
    },
    settings: {
      get: async () => settings,
      update: async (patch: Partial<AppSettings>) => Object.assign(settings, patch)
    },
    instances: {
      list: async () => instances,
      get: async (id: string) => instances.find((item) => item.id === id)!,
      create: async (input) => {
        const created = makeInstance(`mock-${Date.now()}`, input.name, input.mcVersion, input.loader, 0)
        created.installed = false
        created.memory = input.memory ?? settings.defaultMemory
        instances.unshift(created)
        return created
      },
      update: async (id, patch) => {
        const instance = instances.find((item) => item.id === id)!
        Object.assign(instance, patch)
        return instance
      },
      remove: async (id) => {
        const index = instances.findIndex((item) => item.id === id)
        if (index >= 0) instances.splice(index, 1)
      },
      clone: async (id) => {
        const source = instances.find((item) => item.id === id)!
        const copy = { ...source, id: `mock-${Date.now()}`, name: `${source.name} копия` }
        instances.unshift(copy)
        return copy
      },
      setIcon: async (id) => instances.find((item) => item.id === id)!,
      openFolder: async () => undefined,
      refresh: async () => instances
    },
    versions: {
      minecraft: async () =>
        MC_VERSIONS.map(([id, type], index) => ({
          id,
          type,
          releaseTime: new Date(Date.now() - index * 1000 * 60 * 60 * 24 * 26).toISOString()
        })),
      loaders: async (_mcVersion, loader) => {
        await sleep(220)
        return (LOADER_CATALOGUE[loader] ?? []).map((version, index) => ({ version, stable: index < 2 }))
      }
    },
    install: {
      verify: async (instanceId: string): Promise<IntegrityReport> => {
        await sleep(260)
        const instance = instances.find((item) => item.id === instanceId)
        const base: IntegrityReport = {
          ok: true,
          instanceId,
          versionId: instance?.versionId ?? '',
          checkedAt: new Date().toISOString(),
          missing: [],
          truncatedIssues: 0,
          counts: { libraries: 62, assets: 2841, checked: 2904 },
          durationMs: 180
        }
        if (!instance || !instance.installed) {
          return { ...base, ok: false, code: 'not_installed', error: 'Файлы версии не найдены' }
        }
        const broken = brokenFiles[instanceId]
        if (broken && broken.length > 0) {
          return {
            ...base,
            ok: false,
            code: 'integrity_failed',
            error: `Не хватает файлов: ${broken.length}`,
            missing: broken.map((name, index) => ({
              kind: index === 0 ? 'client' : 'library',
              name,
              path: `C:\\Users\\Player\\AppData\\Roaming\\Verdant\\data\\shared\\libraries\\${name}`,
              expectedSize: 2_100_000
            })),
            truncatedIssues: 0
          }
        }
        return base
      },
      run: async (instanceId: string): Promise<InstallRunResult> => {
        const instance = instances.find((item) => item.id === instanceId)
        const fabric = instance?.loader !== 'vanilla'
        const forced = failNextInstall
        await tick(
          `Установка «${instance?.name ?? ''}»`,
          [
            { key: 'manifest', label: 'Чтение манифеста версии', total: 6, unit: 'files', ms: 420 },
            { key: 'version', label: 'Загрузка файлов игры', total: 22 * MB, ms: 1400 },
            ...(fabric ? [{ key: 'loader', label: 'Установка загрузчика', total: 9 * MB, ms: 900 }] : []),
            { key: 'libraries', label: 'Библиотеки, ассеты и natives', total: 64 * MB, ms: forced ? 700 : 1900, steps: forced ? 6 : 14 }
          ],
          instanceId
        )
        if (forced) {
          failNextInstall = null
          if (instance) {
            instance.installed = true
            brokenFiles[instanceId] = [forced.file ?? 'client-1.21.4.jar']
          }
          emitInstances()
          return {
            ok: false,
            code: forced.code,
            message: forced.message,
            file: forced.file,
            stage: 'libraries',
            retryable: true,
            report: await (async () => {
              const broken = brokenFiles[instanceId] ?? []
              return {
                ok: false,
                instanceId,
                versionId: instance?.versionId ?? '',
                checkedAt: new Date().toISOString(),
                code: 'integrity_failed',
                error: `Не хватает файлов: ${broken.length}`,
                missing: broken.map((name) => ({
                  kind: 'library' as const,
                  name,
                  path: `C:\\shared\\libraries\\${name}`,
                  expectedSize: 2_100_000
                })),
                truncatedIssues: 0,
                counts: { libraries: 61, assets: 2841, checked: 2902 },
                durationMs: 190
              }
            })()
          }
        }
        if (instance) {
          instance.installed = true
          delete brokenFiles[instanceId]
        }
        emitInstances()
        return { ok: true, report: await (async () => ({
          ok: true,
          instanceId,
          versionId: instance?.versionId ?? '',
          checkedAt: new Date().toISOString(),
          missing: [],
          truncatedIssues: 0,
          counts: { libraries: 62, assets: 2841, checked: 2904 },
          durationMs: 180
        }))() }
      },
      cancel: () => undefined
    },
    game: {
      launch: async (instanceId: string) => {
        setGame({ state: 'checking', instanceId, startedAt: Date.now() })
        await sleep(500)
        setGame({ state: 'downloading' })
        await sleep(700)
        if (failNextLaunch) {
          const failure = failNextLaunch
          failNextLaunch = null
          setGame({ state: 'idle', instanceId: null, startedAt: null })
          brokenFiles[instanceId] = [failure.file ?? 'client-1.21.4.jar']
          const error = new Error(failure.message ?? 'network_error') as Error & { code?: string; file?: string }
          error.code = failure.code
          error.file = failure.file
          throw error
        }
        setGame({ state: 'starting' })
        await sleep(600)
        setGame({ state: 'running' })
        pushLog('[Render thread/INFO] OpenGL 4.6 initialized', 'info', 'game')
        return { ok: true }
      },
      kill: () => {
        setGame({ state: 'exited', exitCode: 0 })
      },
      state: async () => game,
      onState: (listener) => {
        stateListeners.add(listener)
        return () => stateListeners.delete(listener)
      },
      onCrash: (listener) => {
        crashListeners.add(listener)
        return () => crashListeners.delete(listener)
      }
    },
    logs: {
      history: async () => logLines,
      clear: async () => {
        logLines.length = 0
      },
      openFolder: async () => undefined,
      onLine: (listener) => {
        logListeners.add(listener)
        return () => logListeners.delete(listener)
      },
      onCleared: () => () => undefined
    },
    tasks: {
      onProgress: (listener) => {
        taskListeners.add(listener)
        return () => taskListeners.delete(listener)
      }
    },
    java: {
      scan: async (): Promise<JavaRuntime[]> => [
        {
          path: 'C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.5.11-hotspot\\bin\\java.exe',
          home: 'C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.5.11-hotspot',
          version: '21.0.5',
          major: 21,
          vendor: 'Eclipse Adoptium',
          arch: 'amd64',
          source: 'registry'
        },
        {
          path: 'C:\\Program Files\\Java\\jre1.8.0_411\\bin\\java.exe',
          home: 'C:\\Program Files\\Java\\jre1.8.0_411',
          version: '1.8.0_411',
          major: 8,
          vendor: 'Oracle Corporation',
          arch: 'x86',
          source: 'common'
        }
      ],
      validate: async () => null,
      download: async (major: number) => {
        await tick(`Установка Java ${major}`, ['Манифест Mojang', 'Распаковка'])
        return {
          path: `C:\\Verdant\\java\\jre-${major}\\bin\\java.exe`,
          home: `C:\\Verdant\\java\\jre-${major}`,
          version: String(major),
          major,
          vendor: 'Mojang',
          arch: 'amd64',
          source: 'mojang'
        }
      }
    },
    feedback: {
      preview: async () => {
        await sleep(180)
        return {
          systemInfo: {
            os: 'Windows 11 10.0.22631',
            arch: 'x64',
            appVersion: APP_VERSION,
            electron: '45.2.1',
            java: 'Java 21 (21.0.5) · C:\\Program Files\\Java\\jdk-21\\bin\\javaw.exe',
            totalMemMB: 16384,
            locale: 'ru-RU',
            instance: instances[0]?.name ?? null
          },
          // A real session is a few hundred lines; the service keeps the last 100.
          logLines: mockLogTail(),
          logFile: 'C:\\Users\\Player\\AppData\\Roaming\\Verdant\\logs\\launcher.log',
          configured: true
        }
      },
      send: async (input) => {
        await sleep(700)
        return { ok: true, delivered: 'webhook', logLines: 100, code: undefined, message: undefined }
      }
    },
    content: {
      search: async (input) => {
        await sleep(240)
        const instance = instances.find((item) => item.id === input.instanceId)!
        const text = (input.query ?? '').toLowerCase()
        const source: Omit<ModHit, 'source'>[] =
          input.kind === 'mod'
            ? MODS.filter((mod) => mod.projectType === 'mod')
            : CONTENT_CATALOG[input.kind]
        // Same rule as the main process: exact game version + loader, always.
        const hits = source.filter((hit) => {
          if (!hit.gameVersions.includes(instance.mcVersion)) return false
          if (input.kind !== 'mod') return true
          return instance.loader === 'vanilla' ? false : hit.loaders.includes(instance.loader)
        })
        const filtered = hits
          .filter((hit) => !text || hit.name.toLowerCase().includes(text) || hit.summary.toLowerCase().includes(text))
          .map((hit) => ({ ...hit, source: settings.modSource }))
        return {
          hits: filtered,
          total: filtered.length,
          offset: 0,
          limit: input.limit ?? 20,
          mcVersion: instance.mcVersion,
          loader: instance.loader,
          kind: input.kind
        }
      },
      install: async (input) => {
        const instance = instances.find((item) => item.id === input.instanceId)!
        await tick('Установка контента', [{ key: 'packDownload', label: 'Загрузка файла', total: 1.4 * MB, ms: 700 }], instance.id)
        const project =
          MODS.find((item) => item.id === input.projectId) ??
          (input.kind === 'mod' ? null : CONTENT_CATALOG[input.kind].find((item) => item.id === input.projectId) ?? null)
        const fileName = `${input.projectId}-2.1.0.${input.kind === 'mod' ? 'jar' : 'zip'}`
        if (input.kind === 'mod') {
          const list = installedMods[instance.id] ?? []
          list.push({
            projectId: input.projectId,
            fileName,
            name: project?.name ?? input.projectId,
            version: '2.1.0',
            iconUrl: null,
            enabled: true,
            source: input.source,
            size: 1_200_000,
            installedAt: now,
            versionId: `${input.projectId}-v1`,
            sha1: `${input.projectId}-sha1-2.1.0`,
            author: project?.author ?? null
          })
          installedMods[instance.id] = list
          instance.modsCount = list.length
        } else {
          const list = installedExtras[input.kind]
          list.push({
            projectId: input.projectId,
            fileName,
            name: project?.name ?? input.projectId,
            version: '2.1.0',
            iconUrl: null,
            enabled: true,
            source: input.source,
            size: 3_200_000,
            installedAt: now,
            versionId: `${input.projectId}-v1`,
            sha1: `${input.projectId}-sha1-2.1.0`,
            author: project?.author ?? null
          })
        }
        emitInstances()
        return { installed: [fileName], skipped: [], warnings: [] }
      },
      installed: async (instanceId, kind) => {
        await sleep(160)
        return kind === 'mod' ? [...(installedMods[instanceId] ?? [])] : [...installedExtras[kind]]
      },
      remove: async (instanceId, kind, fileName) => {
        await sleep(180)
        if (kind === 'mod') {
          installedMods[instanceId] = (installedMods[instanceId] ?? []).filter((entry) => entry.fileName !== fileName)
          const instance = instances.find((item) => item.id === instanceId)
          if (instance) instance.modsCount = installedMods[instanceId].length
          emitInstances()
        } else {
          installedExtras[kind] = installedExtras[kind].filter((entry) => entry.fileName !== fileName)
        }
      },
      toggle: async (instanceId, kind, fileName, enabled) => {
        await sleep(120)
        const list = kind === 'mod' ? installedMods[instanceId] ?? [] : installedExtras[kind]
        const entry = list.find((item) => item.fileName === fileName)
        if (entry) entry.enabled = enabled
      },
      updates: async (instanceId, kind) => {
        await sleep(420)
        const instance = instances.find((item) => item.id === instanceId)!
        const installed = kind === 'mod' ? installedMods[instanceId] ?? [] : installedExtras[kind]
        const result: ContentUpdate[] = []
        for (const entry of installed) {
          if (!entry.projectId) continue
          const candidates =
            kind === 'mod' ? modVersions(entry.projectId, instance.mcVersion, instance.loader) : modVersions(entry.projectId, instance.mcVersion, 'minecraft')
          const latest = candidates[0]
          if (!latest || latest.versionNumber === entry.version) continue
          // Only a couple of demo files are "outdated" so the UI stays readable.
          if (kind === 'mod' && entry.projectId !== 'sodium' && entry.projectId !== 'modmenu') continue
          result.push({
            kind,
            projectId: entry.projectId,
            fileName: entry.fileName,
            name: entry.name,
            iconUrl: entry.iconUrl,
            currentVersion: entry.version,
            latestVersion: latest.versionNumber,
            versionId: latest.id,
            sha1: latest.sha1,
            publishedAt: latest.datePublished
          })
        }
        return result
      },
      update: async (input) => {
        await tick('Обновление контента', [{ key: 'packDownload', label: 'Загрузка файла', total: 1.6 * MB, ms: 600 }], input.instanceId)
        const list = input.kind === 'mod' ? installedMods[input.instanceId] ?? [] : installedExtras[input.kind]
        const entry = list.find((item) => item.projectId === input.projectId)
        if (entry) {
          entry.version = '2.1.0'
          entry.versionId = input.versionId ?? `${input.projectId}-v1`
          entry.sha1 = `${input.projectId}-sha1-2.1.0`
        }
      },
      openFolder: async () => undefined,
      openPage: async () => undefined
    },
    mods: {
      search: async (query) => {
        await sleep(420)
        const text = (query.query ?? '').toLowerCase()
        if (query.projectType === 'modpack') {
          const text2 = (query.query ?? '').toLowerCase()
          const packs = PACKS.filter(
            (pack) =>
              !text2 || pack.name.toLowerCase().includes(text2) || pack.summary.toLowerCase().includes(text2)
          ).map((pack) => ({ ...pack, source: query.source }))
          return { hits: packs, total: packs.length, offset: 0, limit: 20 }
        }
        const hits = MODS.filter(
          (mod) =>
            (!text || mod.name.toLowerCase().includes(text) || mod.summary.toLowerCase().includes(text)) &&
            (!query.loader || query.loader === 'vanilla' || mod.loaders.includes(query.loader))
        ).map((mod) => ({ ...mod, source: query.source }))
        return { hits, total: hits.length, offset: 0, limit: 20 }
      },
      packVersions: async (_source, projectId, mcVersion) => {
        await sleep(280)
        const pack = PACKS.find((item) => item.id === projectId)
        const versions = mcVersion ? [mcVersion] : pack?.gameVersions ?? ['1.21.1']
        return versions.flatMap((gameVersion, index) => [
          {
            id: `${projectId}-${gameVersion}-${index}`,
            projectId,
            name: `${pack?.name ?? projectId} ${gameVersion} · r${2 - index}`,
            versionNumber: gameVersion,
            gameVersions: [gameVersion],
            loaders: pack?.loaders ?? ['fabric'],
            datePublished: now,
            downloadUrl: `https://example.invalid/${projectId}-${gameVersion}.mrpack`,
            fileName: `${projectId}-${gameVersion}.mrpack`,
            fileSize: 28_000_000 + index * 3_400_000,
            sha1: `${projectId}-${gameVersion}-sha1`,
            dependencies: []
          }
        ])
      },
      project: async (source, id) => {
        const mod = MODS.find((item) => item.id === id)
        return mod ? { ...mod, source } : null
      },
      versions: async (_source, projectId, mcVersion, loader) => modVersions(projectId, mcVersion, loader),
      install: async (input) => {
        const instance = instances.find((item) => item.id === input.instanceId)!
        await tick('Установка мода', [{ key: 'packDownload', label: 'Загрузка файла', total: 1.2 * MB, ms: 700 }], input.instanceId)
        const list = installedMods[input.instanceId] ?? []
        const mod = MODS.find((item) => item.id === input.projectId)
        list.push({
          projectId: input.projectId,
          fileName: `${input.projectId}-2.1.0.jar`,
          name: mod?.name ?? input.projectId,
          version: '2.1.0',
          iconUrl: null,
          enabled: true,
          source: input.source,
          size: 1_200_000,
          installedAt: now,
          versionId: `${input.projectId}-v1`,
          sha1: `${input.projectId}-sha1-2.1.0`,
          author: mod?.author ?? null
        })
        installedMods[input.instanceId] = list
        instance.modsCount = list.length
        return { installed: [`${input.projectId}-2.1.0.jar`], skipped: [], warnings: [] }
      },
      installed: async (instanceId) => installedMods[instanceId] ?? [],
      remove: async (instanceId, fileName) => {
        installedMods[instanceId] = (installedMods[instanceId] ?? []).filter((mod) => mod.fileName !== fileName)
      },
      toggle: async (instanceId, fileName, enabled) => {
        const mod = (installedMods[instanceId] ?? []).find((item) => item.fileName === fileName)
        if (mod) mod.enabled = enabled
      },
      installPack: async (input) => {
        await tick(`Модпак «${input.projectName}»`, [
          { key: 'packDownload', label: 'Скачивание архива модпака', total: 34 * MB, ms: 1900 },
          { key: 'packFiles', label: 'Загрузка модов из манифеста', total: 186 * MB, ms: 3200 },
          { key: 'overrides', label: 'Конфиги и оверрайды', total: 12 * MB, ms: 900 }
        ])
        const created = makeInstance(`pack-${Date.now()}`, input.projectName, '1.21.1', 'fabric', 42)
        instances.unshift(created)
        return created
      },
      openFolder: async () => undefined
    },
    updates: {
      state: async () => mockUpdate,
      check: async () => {
        await sleep(280)
        return emitUpdate({ checkedAt: now, phase: mockUpdate.release ? mockUpdate.phase : 'up-to-date' })
      },
      download: async () => {
        emitUpdate({ phase: 'downloading', progress: { percent: 0, transferred: 0, total: 118_000_000, bytesPerSecond: 0 } })
        if (updateTimer) window.clearInterval(updateTimer)
        updateTimer = window.setInterval(() => {
          const progress = mockUpdate.progress ?? { percent: 0, transferred: 0, total: 118_000_000, bytesPerSecond: 0 }
          const percent = Math.min(100, progress.percent + 9)
          emitUpdate({
            phase: percent >= 100 ? 'ready' : 'downloading',
            progress: {
              percent,
              transferred: Math.round((percent / 100) * 118_000_000),
              total: 118_000_000,
              bytesPerSecond: 6_400_000
            }
          })
          if (percent >= 100 && updateTimer) {
            window.clearInterval(updateTimer)
            updateTimer = null
          }
        }, 320)
        return mockUpdate
      },
      install: () => undefined,
      defer: async () => emitUpdate({ phase: 'idle' }),
      skip: async () => {
        const skippedVersion = mockUpdate.release?.version ?? null
        return emitUpdate({ phase: 'idle', skippedVersion })
      },
      resume: async () => emitUpdate({ phase: mockUpdate.release ? 'available' : 'idle' }),
      onChange: (listener: (state: UpdateState) => void) => {
        updateListeners.add(listener)
      return () => updateListeners.delete(listener)
    }
  }
  }
}
