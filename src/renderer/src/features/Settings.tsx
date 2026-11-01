import { motion } from 'framer-motion'
import {
  Cpu,
  ExternalLink,
  FolderOpen,
  Gauge,
  Globe2,
  Info,
  Package,
  RefreshCw,
  Save,
  Sliders,
  Sparkles,
  Terminal,
  Download
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { GITHUB_URL, LANGUAGES, formatNumber } from '../../../shared/constants'
import type { AppSettings, JavaRuntime, ModSource } from '../../../shared/types'
import { ScreenHeader } from '../components/layout'
import { Badge, Button, CheckRow, Input, KeyValue, Panel, SectionTitle, Select, Slider, Spinner, Switch } from '../components/ui'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { cn, formatGb } from '../lib/utils'
import { useAppStore } from '../store/app'

type Tab = 'general' | 'java' | 'memory' | 'jvm' | 'mods' | 'about'

export function SettingsScreen(): JSX.Element {
  const t = useT()
  const settings = useAppStore((state) => state.settings)
  const systemInfo = useAppStore((state) => state.systemInfo)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const pushToast = useAppStore((state) => state.pushToast)
  const toastError = useAppStore((state) => state.toastError)
  const refreshInstances = useAppStore((state) => state.refreshInstances)

  const [tab, setTab] = useState<Tab>('general')
  const [jvmArgs, setJvmArgs] = useState(settings.defaultJvmArgs)
  const [cfKey, setCfKey] = useState(settings.curseForgeApiKey)
  const [javaList, setJavaList] = useState<JavaRuntime[] | null>(null)
  const [scanning, setScanning] = useState(false)
  const [downloading, setDownloading] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const totalMem = systemInfo?.totalMemMB ?? 16384
  const recommended = Math.min(8192, Math.max(2048, Math.floor(totalMem / 4 / 1024) * 1024))
  const memory = settings.defaultMemory.max
  const accent = memory / totalMem > 0.7 ? '#f87171' : memory / totalMem > 0.5 ? '#f5c249' : '#2fe28c'

  useEffect(() => setJvmArgs(settings.defaultJvmArgs), [settings.defaultJvmArgs])
  useEffect(() => setCfKey(settings.curseForgeApiKey), [settings.curseForgeApiKey])

  const scanJava = async (): Promise<void> => {
    setScanning(true)
    try {
      setJavaList(await api.java.scan())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setScanning(false)
    }
  }

  useEffect(() => {
    if (tab === 'java' && javaList === null) void scanJava()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const tabs = useMemo(
    () =>
      [
        { id: 'general' as Tab, icon: Sliders, label: t('settings.general') },
        { id: 'java' as Tab, icon: Cpu, label: t('settings.java') },
        { id: 'memory' as Tab, icon: Gauge, label: t('settings.memory') },
        { id: 'jvm' as Tab, icon: Terminal, label: t('settings.jvm') },
        { id: 'mods' as Tab, icon: Package, label: t('settings.mods') },
        { id: 'about' as Tab, icon: Info, label: t('settings.about') }
      ],
    [t]
  )

  const patch = async (value: Partial<AppSettings>): Promise<void> => {
    await updateSettings(value)
  }

  const downloadJava = async (major: number): Promise<void> => {
    setDownloading(major)
    try {
      const runtime = await api.java.download(major)
      pushToast({ kind: 'success', titleKey: 'toast.javaDownloaded', vars: { version: runtime.version } })
      await patch({ javaPath: runtime.path })
      await scanJava()
    } catch (err) {
      toastError(err)
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div className="px-7 py-6">
      <ScreenHeader eyebrow={t('nav.settings')} title={t('settings.title')} description={t('settings.dataRootHint')} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[210px_minmax(0,1fr)]">
        <div className="space-y-1">
          {tabs.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={cn(
                'relative flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[12.5px] transition',
                tab === item.id ? 'bg-emerald/12 text-emerald-soft' : 'text-muted hover:bg-white/[0.05] hover:text-text'
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
              {tab === item.id ? (
                <motion.span layoutId="settings-pill" className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-emerald-glow" />
              ) : null}
            </button>
          ))}
        </div>

        <div className="space-y-5">
          {tab === 'general' ? (
            <>
              <Panel className="p-5">
                <SectionTitle eyebrow="UI" title={t('settings.general')} />
                <div className="divide-y divide-white/[0.05]">
                  <CheckRow
                    label={t('settings.language')}
                    value={
                      <Select
                        value={settings.language}
                        onChange={(value) => void patch({ language: value })}
                        options={LANGUAGES}
                        className="w-[150px]"
                      />
                    }
                  />
                  <CheckRow
                    label={t('settings.animations')}
                    description={t('settings.reduceMotionHint')}
                    value={<Switch checked={settings.animations} onChange={(value) => void patch({ animations: value })} />}
                  />
                  <CheckRow
                    label={t('settings.reduceMotion')}
                    value={<Switch checked={settings.reduceMotion} onChange={(value) => void patch({ reduceMotion: value })} />}
                  />
                  <CheckRow
                    label={t('settings.consoleOnLaunch')}
                    value={<Switch checked={settings.showConsoleOnLaunch} onChange={(value) => void patch({ showConsoleOnLaunch: value })} />}
                  />
                  <CheckRow
                    label={t('settings.confirmDelete')}
                    value={<Switch checked={settings.confirmOnDelete} onChange={(value) => void patch({ confirmOnDelete: value })} />}
                  />
                  <CheckRow
                    label={t('settings.afterLaunch')}
                    value={
                      <Select
                        value={settings.afterLaunch}
                        onChange={(value) => void patch({ afterLaunch: value })}
                        options={[
                          { value: 'stay', label: t('settings.afterLaunch.stay') },
                          { value: 'minimize', label: t('settings.afterLaunch.minimize') },
                          { value: 'close', label: t('settings.afterLaunch.close') }
                        ]}
                        className="w-[190px]"
                      />
                    }
                  />
                </div>
              </Panel>

              <Panel className="p-5">
                <SectionTitle eyebrow="DATA" title={t('settings.dataRoot')} />
                <div className="rounded-xl border border-white/[0.07] bg-black/25 px-3 py-2.5 font-mono text-[11px] text-muted">
                  {settings.dataRoot}
                </div>
                <div className="mt-3 flex gap-2">
                  <Button
                    icon={<FolderOpen className="h-4 w-4" />}
                    onClick={async () => {
                      const picked = await api.app.pickDirectory(t('settings.dataRoot'))
                      if (!picked) return
                      await patch({ dataRoot: picked })
                      await refreshInstances()
                      pushToast({ kind: 'success', titleKey: 'toast.settingsSaved' })
                    }}
                  >
                    {t('settings.change')}
                  </Button>
                  <Button icon={<ExternalLink className="h-4 w-4" />} onClick={() => void api.app.openPath(settings.dataRoot)}>
                    {t('settings.open')}
                  </Button>
                </div>
              </Panel>
            </>
          ) : null}

          {tab === 'java' ? (
            <>
              <Panel className="p-5">
                <SectionTitle
                  eyebrow="RUNTIME"
                  title={t('settings.java.detected')}
                  action={
                    <Button size="sm" icon={<RefreshCw className={cn('h-3.5 w-3.5', scanning && 'animate-spin')} />} onClick={() => void scanJava()}>
                      {t('settings.java.rescan')}
                    </Button>
                  }
                />
                {error ? <div className="mb-3 text-[11.5px] text-rose-300">{error}</div> : null}
                {javaList === null ? (
                  <div className="flex items-center gap-2 py-6 text-[12px] text-muted">
                    <Spinner /> {t('common.loading')}
                  </div>
                ) : javaList.length === 0 ? (
                  <div className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.06] px-4 py-3 text-[12px] text-amber-100">
                    {t('settings.java.none')}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {javaList.map((runtime) => (
                      <button
                        key={runtime.path}
                        className={cn(
                          'flex w-full items-start justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left transition',
                          settings.javaPath === runtime.path
                            ? 'border-emerald/45 bg-emerald/10'
                            : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05]'
                        )}
                        onClick={() => void patch({ javaPath: runtime.path })}
                      >
                        <span className="min-w-0">
                          <span className="flex items-center gap-2 text-[12.5px] text-text">
                            Java {runtime.major}
                            <Badge>{runtime.vendor}</Badge>
                            <Badge tone="emerald">{runtime.version}</Badge>
                          </span>
                          <span className="mt-1 block truncate font-mono text-[10px] text-faint">{runtime.path}</span>
                        </span>
                        {settings.javaPath === runtime.path ? <Badge tone="emerald">{t('settings.java.default')}</Badge> : null}
                      </button>
                    ))}
                  </div>
                )}
                <Button
                  className="mt-3"
                  icon={<Cpu className="h-4 w-4" />}
                  onClick={async () => {
                    const picked = await api.app.pickDirectory(t('settings.java.manual'))
                    if (!picked) return
                    const runtime = await api.java.validate(picked)
                    if (!runtime) {
                      toastError({ code: 'java_not_found' })
                      return
                    }
                    setJavaList((current) => [runtime, ...(current ?? [])])
                    await patch({ javaPath: runtime.path })
                  }}
                >
                  {t('settings.java.manual')}
                </Button>
              </Panel>

              <Panel className="p-5">
                <SectionTitle eyebrow="MOJANG" title="Java runtimes" />
                <div className="divide-y divide-white/[0.05]">
                  <CheckRow
                    label={t('settings.java.auto')}
                    description={t('settings.java.autoHint')}
                    value={<Switch checked={settings.autoDownloadJava} onChange={(value) => void patch({ autoDownloadJava: value })} />}
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {[21, 17, 8].map((major) => (
                    <Button
                      key={major}
                      size="sm"
                      loading={downloading === major}
                      icon={<Download className="h-3.5 w-3.5" />}
                      onClick={() => void downloadJava(major)}
                    >
                      {t('settings.java.download', { major })}
                    </Button>
                  ))}
                </div>
              </Panel>
            </>
          ) : null}

          {tab === 'memory' ? (
            <Panel className="p-6">
              <SectionTitle eyebrow="RAM" title={t('settings.memory.max')} />
              <div className="mb-3 flex items-baseline justify-between">
                <span className="text-[30px] font-semibold tracking-tight" style={{ color: accent }}>
                  {formatGb(memory)}
                </span>
                <span className="text-[11.5px] text-faint">{t('settings.memory.total', { gb: Math.round(totalMem / 1024) })}</span>
              </div>
              <Slider
                value={memory}
                min={1024}
                max={Math.max(2048, Math.min(32768, Math.floor(totalMem / 1024) * 1024 - 1024))}
                step={512}
                accent={accent}
                onChange={(value) => void patch({ defaultMemory: { ...settings.defaultMemory, max: value } })}
              />
              <div className="mt-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {[4096, 6144, 8192].map((value) => (
                    <button
                      key={value}
                      className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[11px] text-muted transition hover:border-emerald/30 hover:text-text"
                      onClick={() => void patch({ defaultMemory: { ...settings.defaultMemory, max: value } })}
                    >
                      {formatGb(value)}
                    </button>
                  ))}
                  <button
                    className="rounded-lg border border-emerald/30 bg-emerald/10 px-2.5 py-1 text-[11px] text-emerald-soft"
                    onClick={() => void patch({ defaultMemory: { ...settings.defaultMemory, max: recommended } })}
                  >
                    {t('settings.memory.recommended')}: {formatGb(recommended)}
                  </button>
                </div>
                <span className="text-[11px] text-faint">{t('settings.memory.hint')}</span>
              </div>
              {memory / totalMem > 0.75 ? (
                <div className="mt-4 rounded-xl border border-rose-500/25 bg-rose-500/[0.08] px-3 py-2 text-[11.5px] text-rose-200">
                  {t('settings.memory.warning')}
                </div>
              ) : null}
            </Panel>
          ) : null}

          {tab === 'jvm' ? (
            <Panel className="p-6">
              <SectionTitle eyebrow="ADVANCED" title={t('settings.jvm')} />
              <p className="mb-3 text-[11.5px] text-muted">{t('settings.jvm.hint')}</p>
              <textarea
                className="field min-h-[140px] resize-y font-mono !text-[11.5px]"
                placeholder={t('settings.jvm.placeholder')}
                value={jvmArgs}
                onChange={(event) => setJvmArgs(event.target.value)}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                {['-XX:+UseG1GC', '-XX:MaxGCPauseMillis=50', '-XX:+UseZGC', '-Dfml.ignoreInvalidMinecraftCertificates=true'].map((preset) => (
                  <button
                    key={preset}
                    className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 font-mono text-[10.5px] text-muted transition hover:border-emerald/30 hover:text-text"
                    onClick={() => setJvmArgs((current) => (current.includes(preset) ? current : `${current} ${preset}`.trim()))}
                  >
                    {preset}
                  </button>
                ))}
              </div>
              <Button
                className="mt-4"
                variant="primary"
                icon={<Save className="h-4 w-4" />}
                onClick={async () => {
                  await patch({ defaultJvmArgs: jvmArgs })
                  pushToast({ kind: 'success', titleKey: 'toast.settingsSaved' })
                }}
              >
                {t('common.save')}
              </Button>
            </Panel>
          ) : null}

          {tab === 'mods' ? (
            <Panel className="p-6">
              <SectionTitle eyebrow="API" title={t('settings.mods')} />
              <div className="divide-y divide-white/[0.05]">
                <CheckRow
                  label={t('settings.mods.defaultSource')}
                  value={
                    <Select
                      value={settings.modSource}
                      onChange={(value) => void patch({ modSource: value as ModSource })}
                      options={[
                        { value: 'modrinth', label: 'Modrinth' },
                        { value: 'curseforge', label: 'CurseForge' }
                      ]}
                      className="w-[160px]"
                    />
                  }
                />
              </div>
              <div className="mt-4">
                <label className="mb-2 block text-[12px] font-medium text-muted">{t('settings.mods.cfKey')}</label>
                <Input value={cfKey} onChange={(event) => setCfKey(event.target.value)} placeholder="$2a$10$…" />
                <p className="mt-2 text-[11px] text-faint">{t('settings.mods.cfHint')}</p>
                <Button
                  className="mt-3"
                  variant="primary"
                  icon={<Save className="h-4 w-4" />}
                  onClick={async () => {
                    await patch({ curseForgeApiKey: cfKey.trim() })
                    pushToast({ kind: 'success', titleKey: 'toast.settingsSaved' })
                  }}
                >
                  {t('common.save')}
                </Button>
              </div>
            </Panel>
          ) : null}

          {tab === 'about' ? (
            <Panel className="relative overflow-hidden p-6">
              <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-emerald/20 blur-[80px]" />
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-soft to-emerald-deep shadow-[0_0_30px_rgba(47,226,140,0.4)]">
                  <span className="pixel text-[18px] text-ink-950">V</span>
                </div>
                <div>
                  <div className="pixel text-[12px] text-text">VERDANT</div>
                  <div className="mt-1 text-[11.5px] text-muted">{t('app.tagline')}</div>
                </div>
              </div>

              <div className="mt-5 space-y-1">
                <KeyValue label={t('settings.about.version')} value={systemInfo?.appVersion ?? '1.0.0'} />
                <KeyValue label="Electron" value={systemInfo?.electron ?? '—'} />
                <KeyValue label="Chromium" value={systemInfo?.chrome ?? '—'} />
                <KeyValue label="Node.js" value={systemInfo?.node ?? '—'} />
                <KeyValue label={t('settings.about.platform')} value={`${systemInfo?.platform ?? '—'} · ${systemInfo?.arch ?? '—'}`} />
                <KeyValue label={t('play.ram')} value={formatNumber(Math.round(totalMem / 1024)) + ' GB'} />
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <Button icon={<ExternalLink className="h-4 w-4" />} onClick={() => void api.app.openExternal(GITHUB_URL)}>
                  {t('settings.about.repo')}
                </Button>
                <Button icon={<Globe2 className="h-4 w-4" />} onClick={() => void api.app.openExternal('https://modrinth.com')}>
                  Modrinth
                </Button>
                <Button icon={<Sparkles className="h-4 w-4" />} onClick={() => void api.app.openExternal('https://xmcl.app')}>
                  XMCL
                </Button>
              </div>

              <p className="mt-4 text-[11px] leading-relaxed text-faint">{t('settings.about.thanks')}</p>
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  )
}
