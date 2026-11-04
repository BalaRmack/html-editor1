import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowUpRight,
  Check,
  Download,
  FolderOpen,
  Layers,
  Package,
  Palette,
  Power,
  RefreshCw,
  ScrollText,
  Search,
  Sparkles,
  Trash2,
  TriangleAlert,
  X
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatNumber } from '../../../shared/constants'
import {
  LOADER_LABELS,
  type ContentKind,
  type ContentUpdate,
  type Instance,
  type InstalledMod,
  type ModHit
} from '../../../shared/types'
import { Badge, Button, IconButton, Input, Spinner } from '../components/ui'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { cn } from '../lib/utils'
import { useAppStore } from '../store/app'

type Tab = 'logs' | 'versions' | 'catalog' | ContentKind

const TAB_ICON: Record<Tab, JSX.Element> = {
  logs: <ScrollText className="h-4 w-4" />,
  versions: <Layers className="h-4 w-4" />,
  catalog: <Sparkles className="h-4 w-4" />,
  mod: <Package className="h-4 w-4" />,
  resourcepack: <Palette className="h-4 w-4" />,
  shader: <Sparkles className="h-4 w-4" />
}

const TAB_LABEL: Record<Tab, 'content.logs' | 'content.versions' | 'content.catalog' | 'content.mods' | 'content.packs' | 'content.shaders'> = {
  logs: 'content.logs',
  versions: 'content.versions',
  catalog: 'content.catalog',
  mod: 'content.mods',
  resourcepack: 'content.packs',
  shader: 'content.shaders'
}

/** `mods` / `resourcepacks` / `shaderpacks` — the tab ↔ content kind bridge. */
function kindOf(tab: Tab): ContentKind {
  return tab === 'resourcepack' || tab === 'shader' || tab === 'mod' ? tab : 'mod'
}

function ContentAvatar({ iconUrl, name, size = 34 }: { iconUrl: string | null; name: string; size?: number }): JSX.Element {
  return (
    <div
      className="flex flex-none items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-gradient-to-br from-white/[0.09] to-white/[0.02] text-[11px] font-semibold text-emerald-soft"
      style={{ width: size, height: size }}
    >
      {iconUrl ? <img src={iconUrl} alt="" className="h-full w-full object-cover" /> : name.slice(0, 2).toUpperCase()}
    </div>
  )
}

function formatDate(value: string | null, locale = 'ru-RU'): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function LevelTag({ level }: { level: string }): JSX.Element {
  const tone =
    level === 'error' ? 'text-rose-300' : level === 'warn' ? 'text-amber-300' : level === 'debug' ? 'text-sky-300' : 'text-emerald-soft'
  return <span className={cn('w-12 flex-none text-[10px] font-semibold uppercase', tone)}>{level}</span>
}

/**
 * Instance «Настроить» window.
 *
 * Three columns: sections (left), content (centre table), actions (right).
 * Every catalogue request and every install goes through `api.content.*`, which
 * injects the instance's game version + loader in the main process — so a mod
 * that is not 100 % compatible can never appear here, let alone be downloaded.
 */
export function ContentManager({ instance, onClose }: { instance: Instance; onClose: () => void }): JSX.Element {
  const t = useT()
  const logs = useAppStore((state) => state.logs)
  const language = useAppStore((state) => state.settings.language)
  const locale = language === 'ru' ? 'ru-RU' : 'en-US'
  const pushToast = useAppStore((state) => state.pushToast)
  const toastError = useAppStore((state) => state.toastError)
  const refreshInstances = useAppStore((state) => state.refreshInstances)

  const [tab, setTab] = useState<Tab>('mod')

  // installed content per kind
  const [installed, setInstalled] = useState<Record<ContentKind, InstalledMod[] | null>>({
    mod: null,
    resourcepack: null,
    shader: null
  })
  const [updates, setUpdates] = useState<Record<ContentKind, ContentUpdate[]>>({ mod: [], resourcepack: [], shader: [] })
  const [checking, setChecking] = useState(false)

  // catalogue
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ModHit[]>([])
  const [total, setTotal] = useState(0)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [selectedHit, setSelectedHit] = useState<ModHit | null>(null)
  const [busyFile, setBusyFile] = useState<string | null>(null)
  // Every project being installed right now: several can run at once (queued in the main process).
  const [busyHits, setBusyHits] = useState<ReadonlySet<string>>(() => new Set())
  const markBusy = useCallback((id: string, on: boolean): void => {
    setBusyHits((current) => {
      const next = new Set(current)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const kind = kindOf(tab)
  const list = installed[kind] ?? []; const installedIds = useMemo(() => new Set((installed[kind] ?? []).map((entry) => entry.projectId).filter((id): id is string => Boolean(id))), [installed, kind])
  const updateMap = useMemo(() => new Map(updates[kind].map((entry) => [entry.fileName, entry])), [updates, kind])
  const selected = list.find((entry) => entry.fileName === selectedFile) ?? null
  const selectedUpdate = selected ? updateMap.get(selected.fileName) ?? null : null

  const loadInstalled = useCallback(
    async (target: ContentKind): Promise<void> => {
      try {
        const rows = await api.content.installed(instance.id, target)
        setInstalled((current) => ({ ...current, [target]: rows }))
      } catch {
        setInstalled((current) => ({ ...current, [target]: [] }))
      }
    },
    [instance.id]
  )

  // Load the current section's content (and mods once on open).
  useEffect(() => {
    if (tab === 'logs' || tab === 'versions') return
    void loadInstalled(kind)
  }, [tab, kind, loadInstalled])

  useEffect(() => {
    void loadInstalled('mod')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Escape closes the window.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const runSearch = useCallback(
    async (text: string): Promise<void> => {
      setSearching(true)
      setSearchError(null)
      try {
        const result = await api.content.search({ instanceId: instance.id, kind, query: text, limit: 24 })
        setHits(result.hits)
        setTotal(result.total)
      } catch (error) {
        setSearchError(t('content.searchFailed'))
        toastError(error)
        setHits([])
      } finally {
        setSearching(false)
      }
    },
    [instance.id, kind]
  )

  useEffect(() => {
    if (tab !== 'catalog') return
    setSelectedHit(null)
    void runSearch(query)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, kind, query])

  const checkUpdates = useCallback(async (): Promise<void> => {
    setChecking(true)
    try {
      const kinds: ContentKind[] = tab === 'logs' || tab === 'versions' ? ['mod', 'resourcepack', 'shader'] : [kind]
      const next: Record<ContentKind, ContentUpdate[]> = { mod: [], resourcepack: [], shader: [] }
      for (const entry of kinds) next[entry] = await api.content.updates(instance.id, entry)
      setUpdates(next)
      const count = kinds.reduce((sum, entry) => sum + next[entry].length, 0)
      if (count === 0) pushToast({ kind: 'info', titleKey: 'content.noUpdates' })
      else pushToast({ kind: 'success', titleKey: 'content.updatesFound', vars: { count } })
    } catch (error) {
      toastError(error)
    } finally {
      setChecking(false)
    }
  }, [instance.id, kind, tab, pushToast, toastError])

  const installHit = useCallback(
    async (hit: ModHit): Promise<void> => {
      markBusy(hit.id, true)
      try {
        await api.content.install({
          instanceId: instance.id,
          kind,
          source: hit.source,
          projectId: hit.id,
          projectName: hit.name,
          projectIcon: hit.iconUrl
        })
        pushToast({ kind: 'success', titleKey: 'content.installed', vars: { name: hit.name } })
        await loadInstalled(kind)
        await refreshInstances()
      } catch (error) {
        toastError(error)
      } finally {
        markBusy(hit.id, false)
      }
    },
    [instance.id, kind, pushToast, t, loadInstalled, refreshInstances, toastError, markBusy]
  )

  const applyUpdate = useCallback(
    async (update: ContentUpdate): Promise<void> => {
      setBusyFile(update.fileName)
      try {
        await api.content.update({ instanceId: instance.id, kind, projectId: update.projectId, versionId: update.versionId })
        pushToast({
          kind: 'success',
          titleKey: 'content.updated',
          vars: { name: update.name, version: update.latestVersion }
        })
        await loadInstalled(kind)
        setUpdates((current) => ({ ...current, [kind]: current[kind].filter((entry) => entry.fileName !== update.fileName) }))
      } catch (error) {
        toastError(error)
      } finally {
        setBusyFile(null)
      }
    },
    [instance.id, kind, pushToast, t, loadInstalled, toastError]
  )

  const toggle = useCallback(
    async (entry: InstalledMod): Promise<void> => {
      setBusyFile(entry.fileName)
      try {
        await api.content.toggle(instance.id, kind, entry.fileName, !entry.enabled)
        await loadInstalled(kind)
      } catch (error) {
        toastError(error)
      } finally {
        setBusyFile(null)
      }
    },
    [instance.id, kind, loadInstalled, toastError]
  )

  const remove = useCallback(
    async (entry: InstalledMod): Promise<void> => {
      setBusyFile(entry.fileName)
      try {
        await api.content.remove(instance.id, kind, entry.fileName)
        pushToast({ kind: 'info', titleKey: 'content.removed', vars: { name: entry.name } })
        setSelectedFile(null)
        await loadInstalled(kind)
        await refreshInstances()
      } catch (error) {
        toastError(error)
      } finally {
        setBusyFile(null)
      }
    },
    [instance.id, kind, pushToast, t, loadInstalled, refreshInstances, toastError]
  )

  const tabs: Tab[] = ['logs', 'versions', 'catalog', 'mod', 'resourcepack', 'shader']
  const tail = logs.slice(-100)
  const updatesForTab = updates[kind]

  return createPortal(
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      <div className="absolute inset-0 bg-black/65 backdrop-blur-md" onClick={onClose} />

      <motion.div
        className="glass relative flex h-[86vh] w-full max-w-[1180px] overflow-hidden rounded-3xl"
        initial={{ opacity: 0, y: 20, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.99 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        role="dialog"
        aria-modal="true"
      >
        <div className="pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-full bg-emerald/20 blur-3xl" />

        {/* ---------------------------------------------------- left: sections */}
        <aside className="relative flex w-[196px] flex-none flex-col border-r border-white/[0.07] bg-black/20 px-3 py-4">
          <div className="flex items-center gap-2.5 px-2">
            <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl border border-emerald/30 bg-emerald/10">
              {instance.icon ? (
                <img src={instance.icon} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="pixel text-[11px] text-emerald-glow">{instance.name.slice(0, 1).toUpperCase()}</span>
              )}
            </div>
            <div className="min-w-0">
              <p className="line-clamp-2 text-[12.5px] font-semibold leading-tight text-text">{instance.name}</p>
              <p className="truncate text-[10px] text-faint">
                {instance.mcVersion} · {LOADER_LABELS[instance.loader]}
              </p>
            </div>
          </div>

          <nav className="mt-5 flex flex-col gap-1">
            {tabs.map((entry) => {
              const active = tab === entry
              const badge = entry === 'mod' || entry === 'resourcepack' || entry === 'shader' ? updates[entry].length : 0
              return (
                <button
                  key={entry}
                  onClick={() => {
                    setTab(entry)
                    setSelectedFile(null)
                    setSelectedHit(null)
                  }}
                  className={cn(
                    'group flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[12.5px] transition',
                    active
                      ? 'bg-emerald/12 text-text shadow-[inset_0_0_0_1px_rgba(47,226,140,0.22)]'
                      : 'text-muted hover:bg-white/[0.05] hover:text-text'
                  )}
                >
                  <span className={cn('transition', active ? 'text-emerald-glow' : 'text-faint group-hover:text-muted')}>
                    {TAB_ICON[entry]}
                  </span>
                  <span className="flex-1">{t(TAB_LABEL[entry])}</span>
                  {badge > 0 ? (
                    <span className="rounded-full bg-emerald/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-glow">
                      {badge}
                    </span>
                  ) : null}
                  {active ? <motion.span layoutId="cm-active" className="absolute left-0 h-6 w-[2px] rounded-full bg-emerald-glow" /> : null}
                </button>
              )
            })}
          </nav>

          <div className="mt-auto rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3">
            <p className="text-[10px] uppercase tracking-[0.14em] text-faint">{t('content.compatTitle')}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone="emerald">{instance.mcVersion}</Badge>
              <Badge>{LOADER_LABELS[instance.loader]}</Badge>
            </div>
            <p className="mt-2 text-[10.5px] leading-relaxed text-faint">{t('content.compatHint')}</p>
          </div>
        </aside>

        {/* ---------------------------------------------------- centre: content */}
        <section className="relative flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between gap-4 border-b border-white/[0.07] px-6 py-4">
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold tracking-tight text-text">{t(TAB_LABEL[tab])}</h2>
              <p className="mt-0.5 truncate text-[11.5px] text-muted">
                {tab === 'logs'
                  ? t('content.logsHint')
                  : tab === 'versions'
                    ? t('content.versionsHint')
                    : t('content.listHint', { version: instance.mcVersion, loader: LOADER_LABELS[instance.loader] })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {tab !== 'logs' && tab !== 'versions' ? (
                <Button
                  size="sm"
                  icon={<RefreshCw className={cn('h-3.5 w-3.5', checking && 'animate-spin')} />}
                  onClick={() => void checkUpdates()}
                  disabled={checking}
                >
                  {t('content.checkUpdates')}
                </Button>
              ) : null}
              <IconButton label={t('common.close')} onClick={onClose}>
                <X className="h-4 w-4" />
              </IconButton>
            </div>
          </header>

          {tab === 'catalog' ? (
            <div className="flex items-center gap-2 border-b border-white/[0.07] px-6 py-3">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('content.searchPlaceholder', { version: instance.mcVersion })}
                  className="!pl-9"
                />
              </div>
              <Badge tone="emerald">{instance.mcVersion}</Badge>
              {kind === 'mod' ? <Badge>{LOADER_LABELS[instance.loader]}</Badge> : null}
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {tab === 'logs' ? (
              <div className="h-full overflow-y-auto rounded-2xl border border-white/[0.07] bg-black/40 p-4 font-mono text-[11px] leading-relaxed">
                {tail.length === 0 ? (
                  <p className="text-faint">{t('content.logsEmpty')}</p>
                ) : (
                  tail.map((line) => (
                    <div key={line.seq} className="flex gap-2 py-[1px]">
                      <span className="flex-none text-white/25">
                        {new Date(line.ts).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                      <LevelTag level={line.level} />
                      <span className="min-w-0 break-all text-text/85">{line.text}</span>
                    </div>
                  ))
                )}
              </div>
            ) : null}

            {tab === 'versions' ? (
              <div className="space-y-3">
                {[
                  { label: t('content.version.mc'), value: instance.mcVersion },
                  { label: t('content.version.loader'), value: `${LOADER_LABELS[instance.loader]}${instance.loaderVersion ? ` ${instance.loaderVersion}` : ''}` },
                  { label: t('content.version.lastPlayed'), value: formatDate(instance.lastPlayedAt, locale) },
                  { label: t('content.version.installed'), value: instance.installed ? t('common.yes') : t('common.no') },
                  { label: t('content.version.mods'), value: String(instance.modsCount) },
                  { label: t('content.version.path'), value: instance.gameDir }
                ].map((row) => (
                  <div key={row.label} className="flex items-center gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.025] px-4 py-3">
                    <span className="w-40 flex-none text-[11px] uppercase tracking-[0.1em] text-faint">{row.label}</span>
                    <span className="min-w-0 break-all text-[12.5px] text-text">{row.value}</span>
                  </div>
                ))}
                <Button
                  size="sm"
                  icon={<FolderOpen className="h-3.5 w-3.5" />}
                  onClick={() => void api.content.openFolder(instance.id, 'mod')}
                >
                  {t('content.openFolder')}
                </Button>
              </div>
            ) : null}

            {tab === 'catalog' ? (
              <div className="space-y-2">
                {searching && hits.length === 0 ? (
                  <div className="flex items-center justify-center py-16 text-muted">
                    <Spinner />
                  </div>
                ) : null}
                {searchError ? (
                  <div className="flex items-center gap-2 rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-[12px] text-rose-200">
                    <TriangleAlert className="h-4 w-4" /> {searchError}
                  </div>
                ) : null}
                {!searching && !searchError && hits.length === 0 ? (
                  <p className="py-16 text-center text-[12.5px] text-faint">{t('content.emptySearch')}</p>
                ) : null}
                {hits.map((hit, index) => {
                  const busy = busyHits.has(hit.id)
                  const active = selectedHit?.id === hit.id
                  return (
                    <motion.div
                      key={hit.id}
                      layout initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: (index % 8) * 0.04, ease: [0.2, 0.8, 0.2, 1] }} whileTap={{ scale: 0.99 }}
                      onClick={() => setSelectedHit(hit)}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-2xl border px-3.5 py-3 transition',
                        active
                          ? 'border-emerald/30 bg-emerald/[0.07]'
                          : 'border-white/[0.06] bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.045]'
                      )}
                    >
                      <ContentAvatar iconUrl={hit.iconUrl} name={hit.name} size={38} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate text-[13px] font-semibold text-text">{hit.name}</h3> {installedIds.has(hit.id) ? <Badge tone="emerald"><Check className="mr-1 inline h-2.5 w-2.5" />{t('content.installedBadge')}</Badge> : null}
                          <Badge tone="emerald">
                            <Check className="mr-1 inline h-2.5 w-2.5" />
                            {hit.gameVersions.includes(instance.mcVersion) ? instance.mcVersion : '—'}
                          </Badge>
                        </div>
                        <p className="mt-0.5 line-clamp-1 text-[11px] text-muted">{hit.summary}</p>
                        <div className="mt-1 flex items-center gap-2 text-[10px] text-faint">
                          {hit.author ? <span>{hit.author}</span> : null}
                          <span className="text-white/20">·</span>
                          <span className="flex items-center gap-1">
                            <Download className="h-3 w-3" /> {formatNumber(hit.downloads)}
                          </span>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="primary"
                        loading={busy}
                        disabled={installedIds.has(hit.id)}
                        icon={installedIds.has(hit.id) ? <Check className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
                        onClick={(event) => {
                          event.stopPropagation()
                          void installHit(hit)
                        }}
                      >
                        {installedIds.has(hit.id) ? t('content.installedBadge') : t('content.install')}
                      </Button>
                    </motion.div>
                  )
                })}
                {hits.length > 0 ? (
                  <p className="pt-2 text-center text-[10.5px] text-faint">{t('content.totalHint', { total, shown: hits.length })}</p>
                ) : null}
              </div>
            ) : null}

            {tab === 'mod' || tab === 'resourcepack' || tab === 'shader' ? (
              <div className="overflow-hidden rounded-2xl border border-white/[0.07]">
                <div className="grid grid-cols-[30px_minmax(0,1.6fr)_116px_104px_112px_92px] items-center gap-3 border-b border-white/[0.07] bg-white/[0.03] px-3 py-2 text-[10px] uppercase tracking-[0.12em] text-faint">
                  <span />
                  <span>{t('content.col.name')}</span>
                  <span>{t('content.col.version')}</span>
                  <span>{t('content.col.date')}</span>
                  <span>{t('content.col.author')}</span>
                  <span>{t('content.col.status')}</span>
                </div>

                {installed[kind] === null ? (
                  <div className="flex items-center justify-center py-16">
                    <Spinner />
                  </div>
                ) : list.length === 0 ? (
                  <p className="py-16 text-center text-[12.5px] text-faint">{t('content.emptyInstalled')}</p>
                ) : (
                  list.map((entry) => {
                    const update = updateMap.get(entry.fileName)
                    const active = selectedFile === entry.fileName
                    return (
                      <div
                        key={entry.fileName}
                        onClick={() => setSelectedFile(entry.fileName)}
                        className={cn(
                          'grid cursor-pointer grid-cols-[30px_minmax(0,1.6fr)_116px_104px_112px_92px] items-center gap-3 border-b border-white/[0.05] px-3 py-2.5 text-[12px] transition last:border-0',
                          active ? 'bg-emerald/[0.08]' : 'hover:bg-white/[0.035]',
                          !entry.enabled && 'opacity-55'
                        )}
                      >
                        <button
                          aria-label={entry.enabled ? t('content.disable') : t('content.enable')}
                          onClick={(event) => {
                            event.stopPropagation()
                            void toggle(entry)
                          }}
                          className={cn(
                            'flex h-[18px] w-[18px] items-center justify-center rounded-[6px] border transition',
                            entry.enabled
                              ? 'border-emerald/50 bg-emerald/25 text-emerald-glow'
                              : 'border-white/15 bg-white/[0.04] text-transparent hover:border-white/30'
                          )}
                        >
                          <Check className="h-3 w-3" />
                        </button>
                        <div className="flex min-w-0 items-center gap-2.5">
                          <ContentAvatar iconUrl={entry.iconUrl} name={entry.name} size={26} />
                          <div className="min-w-0">
                            <p className="truncate font-medium text-text">{entry.name}</p>
                            <p className="truncate text-[10px] text-faint">{entry.fileName}</p>
                          </div>
                        </div>
                        <span className="truncate text-muted">
                          {entry.version || '—'}
                          {update ? <span className="text-emerald-glow"> → {update.latestVersion}</span> : null}
                        </span>
                        <span className="text-faint">{formatDate(entry.installedAt, locale)}</span>
                        <span className="truncate text-faint">{entry.author ?? '—'}</span>
                        <span>
                          {update ? <Badge tone="gold">{t('content.updateBadge')}</Badge> : null}
                        </span>
                      </div>
                    )
                  })
                )}
              </div>
            ) : null}
          </div>
          <footer className="flex items-center justify-between border-t border-white/[0.07] px-6 py-2.5 text-[10.5px] text-faint">
            <span>
              {tab === 'mod' || tab === 'resourcepack' || tab === 'shader'
                ? t('content.footerCount', { count: list.length })
                : t('content.footerCompat', { version: instance.mcVersion, loader: LOADER_LABELS[instance.loader] })}
            </span>
            <span>{t('content.footerHook')}</span>
          </footer>
        </section>

        {/* ---------------------------------------------------- right: actions */}
        <aside className="relative flex w-[272px] flex-none flex-col gap-3 border-l border-white/[0.07] bg-black/20 px-4 py-4">
          <p className="px-1 text-[10px] uppercase tracking-[0.16em] text-faint">{t('content.actions')}</p>

          {selected ? (
            <div className="space-y-3">
              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3.5">
                <div className="flex items-center gap-2.5">
                  <ContentAvatar iconUrl={selected.iconUrl} name={selected.name} size={40} />
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] font-semibold text-text">{selected.name}</p>
                    <p className="truncate text-[10.5px] text-faint">
                      {selected.version || '—'} · {t(selected.enabled ? 'content.enabled' : 'content.disabled')}
                    </p>
                  </div>
                </div>
                {selectedUpdate ? (
                  <div className="mt-3 rounded-xl border border-emerald/25 bg-emerald/10 px-3 py-2">
                    <p className="text-[10.5px] uppercase tracking-[0.12em] text-emerald-glow">{t('content.updateAvailable')}</p>
                    <p className="mt-0.5 text-[11.5px] text-text">
                      {selectedUpdate.currentVersion} → {selectedUpdate.latestVersion}
                    </p>
                  </div>
                ) : null}
              </div>

              {selectedUpdate ? (
                <Button
                  variant="primary"
                  className="w-full justify-start"
                  loading={busyFile === selected.fileName}
                  icon={<RefreshCw className="h-4 w-4" />}
                  onClick={() => void applyUpdate(selectedUpdate)}
                >
                  {t('content.update')}
                </Button>
              ) : null}

              <Button className="w-full justify-start" icon={<Power className="h-4 w-4" />} onClick={() => void toggle(selected)}>
                {t(selected.enabled ? 'content.disable' : 'content.enable')}
              </Button>
              <Button
                className="w-full justify-start"
                icon={<FolderOpen className="h-4 w-4" />}
                onClick={() => void api.content.openFolder(instance.id, kind)}
              >
                {t('content.openFolder')}
              </Button>
              <Button
                className="w-full justify-start"
                icon={<ArrowUpRight className="h-4 w-4" />}
                disabled={!selected.projectId || selected.source === 'manual'}
                onClick={() =>
                  selected.projectId && void api.content.openPage(selected.source === 'curseforge' ? 'curseforge' : 'modrinth', kind, selected.projectId)
                }
              >
                {t('content.openPage')}
              </Button>
              <Button
                variant="danger"
                className="w-full justify-start"
                loading={busyFile === selected.fileName}
                icon={<Trash2 className="h-4 w-4" />}
                onClick={() => void remove(selected)}
              >
                {t('content.delete')}
              </Button>
            </div>
          ) : selectedHit ? (
            <div className="space-y-3">
              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3.5">
                <div className="flex items-center gap-2.5">
                  <ContentAvatar iconUrl={selectedHit.iconUrl} name={selectedHit.name} size={40} />
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] font-semibold text-text">{selectedHit.name}</p>
                    <p className="truncate text-[10.5px] text-faint">{selectedHit.author || '—'}</p>
                  </div>
                </div>
                <p className="mt-2.5 text-[11px] leading-relaxed text-muted">{selectedHit.summary}</p>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {selectedHit.gameVersions.slice(0, 4).map((version) => (
                    <Badge key={version} tone={version === instance.mcVersion ? 'emerald' : 'default'}>
                      {version}
                    </Badge>
                  ))}
                </div>
              </div>
              <Button
                variant="primary"
                className="w-full justify-start"
                loading={busyHits.has(selectedHit.id)}
                disabled={installedIds.has(selectedHit.id)} icon={installedIds.has(selectedHit.id) ? <Check className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                onClick={() => void installHit(selectedHit)}
              >
                {installedIds.has(selectedHit.id) ? t('content.installedBadge') : t('content.install')}
              </Button>
              <Button
                className="w-full justify-start"
                icon={<ArrowUpRight className="h-4 w-4" />}
                onClick={() =>
                  void api.content.openPage(selectedHit.source === 'curseforge' ? 'curseforge' : 'modrinth', kind, selectedHit.id)
                }
              >
                {t('content.openPage')}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3.5">
                <p className="text-[11.5px] leading-relaxed text-muted">{t('content.noSelection')}</p>
              </div>
              {updatesForTab.length > 0 ? (
                <div className="rounded-2xl border border-emerald/20 bg-emerald/[0.07] p-3.5">
                  <p className="text-[10.5px] uppercase tracking-[0.12em] text-emerald-glow">{t('content.updatesReady')}</p>
                  {updatesForTab.slice(0, 4).map((update) => (
                    <button
                      key={update.fileName}
                      onClick={() => setSelectedFile(update.fileName)}
                      className="mt-1.5 flex w-full items-center justify-between gap-2 text-left text-[11.5px] text-text transition hover:text-emerald-glow"
                    >
                      <span className="truncate">{update.name}</span>
                      <span className="flex-none text-[10.5px] text-faint">{update.latestVersion}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              <Button className="w-full justify-start" icon={<FolderOpen className="h-4 w-4" />} onClick={() => void api.content.openFolder(instance.id, kind)}>
                {t('content.openFolder')}
              </Button>
            </div>
          )}

          <div className="mt-auto rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3">
            <p className="text-[10px] uppercase tracking-[0.14em] text-faint">{t('content.instance')}</p>
            <p className="mt-1 truncate text-[11.5px] text-text">{instance.name}</p>
            <p className="truncate text-[10.5px] text-faint">{instance.gameDir}</p>
          </div>
        </aside>
      </motion.div>
    </motion.div>,
    document.body
  )
}

/** Small wrapper so the window can animate out. */
export function ContentManagerHost({ instance, onClose }: { instance: Instance | null; onClose: () => void }): JSX.Element {
  return (
    <AnimatePresence>{instance ? <ContentManager instance={instance} onClose={onClose} /> : null}</AnimatePresence>
  )
}
