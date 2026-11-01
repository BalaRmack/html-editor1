import { AnimatePresence, motion } from 'framer-motion'
import { Check, Image, Layers, Loader2, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { LOADERS, formatDuration } from '../../../shared/constants'
import { LOADER_LABELS, type JavaRuntime, type LoaderType, type LoaderVersion, type VersionSummary } from '../../../shared/types'
import { Modal, Badge, Button, Input, Slider, Spinner } from '../components/ui'
import { useT, type TKey } from '../i18n'
import { api } from '../lib/api'
import { cn, formatGb } from '../lib/utils'
import { useAppStore } from '../store/app'

export function InstanceWizard(): JSX.Element {
  const t = useT()
  const open = useAppStore((state) => state.wizardOpen)
  const setWizardOpen = useAppStore((state) => state.setWizardOpen)
  const createInstance = useAppStore((state) => state.createInstance)
  const installInstance = useAppStore((state) => state.installInstance)
  const settings = useAppStore((state) => state.settings)
  const systemInfo = useAppStore((state) => state.systemInfo)
  const setScreen = useAppStore((state) => state.setScreen)

  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [iconPath, setIconPath] = useState<string | null>(null)
  const [mcVersion, setMcVersion] = useState('')
  const [loader, setLoader] = useState<LoaderType>('fabric')
  const [loaderVersion, setLoaderVersion] = useState('')
  const [memory, setMemory] = useState(4096)
  const [javaPath, setJavaPath] = useState('')

  const [versions, setVersions] = useState<VersionSummary[] | null>(null)
  const [versionQuery, setVersionQuery] = useState('')
  const [showSnapshots, setShowSnapshots] = useState(false)
  const [loaderVersions, setLoaderVersions] = useState<LoaderVersion[] | null>(null)
  const [javaList, setJavaList] = useState<JavaRuntime[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setStep(0)
    setName('')
    setIconPath(null)
    setLoader('fabric')
    setLoaderVersion('')
    setMemory(Math.min(settings.defaultMemory.max, Math.max(2048, Math.floor((systemInfo?.totalMemMB ?? 8192) / 1024 / 2) * 1024)))
    setJavaPath(settings.javaPath ?? '')
    setError(null)
    setCreating(false)
    if (!versions) {
      void api.versions
        .minecraft()
        .then((list) => {
          setVersions(list)
          const latest = list.find((version) => version.type === 'release')
          if (latest) setMcVersion((current) => current || latest.id)
        })
        .catch(() => {
          setVersions([])
          setError(t('errors.network_error'))
        })
    }
    if (!javaList) {
      void api.java.scan().then(setJavaList).catch(() => setJavaList([]))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open || !mcVersion || loader === 'vanilla') {
      setLoaderVersions(null)
      return
    }
    setLoaderVersions(null)
    setLoaderVersion('')
    void api.versions
      .loaders(mcVersion, loader)
      .then((list) => {
        setLoaderVersions(list)
        const stable = list.find((entry) => entry.stable) ?? list[0]
        if (stable) setLoaderVersion(stable.version)
      })
      .catch(() => setLoaderVersions([]))
  }, [mcVersion, loader, open])

  const filteredVersions = useMemo(() => {
    if (!versions) return []
    const text = versionQuery.trim().toLowerCase()
    return versions
      .filter((version) => showSnapshots || version.type === 'release')
      .filter((version) => !text || version.id.toLowerCase().includes(text))
      .slice(0, 80)
  }, [versions, versionQuery, showSnapshots])

  const totalMem = systemInfo?.totalMemMB ?? 16384
  const maxMemory = Math.max(2048, Math.min(32768, Math.floor(totalMem / 1024) * 1024 - 1024))
  const accent = memory / totalMem > 0.7 ? '#f87171' : memory / totalMem > 0.5 ? '#f5c249' : '#2fe28c'
  const canNext = step === 0 ? name.trim().length > 0 : step === 1 ? Boolean(mcVersion) && (loader === 'vanilla' || Boolean(loaderVersion)) : true

  const submit = async (): Promise<void> => {
    setCreating(true)
    setError(null)
    try {
      const instance = await createInstance({
        name: name.trim(),
        mcVersion,
        loader,
        loaderVersion: loader === 'vanilla' ? null : loaderVersion,
        memory: { min: Math.min(1024, memory), max: memory },
        javaPath: javaPath || null,
        iconPath
      })
      setWizardOpen(false)
      setScreen('play')
      await installInstance(instance.id)
    } catch (err) {
      setError((err as Error).message)
      setCreating(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => !creating && setWizardOpen(false)}
      title={t('wizard.title')}
      subtitle={t(`wizard.step${step + 1}` as TKey)}
      width="max-w-3xl"
      closeOnBackdrop={!creating}
      footer={
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-1.5">
            {[0, 1, 2].map((index) => (
              <span
                key={index}
                className={cn(
                  'h-1.5 rounded-full transition-all',
                  index === step ? 'w-6 bg-emerald-glow' : index < step ? 'w-3 bg-emerald/60' : 'w-3 bg-white/15'
                )}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {step > 0 ? (
              <Button onClick={() => setStep((current) => current - 1)} disabled={creating}>
                {t('common.back')}
              </Button>
            ) : null}
            {step < 2 ? (
              <Button variant="primary" disabled={!canNext} onClick={() => setStep((current) => current + 1)}>
                {t('common.next')}
              </Button>
            ) : (
              <Button variant="primary" loading={creating} onClick={() => void submit()}>
                {creating ? t('wizard.creating') : t('wizard.create')}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 14 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -14 }}
          transition={{ duration: 0.2 }}
        >
          {step === 0 ? (
            <div className="space-y-6">
              <div>
                <label className="mb-2 block text-[12px] font-medium text-muted">{t('wizard.name')}</label>
                <Input
                  autoFocus
                  value={name}
                  placeholder={t('wizard.namePlaceholder')}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && canNext) setStep(1)
                  }}
                />
              </div>

              <div>
                <label className="mb-2 block text-[12px] font-medium text-muted">{t('wizard.icon')}</label>
                <div className="flex items-center gap-3">
                  <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
                    {iconPath ? (
                      <IconPreview path={iconPath} />
                    ) : (
                      <Image className="h-5 w-5 text-faint" />
                    )}
                  </div>
                  <Button
                    icon={<Image className="h-4 w-4" />}
                    onClick={async () => {
                      const picked = await api.app.pickImage()
                      if (picked) setIconPath(picked)
                    }}
                  >
                    {t('wizard.pickIcon')}
                  </Button>
                  {iconPath ? (
                    <Button variant="subtle" size="sm" onClick={() => setIconPath(null)}>
                      {t('common.cancel')}
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
                <div className="flex items-center gap-2 text-[12px] text-text">
                  <Layers className="h-4 w-4 text-emerald-soft" />
                  {t('instances.subtitle')}
                </div>
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">{t('play.noInstancesHint')}</p>
              </div>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,1fr)_260px]">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-[12px] font-medium text-muted">{t('wizard.version')}</label>
                  <button
                    className={cn('badge cursor-pointer', showSnapshots && 'badge--gold')}
                    onClick={() => setShowSnapshots((value) => !value)}
                  >
                    {t('wizard.snapshot')}
                  </button>
                </div>
                <div className="search-field mb-2">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
                  <Input placeholder={t('wizard.searchVersion')} value={versionQuery} onChange={(event) => setVersionQuery(event.target.value)} />
                </div>
                <div className="max-h-[280px] space-y-1 overflow-y-auto pr-1">
                  {versions === null ? (
                    Array.from({ length: 7 }).map((_, index) => <div key={index} className="skeleton h-9 w-full" />)
                  ) : filteredVersions.length === 0 ? (
                    <div className="py-8 text-center text-[12px] text-faint">{t('mods.empty')}</div>
                  ) : (
                    filteredVersions.map((version) => (
                      <button
                        key={version.id}
                        onClick={() => setMcVersion(version.id)}
                        className={cn(
                          'flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left transition',
                          mcVersion === version.id
                            ? 'border-emerald/45 bg-emerald/10'
                            : 'border-transparent hover:border-white/10 hover:bg-white/[0.05]'
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-[12px] text-text">{version.id}</span>
                          {version.type === 'snapshot' ? <Badge tone="gold">snapshot</Badge> : null}
                        </span>
                        <span className="text-[10.5px] text-faint">
                          {new Date(version.releaseTime).toLocaleDateString(settings.language === 'ru' ? 'ru-RU' : 'en-US')}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div>
                <label className="mb-2 block text-[12px] font-medium text-muted">{t('wizard.loader')}</label>
                <div className="space-y-1.5">
                  {LOADERS.map((value) => (
                    <button
                      key={value}
                      onClick={() => setLoader(value)}
                      className={cn(
                        'flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-[12px] transition',
                        loader === value
                          ? 'border-emerald/45 bg-emerald/10 text-text'
                          : 'border-white/[0.07] bg-white/[0.03] text-muted hover:bg-white/[0.06]'
                      )}
                    >
                      {LOADER_LABELS[value]}
                      {loader === value ? <Check className="h-3.5 w-3.5 text-emerald-soft" /> : null}
                    </button>
                  ))}
                </div>

                {loader !== 'vanilla' ? (
                  <div className="mt-4">
                    <label className="mb-2 block text-[12px] font-medium text-muted">{t('wizard.loaderVersion')}</label>
                    {loaderVersions === null ? (
                      <div className="flex items-center gap-2 text-[12px] text-faint">
                        <Spinner /> {t('common.loading')}
                      </div>
                    ) : loaderVersions.length === 0 ? (
                      <div className="text-[11.5px] text-amber-300">{t('mods.noVersions')}</div>
                    ) : (
                      <select
                        className="field cursor-pointer"
                        value={loaderVersion}
                        onChange={(event) => setLoaderVersion(event.target.value)}
                      >
                        {loaderVersions.slice(0, 40).map((entry) => (
                          <option key={entry.version} value={entry.version}>
                            {entry.version} {entry.stable ? '· stable' : ''}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-6">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-[12px] font-medium text-muted">{t('wizard.memory')}</label>
                  <span className="font-mono text-[12.5px]" style={{ color: accent }}>
                    {formatGb(memory)}
                  </span>
                </div>
                <Slider value={memory} min={1024} max={maxMemory} step={256} onChange={setMemory} accent={accent} />
                <div className="mt-2 flex justify-between text-[10.5px] text-faint">
                  <span>1 GB</span>
                  <span>{t('settings.memory.total', { gb: Math.round(totalMem / 1024) })}</span>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-[12px] font-medium text-muted">{t('wizard.java')}</label>
                {javaList === null ? (
                  <div className="flex items-center gap-2 text-[12px] text-muted">
                    <Spinner /> {t('common.loading')}
                  </div>
                ) : (
                  <select className="field cursor-pointer" value={javaPath} onChange={(event) => setJavaPath(event.target.value)}>
                    <option value="">{t('instances.javaAuto')}</option>
                    {javaList.map((runtime) => (
                      <option key={runtime.path} value={runtime.path}>
                        Java {runtime.major} · {runtime.vendor} · {runtime.version}
                      </option>
                    ))}
                  </select>
                )}
                {javaList && javaList.length === 0 ? (
                  <p className="mt-2 text-[11px] text-amber-300">{t('settings.java.none')}</p>
                ) : null}
              </div>

              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
                <div className="grid grid-cols-2 gap-3 text-[12px]">
                  <Summary label={t('wizard.name')} value={name || '—'} />
                  <Summary label={t('wizard.version')} value={mcVersion || '—'} />
                  <Summary label={t('wizard.loader')} value={LOADER_LABELS[loader]} />
                  <Summary label={t('instances.memory')} value={formatGb(memory)} />
                </div>
                <div className="mt-3 flex items-center gap-2 text-[11px] text-muted">
                  {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-soft" /> : <Check className="h-3.5 w-3.5 text-emerald-soft" />}
                  {creating ? t('wizard.installing') : t('wizard.ready')}
                </div>
                <div className="mt-1 text-[10.5px] text-faint">
                  {t('play.playtime')}: {formatDuration(0, settings.language)}
                </div>
              </div>

              {error ? <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-200">{error}</div> : null}
            </div>
          ) : null}
        </motion.div>
      </AnimatePresence>
    </Modal>
  )
}

function Summary({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-faint">{label}</div>
      <div className="mt-0.5 truncate text-[12.5px] text-text">{value}</div>
    </div>
  )
}

function IconPreview({ path }: { path: string }): JSX.Element {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void api.app.readImage(path).then((value) => {
      if (alive) setDataUrl(value)
    })
    return () => {
      alive = false
    }
  }, [path])
  if (!dataUrl) return <Image className="h-5 w-5 text-faint" />
  return <img src={dataUrl} alt="" className="h-full w-full object-cover" />
}
