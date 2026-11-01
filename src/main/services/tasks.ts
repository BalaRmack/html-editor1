import type { TaskProgress, TaskStatus } from '../../shared/types'

type TaskListener = (progress: TaskProgress) => void

export interface TaskMetrics {
  percent?: number
  bytesPerSecond?: number
  etaSeconds?: number | null
  retryable?: boolean
  failedFiles?: number
}

export interface TaskHandle {
  readonly id: string
  stage(stage: string, current?: number, total?: number, unit?: TaskProgress['unit'], stageKey?: string): void
  /** increment current progress by `delta` */
  bump(delta?: number): void
  /** Attaches speed/ETA/percent without changing the stage text. */
  metrics(next: TaskMetrics): void
  /** The network dropped: keep the task alive so it can be resumed. */
  waiting(message: string, metrics?: TaskMetrics): void
  done(stage?: string): void
  fail(message: string, metrics?: TaskMetrics): void
}

/**
 * Central task bus. Long-running operations (installs, downloads, pack imports)
 * create a task and report stages; the renderer subscribes once.
 *
 * Every task enforces one invariant: **the percentage never moves backwards**.
 * The downloader may discover new files mid-flight (that is how xmcl works) and
 * a previous release happily reported 90% → 70% because of it. The clamp lives
 * here, in the main process, so no caller can regress the bar again.
 */
class TaskService {
  private listeners = new Set<TaskListener>()
  private counter = 0

  subscribe(listener: TaskListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(progress: TaskProgress): void {
    for (const listener of this.listeners) {
      try {
        listener(progress)
      } catch {
        /* ignore */
      }
    }
  }

  create(label: string, options: { instanceId?: string; total?: number; unit?: TaskProgress['unit'] } = {}): TaskHandle {
    const id = `task-${++this.counter}-${Date.now()}`
    let current = 0
    let total = options.total ?? 0
    let unit = options.unit ?? 'steps'
    let stage = label
    let stageKey: string | undefined
    let status: TaskStatus = 'running'
    let message: string | undefined
    let percent = 0
    let bytesPerSecond: number | undefined
    let etaSeconds: number | null | undefined
    let retryable: boolean | undefined
    let failedFiles: number | undefined

    const clampPercent = (value: number): number => {
      if (!Number.isFinite(value)) return percent
      // Forward only. A completed task may finish at exactly 100.
      percent = Math.max(percent, Math.min(100, value))
      return percent
    }

    const push = (): void => {
      const derived = total > 0 ? (current / total) * 100 : percent
      this.emit({
        id,
        label,
        stage,
        stageKey,
        current,
        total,
        unit,
        status,
        message,
        instanceId: options.instanceId,
        percent: clampPercent(derived),
        bytesPerSecond,
        etaSeconds,
        retryable,
        failedFiles
      })
    }

    push()

    return {
      id,
      stage(nextStage, nextCurrent, nextTotal, nextUnit, nextKey) {
        stage = nextStage
        stageKey = nextKey
        if (typeof nextCurrent === 'number') current = nextCurrent
        if (typeof nextTotal === 'number') total = nextTotal
        if (nextUnit) unit = nextUnit
        status = 'running'
        message = undefined
        push()
      },
      bump(delta = 1) {
        current += delta
        push()
      },
      metrics(next) {
        if (typeof next.percent === 'number') clampPercent(next.percent)
        if (typeof next.bytesPerSecond === 'number') bytesPerSecond = next.bytesPerSecond
        if (next.etaSeconds !== undefined) etaSeconds = next.etaSeconds
        if (next.retryable !== undefined) retryable = next.retryable
        if (next.failedFiles !== undefined) failedFiles = next.failedFiles
        push()
      },
      waiting(nextMessage, next) {
        status = 'waiting'
        message = nextMessage
        if (next) {
          if (typeof next.percent === 'number') clampPercent(next.percent)
          if (typeof next.bytesPerSecond === 'number') bytesPerSecond = next.bytesPerSecond
          if (next.etaSeconds !== undefined) etaSeconds = next.etaSeconds
        }
        retryable = true
        push()
      },
      done(finalStage) {
        status = 'done'
        if (finalStage) stage = finalStage
        percent = 100
        if (total > 0) current = total
        etaSeconds = 0
        push()
      },
      fail(failureMessage, next) {
        status = 'error'
        stage = failureMessage
        message = failureMessage
        if (next) {
          if (typeof next.percent === 'number') clampPercent(next.percent)
          if (next.retryable !== undefined) retryable = next.retryable
          if (next.failedFiles !== undefined) failedFiles = next.failedFiles
        }
        bytesPerSecond = undefined
        etaSeconds = null
        push()
      }
    }
  }
}

export const tasks = new TaskService()
