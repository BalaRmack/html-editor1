import { AnimatePresence, motion } from 'framer-motion'
import {
  Copy,
  Download,
  FolderOpen,
  Image,
  Layers,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { formatDuration } from '../../../shared/constants'
import { LOADER_LABELS, type Instance, type JavaRuntime } from '../../../shared/types'
import { ScreenHeader } from '../components/layout'
import { Badge, Button, EmptyState, Input, Modal, Panel, Slider, Spinner } from '../components/ui'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { cn, formatGb, instanceGradient, relativeTime } from '../lib/utils'
import { useAppStore } from '../store/app'

function InstanceCard({
  instance,
  onPlay,
  onInstall,
  onConfigure,
  onMenu
}: {
  instance: Instance
  onPlay: () => void
  onInstall: () => void
  onConfigure: () => void
  onMenu: (event: React.MouseEvent) => void
}): JSX.Element {
  const t = useT()
  const language = useAppStore((state) => state.settings.language)
  const gameInstanceId = useAppStore((state) => state.game.instanceId)
  const gameState = useAppStore((state) => state.game.state)
  // Select the stored entry (stable reference); compute the fallback outside the
  // selector so zustand's snapshot stays referentially equal between renders.
  const integrityState = useAppStore((state) => state.integrity[instance.id])
  const retryInstall = useAppStore((state) => state.retryInstall)
  const running = gameState === 'running' && gameInstanceId === instance.id
  const integrityStatus = integrityState?.status ?? 'unknown'
  const failed = integrityStatus === 'error'
  const verifying = integrityStatus === 'checking'
  const playable = integrityStatus === 'ok'

  return (
    <motion.div layout className="instance-banner glass glass-hover group relative overflow-hidden rounded-3xl" style={instanceGradient(instance.loader, instance.id)}>
      <div className="relative z-10 flex h-full min-h-[206px] flex-col justify-between p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 flex-none items-center justify-center overflow-hidden rounded-xl border border-white/12 bg-white/[0.06] text-sm font-semibold text-white/90">
              {instance.icon ? (
                <img src={instance.icon} alt="" className="h-full w-full object-cover" />
              ) : (
                instance.name.slice(0, 1).toUpperCase()
              )}
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-[15px] font-semibold text-white">{instance.name}</h3>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Badge tone="emerald">{LOADER_LABELS[instance.loader]}</Badge>
                <Badge>{instance.mcVersion}</Badge>
              </div>
            </div>
          </div>
          <button className="icon-btn -mr-1 -mt-1 text-white/70 hover:bg-white/10" onClick={onMenu} aria-label="menu">
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 flex items-center gap-4 text-[10.5px] text-white/60">
          <span>{instance.modsCount} {t('play.mods').toLowerCase()}</span>
          <span>{formatGb(instance.memory.max)}</span>
          <span>{relativeTime(instance.lastPlayedAt, language)}</span>
          <span>{formatDuration(instance.playTimeMs, language)}</span>
        </div>

        <div className="mt-4 flex items-center gap-2">
          {running ? (
            <Button variant="danger" size="sm" onClick={onPlay}>
              {t('play.stop')}
            </Button>
          ) : failed ? (
            <Button
              variant="primary"
              size="sm"
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={() => void retryInstall(instance.id)}
            >
              {t('play.retry')}
            </Button>
          ) : instance.installed && playable ? (
            <Button variant="primary" size="sm" icon={<Play className="h-3.5 w-3.5 fill-current" />} onClick={onPlay}>
              {t('instances.play')}
            </Button>
          ) : instance.installed && verifying ? (
            <Button size="sm" disabled icon={<RefreshCw className="h-3.5 w-3.5 animate-spin" />}>
              {t('play.verifying')}
            </Button>
          ) : (
            <Button variant="primary" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={onInstall}>
              {t('instances.install')}
            </Button>
          )}
          <Button size="sm" icon={<Settings2 className="h-3.5 w-3.5" />} onClick={onConfigure}>
            {t('instances.configure')}
          </Button>
          <span className="ml-auto">
            {failed ? (
              <Badge tone="danger">{t('play.errorBadge')}</Badge>
            ) : instance.installed && playable ? (
              <Badge>{t('instances.installed')}</Badge>
            ) : verifying ? (
              <Badge>{t('play.verifying')}</Badge>
            ) : (
              <Badge tone="gold">{t('instances.installNeeded')}</Badge>
            )}
          </span>
        </div>
      </div>
    </motion.div>
  )
}

export function InstancesScreen(): JSX.Element {
  const t = useT()
  const instances = useAppStore((state) => state.instances)
  const selectedId = useAppStore((state) => state.selectedId)
  const setSelected = useAppStore((state) => state.setSelected)
  const openCreate = useAppStore((state) => state.openCreate)
  const launch = useAppStore((state) => state.launch)
  const stopGame = useAppStore((state) => state.stopGame)
  const installInstance = useAppStore((state) => state.installInstance)
  const cloneInstance = useAppStore((state) => state.cloneInstance)
  const removeInstance = useAppStore((state) => state.removeInstance)
  const updateInstance = useAppStore((state) => state.updateInstance)
  const setInstanceIcon = useAppStore((state) => state.setInstanceIcon)
  const systemInfo = useAppStore((state) => state.systemInfo)
  const game = useAppStore((state) => state.game)

  const [query, setQuery] = useState('')
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [renameFor, setRenameFor] = useState<Instance | null>(null)
  const [deleteFor, setDeleteFor] = useState<Instance | null>(null)
  const [editFor, setEditFor] = useState<Instance | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [editMemory, setEditMemory] = useState(4096)
  const [editArgs, setEditArgs] = useState('')
  const [editJava, setEditJava] = useState<string>('')
  const [javaList, setJavaList] = useState<JavaRuntime[] | null>(null)

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase()
    if (!text) return instances
    return instances.filter((instance) => instance.name.toLowerCase().includes(text) || instance.mcVersion.includes(text))
  }, [instances, query])

  useEffect(() => {
    if (!editFor) return
    setEditMemory(editFor.memory.max)
    setEditArgs(editFor.jvmArgs)
    setEditJava(editFor.javaPath ?? '')
    setJavaList(null)
    void api.java
      .scan()
      .then(setJavaList)
      .catch(() => setJavaList([]))
  }, [editFor])

  const totalMem = systemInfo?.totalMemMB ?? 16384
  const maxMemory = Math.max(2048, Math.min(32768, Math.floor(totalMem / 1024) * 1024 - 1024))
  const accent = editMemory / totalMem > 0.7 ? '#f87171' : editMemory / totalMem > 0.5 ? '#f5c249' : '#2fe28c'

  return (
    <div className="px-7 py-6">
      <ScreenHeader
        eyebrow={t('nav.instances')}
        title={t('instances.title')}
        description={t('instances.subtitle')}
        action={
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => openCreate()}>
            {t('instances.create')}
          </Button>
        }
      />

      <div className="mb-5 flex items-center gap-3">
        <div className="search-field relative w-full max-w-[340px]">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <Input placeholder={t('instances.search')} value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <Badge>{filtered.length}</Badge>
      </div>

      {filtered.length === 0 ? (
        <Panel className="mt-2">
          <EmptyState
            icon={<Layers className="h-7 w-7" />}
            title={instances.length === 0 ? t('instances.empty') : t('mods.empty')}
            description={instances.length === 0 ? t('instances.emptyHint') : t('mods.emptyHint')}
            action={
              instances.length === 0 ? (
                <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => openCreate()}>
                  {t('instances.create')}
                </Button>
              ) : null
            }
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {filtered.map((instance) => (
            <div key={instance.id} className="relative">
              <InstanceCard
                instance={instance}
                onPlay={() => {
                  setSelected(instance.id)
                  if (game.state === 'running') stopGame()
                  else void launch(instance.id)
                }}
                onInstall={() => {
                  setSelected(instance.id)
                  void installInstance(instance.id)
                }}
                onConfigure={() => setEditFor(instance)}
                onMenu={(event) => {
                  event.stopPropagation()
                  setMenuFor((current) => (current === instance.id ? null : instance.id))
                }}
              />
              <AnimatePresence>
                {menuFor === instance.id ? (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setMenuFor(null)} />
                    <motion.div
                      initial={{ opacity: 0, y: -4, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.99 }}
                      className="menu-sheet absolute right-4 top-14 z-40 w-[218px] p-1.5"
                    >
                      {[
                        {
                          icon: Pencil,
                          label: t('instances.rename'),
                          run: () => {
                            setRenameValue(instance.name)
                            setRenameFor(instance)
                          }
                        },
                        { icon: Copy, label: t('instances.clone'), run: () => void cloneInstance(instance.id) },
                        { icon: Image, label: t('instances.icon'), run: () => void setInstanceIcon(instance.id) },
                        { icon: FolderOpen, label: t('instances.openFolder'), run: () => void api.instances.openFolder(instance.id) },
                        {
                          icon: RefreshCw,
                          label: t('instances.repair'),
                          run: () => void installInstance(instance.id)
                        },
                        { icon: Trash2, label: t('instances.delete'), run: () => setDeleteFor(instance), danger: true }
                      ].map((item) => (
                        <button
                          key={item.label}
                          className={cn(
                            'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12px] transition',
                            item.danger ? 'text-rose-300 hover:bg-rose-500/10' : 'text-text/85 hover:bg-white/[0.06]'
                          )}
                          onClick={() => {
                            setMenuFor(null)
                            item.run()
                          }}
                        >
                          <item.icon className="h-3.5 w-3.5" />
                          {item.label}
                        </button>
                      ))}
                    </motion.div>
                  </>
                ) : null}
              </AnimatePresence>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(renameFor)}
        onClose={() => setRenameFor(null)}
        title={t('instances.renameTitle')}
        footer={
          <>
            <Button onClick={() => setRenameFor(null)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              onClick={async () => {
                if (!renameFor) return
                await updateInstance(renameFor.id, { name: renameValue })
                setRenameFor(null)
              }}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        <Input
          autoFocus
          value={renameValue}
          placeholder={t('instances.renamePlaceholder')}
          onChange={(event) => setRenameValue(event.target.value)}
        />
      </Modal>

      <Modal
        open={Boolean(deleteFor)}
        onClose={() => setDeleteFor(null)}
        title={t('instances.deleteTitle', { name: deleteFor?.name ?? '' })}
        subtitle={t('instances.deleteBody')}
        footer={
          <>
            <Button onClick={() => setDeleteFor(null)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              icon={<Trash2 className="h-4 w-4" />}
              onClick={async () => {
                if (!deleteFor) return
                await removeInstance(deleteFor.id)
                setDeleteFor(null)
              }}
            >
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <div className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3">
          <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/[0.05]">
            {deleteFor?.icon ? <img src={deleteFor.icon} alt="" className="h-full w-full object-cover" /> : <Layers className="h-4 w-4 text-muted" />}
          </div>
          <div className="min-w-0">
            <div className="truncate text-[13px] text-text">{deleteFor?.name}</div>
            <div className="text-[11px] text-faint">
              {deleteFor?.mcVersion} · {deleteFor ? LOADER_LABELS[deleteFor.loader] : ''}
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(editFor)}
        onClose={() => setEditFor(null)}
        title={t('instances.settingsTitle')}
        subtitle={editFor?.name}
        width="max-w-2xl"
        footer={
          <>
            <Button onClick={() => setEditFor(null)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              onClick={async () => {
                if (!editFor) return
                await updateInstance(editFor.id, {
                  memory: { min: Math.min(1024, editMemory), max: editMemory },
                  jvmArgs: editArgs,
                  javaPath: editJava || null
                })
                setEditFor(null)
              }}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        <div className="space-y-6">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[12.5px] font-medium text-text">{t('instances.memory')}</span>
              <span className="font-mono text-[12px]" style={{ color: accent }}>
                {formatGb(editMemory)}
              </span>
            </div>
            <Slider value={editMemory} min={1024} max={maxMemory} step={256} onChange={setEditMemory} accent={accent} />
            <div className="mt-2 flex justify-between text-[10.5px] text-faint">
              <span>1 GB</span>
              <span>{t('settings.memory.total', { gb: Math.round(totalMem / 1024) })}</span>
            </div>
          </div>

          <div>
            <div className="mb-2 text-[12.5px] font-medium text-text">{t('instances.java')}</div>
            {javaList === null ? (
              <div className="flex items-center gap-2 text-[12px] text-muted">
                <Spinner /> {t('common.loading')}
              </div>
            ) : (
              <div className="space-y-1.5">
                <button
                  className={cn(
                    'flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left transition',
                    editJava === '' ? 'border-emerald/40 bg-emerald/10' : 'border-white/[0.07] bg-white/[0.03] hover:bg-white/[0.06]'
                  )}
                  onClick={() => setEditJava('')}
                >
                  <span className="text-[12px] text-text">{t('instances.javaAuto')}</span>
                  {editJava === '' ? <Badge tone="emerald">{t('settings.java.default')}</Badge> : null}
                </button>
                {javaList.map((runtime) => (
                  <button
                    key={runtime.path}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition',
                      editJava === runtime.path
                        ? 'border-emerald/40 bg-emerald/10'
                        : 'border-white/[0.07] bg-white/[0.03] hover:bg-white/[0.06]'
                    )}
                    onClick={() => setEditJava(runtime.path)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] text-text">Java {runtime.major} · {runtime.vendor}</span>
                      <span className="block truncate font-mono text-[10px] text-faint">{runtime.path}</span>
                    </span>
                    <Badge>{runtime.version}</Badge>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="mb-2 text-[12.5px] font-medium text-text">{t('instances.jvm')}</div>
            <textarea
              className="field min-h-[92px] resize-y font-mono !text-[11.5px]"
              placeholder={t('settings.jvm.placeholder')}
              value={editArgs}
              onChange={(event) => setEditArgs(event.target.value)}
            />
          </div>

          <div className="flex items-center justify-between rounded-2xl border border-white/[0.07] bg-white/[0.03] px-4 py-3">
            <div>
              <div className="text-[12px] text-text">{t('instances.repair')}</div>
              <div className="text-[10.5px] text-faint">{editFor?.gameDir}</div>
            </div>
            <Button size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => editFor && void installInstance(editFor.id)}>
              {t('common.retry')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
