import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  ChevronDown,
  Cpu,
  Download,
  HardDrive,
  Layers,
  Package,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Square,
  Terminal,
  Timer,
  UserRound,
  WifiOff,
  CheckCircle2
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatDuration } from '../../../shared/constants'
import { formatEta, formatSpeed } from '../../../shared/format'
import { LOADER_LABELS, type Instance } from '../../../shared/types'
import { localizeError, pluralCount, useT } from '../i18n'
import { cn, formatGb, instanceGradient, relativeTime } from '../lib/utils'
import { useAppStore } from '../store/app'
import { ScreenHeader } from '../components/layout'
import { SkinHead } from '../components/SkinPreview'
import { Badge, Button, EmptyState, Panel, ProgressBar, SectionTitle, Spinner } from '../components/ui'

function InstanceMenuItem({ instance, active, onClick }: { instance: Instance; active: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition',
        active ? 'bg-emerald/10' : 'hover:bg-white/[0.06]'
      )}
    >
      <span className="flex h-8 w-8 flex-none items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-white/[0.05] text-[11px] font-semibold text-emerald-soft">
        {instance.icon ? (
          <img src={instance.icon} alt="" className="h-full w-full object-cover" />
        ) : (
          instance.name.slice(0, 1).toUpperCase()
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-medium text-text">{instance.name}</span>
        <span className="block truncate text-[10.5px] text-faint">
          {instance.mcVersion} · {LOADER_LABELS[instance.loader]}
        </span>
      </span>
      {active ? <CheckCircle2 className="h-4 w-4 flex-none text-emerald-soft" /> : null}
    </button>
  )
}

export function PlayScreen(): JSX.Element {
  const t = useT()
  const language = useAppStore((state) => state.settings.language)
  const instances = useAppStore((state) => state.instances)
  const selectedId = useAppStore((state) => state.selectedId)
  const profile = useAppStore((state) => state.profile)
  const skin = useAppStore((state) => state.skin)
  const systemInfo = useAppStore((state) => state.systemInfo)
  const game = useAppStore((state) => state.game)
  const task = useAppStore((state) => state.task)
  const logs = useAppStore((state) => state.logs)

  const setSelected = useAppStore((state) => state.setSelected)
  const launch = useAppStore((state) => state.launch)
  const stopGame = useAppStore((state) => state.stopGame)
  const installInstance = useAppStore((state) => state.installInstance)
  const retryInstall = useAppStore((state) => state.retryInstall)
  const checkIntegrity = useAppStore((state) => state.checkIntegrity)
  const integrity = useAppStore((state) => state.integrity)
  const openCreate = useAppStore((state) => state.openCreate)
  const openProfileModal = useAppStore((state) => state.openProfileModal)
  const setScreen = useAppStore((state) => state.setScreen)

  const [menuOpen, setMenuOpen] = useState(false)
  const instance = instances.find((item) => item.id === selectedId) ?? null

  const busy = ['checking', 'downloading', 'starting'].includes(game.state)
  const running = game.state === 'running'
  // `waiting` is a live task too: the network dropped, the install is resumable.
  const activeTask = task && (task.status === 'running' || task.status === 'waiting') ? task : null

  // Download state of the selected instance. «Играть» unlocks only on `ok`,
  // which is produced by a real integrity check, never by the downloader.
  const state = instance ? integrity[instance.id] ?? { status: 'unknown' as const } : { status: 'unknown' as const }
  const verifying = state.status === 'checking' || state.status === 'unknown'
  const failed = state.status === 'error'
  const playable = state.status === 'ok' && instance?.installed === true
  const errorCode = state.status === 'error' ? state.code : null
  // A network failure is a waiting room, not a dead end: the retry resumes.
  const waitingNetwork = activeTask?.status === 'waiting' || errorCode === 'network_error'
  const errorFile = state.status === 'error' ? state.file : undefined
  const errorReport = state.status === 'error' ? state.report : undefined
  const problemCount = errorReport ? errorReport.missing.length + errorReport.truncatedIssues : 0
  const downloading = activeTask !== null && instance !== null && activeTask.instanceId === instance.id

  // Verify as soon as the screen shows an instance we know nothing about.
  useEffect(() => {
    if (!instance) return
    if ((integrity[instance.id] ?? { status: 'unknown' }).status === 'unknown') void checkIntegrity(instance.id)
  }, [instance, integrity, checkIntegrity])
  const totalMem = systemInfo?.totalMemMB ?? 16384
  const memoryRatio = instance ? instance.memory.max / totalMem : 0.25
  const memoryAccent = memoryRatio > 0.7 ? '#f87171' : memoryRatio > 0.5 ? '#f5c249' : '#2fe28c'

  const recentLogs = logs.slice(-5)

  return (
    <div className="px-7 py-6">
      <ScreenHeader
        eyebrow={t('app.name')}
        title={profile ? t('play.greeting', { name: profile.name }) : t('play.greetingGuest')}
        description={t('app.tagline')}
        action={
          <div className="flex items-center gap-2">
            <Badge tone={running ? 'emerald' : 'default'}>
              <span className={cn('h-1.5 w-1.5 rounded-full', running ? 'bg-emerald-glow' : 'bg-white/30')} />
              {running ? t('top.running') : t('top.idle')}
            </Badge>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]">
        <div className="space-y-5">
          <div
            className="instance-banner glass relative flex min-h-[356px] flex-col justify-between overflow-hidden rounded-[28px] p-7"
            style={instance ? instanceGradient(instance.loader, instance.id) : undefined}
          >
            {instance ? (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-4">
                    <div className="flex h-14 w-14 flex-none items-center justify-center overflow-hidden rounded-2xl border border-white/15 bg-white/[0.06] text-lg font-semibold text-white/90 shadow-lg backdrop-blur">
                      {instance.icon ? (
                        <img src={instance.icon} alt="" className="h-full w-full object-cover" />
                      ) : (
                        instance.name.slice(0, 1).toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                        <Badge tone="emerald">{LOADER_LABELS[instance.loader]}</Badge>
                        <Badge>{instance.mcVersion}</Badge>
                        {failed ? (
                          <Badge tone="danger">{t('play.errorBadge')}</Badge>
                        ) : verifying ? (
                          <Badge tone="default">
                            <Spinner /> {t('play.verifying')}
                          </Badge>
                        ) : playable ? (
                          <Badge tone="emerald">{t('play.verified')}</Badge>
                        ) : (
                          <Badge tone="gold">{t('play.notInstalled')}</Badge>
                        )}
                      </div>
                      <h2 className="truncate text-[26px] font-semibold leading-tight tracking-tight text-white">
                        {instance.name}
                      </h2>
                    </div>
                  </div>

                  <div className="relative">
                    <button
                      className="flex items-center gap-2 rounded-xl border border-white/12 bg-black/25 px-3 py-2 text-[11.5px] text-text/85 backdrop-blur transition hover:border-emerald/40 hover:text-text"
                      onClick={() => setMenuOpen((open) => !open)}
                    >
                      <Layers className="h-3.5 w-3.5" />
                      {t('play.select')}
                      <ChevronDown className={cn('h-3.5 w-3.5 transition', menuOpen && 'rotate-180')} />
                    </button>
                    <AnimatePresence>
                      {menuOpen ? (
                        <>
                          <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                          <motion.div
                            initial={{ opacity: 0, y: -6, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -4, scale: 0.99 }}
                            transition={{ duration: 0.16 }}
                            className="menu-sheet absolute right-0 z-40 mt-2 w-[290px] p-1.5"
                          >
                            <div className="max-h-[260px] space-y-0.5 overflow-y-auto">
                              {instances.map((item) => (
                                <InstanceMenuItem
                                  key={item.id}
                                  instance={item}
                                  active={item.id === instance.id}
                                  onClick={() => {
                                    setSelected(item.id)
                                    setMenuOpen(false)
                                  }}
                                />
                              ))}
                            </div>
                            <div className="divider my-1.5" />
                            <button
                              className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-[12px] text-emerald-soft transition hover:bg-emerald/10"
                              onClick={() => {
                                setMenuOpen(false)
                                openCreate()
                              }}
                            >
                              <Plus className="h-4 w-4" /> {t('instances.create')}
                            </button>
                          </motion.div>
                        </>
                      ) : null}
                    </AnimatePresence>
                  </div>
                </div>

                <div className="mt-6 flex flex-col items-center gap-4">
                  <div className="flex items-center gap-4">
                    <button
                      className={cn(
                        'play-button',
                        running && 'play-button--running',
                        failed && 'play-button--error'
                      )}
                      // Locked on purpose: a failed install must never spawn the
                      // game. The reason is already on screen (sticky toast +
                      // error card) and `launch()` in the store re-checks it.
                      disabled={busy || downloading || verifying || failed}
                      aria-disabled={failed}
                      title={failed ? t('play.errorHint') : undefined}
                      onClick={() => {
                        if (running || failed || verifying) return
                        if (!playable) void installInstance(instance.id)
                        else void launch(instance.id)
                      }}
                    >
                      {downloading ? (
                        <>
                          <Download className="h-5 w-5 animate-bounce" />
                          {t('top.preparing')}
                        </>
                      ) : busy ? (
                        <>
                          <Download className="h-5 w-5 animate-bounce" />
                          {t('top.preparing')}
                        </>
                      ) : running ? (
                        <>
                          <span className="pulse-dot" />
                          {t('play.running')}
                        </>
                      ) : failed ? (
                        <>
                          <AlertTriangle className="h-5 w-5" />
                          {t('play.errorPlay')}
                        </>
                      ) : verifying ? (
                        <>
                          <Spinner />
                          {t('play.verifying')}
                        </>
                      ) : playable ? (
                        <>
                          <Play className="h-5 w-5 fill-current" />
                          {t('play.play')}
                        </>
                      ) : (
                        <>
                          <Download className="h-5 w-5" />
                          {t('instances.install')}
                        </>
                      )}
                    </button>
                    {running ? (
                      <Button variant="danger" size="lg" icon={<Square className="h-3.5 w-3.5" />} onClick={stopGame}>
                        {t('play.stop')}
                      </Button>
                    ) : null}
                  </div>

                  {failed ? (
                    <div className="w-full max-w-[460px] rounded-2xl border border-rose-400/25 bg-rose-950/35 p-3.5 text-left backdrop-blur">
                      <div className="flex items-start gap-2.5">
                        <span className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-rose-500/15 text-rose-300">
                          <AlertTriangle className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-[12px] font-semibold text-rose-100">
                            {errorCode === 'network_error' ? t('play.waitingNetwork') : t('play.errorTitle')}
                          </div>
                          <div className="mt-0.5 text-[11px] leading-relaxed text-rose-200/80">
                            {localizeError(t, errorCode ?? undefined, errorFile ? { file: errorFile } : undefined)}
                          </div>
                          {waitingNetwork ? (
                            <div className="mt-1 text-[10.5px] leading-relaxed text-amber-200/80">{t('play.waitingHint')}</div>
                          ) : null}
                          {problemCount > 0 ? (
                            <div className="mt-1 text-[10.5px] text-rose-200/60">
                              {t('play.missingFiles', { count: problemCount })}
                              {errorReport?.missing.length
                                ? `: ${errorReport.missing.slice(0, 3).map((item) => item.name).join(', ')}`
                                : ''}
                            </div>
                          ) : null}
                          <div className="mt-2.5 flex flex-wrap items-center gap-2">
                            <button
                              className="flex items-center gap-1.5 rounded-lg bg-emerald px-3 py-1.5 text-[11px] font-semibold text-ink-950 transition hover:bg-emerald-glow"
                              onClick={() => void retryInstall(instance.id)}
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                              {t('play.retry')}
                            </button>
                            <button
                              className="flex items-center gap-1.5 rounded-lg border border-white/12 px-3 py-1.5 text-[11px] text-white/70 transition hover:border-white/25 hover:text-white"
                              onClick={() => void checkIntegrity(instance.id)}
                            >
                              <ShieldCheck className="h-3.5 w-3.5" />
                              {t('play.verify')}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {downloading || (activeTask && activeTask.instanceId === instance.id) ? (
                    <div className="w-full max-w-[420px] rounded-2xl border border-white/10 bg-black/30 p-3.5 backdrop-blur">
                      <div className="mb-2 flex items-center justify-between gap-3 text-[11px]">
                        <span className="flex min-w-0 items-center gap-1.5 truncate text-text/85">
                          {waitingNetwork ? (
                            <span className="flex-none rounded-md bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                              {t('play.waitingNetwork')}
                            </span>
                          ) : null}
                          <span className="truncate">{activeTask?.stage}</span>
                        </span>
                        <span className="flex-none font-mono tabular-nums text-emerald-soft">
                          {typeof activeTask?.percent === 'number' ? `${Math.floor(activeTask.percent)}%` : '…'}
                        </span>
                      </div>
                      <ProgressBar percent={activeTask?.percent} value={activeTask?.current ?? 0} total={activeTask?.total ?? 1} />
                      <div className="mt-2 flex items-center justify-between gap-3 text-[10.5px] text-faint">
                        <span className="flex items-center gap-1.5">
                          <Download className="h-3 w-3 text-emerald-soft/80" />
                          {t('play.speed')}: {formatSpeed(activeTask?.bytesPerSecond ?? 0)}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Timer className="h-3 w-3 text-emerald-soft/80" />
                          {t('play.eta')}: {formatEta(activeTask?.etaSeconds ?? null)}
                        </span>
                      </div>
                      {activeTask?.status === 'waiting' ? (
                        <div className="mt-1.5 flex items-start gap-1.5 text-[10px] leading-snug text-amber-200/75">
                          <WifiOff className="mt-0.5 h-3 w-3 flex-none" />
                          {t('play.waitingHint')}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div className="mt-7 flex flex-wrap items-center gap-2.5 text-[11px] text-white/65">
                  <span className="flex items-center gap-1.5 rounded-lg bg-black/25 px-2.5 py-1.5 backdrop-blur">
                    <Timer className="h-3.5 w-3.5 text-emerald-soft" />
                    {t('play.lastPlayed')}: {relativeTime(instance.lastPlayedAt, language)}
                  </span>
                  <span className="flex items-center gap-1.5 rounded-lg bg-black/25 px-2.5 py-1.5 backdrop-blur">
                    <Package className="h-3.5 w-3.5 text-emerald-soft" />
                    {pluralCount(t, instance.modsCount, 'mod')}
                  </span>
                  <span className="flex items-center gap-1.5 rounded-lg bg-black/25 px-2.5 py-1.5 backdrop-blur">
                    <HardDrive className="h-3.5 w-3.5 text-emerald-soft" />
                    {formatGb(instance.memory.max)}
                  </span>
                  <span className="flex items-center gap-1.5 rounded-lg bg-black/25 px-2.5 py-1.5 backdrop-blur">
                    <Timer className="h-3.5 w-3.5 text-gold" />
                    {t('play.playtime')}: {formatDuration(instance.playTimeMs, language)}
                  </span>
                </div>
              </>
            ) : (
              <EmptyState
                icon={<Layers className="h-7 w-7" />}
                title={t('play.noInstances')}
                description={t('play.noInstancesHint')}
                action={
                  <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => openCreate()}>
                    {t('play.create')}
                  </Button>
                }
              />
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Panel className="p-4">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-faint">
                <Layers className="h-3.5 w-3.5" /> {t('instances.title')}
              </div>
              <div className="mt-2 text-[22px] font-semibold text-text">{instances.length}</div>
              <button className="mt-1 text-[11px] text-emerald-soft hover:underline" onClick={() => setScreen('instances')}>
                {t('instances.configure')} →
              </button>
            </Panel>
            <Panel className="p-4">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-faint">
                <Package className="h-3.5 w-3.5" /> {t('play.mods')}
              </div>
              <div className="mt-2 text-[22px] font-semibold text-text">{instance?.modsCount ?? 0}</div>
              <button className="mt-1 text-[11px] text-emerald-soft hover:underline" onClick={() => setScreen('mods')}>
                {t('mods.catalogTab')} →
              </button>
            </Panel>
            <Panel className="p-4">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-faint">
                <Cpu className="h-3.5 w-3.5" /> {t('play.systemCard')}
              </div>
              <div className="mt-2 text-[22px] font-semibold text-text">{systemInfo ? `${Math.round(systemInfo.totalMemMB / 1024)} GB` : '—'}</div>
              <div className="mt-1 text-[11px] text-faint">
                {systemInfo?.cpus ?? '—'} {t('play.cpu').toLowerCase()}
              </div>
            </Panel>
          </div>
        </div>

        <div className="space-y-5">
          <Panel className="p-5" hover>
            <SectionTitle eyebrow={t('play.offline')} title={t('play.profileCard')} />
            <div className="flex items-center gap-3.5">
              <SkinHead dataUrl={skin.dataUrl} size={54} className="shadow-xl" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold text-text">{profile?.name ?? t('top.noProfile')}</div>
                <div className="mt-0.5 truncate font-mono text-[10.5px] text-faint">{profile?.uuid ?? '—'}</div>
              </div>
            </div>
            <Button className="mt-4 w-full" icon={<UserRound className="h-4 w-4" />} onClick={() => openProfileModal(true)}>
              {profile ? t('play.changeNickname') : t('top.profile')}
            </Button>
          </Panel>

          <Panel className="p-5">
            <SectionTitle
              eyebrow={instance ? instance.name : t('common.none')}
              title={t('play.memoryCard')}
              action={
                <span className="font-mono text-[11px]" style={{ color: memoryAccent }}>
                  {instance ? formatGb(instance.memory.max) : '—'}
                </span>
              }
            />
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
              <motion.div
                className="h-full rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(memoryRatio * 100, 100)}%` }}
                transition={{ type: 'spring', stiffness: 90, damping: 20 }}
                style={{ background: `linear-gradient(90deg, ${memoryAccent}aa, ${memoryAccent})`, boxShadow: `0 0 18px ${memoryAccent}66` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-[10.5px] text-faint">
              <span>{formatGb(instance?.memory.max ?? 0)}</span>
              <span>
                {systemInfo ? `${Math.round(systemInfo.totalMemMB / 1024)} GB ${t('play.ram')}` : ''}
              </span>
            </div>
            <button className="mt-3 text-[11px] text-emerald-soft hover:underline" onClick={() => setScreen('settings')}>
              {t('settings.memory')} →
            </button>
          </Panel>

          <Panel className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3.5">
              <div className="flex items-center gap-2 text-[12px] font-semibold text-text">
                <Terminal className="h-4 w-4 text-emerald-soft" />
                {t('play.consoleCard')}
              </div>
              <button className="text-[11px] text-emerald-soft hover:underline" onClick={() => setScreen('console')}>
                {t('play.openConsole')}
              </button>
            </div>
            <div className="h-[150px] space-y-1 overflow-hidden px-4 py-3 font-mono text-[10.5px] leading-relaxed">
              {recentLogs.length === 0 ? (
                <div className="text-faint">{t('console.empty')}</div>
              ) : (
                recentLogs.map((line) => (
                  <div
                    key={line.seq}
                    className={cn(
                      'truncate',
                      line.level === 'error' && 'text-rose-300',
                      line.level === 'warn' && 'text-amber-300',
                      line.level === 'info' && 'text-text/70',
                      line.source === 'launcher' && line.level === 'info' && 'text-emerald-soft/80'
                    )}
                  >
                    {line.text}
                  </div>
                ))
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
