import { AnimatePresence, motion } from 'framer-motion'
import {
  Download,
  ExternalLink,
  FolderOpen,
  Package,
  Power,
  Search,
  Sparkles,
  Trash2,
  TriangleAlert
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatNumber } from '../../../shared/constants'
import { LOADER_LABELS, type InstalledMod, type LoaderType, type ModHit, type ModSource, type ModSort, type ModVersion } from '../../../shared/types'
import { ScreenHeader } from '../components/layout'
import { Badge, Button, EmptyState, Input, Modal, Panel, Select, Skeleton, Spinner } from '../components/ui'
import { localizeError, useT } from '../i18n'
import { api } from '../lib/api'
import { cn } from '../lib/utils'
import { useAppStore } from '../store/app'

function ModAvatar({ hit, size = 44 }: { hit: Pick<ModHit, 'iconUrl' | 'name'>; size?: number }): JSX.Element {
  return (
    <div
      className="flex flex-none items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-white/[0.09] to-white/[0.02] text-[13px] font-semibold text-emerald-soft"
      style={{ width: size, height: size }}
    >
      {hit.iconUrl ? <img src={hit.iconUrl} alt="" className="h-full w-full object-cover" /> : hit.name.slice(0, 2).toUpperCase()}
    </div>
  )
}

function ModRow({
  hit,
  onOpen,
  onInstall,
  installing,
  disabled,
  showPack
}: {
  hit: ModHit
  onOpen: () => void
  onInstall: () => void
  installing: boolean
  disabled: boolean
  showPack: boolean
}): JSX.Element {
  const t = useT()
  return (
    <motion.div
      layout
      className="glass glass-hover group flex cursor-pointer items-center gap-4 rounded-2xl px-4 py-3.5"
      onClick={onOpen}
    >
      <ModAvatar hit={hit} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-[13.5px] font-semibold text-text">{hit.name}</h3>
          {hit.projectType === 'modpack' ? <Badge tone="gold">{t('mods.packBadge')}</Badge> : null}
        </div>
        <p className="mt-0.5 line-clamp-1 text-[11.5px] text-muted">{hit.summary}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-faint">
          {hit.author ? <span>{t('mods.by')} {hit.author}</span> : null}
          <span className="text-white/20">·</span>
          <span className="flex items-center gap-1">
            <Download className="h-3 w-3" /> {formatNumber(hit.downloads)}
          </span>
          {hit.loaders?.slice(0, 3).map((loader) => (
            <span key={loader} className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide">
              {loader}
            </span>
          ))}
        </div>
      </div>
      <Button
        size="sm"
        variant={showPack ? 'primary' : 'ghost'}
        disabled={disabled || installing}
        loading={installing}
        icon={showPack ? <Sparkles className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
        onClick={(event) => {
          event.stopPropagation()
          onInstall()
        }}
      >
        {showPack ? t('mods.installPack') : t('mods.install')}
      </Button>
    </motion.div>
  )
}

export function ModsScreen(): JSX.Element {
  const t = useT()
  const language = useAppStore((state) => state.settings.language)
  const settings = useAppStore((state) => state.settings)
  const instances = useAppStore((state) => state.instances)
  const selectedId = useAppStore((state) => state.selectedId)
  const setSelected = useAppStore((state) => state.setSelected)
  const pushToast = useAppStore((state) => state.pushToast)
  const toastError = useAppStore((state) => state.toastError)
  const refreshInstances = useAppStore((state) => state.refreshInstances)
  const setScreen = useAppStore((state) => state.setScreen)
  const setWizardOpen = useAppStore((state) => state.setWizardOpen)

  const instance = instances.find((item) => item.id === selectedId) ?? null
  const loader: LoaderType = instance?.loader ?? 'fabric'

  const [tab, setTab] = useState<'catalog' | 'installed'>('catalog')
  const [source, setSource] = useState<ModSource>(settings.modSource)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<ModSort>('relevance')
  const [hits, setHits] = useState<ModHit[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [installingId, setInstallingId] = useState<string | null>(null)
  const [selectedMod, setSelectedMod] = useState<ModHit | null>(null)
  const [versions, setVersions] = useState<ModVersion[] | null>(null)
  const [installed, setInstalled] = useState<InstalledMod[] | null>(null)
  const [versionPick, setVersionPick] = useState<string>('')
  const timer = useRef<number | null>(null)

  const isPackProject = selectedMod?.projectType === 'modpack'

  const runSearch = useCallback(
    async (offset = 0) => {
      setLoading(true)
      setError(null)
      try {
        const result = await api.mods.search({
          source,
          query,
          mcVersion: instance?.mcVersion ?? null,
          loader: instance?.loader ?? 'fabric',
          sort,
          offset,
          limit: 20
        })
        setHits((current) => (offset === 0 ? result.hits : [...current, ...result.hits]))
        setTotal(result.total)
      } catch (err) {
        setError(localizeError(t, (err as { code?: string }).code))
      } finally {
        setLoading(false)
      }
    },
    [source, query, instance?.mcVersion, instance?.loader, sort, t]
  )

  useEffect(() => {
    if (tab !== 'catalog') return
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void runSearch(0), 320)
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [runSearch, tab])

  const loadInstalled = useCallback(async () => {
    if (!instance) {
      setInstalled([])
      return
    }
    try {
      setInstalled(await api.mods.installed(instance.id))
    } catch {
      setInstalled([])
    }
  }, [instance])

  useEffect(() => {
    if (tab === 'installed') void loadInstalled()
  }, [tab, loadInstalled])

  useEffect(() => {
    if (!selectedMod) return
    setVersions(null)
    setVersionPick('')
    void api.mods
      .versions(selectedMod.source, selectedMod.id, instance?.mcVersion ?? '', instance?.loader ?? 'fabric')
      .then(setVersions)
      .catch(() => setVersions([]))
  }, [selectedMod, instance?.mcVersion, instance?.loader])

  const installMod = async (hit: ModHit, versionId?: string): Promise<void> => {
    if (!instance) {
      pushToast({ kind: 'warning', titleKey: 'mods.requiresInstance', description: t('mods.selectInstance') })
      return
    }
    setInstallingId(hit.id)
    try {
      if (hit.projectType === 'modpack') {
        const created = await api.mods.installPack({
          source: hit.source,
          projectId: hit.id,
          projectName: hit.name,
          projectIcon: hit.iconUrl,
          versionId
        })
        await refreshInstances()
        setSelected(created.id)
        pushToast({ kind: 'success', titleKey: 'toast.packInstalled', vars: { name: created.name } })
      } else {
        const result = await api.mods.install({
          instanceId: instance.id,
          source: hit.source,
          projectId: hit.id,
          projectName: hit.name,
          projectIcon: hit.iconUrl,
          versionId
        })
        pushToast({
          kind: 'success',
          titleKey: 'toast.modsInstalled',
          vars: { count: result.installed.length }
        })
        if (result.warnings.length > 0) {
          pushToast({ kind: 'warning', titleKey: 'toast.error', description: result.warnings[0] })
        }
      }
      await refreshInstances()
      if (tab === 'installed') await loadInstalled()
    } catch (err) {
      toastError(err)
    } finally {
      setInstallingId(null)
      setSelectedMod(null)
    }
  }

  const canInstall = Boolean(instance && (instance.loader !== 'vanilla' || selectedMod?.projectType === 'modpack'))
  const shown = useMemo(() => hits, [hits])

  return (
    <div className="px-7 py-6">
      <ScreenHeader
        eyebrow={t('nav.mods')}
        title={t('mods.title')}
        description={t('mods.subtitle')}
        action={
          <div className="flex items-center gap-2">
            <Select
              value={instance?.id ?? ''}
              onChange={(value) => setSelected(value || null)}
              options={
                instances.length === 0
                  ? [{ value: '', label: t('mods.noInstance') }]
                  : instances.map((item) => ({ value: item.id, label: `${item.name} · ${item.mcVersion}` }))
              }
              className="w-[240px]"
            />
            {instances.length === 0 ? (
              <Button variant="primary" icon={<Package className="h-4 w-4" />} onClick={() => setWizardOpen(true)}>
                {t('instances.create')}
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-white/[0.08] bg-white/[0.03] p-1">
          {(['catalog', 'installed'] as const).map((key) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-[11.5px] font-medium transition',
                tab === key ? 'bg-emerald/15 text-emerald-soft' : 'text-muted hover:text-text'
              )}
            >
              {key === 'catalog' ? t('mods.catalogTab') : t('mods.installedTab')}
            </button>
          ))}
        </div>

        {tab === 'catalog' ? (
          <>
            <Select
              value={source}
              onChange={(value) => setSource(value)}
              options={[
                { value: 'modrinth', label: 'Modrinth' },
                { value: 'curseforge', label: 'CurseForge' }
              ]}
              className="w-[142px]"
            />
            <Select
              value={sort}
              onChange={(value) => setSort(value)}
              options={[
                { value: 'relevance', label: t('mods.sort.relevance') },
                { value: 'downloads', label: t('mods.sort.downloads') },
                { value: 'follows', label: t('mods.sort.follows') },
                { value: 'newest', label: t('mods.sort.newest') },
                { value: 'updated', label: t('mods.sort.updated') }
              ]}
              className="w-[180px]"
            />
            <div className="search-field min-w-[240px] flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
              <Input placeholder={t('mods.search')} value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
          </>
        ) : (
          <div className="ml-auto flex items-center gap-2">
            {instance ? <Badge tone="emerald">{LOADER_LABELS[instance.loader]}</Badge> : null}
            <Button size="sm" icon={<FolderOpen className="h-3.5 w-3.5" />} onClick={() => instance && void api.mods.openFolder(instance.id)}>
              {t('mods.openFolder')}
            </Button>
          </div>
        )}
      </div>

      {instance && instance.loader === 'vanilla' && tab === 'catalog' ? (
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-400/25 bg-amber-400/[0.07] px-4 py-3 text-[12px] text-amber-100">
          <TriangleAlert className="mt-0.5 h-4 w-4 flex-none text-amber-300" />
          <div className="flex-1">{t('mods.vanillaWarning')}</div>
          <button className="text-[11px] font-medium text-amber-200 underline" onClick={() => setWizardOpen(true)}>
            {t('instances.create')}
          </button>
        </div>
      ) : null}

      {source === 'curseforge' && !settings.curseForgeApiKey && tab === 'catalog' ? (
        <Panel className="p-5">
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 h-4 w-4 text-amber-300" />
            <div className="flex-1">
              <div className="text-[13px] font-medium text-text">{t('settings.mods.cfKey')}</div>
              <p className="mt-1 text-[11.5px] text-muted">{t('mods.curseKeyHint')}</p>
            </div>
            <Button size="sm" onClick={() => setScreen('settings')}>
              {t('nav.settings')}
            </Button>
          </div>
        </Panel>
      ) : null}

      {tab === 'catalog' && !(source === 'curseforge' && !settings.curseForgeApiKey) ? (
        <div className="space-y-2.5">
          {loading && hits.length === 0
            ? Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="glass flex items-center gap-4 rounded-2xl px-4 py-3.5">
                  <Skeleton className="h-11 w-11 rounded-xl" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3 w-1/3" />
                    <Skeleton className="h-2.5 w-2/3" />
                  </div>
                </div>
              ))
            : null}

          {!loading && error ? (
            <Panel>
              <EmptyState
                icon={<TriangleAlert className="h-6 w-6 text-amber-300" />}
                title={t('toast.error')}
                description={error}
                action={
                  <Button onClick={() => void runSearch(0)} icon={<Search className="h-4 w-4" />}>
                    {t('common.retry')}
                  </Button>
                }
              />
            </Panel>
          ) : null}

          {!error && shown.length === 0 && !loading ? (
            <Panel>
              <EmptyState
                icon={<Search className="h-6 w-6" />}
                title={query ? t('mods.empty') : t('mods.searchHint')}
                description={query ? t('mods.emptyHint') : undefined}
              />
            </Panel>
          ) : null}

          <AnimatePresence initial={false}>
            {shown.map((hit) => (
              <ModRow
                key={`${hit.source}-${hit.id}`}
                hit={hit}
                onOpen={() => setSelectedMod(hit)}
                onInstall={() => void installMod(hit)}
                installing={installingId === hit.id}
                disabled={!canInstall && hit.projectType !== 'modpack'}
                showPack={hit.projectType === 'modpack'}
              />
            ))}
          </AnimatePresence>

          {shown.length > 0 && shown.length < total ? (
            <div className="flex justify-center pt-2">
              <Button loading={loading} onClick={() => void runSearch(hits.length)}>
                {t('mods.loadMore')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === 'installed' ? (
        <div className="space-y-2.5">
          {!instance ? (
            <Panel>
              <EmptyState icon={<Package className="h-6 w-6" />} title={t('mods.noInstance')} description={t('mods.selectInstance')} />
            </Panel>
          ) : installed === null ? (
            Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="glass flex items-center gap-4 rounded-2xl px-4 py-3.5">
                <Skeleton className="h-11 w-11 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-1/4" />
                  <Skeleton className="h-2.5 w-1/2" />
                </div>
              </div>
            ))
          ) : installed.length === 0 ? (
            <Panel>
              <EmptyState
                icon={<Package className="h-6 w-6" />}
                title={t('mods.installedEmpty')}
                description={t('mods.installedEmptyHint')}
                action={
                  <Button variant="primary" onClick={() => setTab('catalog')}>
                    {t('mods.catalogTab')}
                  </Button>
                }
              />
            </Panel>
          ) : (
            installed.map((mod) => (
              <motion.div
                key={mod.fileName}
                layout
                className="glass flex items-center gap-4 rounded-2xl px-4 py-3.5"
              >
                <ModAvatar hit={{ iconUrl: mod.iconUrl, name: mod.name }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-[13px] font-semibold text-text">{mod.name}</h3>
                    {!mod.enabled ? <Badge tone="danger">off</Badge> : null}
                  </div>
                  <p className="mt-0.5 truncate font-mono text-[10.5px] text-faint">{mod.fileName}</p>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-faint">
                    <span>{mod.version || '—'}</span>
                    <span className="text-white/20">·</span>
                    <span>{(mod.size / 1024 / 1024).toFixed(1)} MB</span>
                    <span className="text-white/20">·</span>
                    <span className="uppercase">{mod.source}</span>
                  </div>
                </div>
                <button
                  className={cn(
                    'icon-btn',
                    mod.enabled ? 'text-emerald-soft hover:bg-emerald-500/10' : 'text-faint hover:bg-white/10'
                  )}
                  title={mod.enabled ? t('mods.disable') : t('mods.enable')}
                  onClick={async () => {
                    await api.mods.toggle(instance.id, mod.fileName, !mod.enabled)
                    await loadInstalled()
                  }}
                >
                  <Power className="h-4 w-4" />
                </button>
                <button
                  className="icon-btn text-faint hover:bg-rose-500/10 hover:text-rose-300"
                  title={t('mods.remove')}
                  onClick={async () => {
                    await api.mods.remove(instance.id, mod.fileName)
                    await loadInstalled()
                    await refreshInstances()
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </motion.div>
            ))
          )}
        </div>
      ) : null}

      <Modal
        open={Boolean(selectedMod)}
        onClose={() => setSelectedMod(null)}
        title={selectedMod?.name ?? ''}
        subtitle={selectedMod ? `${selectedMod.author || ''} · ${formatNumber(selectedMod.downloads)} ${t('mods.downloads')}` : undefined}
        width="max-w-2xl"
        footer={
          selectedMod ? (
            <>
              <Button icon={<ExternalLink className="h-3.5 w-3.5" />} onClick={() => selectedMod.slug && void api.app.openExternal(`https://modrinth.com/${selectedMod.projectType}/${selectedMod.slug}`)}>
                {t('mods.details')}
              </Button>
              <Button
                variant="primary"
                loading={installingId === selectedMod.id}
                disabled={!canInstall && selectedMod.projectType !== 'modpack'}
                icon={<Download className="h-4 w-4" />}
                onClick={() => void installMod(selectedMod, versionPick || undefined)}
              >
                {selectedMod.projectType === 'modpack' ? t('mods.installPack') : t('mods.install')}
              </Button>
            </>
          ) : null
        }
      >
        {selectedMod ? (
          <div className="space-y-4">
            <div className="flex gap-4">
              <ModAvatar hit={selectedMod} size={64} />
              <div>
                <p className="text-[12.5px] leading-relaxed text-muted">{selectedMod.summary}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {selectedMod.categories?.slice(0, 5).map((category) => (
                    <Badge key={category}>{category}</Badge>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[12px] font-medium text-text">{t('mods.versions')}</span>
                {instance ? <Badge tone="emerald">{instance.mcVersion} · {LOADER_LABELS[instance.loader]}</Badge> : null}
              </div>
              {versions === null ? (
                <div className="flex items-center gap-2 py-4 text-[12px] text-muted">
                  <Spinner /> {t('common.loading')}
                </div>
              ) : versions.length === 0 ? (
                <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.06] px-3 py-2 text-[11.5px] text-amber-200">
                  {t('mods.noVersions')}
                </div>
              ) : (
                <div className="max-h-[220px] space-y-1 overflow-y-auto pr-1">
                  {versions.slice(0, 20).map((version) => (
                    <button
                      key={version.id}
                      className={cn(
                        'flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition',
                        (versionPick === version.id || (!versionPick && version.id === versions[0].id))
                          ? 'border-emerald/40 bg-emerald/10'
                          : 'border-white/[0.06] hover:bg-white/[0.05]'
                      )}
                      onClick={() => setVersionPick(version.id)}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[12px] text-text">{version.name}</span>
                        <span className="block truncate text-[10px] text-faint">
                          {version.gameVersions.slice(0, 3).join(', ')} · {(version.fileSize / 1024 / 1024).toFixed(1)} MB
                        </span>
                      </span>
                      {version.dependencies.length > 0 ? (
                        <Badge tone="gold">+{version.dependencies.length} dep</Badge>
                      ) : null}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {!canInstall && selectedMod.projectType !== 'modpack' ? (
              <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.06] px-3 py-2 text-[11.5px] text-amber-200">
                {t('mods.vanillaWarning')}
              </div>
            ) : null}

            {language === 'ru' ? null : null}
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
