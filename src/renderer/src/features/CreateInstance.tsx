import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  Boxes,
  Check,
  CheckCircle2,
  ChevronDown,
  Cpu,
  Download,
  Loader2,
  Package,
  Play,
  Plus,
  Search,
  Sparkles,
  X
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatBytes, formatNumber } from '../../../shared/constants'
import { LOADER_LABELS } from '../../../shared/types'
import type {
  Instance,
  JavaRuntime,
  LoaderType,
  LoaderVersion,
  ModHit,
  ModSource,
  ModVersion,
  VersionSummary
} from '../../../shared/types'
import { Badge, Button, Input, Slider, Spinner } from '../components/ui'
import { localizeError, pluralCount, useT, type TKey } from '../i18n'
import { api } from '../lib/api'
import { cn, formatGb, LOADER_COLORS, relativeTime } from '../lib/utils'
import { useAppStore, type CreateTab } from '../store/app'

type SubmitPhase = 'idle' | 'progress' | 'done'

const LOADERS: { value: LoaderType; label: string; hint: TKey }[] = [
  { value: 'vanilla', label: 'Vanilla', hint: 'create.loader.vanilla' },
  { value: 'fabric', label: 'Fabric', hint: 'create.loader.fabric' },
  { value: 'quilt', label: 'Quilt', hint: 'create.loader.quilt' },
  { value: 'forge', label: 'Forge', hint: 'create.loader.forge' },
  { value: 'neoforge', label: 'NeoForge', hint: 'create.loader.neoforge' }
]

/** Icons for the loader radio-cards (no external assets). */
function LoaderGlyph({ loader }: { loader: LoaderType }): JSX.Element {
  const colors = LOADER_COLORS[loader]
  return (
    <span
      className="flex h-8 w-8 flex-none items-center justify-center rounded-xl border border-white/10 text-[11px] font-bold uppercase tracking-tight text-white/90"
      style={{ background: `linear-gradient(140deg, ${colors.from}, ${colors.to})` }}
    >
      {loader === 'vanilla' ? '★' : loader.slice(0, 1)}
    </span>
  )
}

function LoaderPicker({
  value,
  onChange
}: {
  value: LoaderType
  onChange: (loader: LoaderType) => void
}): JSX.Element {
  const t = useT()
  return (
    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t('create.loader.title')}>
      {LOADERS.map((entry) => {
        const active = value === entry.value
        return (
          <button
            key={entry.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={entry.label}
            onClick={() => onChange(entry.value)}
            className={cn(
              'group relative flex items-start gap-2.5 rounded-2xl border px-3 py-2 text-left transition',
              entry.value === 'vanilla' && 'col-span-2',
              active
                ? 'border-emerald/45 bg-emerald/[0.09] shadow-[0_10px_30px_-18px_rgba(47,226,140,0.8)]'
                : 'border-white/[0.07] bg-white/[0.025] hover:border-white/15 hover:bg-white/[0.05]'
            )}
          >
            <LoaderGlyph loader={entry.value} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-text">
                {entry.label}
                {active ? <Check className="h-3.5 w-3.5 text-emerald-soft" /> : null}
              </span>
              <span className="mt-0.5 block text-[10.5px] leading-snug text-muted">{t(entry.hint)}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

function VersionList({
  versions,
  loading,
  selected,
  latest,
  onSelect
}: {
  versions: VersionSummary[]
  loading: boolean
  selected: string
  latest: string | null
  onSelect: (version: string) => void
}): JSX.Element {
  const t = useT()
  const language = useAppStore((state) => state.settings.language)

  if (loading) {
    return (
      <div className="space-y-1.5">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="skeleton h-[38px] w-full rounded-xl" />
        ))}
      </div>
    )
  }

  if (versions.length === 0) {
    return <div className="py-12 text-center text-[12px] text-faint">{t('create.versions.empty')}</div>
  }

  return (
    <div className="space-y-1 pr-1">
      {versions.map((version) => {
        const active = selected === version.id
        return (
          <button
            key={version.id}
            onClick={() => onSelect(version.id)}
            className={cn(
              'flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left transition',
              active
                ? 'border-emerald/45 bg-emerald/[0.1]'
                : 'border-transparent hover:border-white/10 hover:bg-white/[0.04]'
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={cn(
                  'flex h-4 w-4 flex-none items-center justify-center rounded-full border transition',
                  active ? 'border-emerald-glow bg-emerald-glow/20' : 'border-white/20'
                )}
              >
                {active ? <span className="h-1.5 w-1.5 rounded-full bg-emerald-glow" /> : null}
              </span>
              <span className="truncate font-mono text-[12px] text-text">{version.id}</span>
              {version.id === latest ? <Badge tone="emerald">{t('create.versions.latest')}</Badge> : null}
              {version.type === 'snapshot' ? <Badge tone="gold">snap</Badge> : null}
            </span>
            <span className="flex-none text-[10px] text-faint">
              {new Date(version.releaseTime).toLocaleDateString(language === 'ru' ? 'ru-RU' : 'en-US')}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function ModpackCard({
  hit,
  active,
  onSelect
}: {
  hit: ModHit
  active: boolean
  onSelect: () => void
}): JSX.Element {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl border px-2.5 py-2 text-left transition',
        active
          ? 'border-emerald/45 bg-emerald/[0.1]'
          : 'border-transparent hover:border-white/10 hover:bg-white/[0.04]'
      )}
    >
      <span className="flex h-9 w-9 flex-none items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-white/[0.05] text-[10px] font-semibold text-emerald-soft">
        {hit.iconUrl ? <img src={hit.iconUrl} alt="" className="h-full w-full object-cover" /> : hit.name.slice(0, 2).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium text-text">{hit.name}</span>
        <span className="block truncate text-[10px] text-faint">{hit.summary}</span>
      </span>
      <span className="flex flex-none items-center gap-1 text-[9.5px] text-faint">
        <Download className="h-2.5 w-2.5" />
        {formatNumber(hit.downloads)}
      </span>
    </button>
  )
}

/** Pipeline rows shown while an instance is built from a Minecraft version. */
const VERSION_PIPELINE: { key: string; match: string[]; label: TKey }[] = [
  { key: 'version', match: ['manifest', 'version', 'download'], label: 'create.progress.files' },
  { key: 'loader', match: ['loader'], label: 'create.progress.loader' },
  { key: 'libraries', match: ['libraries'], label: 'create.progress.assets' }
]

/** Pipeline rows shown while a modpack is installed as an instance. */
const PACK_PIPELINE: { key: string; match: string[]; label: TKey }[] = [
  { key: 'packDownload', match: ['pack', 'packDownload', 'manifest', 'version', 'download'], label: 'create.progress.archive' },
  { key: 'packFiles', match: ['packFiles'], label: 'create.progress.mods' },
  { key: 'overrides', match: ['overrides'], label: 'create.progress.configs' }
]

export function CreateInstanceModal(): JSX.Element | null {
  const t = useT()
  const language = useAppStore((state) => state.settings.language)
  const open = useAppStore((state) => state.createOpen)
  const tab = useAppStore((state) => state.createTab)
  const setTab = useAppStore((state) => state.setCreateTab)
  const closeCreate = useAppStore((state) => state.closeCreate)
  const settings = useAppStore((state) => state.settings)
  const systemInfo = useAppStore((state) => state.systemInfo)
  const instances = useAppStore((state) => state.instances)
  const createInstance = useAppStore((state) => state.createInstance)
  const installInstance = useAppStore((state) => state.installInstance)
  const installModpack = useAppStore((state) => state.installModpack)
  const pushToast = useAppStore((state) => state.pushToast)
  const toastError = useAppStore((state) => state.toastError)
  const setScreen = useAppStore((state) => state.setScreen)
  const launch = useAppStore((state) => state.launch)
  const task = useAppStore((state) => state.task)

  // ------- versions tab state
  const [versions, setVersions] = useState<VersionSummary[] | null>(null)
  const [versionQuery, setVersionQuery] = useState('')
  const [versionFilter, setVersionFilter] = useState<'release' | 'snapshot' | 'all'>('release')
  const [mcVersion, setMcVersion] = useState('')
  const [loader, setLoader] = useState<LoaderType>('fabric')
  const [loaderVersions, setLoaderVersions] = useState<LoaderVersion[] | null>(null)
  const [loaderVersion, setLoaderVersion] = useState('')
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [memory, setMemory] = useState(4096)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [javaList, setJavaList] = useState<JavaRuntime[] | null>(null)
  const [javaPath, setJavaPath] = useState('')

  // ------- modpacks tab state
  const [source, setSource] = useState<ModSource>(settings.modSource)
  const [packQuery, setPackQuery] = useState('')
  const [packs, setPacks] = useState<ModHit[]>([])
  const [packsLoading, setPacksLoading] = useState(false)
  const [packsError, setPacksError] = useState<string | null>(null)
  const [selectedPack, setSelectedPack] = useState<ModHit | null>(null)
  const [packVersions, setPackVersions] = useState<ModVersion[] | null>(null)
  const [packVersionId, setPackVersionId] = useState<string>('')

  // ------- submit state
  const [phase, setPhase] = useState<SubmitPhase>('idle')
  const [installMode, setInstallMode] = useState<'version' | 'pack'>('version')
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<Instance | null>(null)
  /** Instance already created but not fully installed — retry must not duplicate it. */
  const [pending, setPending] = useState<Instance | null>(null)
  const [liveStage, setLiveStage] = useState<{ key: string; label: string }>({ key: 'manifest', label: '' })
  const submitInFlight = useRef(false)

  const reset = useCallback(() => {
    setPhase('idle')
    setError(null)
    setCreated(null)
    setPending(null)
    setVersionQuery('')
    setPackQuery('')
    setPacks([])
    setSelectedPack(null)
    setPackVersions(null)
    setPackVersionId('')
    setName('')
    setNameTouched(false)
    setShowAdvanced(false)
    setLiveStage({ key: 'manifest', label: '' })
    submitInFlight.current = false
  }, [])

  // ------- bootstrap on open
  useEffect(() => {
    if (!open) return
    reset()
    setLoader('fabric')
    setLoaderVersion('')
    if (!versions) {
      void api.versions
        .minecraft()
        .then((list) => {
          setVersions(list)
          const latest = list.find((entry) => entry.type === 'release')
          if (latest) setMcVersion((current) => current || latest.id)
        })
        .catch((err) => {
          setVersions([])
          setError(localizeError(t, (err as { code?: string }).code))
        })
    }
    const recommended = Math.min(8192, Math.max(2048, Math.floor((systemInfo?.totalMemMB ?? 8192) / 1024 / 4) * 1024))
    setMemory(settings.defaultMemory.max || recommended)
    setJavaPath(settings.javaPath ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open || !mcVersion) return
    if (loader === 'vanilla') {
      setLoaderVersions(null)
      setLoaderVersion('')
      return
    }
    let alive = true
    setLoaderVersions(null)
    setLoaderVersion('')
    void api.versions
      .loaders(mcVersion, loader)
      .then((list) => {
        if (!alive) return
        setLoaderVersions(list)
        const stable = list.find((entry) => entry.stable) ?? list[0]
        if (stable) setLoaderVersion(stable.version)
      })
      .catch(() => alive && setLoaderVersions([]))
    return () => {
      alive = false
    }
  }, [mcVersion, loader, open])

  useEffect(() => {
    if (!open || tab !== 'versions' || !showAdvanced || javaList) return
    void api.java.scan().then(setJavaList).catch(() => setJavaList([]))
  }, [open, tab, showAdvanced, javaList])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && phase === 'idle') closeCreate()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, phase, closeCreate])

  // ------- default instance name follows the selection until the user edits it
  const suggestedName = useMemo(() => {
    if (!mcVersion) return ''
    return loader === 'vanilla'
      ? `Minecraft ${mcVersion}`
      : `${LOADERS.find((entry) => entry.value === loader)?.label ?? 'Minecraft'} ${mcVersion}`
  }, [loader, mcVersion])

  useEffect(() => {
    if (!nameTouched) setName(suggestedName)
  }, [suggestedName, nameTouched])

  // ------- modpack search (debounced)
  const searchPacks = useCallback(
    async (query: string, src: ModSource) => {
      setPacksLoading(true)
      setPacksError(null)
      try {
        const result = await api.mods.search({
          source: src,
          query,
          sort: query ? 'relevance' : 'downloads',
          projectType: 'modpack',
          limit: 20
        })
        setPacks(result.hits)
      } catch (err) {
        setPacks([])
        setPacksError(localizeError(t, (err as { code?: string }).code ?? (err as Error).message))
      } finally {
        setPacksLoading(false)
      }
    },
    [t]
  )

  useEffect(() => {
    if (!open || tab !== 'modpacks') return
    const timer = window.setTimeout(() => void searchPacks(packQuery, source), 320)
    return () => window.clearTimeout(timer)
  }, [open, tab, packQuery, source, searchPacks])

  useEffect(() => {
    if (!selectedPack) return
    let alive = true
    setPackVersions(null)
    setPackVersionId('')
    void api.mods
      .packVersions(selectedPack.source, selectedPack.id)
      .then((list) => {
        if (!alive) return
        setPackVersions(list)
        if (list[0]) setPackVersionId(list[0].id)
      })
      .catch(() => alive && setPacksError(localizeError(t, 'network_error')))
    return () => {
      alive = false
    }
  }, [selectedPack, t])

  // ------- live task mirror (stage label for the progress screen)
  useEffect(() => {
    if (!task || task.status === 'done' || !task.stageKey) return
    setLiveStage({ key: task.stageKey, label: task.stage })
  }, [task])

  const totalMem = systemInfo?.totalMemMB ?? 16384
  const maxMemory = Math.max(2048, Math.min(32768, Math.floor(totalMem / 1024) * 1024 - 1024))
  const memoryAccent = memory / totalMem > 0.7 ? '#f87171' : memory / totalMem > 0.5 ? '#f5c249' : '#2fe28c'

  const filteredVersions = useMemo(() => {
    if (!versions) return []
    const text = versionQuery.trim().toLowerCase()
    const filtered = versions
      .filter((version) =>
        versionFilter === 'all' ? true : versionFilter === 'release' ? version.type === 'release' : version.type === 'snapshot'
      )
      .filter((version) => !text || version.id.toLowerCase().includes(text))
    return filtered.slice(0, 120)
  }, [versions, versionQuery, versionFilter])

  const latestRelease = useMemo(() => versions?.find((version) => version.type === 'release')?.id ?? null, [versions])
  const releaseCount = useMemo(() => versions?.filter((version) => version.type === 'release').length ?? 0, [versions])

  const activeTask = task && task.status === 'running' ? task : null
  const pipeline = installMode === 'pack' ? PACK_PIPELINE : VERSION_PIPELINE
  const stageKey = activeTask?.stageKey ?? liveStage.key
  let rowIndex = pipeline.findIndex((row) => row.match.includes(stageKey))
  if (rowIndex < 0) rowIndex = 0

  // A single honest percentage across the whole pipeline, weighted per stage.
  const stageFraction = activeTask && activeTask.total > 0 ? Math.min(1, activeTask.current / activeTask.total) : 0
  const percent =
    phase === 'progress'
      ? Math.min(99, Math.round(((rowIndex + stageFraction) / pipeline.length) * 100))
      : null

  const runInstall = async (instance: Instance): Promise<void> => {
    setInstallMode('version')
    setPhase('progress')
    setLiveStage({ key: 'manifest', label: '' })
    const ok = await installInstance(instance.id)
    if (ok) {
      setCreated(await api.instances.get(instance.id).catch(() => instance))
      setPhase('done')
    } else {
      // Surface the concrete reason right next to the button as well: a toast
      // alone is easy to miss and the retry lives on this screen.
      const state = useAppStore.getState().integrity[instance.id]
      if (state?.status === 'error') {
        setError(
          state.code === 'network_error' && state.file
            ? t('errors.network_error', { file: state.file })
            : t(`errors.${state.code}` as TKey)
        )
      }
      // keep the instance and retry in place
      setPending(instance)
      setPhase('idle')
      setCreated(null)
    }
  }

  const submitVersion = async (): Promise<void> => {
    if (submitInFlight.current) return
    submitInFlight.current = true
    setError(null)
    try {
      const instance =
        pending ??
        (await createInstance({
          name: name.trim() || suggestedName,
          mcVersion,
          loader,
          loaderVersion: loader === 'vanilla' ? null : loaderVersion,
          memory: { min: Math.min(1024, memory), max: memory },
          javaPath: javaPath || null
        }))
      setName(instance.name)
      await runInstall(instance)
    } catch (err) {
      setError(localizeError(t, (err as { code?: string }).code ?? (err as Error).message))
    } finally {
      submitInFlight.current = false
    }
  }

  const submitPack = async (): Promise<void> => {
    if (!selectedPack || submitInFlight.current) return
    submitInFlight.current = true
    setError(null)
    setInstallMode('pack')
    setPhase('progress')
    setLiveStage({ key: 'packDownload', label: '' })
    try {
      const instance = await installModpack({
        source: selectedPack.source,
        projectId: selectedPack.id,
        projectName: selectedPack.name,
        projectIcon: selectedPack.iconUrl,
        versionId: packVersionId || undefined
      })
      setCreated(instance)
      setPhase('done')
      pushToast({ kind: 'success', titleKey: 'toast.packInstalled', vars: { name: instance.name } })
    } catch (err) {
      setPhase('idle')
      const code = (err as { code?: string }).code
      setError(
        code === 'network_error' && (err as { file?: string }).file
          ? t('errors.network_error', { file: (err as { file?: string }).file as string })
          : localizeError(t, code ?? (err as Error).message)
      )
    } finally {
      submitInFlight.current = false
    }
  }

  const canSubmitVersions = Boolean(mcVersion) && (loader === 'vanilla' || Boolean(loaderVersion))
  const curseforgeBlocked = source === 'curseforge' && !settings.curseForgeApiKey

  const displayName = created?.name ?? (tab === 'modpacks' ? selectedPack?.name ?? '' : name)
  const modalTitle = t('create.title')
  const modalSubtitle = t('create.subtitle')
  const statusText =
    phase === 'progress' ? t('create.progress.title', { name: displayName }) : t('create.done.hint', { name: displayName })

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <motion.div
        className="absolute inset-0 bg-black/65 backdrop-blur-md"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        onClick={() => {
          if (phase === 'idle') closeCreate()
        }}
      />
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        className="glass relative flex h-[min(84vh,720px)] w-full max-w-[1080px] flex-col overflow-hidden rounded-[28px]"
        role="dialog"
        aria-modal="true"
        aria-label={modalTitle}
      >
        {/* ambient emerald glow */}
        <div className="pointer-events-none absolute -left-24 -top-28 h-72 w-72 rounded-full bg-emerald/20 blur-[90px]" />
        <div className="pointer-events-none absolute -right-24 top-1/3 h-64 w-64 rounded-full bg-gold/10 blur-[90px]" />

        {/* header */}
        <div className="relative flex items-start justify-between gap-4 px-7 pb-4 pt-6">
          <div>
            <div className="eyebrow mb-1.5">{phase === 'idle' ? t('nav.instances') : t('app.name')}</div>
            <h2 className="text-[19px] font-semibold tracking-tight text-text">{modalTitle}</h2>
            <p className="mt-1 max-w-lg text-[12px] leading-relaxed text-muted">
              {phase === 'idle' ? modalSubtitle : statusText}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {phase === 'idle' ? (
              <div className="flex rounded-xl border border-white/[0.08] bg-white/[0.03] p-1">
                {(['versions', 'modpacks'] as CreateTab[]).map((key) => (
                  <button
                    key={key}
                    onClick={() => setTab(key)}
                    className={cn(
                      'relative rounded-lg px-3.5 py-1.5 text-[11.5px] font-medium transition',
                      tab === key ? 'text-emerald-soft' : 'text-muted hover:text-text'
                    )}
                  >
                    {tab === key ? (
                      <motion.span
                        layoutId="create-tab"
                        className="absolute inset-0 rounded-lg border border-emerald/30 bg-emerald/[0.12]"
                        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                      />
                    ) : null}
                    <span className="relative z-10 flex items-center gap-1.5">
                      {key === 'versions' ? <Boxes className="h-3.5 w-3.5" /> : <Package className="h-3.5 w-3.5" />}
                      {t(key === 'versions' ? 'create.tab.versions' : 'create.tab.modpacks')}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            <button
              className="icon-btn"
              aria-label={t('common.close')}
              onClick={() => (phase === 'progress' ? undefined : closeCreate())}
              disabled={phase === 'progress'}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="hairline mx-7" />

        {/* body */}
        <div className="relative min-h-0 flex-1 overflow-hidden px-7 py-5">
          <AnimatePresence mode="wait">
            {/* ------------------------------------------------ progress */}
            {phase === 'progress' ? (
              <motion.div
                key="progress"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex h-full flex-col items-center justify-center gap-6"
              >
                <div className="relative flex h-[92px] w-[92px] items-center justify-center">
                  <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90">
                    <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="7" />
                    <motion.circle
                      cx="50"
                      cy="50"
                      r="44"
                      fill="none"
                      stroke="url(#verdantGradient)"
                      strokeWidth="7"
                      strokeLinecap="round"
                      strokeDasharray={276}
                      animate={{ strokeDashoffset: percent === null ? 276 * 0.72 : 276 - (276 * percent) / 100 }}
                      transition={{ type: 'spring', stiffness: 90, damping: 20 }}
                    />
                    <defs>
                      <linearGradient id="verdantGradient" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#2fe28c" />
                        <stop offset="100%" stopColor="#0a8f63" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div className="flex flex-col items-center">
                    {percent === null ? (
                      <Loader2 className="h-6 w-6 animate-spin text-emerald-soft" />
                    ) : (
                      <span className="text-[17px] font-semibold text-text">{percent}%</span>
                    )}
                  </div>
                </div>

                <div className="w-full max-w-[460px]">
                  <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
                    <motion.div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-soft to-emerald-deep"
                      animate={{ width: `${percent ?? 0}%` }}
                      transition={{ type: 'spring', stiffness: 120, damping: 24 }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    {pipeline.map((row, index) => {
                      const done = index < rowIndex
                      const active = index === rowIndex
                      return (
                        <div
                          key={row.key}
                          className={cn(
                            'flex items-center gap-2.5 rounded-xl border px-3 py-2 text-[12px] transition',
                            active
                              ? 'border-emerald/35 bg-emerald/[0.08] text-text'
                              : done
                                ? 'border-white/[0.06] bg-white/[0.02] text-muted'
                                : 'border-transparent text-faint'
                          )}
                        >
                          {done ? (
                            <CheckCircle2 className="h-4 w-4 flex-none text-emerald-soft" />
                          ) : active ? (
                            <Spinner />
                          ) : (
                            <span className="h-4 w-4 flex-none rounded-full border border-white/15" />
                          )}
                          <span className="flex-1">{t(row.label)}</span>
                          {active && activeTask && activeTask.unit === 'bytes' && activeTask.total > 0 ? (
                            <span className="font-mono text-[10.5px] text-faint">
                              {formatBytes(activeTask.current)} / {formatBytes(activeTask.total)}
                            </span>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {activeTask?.stageKey ? (
                  <div className="-mt-3 text-center text-[10.5px] text-faint">
                    {t(`create.stage.${activeTask.stageKey}` as TKey)}
                  </div>
                ) : null}
                <Button icon={<X className="h-3.5 w-3.5" />} onClick={() => api.install.cancel()}>
                  {t('create.progress.cancel')}
                </Button>
              </motion.div>
            ) : null}

            {/* ------------------------------------------------ done */}
            {phase === 'done' ? (
              <motion.div
                key="done"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="flex h-full flex-col items-center justify-center gap-5 text-center"
              >
                <motion.div
                  initial={{ scale: 0.7, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 18 }}
                  className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-emerald-soft to-emerald-deep shadow-[0_0_60px_rgba(47,226,140,0.45)]"
                >
                  <Check className="h-9 w-9 text-ink-950" strokeWidth={3} />
                </motion.div>
                <div>
                  <div className="eyebrow mb-1">{t('create.done.title')}</div>
                  <h3 className="text-[17px] font-semibold text-text">{created?.name}</h3>
                  <p className="mt-1 text-[12px] text-muted">
                    {created
                      ? [created.mcVersion, LOADER_LABELS[created.loader] ?? created.loader, created.modsCount ? pluralCount(t, created.modsCount, 'mod') : null]
                          .filter(Boolean)
                          .join(' · ')
                      : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button className="!px-4" onClick={() => { closeCreate(); setScreen('instances') }}>
                    {t('nav.instances')}
                  </Button>
                  <Button
                    variant="primary"
                    icon={<Play className="h-4 w-4 fill-current" />}
                    onClick={() => {
                      closeCreate()
                      setScreen('play')
                      if (created) void launch(created.id)
                    }}
                  >
                    {t('create.done.play')}
                  </Button>
                </div>
                <button
                  className="text-[11.5px] text-emerald-soft hover:underline"
                  onClick={() => {
                    reset()
                    setTab(tab)
                  }}
                >
                  {t('create.done.another')}
                </button>
              </motion.div>
            ) : null}

            {/* ------------------------------------------------ versions tab */}
            {phase === 'idle' && tab === 'versions' ? (
              <motion.div
                key="versions"
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12 }}
                transition={{ duration: 0.2 }}
                className="grid h-full grid-cols-1 gap-5 md:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]"
              >
                {/* left: version list */}
                <div className="flex min-h-0 flex-col">
                  <div className="mb-2.5 flex items-center justify-between">
                    <div className="eyebrow">{t('create.versions.eyebrow')}</div>
                    <div className="flex items-center gap-1 rounded-lg border border-white/[0.07] bg-white/[0.03] p-0.5">
                      {(['release', 'snapshot', 'all'] as const).map((filter) => (
                        <button
                          key={filter}
                          onClick={() => setVersionFilter(filter)}
                          className={cn(
                            'rounded-md px-2 py-1 text-[10.5px] transition',
                            versionFilter === filter ? 'bg-emerald/15 text-emerald-soft' : 'text-muted hover:text-text'
                          )}
                        >
                          {filter === 'release'
                            ? `${t('create.versions.release')}${releaseCount ? ` ${releaseCount}` : ''}`
                            : filter === 'snapshot'
                              ? t('create.versions.snapshot')
                              : t('create.versions.all')}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="search-field mb-2.5">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
                    <Input
                      placeholder={t('create.versions.search')}
                      value={versionQuery}
                      onChange={(event) => setVersionQuery(event.target.value)}
                    />
                  </div>

                  <div className="scroll-area relative min-h-0 flex-1">
                    <VersionList
                      versions={filteredVersions}
                      loading={versions === null}
                      selected={mcVersion}
                      latest={latestRelease}
                      onSelect={setMcVersion}
                    />
                    <div className="pointer-events-none sticky bottom-0 -mt-8 h-8 bg-gradient-to-t from-ink-900 to-transparent" />
                  </div>
                </div>

                {/* right: loader + name + create */}
                <div className="flex min-h-0 flex-col">
                  <div className="scroll-area min-h-0 flex-1 pb-1">
                  <div className="mb-2.5 eyebrow">{t('create.loader.eyebrow')}</div>
                  <LoaderPicker
                    value={loader}
                    onChange={(next) => {
                      setLoader(next)
                      setNameTouched(false)
                    }}
                  />

                  <AnimatePresence initial={false}>
                    {loader !== 'vanilla' ? (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                        <div className="mt-3">
                          <div className="mb-1.5 flex items-center justify-between">
                            <span className="text-[11px] font-medium text-muted">{t('create.loader.version')}</span>
                            {loaderVersions && loaderVersions.length > 0 ? (
                              <span className="text-[10px] text-faint">
                                {t('create.loader.count', { count: loaderVersions.length })}
                              </span>
                            ) : null}
                          </div>
                          {loaderVersions === null ? (
                            <div className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5 text-[11.5px] text-muted">
                              <Spinner /> {t('create.loader.loading')}
                            </div>
                          ) : loaderVersions.length === 0 ? (
                            <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.07] px-3 py-2.5 text-[11px] text-amber-200">
                              {t('create.loader.none')}
                            </div>
                          ) : (
                            <div className="relative">
                              <select
                                aria-label={t('create.loader.version')}
                                className="h-10 w-full cursor-pointer appearance-none rounded-xl border border-white/[0.08] bg-white/[0.04] pl-3 pr-9 text-[12px] text-text outline-none transition hover:border-white/15 focus:border-emerald/45"
                                value={loaderVersion}
                                onChange={(event) => setLoaderVersion(event.target.value)}
                              >
                                {loaderVersions.slice(0, 60).map((entry) => (
                                  <option key={entry.version} value={entry.version} className="bg-ink-800">
                                    {entry.version} {entry.stable ? '· stable' : ''}
                                  </option>
                                ))}
                              </select>
                              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                            </div>
                          )}
                        </div>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>

                  <div className="mt-3 space-y-2.5">
                    <div>
                      <label className="mb-1.5 block text-[11px] font-medium text-muted">{t('create.name')}</label>
                      <Input
                        value={name}
                        maxLength={48}
                        placeholder={t('create.namePlaceholder')}
                        onChange={(event) => {
                          setNameTouched(true)
                          setName(event.target.value)
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && canSubmitVersions) void submitVersion()
                        }}
                      />
                    </div>

                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-[11px] font-medium text-muted">{t('create.memory')}</span>
                        <span className="font-mono text-[11px]" style={{ color: memoryAccent }}>
                          {formatGb(memory)}
                        </span>
                      </div>
                      <Slider value={memory} min={1024} max={maxMemory} step={256} onChange={setMemory} accent={memoryAccent} />
                    </div>

                    <button
                      className="flex w-full items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-[11px] text-muted transition hover:border-white/12 hover:text-text"
                      onClick={() => setShowAdvanced((value) => !value)}
                    >
                      <span className="flex items-center gap-1.5">
                        <Cpu className="h-3.5 w-3.5" />
                        {t('create.java')}
                      </span>
                      <span className="flex max-w-[60%] items-center gap-1.5">
                        <span className="truncate">
                          {javaPath ? javaPath.split(/[\\/]/).slice(-1)[0] : t('create.javaAuto')}
                        </span>
                        <ChevronDown className={cn('h-3.5 w-3.5 flex-none transition', showAdvanced && 'rotate-180')} />
                      </span>
                    </button>
                    <AnimatePresence initial={false}>
                      {showAdvanced ? (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                          <select
                            aria-label={t('settings.java')}
                            className="h-9 w-full cursor-pointer rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 text-[11.5px] text-text outline-none transition hover:border-white/15 focus:border-emerald/45"
                            value={javaPath}
                            onChange={(event) => setJavaPath(event.target.value)}
                          >
                            <option value="">{t('instances.javaAuto')}</option>
                            {(javaList ?? []).map((runtime) => (
                              <option key={runtime.path} value={runtime.path}>
                                Java {runtime.major} · {runtime.vendor}
                              </option>
                            ))}
                          </select>
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  </div>

                  </div>

                  {error ? (
                    <div className="mt-2 flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/[0.08] px-3 py-2 text-[11.5px] text-rose-200">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
                      {error}
                    </div>
                  ) : null}

                  <div className="pt-3">
                    <div className="mb-2 flex items-center gap-1.5 text-[10.5px] text-faint">
                      <Sparkles className="h-3 w-3 text-emerald-soft/70" />
                      {pending ? t('create.hint.retry') : t('create.hint.versions')}
                    </div>
                    <Button
                      variant="primary"
                      className="w-full !py-3"
                      disabled={!canSubmitVersions}
                      icon={<Plus className="h-4 w-4" />}
                      onClick={() => void submitVersion()}
                    >
                      {pending ? t('create.retry') : t('create.submit')}
                      {mcVersion ? ` · ${mcVersion}` : ''}
                      {loader !== 'vanilla' && loaderVersion ? ` · ${loaderVersion}` : ''}
                    </Button>
                  </div>
                </div>
              </motion.div>
            ) : null}

            {/* ------------------------------------------------ modpacks tab */}
            {phase === 'idle' && tab === 'modpacks' ? (
              <motion.div
                key="modpacks"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.2 }}
                className="grid h-full grid-cols-1 gap-5 md:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]"
              >
                {/* left: search + results */}
                <div className="flex min-h-0 flex-col">
                  <div className="mb-2.5 flex items-center justify-between gap-2">
                    <div className="eyebrow">{t('create.modpacks.eyebrow')}</div>
                    <div className="flex items-center gap-1 rounded-lg border border-white/[0.07] bg-white/[0.03] p-0.5">
                      {(['modrinth', 'curseforge'] as ModSource[]).map((entry) => (
                        <button
                          key={entry}
                          onClick={() => setSource(entry)}
                          className={cn(
                            'rounded-md px-2 py-1 text-[10.5px] capitalize transition',
                            source === entry ? 'bg-emerald/15 text-emerald-soft' : 'text-muted hover:text-text'
                          )}
                        >
                          {entry}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="search-field mb-2.5">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
                    <Input
                      placeholder={t('create.modpacks.search')}
                      value={packQuery}
                      onChange={(event) => setPackQuery(event.target.value)}
                    />
                  </div>

                  <div className="scroll-area min-h-0 flex-1">
                    {curseforgeBlocked ? (
                      <div className="flex items-start gap-2.5 rounded-xl border border-amber-400/25 bg-amber-400/[0.07] px-3 py-2.5 text-[11.5px] text-amber-100">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none text-amber-300" />
                        <div className="flex-1">
                          {t('create.modpacks.curseKey')}
                          <button
                            className="ml-2 underline"
                            onClick={() => {
                              closeCreate()
                              setScreen('settings')
                            }}
                          >
                            {t('nav.settings')}
                          </button>
                        </div>
                      </div>
                    ) : packsLoading && packs.length === 0 ? (
                      <div className="space-y-1.5">
                        {Array.from({ length: 7 }).map((_, index) => (
                          <div key={index} className="skeleton h-[54px] w-full rounded-xl" />
                        ))}
                      </div>
                    ) : packsError ? (
                      <div className="rounded-xl border border-rose-500/25 bg-rose-500/[0.07] px-3 py-2.5 text-[11.5px] text-rose-200">
                        {packsError}
                      </div>
                    ) : packs.length === 0 ? (
                      <div className="py-12 text-center">
                        <div className="text-[12px] text-muted">{t('create.modpacks.empty')}</div>
                        <div className="mt-1 text-[11px] text-faint">
                          {packQuery ? t('create.modpacks.emptyHint') : t('create.modpacks.searchHint')}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-0.5">
                        {packs.map((hit) => (
                          <ModpackCard
                            key={`${hit.source}-${hit.id}`}
                            hit={hit}
                            active={selectedPack?.id === hit.id}
                            onSelect={() => setSelectedPack(hit)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* right: details + install */}
                <div className="flex min-h-0 flex-col">
                  <div className="mb-2.5 eyebrow">{t('create.modpacks.title')}</div>
                  {!selectedPack ? (
                    <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-4 text-center">
                      <Package className="h-7 w-7 text-emerald-soft/70" />
                      <div className="text-[12px] text-muted">{t('create.modpacks.pick')}</div>
                      <div className="text-[10.5px] text-faint">{t('create.modpacks.pickHint')}</div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start gap-3">
                        <div className="flex h-12 w-12 flex-none items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/[0.05] text-[12px] font-semibold text-emerald-soft">
                          {selectedPack.iconUrl ? (
                            <img src={selectedPack.iconUrl} alt="" className="h-full w-full object-cover" />
                          ) : (
                            selectedPack.name.slice(0, 2).toUpperCase()
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-[13.5px] font-semibold text-text">{selectedPack.name}</div>
                          <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-faint">
                            <span className="flex items-center gap-1">
                              <Download className="h-3 w-3" /> {formatNumber(selectedPack.downloads)}
                            </span>
                            <span className="capitalize">{selectedPack.source}</span>
                            {selectedPack.updatedAt ? <span>{relativeTime(selectedPack.updatedAt, language)}</span> : null}
                          </div>
                        </div>
                      </div>
                      <p className="mt-2 line-clamp-2 text-[11.5px] leading-relaxed text-muted">{selectedPack.summary}</p>

                      <div className="mb-1.5 mt-3 flex items-center justify-between">
                        <span className="text-[11px] font-medium text-muted">{t('create.modpacks.versions')}</span>
                        {packVersions && packVersions.length > 0 ? (
                          <span className="text-[10px] text-faint">{packVersions.length}</span>
                        ) : null}
                      </div>
                      <div className="scroll-area max-h-[150px] min-h-[64px] space-y-1 pr-1">
                        {packVersions === null ? (
                          <div className="flex items-center gap-2 py-3 text-[11.5px] text-muted">
                            <Spinner /> {t('common.loading')}
                          </div>
                        ) : packVersions.length === 0 ? (
                          <div className="py-3 text-[11.5px] text-faint">{t('create.modpacks.empty')}</div>
                        ) : (
                          packVersions.slice(0, 30).map((version) => {
                            const active = packVersionId === version.id
                            return (
                              <button
                                key={version.id}
                                onClick={() => setPackVersionId(version.id)}
                                className={cn(
                                  'flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left transition',
                                  active
                                    ? 'border-emerald/40 bg-emerald/[0.09]'
                                    : 'border-white/[0.05] hover:border-white/10 hover:bg-white/[0.04]'
                                )}
                              >
                                <span className="min-w-0">
                                  <span className="block truncate text-[11.5px] text-text">{version.name}</span>
                                  <span className="block truncate text-[10px] text-faint">
                                    {version.gameVersions.slice(0, 2).join(', ')}
                                    {version.fileSize ? ` · ${formatBytes(version.fileSize)}` : ''}
                                  </span>
                                </span>
                                {active ? <Check className="h-3.5 w-3.5 flex-none text-emerald-soft" /> : null}
                              </button>
                            )
                          })
                        )}
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-1.5">
                        <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-2.5 py-1.5">
                          <div className="text-[9.5px] uppercase tracking-wider text-faint">{t('create.modpacks.mc')}</div>
                          <div className="mt-0.5 truncate font-mono text-[11px] text-text">
                            {packVersions?.[0]?.gameVersions.join(', ') ?? selectedPack.gameVersions.slice(0, 2).join(', ') ?? '—'}
                          </div>
                        </div>
                        <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-2.5 py-1.5">
                          <div className="text-[9.5px] uppercase tracking-wider text-faint">{t('create.modpacks.loader')}</div>
                          <div className="mt-0.5 truncate text-[11px] capitalize text-text">
                            {(packVersions?.[0]?.loaders ?? selectedPack.loaders).join(' / ') || '—'}
                          </div>
                        </div>
                      </div>

                      {error ? (
                        <div className="mt-2.5 flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/[0.08] px-3 py-2 text-[11.5px] text-rose-200">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
                          {error}
                        </div>
                      ) : null}

                      <div className="mt-auto pt-3">
                        <div className="mb-2.5 flex items-center gap-1.5 text-[10.5px] text-faint">
                          <Sparkles className="h-3 w-3 text-emerald-soft/70" />
                          {t('create.modpacks.hint')}
                        </div>
                        <Button
                          variant="primary"
                          className="w-full !py-3"
                          disabled={!packVersionId}
                          icon={<Download className="h-4 w-4" />}
                          onClick={() => void submitPack()}
                        >
                          {t('create.modpacks.install')}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        {instances.length > 0 && phase === 'idle' ? (
          <div className="relative flex items-center justify-between gap-3 border-t border-white/[0.06] px-7 py-3 text-[10.5px] text-faint">
            <span>
              {t('create.versions.count', { count: versions?.length ?? 0 })} · {instances.length} {t('nav.instances').toLowerCase()}
            </span>
            <button className="text-muted transition hover:text-text" onClick={closeCreate}>
              {t('create.cancel')}
            </button>
          </div>
        ) : null}
      </motion.div>
    </div>
  )
}
