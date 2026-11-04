import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import {
  defaultInstallDir,
  extractPayload,
  installLauncher,
  registryArgs,
  resolvePaths,
  shortcutScript,
  stagePercent,
  uninstallLauncher,
  uninstallRegistry,
  type InstallPhaseEvent
} from '../installer/core'

const run = promisify(execFile)

describe('paths', () => {
  it('installs into %LOCALAPPDATA%\\VerdantLauncher', () => {
    expect(defaultInstallDir('C:\\Users\\Player\\AppData\\Local')).toBe(
      join('C:\\Users\\Player\\AppData\\Local', 'VerdantLauncher')
    )
  })

  it('builds shortcuts, uninstaller and the roaming data dir', () => {
    const paths = resolvePaths('C:\\Apps\\VerdantLauncher', {
      roamingAppData: 'C:\\Roaming',
      desktop: 'C:\\Desktop',
      startMenu: 'C:\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs'
    })
    expect(paths.exe.endsWith('VerdantLauncher.exe')).toBe(true)
    expect(paths.uninstaller.endsWith('Uninstall Verdant Launcher.exe')).toBe(true)
    expect(paths.desktopShortcut).toBe(join('C:\\Desktop', 'Verdant Launcher.lnk'))
    expect(paths.dataDir).toBe(join('C:\\Roaming', 'Verdant'))
  })
})

describe('registry entry («Установка и удаление программ»)', () => {
  const paths = resolvePaths('C:\\Apps\\VerdantLauncher', {
    roamingAppData: 'C:\\Roaming',
    desktop: 'C:\\Desktop',
    startMenu: 'C:\\Start'
  })

  it('points both uninstall strings at the bootstrapper', () => {
    const values = uninstallRegistry(paths, '1.2.0', 204800)
    expect(values.DisplayName).toBe('Verdant Launcher')
    expect(values.DisplayVersion).toBe('1.2.0')
    expect(values.UninstallString).toBe(`"${paths.uninstaller}" --uninstall`)
    expect(values.QuietUninstallString).toBe(`"${paths.uninstaller}" --uninstall --silent`)
    expect(values.EstimatedSize).toBe(204800)
    expect(values.NoModify).toBe(1)
  })

  it('writes REG_SZ and REG_DWORD values with reg.exe', () => {
    expect(registryArgs('HKCU\\Key', 'DisplayName', 'Verdant Launcher')).toEqual([
      'add',
      'HKCU\\Key',
      '/v',
      'DisplayName',
      '/t',
      'REG_SZ',
      '/d',
      'Verdant Launcher',
      '/f'
    ])
    expect(registryArgs('HKCU\\Key', 'NoModify', 1).slice(4)).toEqual(['/t', 'REG_DWORD', '/d', '0x1', '/f'])
  })

  it('escapes apostrophes in the shortcut script', () => {
    const script = shortcutScript("C:\\Users\\O'Brien\\Desktop\\Verdant Launcher.lnk", 'C:\\App\\V.exe', 'C:\\App')
    expect(script).toContain("'C:\\Users\\O''Brien\\Desktop\\Verdant Launcher.lnk'")
    expect(script).toContain('$link.TargetPath = \'C:\\App\\V.exe\'')
    expect(script).toContain('$link.Save()')
  })
})

describe('progress mapping', () => {
  it('never goes backwards across stages', () => {
    const stops = (['preparing', 'extracting', 'shortcuts', 'registry', 'done'] as const).map((stage) =>
      stagePercent(stage, stage === 'done' ? 1 : 0)
    )
    for (let index = 1; index < stops.length; index++) expect(stops[index]).toBeGreaterThanOrEqual(stops[index - 1])
    expect(stops[0]).toBe(0)
    expect(stops.at(-1)).toBe(100)
  })

  it('spreads extraction over its own slice', () => {
    expect(stagePercent('extracting', 0.5)).toBe(44)
    expect(stagePercent('extracting', 2)).toBe(82)
    expect(stagePercent('extracting', -1)).toBe(6)
  })
})

describe('payload archive', () => {
  it('packs and extracts a directory byte-for-byte', async () => {
    const source = await mkdtemp(join(tmpdir(), 'verdant-zip-src-'))
    const target = await mkdtemp(join(tmpdir(), 'verdant-zip-dst-'))
    const zip = join(await mkdtemp(join(tmpdir(), 'verdant-zip-out-')), 'app.zip')
    try {
      await mkdir(join(source, 'resources'), { recursive: true })
      // 320 KB of pseudo-random bytes: big enough to arrive in many chunks, so
      // a lost first chunk (the Windows race fixed in 1.2.0) is visible here.
      const random = Buffer.alloc(320 * 1024)
      let seed = 7
      for (let index = 0; index < random.length; index++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff
        random[index] = seed & 0xff
      }
      await writeFile(join(source, 'VerdantLauncher.exe'), random)
      await writeFile(join(source, 'resources', 'app.asar'), Buffer.from('asar payload'))
      await run('node', ['scripts/make-payload.mjs', source, zip])

      const progress: number[] = []
      const stats = await extractPayload(zip, target, (event) => progress.push(event.bytes))
      expect(stats.files).toBe(2)
      expect(progress.length).toBeGreaterThan(0)
      expect(progress.at(-1)).toBe(stats.bytes)
      expect((await readFile(join(target, 'resources', 'app.asar'), 'utf8'))).toBe('asar payload')
      const extracted = await readFile(join(target, 'VerdantLauncher.exe'))
      expect(extracted.length).toBe(random.length)
      expect(extracted.equals(random)).toBe(true)
      expect(stats.bytes).toBe(random.length + 'asar payload'.length)
    } finally {
      await rm(source, { recursive: true, force: true })
      await rm(target, { recursive: true, force: true })
      await rm(zip, { force: true })
    }
  }, 30_000)
})

describe('install / uninstall orchestration', () => {
  it('runs prepare → extract → shortcuts → registry and finishes at 100 %', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'verdant-install-'))
    const events: InstallPhaseEvent[] = []
    const shortcuts: string[] = []
    let registryArgsSeen: unknown[] | null = null
    let copied: string | null = null
    try {
      await installLauncher({
        installDir: join(dir, 'app'),
        payloadZip: 'fake.zip',
        version: '1.2.0',
        setupExe: 'C:\\Downloads\\Setup.exe',
        desktopShortcut: true,
        startMenuShortcut: false,
        onProgress: (event) => events.push(event),
        fileOps: {
          extract: async () => ({ files: 10, totalFiles: 10, bytes: 1_048_576, totalBytes: 1_048_576 }),
          copy: async (from) => {
            copied = from
          },
          shortcut: async (shortcut) => {
            shortcuts.push(shortcut)
          },
          registry: async (_paths, version, sizeKb) => {
            registryArgsSeen = [version, sizeKb]
          }
        }
      })
      expect(events.at(-1)?.stage).toBe('done')
      expect(events.at(-1)?.percent).toBe(100)
      expect(events.some((event) => event.stage === 'extracting')).toBe(true)
      expect(copied).toBe('C:\\Downloads\\Setup.exe')
      expect(shortcuts).toHaveLength(1)
      expect(shortcuts[0]).toContain('Verdant Launcher.lnk')
      // 1 MiB + 2 % (installer overhead) → 1044 KB
      expect(registryArgsSeen).toEqual(['1.2.0', 1044])
      // Progress is monotonic from start to finish.
      const percentages = events.map((event) => event.percent)
      expect(percentages).toEqual([...percentages].sort((a, b) => a - b))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('removes the install dir and, on request, the data dir', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'verdant-uninstall-'))
    const installDir = join(dir, 'app')
    await mkdir(installDir, { recursive: true })
    await writeFile(join(installDir, 'VerdantLauncher.exe'), 'x')
    let unregistered = 0
    await uninstallLauncher({
      installDir,
      removeData: false,
      fileOps: {
        registry: async () => {
          unregistered += 1
        }
      }
    })
    expect(unregistered).toBe(1)
    await expect(stat(installDir)).rejects.toThrow()
    await rm(dir, { recursive: true, force: true })
  })
})
