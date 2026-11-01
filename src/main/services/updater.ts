import { app } from 'electron'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { autoUpdater } from 'electron-updater'
import { APP_VERSION, GITHUB_OWNER, GITHUB_REPO } from '../../shared/constants'
import type { UpdateProgress, UpdateRelease, UpdateState } from '../../shared/types'
import { configStore } from './config-store'
import { logger } from './logger'
import { downloadFile, fetchJson } from './net'
import { paths } from './paths'
import {
  compareVersions,
  decideUpdate,
  isNewerVersion,
  normalizeRelease,
  type GitHubRelease
} from './update-logic'

const CHECK_INTERVAL_MS = 60 * 60 * 1000 // once an hour, as asked
/** GitHub API host is overridable so tests / mirrors can point elsewhere. */
const GITHUB_API = process.env['VERDANT_GITHUB_API'] ?? 'https://api.github.com'

type Listener = (state: UpdateState) => void

function progressOf(transferred: number, total: number, bytesPerSecond: number): UpdateProgress {
  const percent = total > 0 ? Math.min(100, Math.round((transferred / total) * 100)) : 0
  return { percent, transferred, total, bytesPerSecond }
}

/**
 * Launcher self-update.
 *
 * Flow (and the reason for each half):
 *  1. poll GitHub `releases/latest` on boot and every hour — this is the only
 *     way to know a release exists *before* electron-updater's own manifest
 *     check, and it also works for a portable/dev build;
 *  2. the announcement (and the «Не скачивать эту версию» preference) is
 *     decided by the pure `decideUpdate()`;
 *  3. the actual download/install is delegated to `electron-updater`, which
 *     verifies the blockmap and swaps the app atomically.
 */
export class UpdateService {
  private state: UpdateState = {
    phase: 'idle',
    currentVersion: APP_VERSION,
    release: null,
    progress: null,
    checkedAt: null,
    skippedVersion: null
  }

  private listeners = new Set<Listener>()
  private timer: NodeJS.Timeout | null = null
  private checking: Promise<UpdateState> | null = null
  private deferredTag: string | null = null
  private wiring: boolean = false
  /** The downloaded setup exe, kept until the user presses «Перезапустить». */
  private installerPath: string | null = null

  init(): void {
    this.state.currentVersion = app.getVersion() || APP_VERSION
    this.state.skippedVersion = configStore.skippedUpdate()
    this.wireAutoUpdater()
  }

  private wireAutoUpdater(): void {
    if (this.wiring) return
    this.wiring = true
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowPrerelease = false
    autoUpdater.logger = {
      info: (message?: unknown) => logger.info(`[updater] ${String(message)}`),
      warn: (message?: unknown) => logger.warn(`[updater] ${String(message)}`),
      error: (message?: unknown) => logger.error(`[updater] ${String(message)}`),
      debug: (message?: unknown) => logger.debug(`[updater] ${String(message)}`)
    } as unknown as typeof autoUpdater.logger

    autoUpdater.on('download-progress', (progress) => {
      this.patch({
        phase: 'downloading',
        progress: progressOf(progress.transferred, progress.total, progress.bytesPerSecond)
      })
    })

    autoUpdater.on('update-downloaded', (info) => {
      logger.info(`Обновление ${info.version} скачано`)
      this.patch({
        phase: 'ready',
        progress: this.state.progress ? { ...this.state.progress, percent: 100 } : null
      })
    })

    autoUpdater.on('error', (error) => {
      // A missing publish config in a dev build is not worth a red banner.
      if (!app.isPackaged) {
        logger.warn(`[updater] ${error.message}`)
        return
      }
      this.patch({ phase: 'error', error: error.message })
    })
  }

  onState(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  stateSnapshot(): UpdateState {
    return this.state
  }

  /** Boot check + hourly timer. Safe to call twice. */
  start(): void {
    if (this.timer) return
    void this.check()
    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS)
    // Do not keep the app alive just for the timer.
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private patch(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) {
      try {
        listener(this.state)
      } catch {
        /* a broken listener must not break updates */
      }
    }
  }

  /** One GitHub API round-trip; concurrent callers share the same promise. */
  check(): Promise<UpdateState> {
    if (this.checking) return this.checking
    this.checking = this.runCheck().finally(() => {
      this.checking = null
    })
    return this.checking
  }

  private async runCheck(): Promise<UpdateState> {
    this.patch({ phase: 'checking' })
    let raw: GitHubRelease | null = null
    try {
      raw = await fetchJson<GitHubRelease>(`${GITHUB_API}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`, {
        // GitHub answers 403 to requests without a User-Agent (its API policy
        // rejects generic clients). A named UA is mandatory, not cosmetic.
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'VerdantLauncher',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        retries: 2,
        timeoutMs: 15000
      })
    } catch (error) {
      const message = (error as Error).message
      logger.warn(`Проверка обновлений не удалась: ${message}`)
      // Keep the last known release: a flaky network must not hide a banner.
      this.patch({ phase: this.state.release ? 'available' : 'idle', error: message, checkedAt: new Date().toISOString() })
      return this.state
    }

    const release = normalizeRelease(raw)
    const skipped = configStore.skippedUpdate()
    const decision = decideUpdate({
      release,
      currentVersion: this.state.currentVersion,
      skippedVersion: skipped,
      deferred: release ? this.deferredTag === release.tag : false
    })

    this.patch({
      phase: decision === 'notify' ? 'available' : decision === 'deferred' ? 'idle' : 'up-to-date',
      release,
      progress: null,
      error: undefined,
      checkedAt: new Date().toISOString(),
      skippedVersion: skipped
    })
    logger.info(
      decision === 'notify'
        ? `Доступно обновление ${release?.version} (сейчас ${this.state.currentVersion})`
        : `Обновлений нет (последняя ${release?.version ?? '—'}, сейчас ${this.state.currentVersion})`
    )
    return this.state
  }

  /** True when the release in `state` is still worth announcing. */
  private canAnnounce(): boolean {
    const { release, currentVersion, skippedVersion } = this.state
    if (!release) return false
    if (!isNewerVersion(release.version, currentVersion)) return false
    if (skippedVersion && compareVersions(skippedVersion, release.version) === 0) return false
    return true
  }

  /**
   * Downloads the update.
   *
   * Since 1.2.0 the release artifact is our own Electron bootstrapper, which has
   * no `latest.yml` for `electron-updater` to verify. So every build — packaged
   * or not — streams the setup exe from the release page and then runs it in
   * `--silent` mode; the progress bar behaves exactly the same in both.
   */
  async download(): Promise<UpdateState> {
    if (!this.canAnnounce() || !this.state.release) return this.state
    const release: UpdateRelease = this.state.release
    this.patch({
      phase: 'downloading',
      progress: progressOf(0, release.sizeBytes, 0),
      error: undefined
    })

    if (!release.assetUrl) {
      this.patch({ phase: 'error', error: 'В релизе нет .exe-файла установщика' })
      return this.state
    }
    const target = join(paths.get().cacheDir, 'updates', release.assetName ?? `Verdant-Launcher-${release.version}.exe`)
    try {
      await downloadFile(release.assetUrl, target, (received, total) => {
        const now = Date.now()
        const seconds = Math.max(0.001, (now - this.lastTick) / 1000)
        if (now - this.lastTick > 400) {
          this.bytesPerSecond = Math.round((received - this.lastBytes) / seconds)
          this.lastTick = now
          this.lastBytes = received
        }
        this.patch({
          phase: 'downloading',
          progress: progressOf(received, total || release.sizeBytes, this.bytesPerSecond)
        })
      })
      this.installerPath = target
      this.patch({ phase: 'ready', progress: this.state.progress ? { ...this.state.progress, percent: 100 } : null })
      logger.info(`Обновление скачано: ${target}`)
    } catch (error) {
      const message = (error as Error).message
      logger.error(`Не удалось скачать обновление: ${message}`)
      this.patch({ phase: 'error', error: message })
    }
    return this.state
  }

  private lastTick = Date.now()
  private lastBytes = 0
  private bytesPerSecond = 0

  /**
   * Quits and runs the downloaded bootstrapper.
   *
   * `--wait-pid` makes the setup wait until this process is really gone, so it
   * never tries to overwrite a locked `VerdantLauncher.exe`.
   */
  install(): void {
    if (this.state.phase !== 'ready') return
    logger.info('Перезапуск для установки обновления')
    if (this.installerPath) {
      try {
        spawn(this.installerPath, ['--silent', '--wait-pid', String(process.pid)], {
          detached: true,
          stdio: 'ignore'
        }).unref()
        app.quit()
        return
      } catch (error) {
        logger.warn(`Не удалось запустить установщик: ${(error as Error).message}`)
      }
    }
    app.relaunch()
    app.exit(0)
  }

  /** «Отложить» — hide until the next launch (memory only). */
  defer(): UpdateState {
    this.deferredTag = this.state.release?.tag ?? null
    this.patch({ phase: 'idle' })
    return this.state
  }

  /** «Не скачивать эту версию» — persisted, never offered again. */
  skip(): UpdateState {
    const version = this.state.release?.version ?? null
    configStore.setSkippedUpdate(version)
    this.patch({ phase: 'idle', skippedVersion: version })
    logger.info(`Версия ${version ?? '—'} исключена из обновлений`)
    return this.state
  }

  /** Shows the banner again after «Отложить» (used by the settings screen). */
  resume(): UpdateState {
    this.deferredTag = null
    if (this.canAnnounce()) this.patch({ phase: 'available' })
    return this.state
  }
}

export const updates = new UpdateService()
