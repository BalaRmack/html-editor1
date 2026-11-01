import type { TaskProgress, TaskStatus } from '../../shared/types'

type TaskListener = (progress: TaskProgress) => void

export interface TaskHandle {
  readonly id: string
  stage(stage: string, current?: number, total?: number, unit?: TaskProgress['unit'], stageKey?: string): void
  /** increment current progress by `delta` */
  bump(delta?: number): void
  done(stage?: string): void
  fail(message: string): void
}

/**
 * Central task/进度 bus. Long-running operations (installs, downloads, pack
 * imports) create a task and report stages; the renderer subscribes once.
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

    const push = (): void => {
      this.emit({
        id,
        label,
        stage,
        stageKey,
        current,
        total,
        unit,
        status,
        instanceId: options.instanceId
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
        push()
      },
      bump(delta = 1) {
        current += delta
        push()
      },
      done(finalStage) {
        status = 'done'
        if (finalStage) stage = finalStage
        if (total > 0) current = total
        push()
      },
      fail(message) {
        status = 'error'
        stage = message
        push()
      }
    }
  }
}

export const tasks = new TaskService()
