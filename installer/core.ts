import { execFile } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { chmod, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import * as yauzl from 'yauzl'

const run = promisify(execFile)

/**
 * Everything the bootstrapper does to the machine, kept free of Electron so it
 * can be unit-tested on any platform.
 *
 * The installer is a normal (frameless) Electron window; it unpacks `app.zip`
 * next to itself, writes shortcuts through WScript.Shell and registers itself in
 * `HKCU\...\Uninstall`. No NSIS wizard, no white system chrome.
 */

export const APP_ID = 'VerdantLauncher'
export const APP_NAME = 'Verdant Launcher'
export const PUBLISHER = 'BalaRmack'
export const UNINSTALL_KEY = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_ID}`
export const UNINSTALLER_NAME = 'Uninstall Verdant Launcher.exe'

export interface InstallPaths {
  /** `%LOCALAPPDATA%\VerdantLauncher` */
  dir: string
  /** The launcher executable inside the install dir. */
  exe: string
  uninstaller: string
  desktopShortcut: string
  startMenuShortcut: string
  /** `%APPDATA%\Verdant` — saves, settings, downloaded game files. */
  dataDir: string
}

export function defaultInstallDir(localAppData: string | undefined = process.env['LOCALAPPDATA']): string {
  const base = localAppData && localAppData.trim() ? localAppData : join(homedir(), 'AppData', 'Local')
  return join(base, APP_ID)
}

export function resolvePaths(
  dir: string,
  options: { roamingAppData?: string; desktop?: string; startMenu?: string } = {}
): InstallPaths {
  const roaming = options.roamingAppData ?? process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming')
  const desktop = options.desktop ?? join(homedir(), 'Desktop')
  const startMenu = options.startMenu ?? join(roaming, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  return {
    dir,
    exe: join(dir, 'VerdantLauncher.exe'),
    uninstaller: join(dir, UNINSTALLER_NAME),
    desktopShortcut: join(desktop, `${APP_NAME}.lnk`),
    startMenuShortcut: join(startMenu, `${APP_NAME}.lnk`),
    dataDir: join(roaming, 'Verdant')
  }
}

/* -------------------------------------------------------------------------- */
/*  ZIP payload                                                               */
/* -------------------------------------------------------------------------- */

export interface ExtractProgress {
  files: number
  totalFiles: number
  bytes: number
  totalBytes: number
}

/**
 * Streams `app.zip` to disk entry by entry (never into RAM — the payload is
 * ~200 MB). `onProgress` is called for every chunk so the installer bar moves.
 */
export async function extractPayload(
  zipPath: string,
  destination: string,
  onProgress?: (progress: ExtractProgress) => void
): Promise<ExtractProgress> {
  // Inside Electron any path ending in `.asar` is treated as an asar archive, so
  // writing the payload's `resources/app.asar` fails ("Invalid package") or hangs.
  // `noAsar` makes fs behave normally while we unpack; plain Node ignores it.
  const proc = process as NodeJS.Process & { noAsar?: boolean }
  const previous = proc.noAsar
  proc.noAsar = true
  try {
    return await extractPayloadFiles(zipPath, destination, onProgress)
  } finally {
    proc.noAsar = previous ?? false
  }
}

async function extractPayloadFiles(
  zipPath: string,
  destination: string,
  onProgress?: (progress: ExtractProgress) => void
): Promise<ExtractProgress> {
  const open = (): Promise<yauzl.ZipFile> =>
    new Promise((resolve, reject) => {
      yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (error, file) => {
        if (error || !file) reject(error ?? new Error('Не удалось открыть архив'))
        else resolve(file)
      })
    })

  // Pass 1 reads only the central directory, so the totals are known up front.
  // Counting them while extracting made the percentage jump backwards.
  const totals = await new Promise<{ files: number; bytes: number }>((resolve, reject) => {
    open().then((scan) => {
      let files = 0
      let bytes = 0
      scan.on('error', reject)
      scan.on('end', () => resolve({ files, bytes }))
      scan.on('entry', (entry: yauzl.Entry) => {
        const name = entry.fileName.replace(/\\/g, '/')
        if (!/\/$/.test(name) && !name.split('/').includes('..') && !name.startsWith('/')) {
          files += 1
          bytes += entry.uncompressedSize
        }
        scan.readEntry()
      })
      scan.readEntry()
    }, reject)
  })
  const progress: ExtractProgress = { files: 0, totalFiles: totals.files, bytes: 0, totalBytes: totals.bytes }
  const zip = await open()

  /**
   * One entry at a time, streamed through `pipeline`.
   *
   * The obvious version — `stream.on('data', …)` for the byte counter and then
   * `stream.pipe(out)` after an `await mkdir()` — has a race that cost a real
   * Windows build: attaching a `data` listener switches the entry stream to
   * flowing *before* the write stream exists, so the first chunks (sometimes the
   * whole small file) are counted and dropped. `pipeline` attaches both ends in
   * the same tick and handles backpressure, so the file on disk is always exact.
   */
  const handleEntry = async (entry: yauzl.Entry): Promise<void> => {
    const name = entry.fileName.replace(/\\/g, '/')
    if (/\/$/.test(name)) return
    // A zip can carry `../` — never write outside the install dir.
    if (name.split('/').includes('..') || name.startsWith('/')) return

    const target = join(destination, name)
    const stream = await new Promise<Readable>((resolve, reject) => {
      zip.openReadStream(entry, (error, readStream) => {
        if (error || !readStream) reject(error ?? new Error(`Не удалось прочитать ${name}`))
        else resolve(readStream)
      })
    })
    await mkdir(dirname(target), { recursive: true })
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        progress.bytes += chunk.length
        onProgress?.({ ...progress })
        callback(null, chunk)
      }
    })
    await pipeline(stream, counter, createWriteStream(target))
    progress.files += 1
    onProgress?.({ ...progress })
  }

  await new Promise<void>((resolve, reject) => {
    zip.on('error', reject)
    zip.on('end', () => resolve())
    zip.on('entry', (entry: yauzl.Entry) => {
      void handleEntry(entry)
        .then(() => zip.readEntry())
        .catch(reject)
    })
    zip.readEntry()
  })
  return progress
}

/* -------------------------------------------------------------------------- */
/*  Shortcuts (WScript.Shell — no extra dependency)                           */
/* -------------------------------------------------------------------------- */

/** PowerShell script creating one .lnk. Exported so it can be asserted in tests. */
export function shortcutScript(shortcut: string, target: string, workDir: string, description = APP_NAME): string {
  const q = (value: string): string => `'${value.replace(/'/g, "''")}'`
  return [
    "$ErrorActionPreference = 'Stop'",
    `$link = (New-Object -ComObject WScript.Shell).CreateShortcut(${q(shortcut)})`,
    `$link.TargetPath = ${q(target)}`,
    `$link.WorkingDirectory = ${q(workDir)}`,
    `$link.IconLocation = ${q(target)}`,
    `$link.Description = ${q(description)}`,
    '$link.Save()'
  ].join('\n')
}

export async function createShortcut(shortcut: string, target: string, workDir: string): Promise<void> {
  await mkdir(dirname(shortcut), { recursive: true })
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', shortcutScript(shortcut, target, workDir)], {
    timeout: 20_000,
    windowsHide: true
  })
}

/* -------------------------------------------------------------------------- */
/*  Registry                                                                  */
/* -------------------------------------------------------------------------- */

export interface RegistryValues {
  DisplayName: string
  DisplayVersion: string
  Publisher: string
  InstallLocation: string
  DisplayIcon: string
  UninstallString: string
  QuietUninstallString: string
  EstimatedSize?: number
  NoModify: number
  NoRepair: number
}

/**
 * The exact values Windows shows in «Установка и удаление программ». Pure: the
 * caller turns them into `reg.exe add` arguments.
 */
export function uninstallRegistry(paths: InstallPaths, version: string, sizeKb?: number): RegistryValues {
  const values: RegistryValues = {
    DisplayName: APP_NAME,
    DisplayVersion: version,
    Publisher: PUBLISHER,
    InstallLocation: paths.dir,
    DisplayIcon: paths.exe,
    UninstallString: `"${paths.uninstaller}" --uninstall`,
    QuietUninstallString: `"${paths.uninstaller}" --uninstall --silent`,
    NoModify: 1,
    NoRepair: 1
  }
  if (sizeKb && sizeKb > 0) values.EstimatedSize = Math.round(sizeKb)
  return values
}

/** `reg.exe` arguments for one value. */
export function registryArgs(key: string, name: string, value: string | number): string[] {
  const isNumber = typeof value === 'number'
  return [
    'add',
    key,
    '/v',
    name,
    '/t',
    isNumber ? 'REG_DWORD' : 'REG_SZ',
    '/d',
    isNumber ? `0x${value.toString(16)}` : String(value),
    '/f'
  ]
}

export async function writeUninstallRegistry(paths: InstallPaths, version: string, sizeKb?: number): Promise<void> {
  const values = uninstallRegistry(paths, version, sizeKb)
  for (const [name, value] of Object.entries(values)) {
    await run('reg.exe', registryArgs(UNINSTALL_KEY, name, value as string | number), {
      timeout: 15_000,
      windowsHide: true
    })
  }
}

export async function removeUninstallRegistry(): Promise<void> {
  await run('reg.exe', ['delete', UNINSTALL_KEY, '/f']).catch(() => undefined)
}

/* -------------------------------------------------------------------------- */
/*  Install / uninstall                                                       */
/* -------------------------------------------------------------------------- */

export interface InstallPhaseEvent {
  stage: 'preparing' | 'extracting' | 'shortcuts' | 'registry' | 'done'
  percent: number
  detail?: string
  bytesPerSecond?: number
  etaSeconds?: number | null
}

export interface InstallOptions {
  installDir: string
  payloadZip: string
  version: string
  /** The running setup exe — copied into the install dir as the uninstaller. */
  setupExe?: string
  desktopShortcut: boolean
  startMenuShortcut: boolean
  onProgress?: (event: InstallPhaseEvent) => void
  signal?: AbortSignal
  /** Injectable for tests. */
  fileOps?: {
    extract?: typeof extractPayload
    copy?: (from: string, to: string) => Promise<void>
    shortcut?: typeof createShortcut
    registry?: typeof writeUninstallRegistry
  }
}

const STAGE_RANGES: Record<InstallPhaseEvent['stage'], [number, number]> = {
  preparing: [0, 6],
  extracting: [6, 82],
  shortcuts: [82, 92],
  registry: [92, 98],
  done: [100, 100]
}

export function stagePercent(stage: InstallPhaseEvent['stage'], fraction: number): number {
  const [from, to] = STAGE_RANGES[stage]
  return Math.min(100, Math.max(0, from + (to - from) * Math.min(1, Math.max(0, fraction))))
}

async function copyFile(from: string, to: string): Promise<void> {
  const { copyFile: copy } = await import('node:fs/promises')
  await copy(from, to)
}

export async function installLauncher(options: InstallOptions): Promise<void> {
  const { installDir, payloadZip, version, setupExe, onProgress } = options
  const emit = (stage: InstallPhaseEvent['stage'], fraction: number, detail?: string): void => {
    onProgress?.({ stage, percent: stagePercent(stage, fraction), detail })
  }
  const ops = {
    extract: options.fileOps?.extract ?? extractPayload,
    copy: options.fileOps?.copy ?? copyFile,
    shortcut: options.fileOps?.shortcut ?? createShortcut,
    registry: options.fileOps?.registry ?? writeUninstallRegistry
  }

  emit('preparing', 0, 'Подготовка папки')
  await mkdir(installDir, { recursive: true })

  emit('extracting', 0, 'Распаковка файлов лаунчера')
  // Chunk events arrive ~9000 times a second; sending each one over IPC floods
  // the renderer and the window looks frozen. Forward at most one per 80 ms.
  let lastEmit = 0
  const stats = await ops.extract(payloadZip, installDir, (progress) => {
    const now = Date.now()
    if (now - lastEmit < 80 && progress.bytes < progress.totalBytes) return
    lastEmit = now
    const fraction = progress.totalBytes > 0 ? progress.bytes / progress.totalBytes : 0
    emit('extracting', fraction, `${progress.files} из ${progress.totalFiles} файлов`)
  })
  if (options.signal?.aborted) throw new Error('Установка отменена')

  const paths = resolvePaths(installDir)
  // The same bootstrapper doubles as the uninstaller: copy the setup exe into
  // the install dir so the registry entry always works, even if the installer
  // file itself is deleted from Downloads.
  if (setupExe) {
    emit('shortcuts', 0, 'Подготовка деинсталлятора')
    await ops.copy(setupExe, paths.uninstaller).catch(() => undefined)
    await chmod(paths.uninstaller, 0o755).catch(() => undefined)
  }

  emit('shortcuts', 0.3, 'Ярлыки')
  if (options.desktopShortcut) await ops.shortcut(paths.desktopShortcut, paths.exe, installDir).catch(() => undefined)
  if (options.startMenuShortcut) await ops.shortcut(paths.startMenuShortcut, paths.exe, installDir).catch(() => undefined)

  emit('registry', 0, 'Запись в реестр')
  const sizeKb = Math.round((stats.bytes / 1024) * 1.02)
  await ops.registry(paths, version, sizeKb)
  emit('done', 1, 'Готово')
}

export interface UninstallOptions {
  installDir: string
  removeData: boolean
  onProgress?: (event: InstallPhaseEvent) => void
  fileOps?: {
    shortcut?: typeof createShortcut
    registry?: typeof removeUninstallRegistry
  }
}

async function listSize(dir: string): Promise<number> {
  let total = 0
  const walk = async (current: string): Promise<void> => {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await readdir(current, { withFileTypes: true, encoding: 'utf8' })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(current, String(entry.name))
      if (entry.isDirectory()) await walk(path)
      else {
        try {
          total += (await stat(path)).size
        } catch {
          /* a locked file does not break the estimate */
        }
      }
    }
  }
  await walk(dir)
  return total
}

export async function uninstallLauncher(options: UninstallOptions): Promise<void> {
  const { installDir, removeData, onProgress } = options
  const emit = (stage: InstallPhaseEvent['stage'], fraction: number, detail?: string): void => {
    onProgress?.({ stage, percent: stagePercent(stage, fraction), detail })
  }
  const ops = { registry: options.fileOps?.registry ?? removeUninstallRegistry }
  const paths = resolvePaths(installDir)

  emit('preparing', 0, 'Удаление ярлыков')
  await rm(paths.desktopShortcut, { force: true }).catch(() => undefined)
  await rm(paths.startMenuShortcut, { force: true }).catch(() => undefined)

  emit('registry', 0, 'Удаление записи из реестра')
  await ops.registry()

  emit('extracting', 0, 'Удаление файлов лаунчера')
  const total = await listSize(installDir)
  // `rm` is recursive and not per-file observable; report by bytes estimate.
  await rm(installDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 120 }).catch(() => undefined)
  emit('extracting', 1, `${(total / (1024 * 1024)).toFixed(0)} МБ освобождено`)

  if (removeData) {
    emit('shortcuts', 0.5, 'Удаление сохранений и настроек')
    await rm(paths.dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 120 }).catch(() => undefined)
  }
  emit('done', 1, 'Удалено')
}
