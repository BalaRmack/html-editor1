import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUpRight, DownloadCloud, RefreshCw, Rocket, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { Badge, Button } from '../components/ui'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { cn } from '../lib/utils'
import { useAppStore } from '../store/app'

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

/** Phases in which the launcher has something to say about a newer version. */
const VISIBLE: string[] = ['available', 'downloading', 'ready', 'error']

/**
 * Glass banner in the bottom-right corner. Three decisions, exactly as asked:
 * install (with progress → restart), postpone until the next launch, or never
 * offer this version again (persisted in the config store).
 */
export function UpdateBanner(): JSX.Element {
  const t = useT()
  const update = useAppStore((state) => state.update)
  const downloadUpdate = useAppStore((state) => state.downloadUpdate)
  const installUpdate = useAppStore((state) => state.installUpdate)
  const deferUpdate = useAppStore((state) => state.deferUpdate)
  const skipUpdate = useAppStore((state) => state.skipUpdate)

  const phase = update?.phase ?? 'idle'
  const visible = Boolean(update?.release) && VISIBLE.includes(phase) && update?.release?.version !== update?.currentVersion
  const progress = update?.progress ?? null
  const percent = Math.max(0, Math.min(100, progress?.percent ?? 0))

  // Portalled to <body> so no transformed/scrollable ancestor can clip it.
  return createPortal(
    <AnimatePresence>
      {visible && update?.release ? (
        <motion.aside
          key="update-banner"
          initial={{ opacity: 0, y: 24, filter: 'blur(8px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: 18, filter: 'blur(6px)' }}
          transition={{ type: 'spring', stiffness: 260, damping: 28 }}
          className="fixed bottom-6 right-6 z-40 w-[382px] overflow-hidden rounded-3xl border border-emerald/25 bg-ink-850/85 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.95)] backdrop-blur-2xl"
          aria-live="polite"
        >
          {/* emerald light leaking from the corner — the Verdant signature */}
          <div className="pointer-events-none absolute -right-16 -top-24 h-48 w-48 rounded-full bg-emerald/25 blur-3xl" />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald/60 to-transparent" />

          <div className="relative p-5">
            <div className="flex items-start gap-3.5">
              <div
                className={cn(
                  'flex h-11 w-11 flex-none items-center justify-center rounded-2xl border border-emerald/30 bg-emerald/10 text-emerald-glow',
                  phase === 'downloading' && 'animate-pulse'
                )}
              >
                {phase === 'ready' ? <Rocket className="h-5 w-5" /> : <DownloadCloud className="h-5 w-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-[13.5px] font-semibold text-text">
                    {phase === 'ready' ? t('update.ready') : t('update.available', { version: update.release.version })}
                  </h3>
                  <Badge tone="emerald">{update.release.tag}</Badge>
                </div>
                <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
                  {phase === 'ready'
                    ? t('update.readyHint')
                    : phase === 'error'
                      ? t('update.error')
                      : t('update.hint', { current: update.currentVersion })}
                </p>
              </div>
            </div>

            {phase === 'downloading' && progress ? (
              <div className="mt-4">
                <div className="mb-1.5 flex items-center justify-between text-[10.5px] text-muted">
                  <span>{t('update.downloading')}</span>
                  <span className="tabular-nums text-emerald-glow">
                    {percent}% · {formatBytes(progress.bytesPerSecond)}/s
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-deep to-emerald-glow"
                    initial={{ width: 0 }}
                    animate={{ width: `${percent}%` }}
                    transition={{ type: 'spring', stiffness: 120, damping: 24 }}
                  />
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-3 text-[10px] text-faint">
                  <span className="tabular-nums">
                    {formatBytes(progress.transferred)} / {formatBytes(progress.total || update.release.sizeBytes)}
                  </span>
                  <div className="flex items-center gap-3">
                    <button className="transition hover:text-rose-200" onClick={() => void skipUpdate()}>
                      {t('update.skip')}
                    </button>
                    {update.release.htmlUrl ? (
                      <button
                        className="flex items-center gap-1 transition hover:text-emerald-glow"
                        onClick={() => void api.app.openExternal(update.release!.htmlUrl)}
                      >
                        {t('update.whatsNew')}
                        <ArrowUpRight className="h-3 w-3" />
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            {phase === 'error' ? (
              <p className="mt-3 rounded-xl border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
                {update.error ?? t('update.error')}
              </p>
            ) : null}

            {phase !== 'downloading' ? (
              <>
                <div className="mt-4 flex items-center gap-2">
                  {phase === 'available' || phase === 'error' ? (
                    <Button
                      variant="primary"
                      size="sm"
                      icon={<DownloadCloud className="h-3.5 w-3.5" />}
                      onClick={() => void downloadUpdate()}
                    >
                      {phase === 'error' ? t('update.retry') : t('update.install')}
                    </Button>
                  ) : null}

                  {phase === 'ready' ? (
                    <Button
                      variant="primary"
                      size="sm"
                      icon={<Rocket className="h-3.5 w-3.5" />}
                      onClick={() => installUpdate()}
                    >
                      {t('update.restart')}
                    </Button>
                  ) : null}

                  <Button size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void deferUpdate()}>
                    {phase === 'ready' ? t('update.later') : t('update.postpone')}
                  </Button>
                </div>

                {/* tertiary row: opt out for good on the left, changelog on the right */}
                <div className="mt-3 flex items-center justify-between gap-3 text-[10.5px]">
                  <button
                    className="flex items-center gap-1 text-faint transition hover:text-rose-200"
                    onClick={() => void skipUpdate()}
                  >
                    <X className="h-3 w-3" />
                    {t('update.skip')}
                  </button>
                  {update.release.htmlUrl ? (
                    <button
                      className="flex items-center gap-1 text-muted transition hover:text-emerald-glow"
                      onClick={() => void api.app.openExternal(update.release!.htmlUrl)}
                    >
                      {t('update.whatsNew')}
                      <ArrowUpRight className="h-3 w-3" />
                    </button>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>,
    document.body
  )
}
