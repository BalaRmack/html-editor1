import { execFile } from 'node:child_process'
import { access, readdir, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, sep } from 'node:path'
import { promisify } from 'node:util'
import { fetchJavaRuntimeManifest, installJavaRuntimeTask } from '@xmcl/installer'
import type { JavaRuntime } from '../../shared/types'
import { logger } from './logger'

const execFileAsync = promisify(execFile)

const JAVA_BIN = process.platform === 'win32' ? 'java.exe' : 'java'

function uniq<T>(items: T[]): T[] {
  return [...new Set(items)]
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function runReg(query: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('reg', query, { windowsHide: true, timeout: 6000 })
    return stdout
  } catch {
    return ''
  }
}

/** Parses `reg query` output for REG_SZ values that look like java homes. */
function regPaths(output: string): string[] {
  const found: string[] = []
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/REG_SZ\s+(.+)$/)
    if (!match) continue
    const value = match[1].trim()
    if (!value) continue
    if (/java|jdk|jre/i.test(value)) found.push(value)
  }
  return found
}

export async function validateJava(javaPath: string): Promise<JavaRuntime | null> {
  try {
    const { stderr } = await execFileAsync(javaPath, ['-XshowSettings:properties', '-version'], {
      windowsHide: true,
      timeout: 8000
    }).catch((error: { stderr?: string }) => ({ stderr: error?.stderr ?? '' }))
    const text = stderr ?? ''
    const version = /java\.version\s*=\s*(\S+)/.exec(text)?.[1]
    if (!version) return null
    const major = /^1\.(\d+)/.test(version) ? Number(/^1\.(\d+)/.exec(version)?.[1]) : Number(version.split('.')[0])
    const home = /java\.home\s*=\s*(.+)/.exec(text)?.[1]?.trim() || dirname(dirname(javaPath))
    const vendor = /java\.vendor\s*=\s*(.+)/.exec(text)?.[1]?.trim() || 'Unknown'
    const arch = /os\.arch\s*=\s*(.+)/.exec(text)?.[1]?.trim() || process.arch
    return {
      path: javaPath,
      home,
      version,
      major: Number.isFinite(major) ? major : 0,
      vendor,
      arch,
      source: 'common'
    }
  } catch {
    return null
  }
}

async function candidateFromHome(home: string, source: JavaRuntime['source']): Promise<JavaRuntime | null> {
  const candidates = [
    join(home, 'bin', JAVA_BIN),
    join(home, JAVA_BIN),
    join(home, 'jre', 'bin', JAVA_BIN),
    join(home, 'Contents', 'Home', 'bin', JAVA_BIN)
  ]
  for (const candidate of candidates) {
    if (await exists(candidate)) {
      const runtime = await validateJava(candidate)
      if (runtime) return { ...runtime, source }
    }
  }
  return null
}

async function listDirs(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => join(root, entry.name))
  } catch {
    return []
  }
}

async function windowsCandidates(): Promise<string[]> {
  const roots = [
    'HKLM\\SOFTWARE\\JavaSoft\\Java Runtime Environment',
    'HKLM\\SOFTWARE\\JavaSoft\\Java Development Kit',
    'HKLM\\SOFTWARE\\WOW6432Node\\JavaSoft\\Java Runtime Environment',
    'HKLM\\SOFTWARE\\WOW6432Node\\JavaSoft\\Java Development Kit',
    'HKLM\\SOFTWARE\\Eclipse Adoptium',
    'HKLM\\SOFTWARE\\Eclipse Foundation',
    'HKLM\\SOFTWARE\\Microsoft\\JDK',
    'HKLM\\SOFTWARE\\Azul Systems\\Zulu',
    'HKLM\\SOFTWARE\\BellSoft'
  ]
  const output = await Promise.all(
    roots.map((root) => runReg(['query', root, '/s', '/v', 'JavaHome']).then((out) => (out ? out : runReg(['query', root, '/s', '/v', 'Path']))))
  )
  const fromRegistry = output.flatMap(regPaths)

  const programFiles = [process.env['ProgramFiles'], process.env['ProgramFiles(x86)'], process.env['ProgramW6432']].filter(
    (dir): dir is string => Boolean(dir)
  )
  const vendors = [
    'Java',
    'Eclipse Adoptium',
    'Eclipse Foundation',
    'AdoptOpenJDK',
    'Zulu',
    'BellSoft',
    'Microsoft',
    'Amazon Corretto',
    'Semeru',
    'RedHat'
  ]
  const dirs: string[] = []
  for (const base of programFiles) {
    for (const vendor of vendors) dirs.push(...(await listDirs(join(base, vendor))))
  }
  dirs.push(...(await listDirs(join(homedir(), '.jdks'))))
  dirs.push(...(await listDirs(join(homedir(), '.gradle', 'jdks'))))
  const localPrograms = process.env['LOCALAPPDATA'] ? join(process.env['LOCALAPPDATA'], 'Programs') : null
  if (localPrograms) {
    for (const vendor of ['Eclipse Adoptium', 'Eclipse Foundation', 'Microsoft', 'Zulu']) {
      dirs.push(...(await listDirs(join(localPrograms, vendor))))
    }
  }
  return uniq([...fromRegistry, ...dirs])
}

async function unixCandidates(): Promise<string[]> {
  if (process.platform === 'darwin') {
    const roots = await listDirs('/Library/Java/JavaVirtualMachines')
    return roots.map((dir) => join(dir, 'Contents', 'Home'))
  }
  const roots = ['/usr/lib/jvm', '/usr/java', '/opt/java', '/opt/jdk', join(homedir(), '.sdkman', 'candidates', 'java'), join(homedir(), '.jdks')]
  const dirs: string[] = []
  for (const root of roots) dirs.push(...(await listDirs(root)))
  return dirs
}

class JavaService {
  private cache: JavaRuntime[] = []

  async scan(extraRoots: string[] = []): Promise<JavaRuntime[]> {
    const homes: { home: string; source: JavaRuntime['source'] }[] = []
    const registryHome = process.platform === 'win32' ? await windowsCandidates() : []
    for (const home of registryHome) homes.push({ home, source: 'registry' })
    for (const home of process.platform === 'win32' ? [] : await unixCandidates()) homes.push({ home, source: 'common' })
    for (const root of extraRoots) {
      homes.push({ home: root, source: 'launcher' })
      for (const dir of await listDirs(root)) homes.push({ home: dir, source: 'launcher' })
      if (process.platform === 'win32') {
        for (const dir of await listDirs(join(root, 'bin'))) homes.push({ home: dir, source: 'launcher' })
      }
    }

    const found: JavaRuntime[] = []
    const seen = new Set<string>()

    const add = async (runtime: JavaRuntime | null): Promise<void> => {
      if (!runtime) return
      let key = runtime.path
      try {
        key = await realpath(runtime.path)
      } catch {
        /* keep path */
      }
      if (seen.has(key)) return
      seen.add(key)
      found.push({ ...runtime, path: key })
    }

    for (const { home, source } of homes) {
      await add(await candidateFromHome(home, source))
    }

    // `java` on PATH
    try {
      const { stdout } = await execFileAsync(process.platform === 'win32' ? 'where' : 'which', ['java'], { windowsHide: true })
      for (const line of stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
        await add(await validateJava(line))
      }
    } catch {
      /* java is simply not on PATH */
    }

    if (process.platform === 'darwin') {
      try {
        const { stdout } = await execFileAsync('/usr/libexec/java_home', [], { timeout: 5000 })
        const home = stdout.trim()
        if (home) await add(await candidateFromHome(home, 'common'))
      } catch {
        /* no java_home */
      }
    }

    this.cache = found.sort((a, b) => b.major - a.major || a.path.localeCompare(b.path))
    logger.debug(`Найдено Java-рантаймов: ${this.cache.length}`)
    return this.cache
  }

  cached(): JavaRuntime[] {
    return this.cache
  }

  async validate(javaPath: string): Promise<JavaRuntime | null> {
    const direct = await validateJava(javaPath)
    if (direct) return direct
    return candidateFromHome(javaPath, 'manual')
  }

  /**
   * Picks the best runtime for a required Java major version.
   * Prefers an exact/newer match, otherwise returns the newest available.
   */
  async pick(preferredPath: string | null, requiredMajor: number): Promise<JavaRuntime | null> {
    if (preferredPath) {
      const manual = await this.validate(preferredPath)
      if (manual) return manual
    }
    const list = this.cache.length > 0 ? this.cache : await this.scan()
    if (list.length === 0) return null
    const exact = list.find((runtime) => runtime.major === requiredMajor)
    if (exact) return exact
    const newer = list.filter((runtime) => runtime.major >= requiredMajor).sort((a, b) => a.major - b.major)[0]
    if (newer) return newer
    return list[0]
  }

  async download(major: number, destinationRoot: string, onStage?: (stage: string) => void): Promise<JavaRuntime> {
    onStage?.(`Загрузка Java ${major}`)
    const target = major >= 21 ? 'java-runtime-delta' : major >= 17 ? 'java-runtime-gamma' : major >= 16 ? 'java-runtime-beta' : 'jre-legacy'
    const destination = join(destinationRoot, `jre-${target}`)
    logger.info(`Скачивание Java (${target}) в ${destination}`)
    const manifest = await fetchJavaRuntimeManifest({ target })
    onStage?.(`Распаковка Java ${manifest.version.name}`)
    const task = installJavaRuntimeTask({ destination, manifest })
    await task.startAndWait()
    const runtime = await candidateFromHome(destination, 'mojang')
    if (!runtime) throw new Error('java_download_failed')
    logger.info(`Java ${runtime.version} установлена`)
    this.cache = uniq([runtime, ...this.cache].map((item) => item))
    return runtime
  }

  /** Best-effort: does this path look like a java binary? */
  static looksLikeJava(path: string): boolean {
    return basename(path).toLowerCase() === JAVA_BIN.toLowerCase() || path.includes(`${sep}bin${sep}`)
  }
}

export const javaService = new JavaService()
