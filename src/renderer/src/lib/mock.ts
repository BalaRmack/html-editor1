import type { LauncherApi } from '../../../shared/ipc'
import { DEFAULT_SETTINGS } from '../../../shared/constants'
import type {
  AppSettings,
  GameSnapshot,
  InstalledMod,
  Instance,
  JavaRuntime,
  LogLine,
  ModHit,
  ModVersion,
  OfflineProfile,
  TaskProgress
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
      installedAt: now
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
      installedAt: now
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
      installedAt: now
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
      installedAt: now
    }
  ],
  a2: [],
  a3: []
}

const tick = async (label: string, stages: string[], instanceId?: string): Promise<void> => {
  const id = `mock-task-${Date.now()}`
  for (let i = 0; i < stages.length; i++) {
    taskListeners.forEach((listener) =>
      listener({ id, label, stage: stages[i], current: i, total: stages.length, unit: 'steps', status: 'running', instanceId })
    )
    await sleep(450)
  }
  taskListeners.forEach((listener) =>
    listener({ id, label, stage: 'Готово', current: stages.length, total: stages.length, unit: 'steps', status: 'done', instanceId })
  )
}

function setGame(patch: Partial<GameSnapshot>): void {
  game = { ...game, ...patch }
  stateListeners.forEach((listener) => listener(game))
}

const modVersions = (projectId: string, mcVersion: string, loader: string): ModVersion[] => {
  const base = MODS.find((mod) => mod.id === projectId)
  return [
    {
      id: `${projectId}-v1`,
      projectId,
      name: `${base?.name ?? projectId} 1.2.0`,
      versionNumber: '1.2.0',
      gameVersions: [mcVersion],
      loaders: [loader],
      datePublished: now,
      downloadUrl: `https://example.invalid/${projectId}.jar`,
      fileName: `${projectId}-1.2.0.jar`,
      fileSize: 1_800_000,
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
      dependencies: []
    }
  ]
}

export function createMockApi(): LauncherApi {
  const tag = (): void => {
    /* keep the preview alive with a couple of log lines */
  }
  window.setTimeout(() => {
    pushLog('Verdant Launcher 1.0.0 — демонстрационный режим (браузер)', 'info')
    pushLog('[main/INFO] Setting user: Steve', 'info', 'game')
    pushLog('[Render thread/INFO] OpenAL initialized', 'info', 'game')
    tag()
  }, 700)

  return {
    app: {
      info: async () => ({
        appVersion: '1.0.0',
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
        ['1.21.4', '1.21.1', '1.21', '1.20.6', '1.20.4', '1.20.1', '1.19.4', '1.18.2', '1.16.5', '1.12.2'].map((id) => ({
          id,
          type: 'release',
          releaseTime: now
        })),
      loaders: async () => [
        { version: '0.16.10', stable: true },
        { version: '0.16.9', stable: true },
        { version: '0.15.11', stable: false }
      ]
    },
    install: {
      run: async (instanceId: string) => {
        const instance = instances.find((item) => item.id === instanceId)
        await tick(`Установка «${instance?.name ?? ''}»`, ['Проверка версии', 'Установка загрузчика', 'Библиотеки и ассеты'], instanceId)
        if (instance) instance.installed = true
        return { ok: true }
      },
      cancel: () => undefined
    },
    game: {
      launch: async (instanceId: string) => {
        setGame({ state: 'checking', instanceId, startedAt: Date.now() })
        await sleep(500)
        setGame({ state: 'downloading' })
        await sleep(700)
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
    mods: {
      search: async (query) => {
        await sleep(420)
        const text = (query.query ?? '').toLowerCase()
        const hits = MODS.filter(
          (mod) =>
            (!text || mod.name.toLowerCase().includes(text) || mod.summary.toLowerCase().includes(text)) &&
            (!query.loader || query.loader === 'vanilla' || mod.loaders.includes(query.loader))
        ).map((mod) => ({ ...mod, source: query.source }))
        return { hits, total: hits.length, offset: 0, limit: 20 }
      },
      project: async (source, id) => {
        const mod = MODS.find((item) => item.id === id)
        return mod ? { ...mod, source } : null
      },
      versions: async (_source, projectId, mcVersion, loader) => modVersions(projectId, mcVersion, loader),
      install: async (input) => {
        const instance = instances.find((item) => item.id === input.instanceId)!
        await tick('Установка мода', ['Загрузка файла', 'Проверка зависимостей'], input.instanceId)
        const list = installedMods[input.instanceId] ?? []
        const mod = MODS.find((item) => item.id === input.projectId)
        list.push({
          projectId: input.projectId,
          fileName: `${input.projectId}-1.2.0.jar`,
          name: mod?.name ?? input.projectId,
          version: '1.2.0',
          iconUrl: null,
          enabled: true,
          source: input.source,
          size: 1_200_000,
          installedAt: now
        })
        installedMods[input.instanceId] = list
        instance.modsCount = list.length
        return { installed: [`${input.projectId}-1.2.0.jar`], skipped: [], warnings: [] }
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
        await tick(`Модпак «${input.projectName}»`, ['Скачивание архива', 'Создание сборки', 'Установка модов'])
        const created = makeInstance(`pack-${Date.now()}`, input.projectName, '1.21.1', 'fabric', 42)
        instances.unshift(created)
        return created
      },
      openFolder: async () => undefined
    }
  }
}
