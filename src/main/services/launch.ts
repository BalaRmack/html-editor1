import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import {
  DEFAULT_EXTRA_JVM_ARGS,
  LaunchPrecheck,
  Version,
  createMinecraftProcessWatcher,
  launch as launchMinecraft,
  type LaunchOption,
  type MinecraftProcessWatcher
} from '@xmcl/core'
import { installDependencies } from '@xmcl/installer'
import { APP_NAME, APP_VERSION } from '../../shared/constants'
import type { AppSettings, CrashInfo, GameSnapshot, Instance, LaunchResult, OfflineProfile } from '../../shared/types'
import { toFailure } from './errors'
import { checkIntegrity } from './integrity'
import { javaService } from './java'
import { logger } from './logger'
import { offlineToken } from './offline'

export interface LaunchContext {
  instance: Instance
  profile: OfflineProfile
  settings: AppSettings
  sharedDir: string
  instanceDir: string
  javaDir: string
  onAfterLaunch?: () => void
}

type StateListener = (snapshot: GameSnapshot) => void
type CrashListener = (crash: CrashInfo) => void

const ANSI_RE = /\u001b\[[0-9;]*m/g

/**
 * Splits a JVM args string the way a shell would, honouring quotes that may sit
 * in the middle of a token: `-Dfoo="a b"` -> `-Dfoo=a b`.
 */
export function splitArgs(input: string): string[] {
  const result: string[] = []
  if (!input) return result
  let current = ''
  let quote: '"' | "'" | null = null
  let started = false

  for (const char of input) {
    if (quote) {
      if (char === quote) quote = null
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      started = true
      continue
    }
    if (/\s/.test(char)) {
      if (started) result.push(current)
      current = ''
      started = false
      continue
    }
    current += char
    started = true
  }
  if (started) result.push(current)
  return result
}

/** Keeps the JVM flags Minecraft ships with unless the user tuned them explicitly. */
export function buildJvmArgs(userArgs: string): string[] {
  const baseFlags = DEFAULT_EXTRA_JVM_ARGS.filter((flag) => flag !== '-Xmx2G')
  const extra = splitArgs(userArgs)
  const tunedGc = extra.some((flag) => /^-XX:\+Use/.test(flag))
  const base = tunedGc ? baseFlags.filter((flag) => !/^-XX:/.test(flag)) : baseFlags
  return [...base, ...extra]
}

/** On Windows prefers `javaw.exe` (no console window) when it sits next to `java.exe`. */
export function windowedJava(javaPath: string): string {
  if (process.platform !== 'win32') return javaPath
  if (!/[\\/]java\.exe$/i.test(javaPath)) return javaPath
  const candidate = javaPath.replace(/java\.exe$/i, 'javaw.exe')
  return existsSync(candidate) ? candidate : javaPath
}

export class LaunchService {
  private child: ChildProcess | null = null
  private watcher: MinecraftProcessWatcher | null = null
  private snapshot: GameSnapshot = {
    state: 'idle',
    instanceId: null,
    startedAt: null,
    exitCode: null,
    crashReportLocation: null
  }
  private stateListeners = new Set<StateListener>()
  private crashListeners = new Set<CrashListener>()
  private currentInstanceId: string | null = null
  private starting = false

  state(): GameSnapshot {
    return { ...this.snapshot }
  }

  isRunning(): boolean {
    return this.child !== null
  }

  onState(listener: StateListener): () => void {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  onCrash(listener: CrashListener): () => void {
    this.crashListeners.add(listener)
    return () => this.crashListeners.delete(listener)
  }

  private setState(patch: Partial<GameSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.stateListeners) {
      try {
        listener({ ...this.snapshot })
      } catch {
        /* ignore */
      }
    }
  }

  private pipeOutput(child: ChildProcess): void {
    const attach = (stream: NodeJS.ReadableStream | null): void => {
      if (!stream) return
      let buffer = ''
      stream.setEncoding('utf8')
      stream.on('data', (chunk: string) => {
        buffer += chunk
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() ?? ''
        for (const raw of lines) {
          const text = raw.replace(ANSI_RE, '').trimEnd()
          if (!text) continue
          logger.push(LaunchService.classify(text), text, 'game')
        }
      })
    }
    attach(child.stdout)
    attach(child.stderr)
  }

  static classify(text: string): 'info' | 'warn' | 'error' | 'debug' {
    if (/^\[[^\]]+\/(ERROR|FATAL)\]|Exception in thread|Error:|Caused by:|#@!@# Game crashed/.test(text)) return 'error'
    if (/^\[[^\]]+\/WARN\]|WARN(ING)?:/.test(text)) return 'warn'
    if (/^\[[^\]]+\/DEBUG\]/.test(text)) return 'debug'
    return 'info'
  }

  async launch(context: LaunchContext): Promise<LaunchResult> {
    // `child` is only set after spawn, so guard the whole preparation phase too
    // (integrity check, repair, Java download) against a double click.
    if (this.child || this.starting) {
      return { ok: false, error: 'game_running' }
    }
    this.starting = true
    try {
      return await this.doLaunch(context)
    } finally {
      this.starting = false
    }
  }

  private async doLaunch(context: LaunchContext): Promise<LaunchResult> {
    const { instance, profile, settings, sharedDir, instanceDir } = context
    this.currentInstanceId = instance.id
    this.setState({ state: 'checking', instanceId: instance.id, startedAt: null, exitCode: null, crashReportLocation: null })

    try {
      const minecraft = join(sharedDir, 'versions', instance.versionId, `${instance.versionId}.json`)
      try {
        await readFile(minecraft, 'utf8')
      } catch {
        this.setState({ state: 'idle' })
        return { ok: false, error: 'not_installed' }
      }

      logger.info(`Запуск «${instance.name}» (${instance.versionId})`)
      const resolved = await Version.parse(sharedDir, instance.versionId)
      const requiredJava = resolved.javaVersion?.majorVersion ?? 8
      let java = await javaService.pick(instance.javaPath ?? settings.javaPath, requiredJava)
      if (!java) {
        if (!settings.autoDownloadJava) {
          this.setState({ state: 'idle' })
          return { ok: false, error: 'java_not_found' }
        }
        logger.info(`Java ${requiredJava} не найдена — скачиваем рантайм Mojang`)
        java = await javaService.download(requiredJava, context.javaDir, (stage) => logger.info(stage))
      }

      this.setState({ state: 'downloading' })
      logger.info('Проверка целостности файлов игры…')

      // Repair before launching: `installDependencies` re-downloads only what is
      // missing, but if it dies on the network we must never fall through to
      // `launchMinecraft` with a half-populated directory.
      try {
        await installDependencies(resolved, {})
      } catch (error) {
        const failure = toFailure(error, 'libraries')
        logger.error(`Докачка файлов не удалась: ${failure.message}`)
        this.setState({ state: 'idle' })
        return { ok: false, error: failure.code, file: failure.file }
      }

      // Incremental: `instanceDir` lets the check reuse the fingerprint cache,
      // so a healthy install is validated by stat alone instead of re-hashing
      // every library and asset on each launch.
      const report = await checkIntegrity(
        { id: instance.id, versionId: instance.versionId, mcVersion: instance.mcVersion, instanceDir },
        sharedDir
      )
      if (!report.ok) {
        logger.error(`Целостность не подтверждена: не хватает ${report.missing.length + report.truncatedIssues} файлов`)
        this.setState({ state: 'idle' })
        return { ok: false, error: 'integrity_failed', file: report.missing[0]?.name }
      }
      logger.info('Файлы в порядке')

      await mkdir(instanceDir, { recursive: true })
      const nativeRoot = join(context.instanceDir, '.natives', instance.versionId)
      await mkdir(nativeRoot, { recursive: true })

      const options: LaunchOption = {
        gamePath: context.instanceDir,
        resourcePath: sharedDir,
        javaPath: windowedJava(java.path),
        version: resolved,
        gameProfile: { name: profile.name, id: profile.uuid },
        accessToken: offlineToken(profile.uuid),
        userType: 'mojang',
        launcherName: APP_NAME,
        launcherBrand: APP_VERSION,
        minMemory: instance.memory.min,
        maxMemory: instance.memory.max,
        extraJVMArgs: buildJvmArgs(instance.jvmArgs || settings.defaultJvmArgs),
        nativeRoot,
        prechecks: [
          LaunchPrecheck.checkVersion,
          LaunchPrecheck.checkLibraries,
          LaunchPrecheck.checkNatives,
          LaunchPrecheck.linkAssets
        ],
        // No `windowsHide`: Windows would apply SW_HIDE to the game's first window
        // and Minecraft would run invisible. `javaw.exe` has no console instead.
        extraExecOption: {}
      }

      this.setState({ state: 'starting' })
      const child = await launchMinecraft(options)
      this.child = child
      this.pipeOutput(child)

      const watcher = createMinecraftProcessWatcher(child)
      this.watcher = watcher
      watcher.on('minecraft-window-ready', () => {
        this.setState({ state: 'running' })
        logger.info('Игра запущена')
      })
      watcher.on('error', (error: Error) => {
        logger.error(`Процесс игры не стартовал: ${error.message}`)
        this.child = null
        this.setState({ state: 'exited', exitCode: -1 })
      })
      watcher.on('minecraft-exit', (event) => {
        this.child = null
        this.watcher = null
        this.setState({
          state: 'exited',
          exitCode: event.code,
          crashReportLocation: event.crashReport ? event.crashReportLocation : null
        })
        logger.info(`Игра завершилась с кодом ${event.code}`)
        if (event.crashReport) {
          logger.error('Обнаружен crash-report')
          for (const listener of this.crashListeners) {
            try {
              listener({
                instanceId: instance.id,
                code: event.code,
                report: event.crashReport,
                location: event.crashReportLocation
              })
            } catch {
              /* ignore */
            }
          }
        }
      })

      this.setState({ startedAt: Date.now() })
      context.onAfterLaunch?.()
      return { ok: true }
    } catch (error) {
      const failure = toFailure(error)
      logger.error(`Ошибка запуска: [${failure.code}] ${failure.message}`)
      this.child = null
      this.setState({ state: 'idle' })
      return { ok: false, error: failure.code, file: failure.file }
    }
  }

  kill(): void {
    const child = this.child
    if (!child || !child.pid) return
    logger.warn('Принудительное завершение игры')
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => {
        child.kill('SIGKILL')
      })
    } else {
      child.kill('SIGTERM')
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL')
      }, 4000)
    }
  }

  get instanceId(): string | null {
    return this.currentInstanceId
  }

  /** Extra classpath helper kept for future loader-specific patches. */
  static joinClasspath(entries: string[]): string {
    return entries.join(delimiter)
  }
}

export const launcher = new LaunchService()
