import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowRight,
  Check,
  FolderOpen,
  HardDriveDownload,
  Loader2,
  Minus,
  Package,
  ShieldCheck,
  Sparkles,
  Trash2,
  X
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { SetupInfo, SetupProgress } from '../preload'
import { getBridge } from './bridge'

type Step = 'welcome' | 'progress' | 'done' | 'error'

const STEPS: Array<{ stage: SetupProgress['stage']; label: string }> = [
  { stage: 'preparing', label: 'Подготовка' },
  { stage: 'extracting', label: 'Распаковка' },
  { stage: 'shortcuts', label: 'Ярлыки' },
  { stage: 'registry', label: 'Реестр' }
]

const stageIndex = (stage: SetupProgress['stage']): number => {
  const index = STEPS.findIndex((item) => item.stage === stage)
  return index < 0 ? STEPS.length : index
}

const formatSize = (bytes: number): string =>
  bytes >= 1024 * 1024 * 1024 ? `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} ГБ` : `${Math.round(bytes / (1024 * 1024))} МБ`

function Toggle({
  checked,
  onChange,
  label,
  hint
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  hint?: string
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="group flex w-full items-start gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-3.5 py-2.5 text-left transition hover:border-emerald/30 hover:bg-emerald/[0.05]"
    >
      <span
        className={
          'mt-0.5 flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[6px] border transition ' +
          (checked ? 'border-emerald bg-emerald text-ink-950' : 'border-white/20 bg-transparent text-transparent')
        }
      >
        <Check className="h-3 w-3" strokeWidth={3} />
      </span>
      <span className="min-w-0">
        <span className="block text-[12.5px] font-medium text-text">{label}</span>
        {hint ? <span className="mt-0.5 block text-[11px] leading-snug text-faint">{hint}</span> : null}
      </span>
    </button>
  )
}

export default function App(): JSX.Element {
  const api = useMemo(getBridge, [])
  const [info, setInfo] = useState<SetupInfo | null>(null)
  const [step, setStep] = useState<Step>('welcome')
  const [installDir, setInstallDir] = useState('')
  const [desktopShortcut, setDesktopShortcut] = useState(true)
  const [startMenuShortcut, setStartMenuShortcut] = useState(true)
  const [removeData, setRemoveData] = useState(false)
  const [launchAfter, setLaunchAfter] = useState(true)
  const [progress, setProgress] = useState<SetupProgress>({ stage: 'preparing', percent: 0 })
  const [error, setError] = useState<string | null>(null)

  const uninstallMode = info?.mode === 'uninstall'

  useEffect(() => {
    void api.info().then((data) => {
      setInfo(data)
      setInstallDir(data.installDir)
    })
  }, [api])

  useEffect(() => api.onProgress(setProgress), [api])

  const start = async (): Promise<void> => {
    setStep('progress')
    setProgress({ stage: 'preparing', percent: 0 })
    const result = uninstallMode
      ? await api.uninstall({ installDir, removeData })
      : await api.install({ installDir, desktopShortcut, startMenuShortcut, launch: false })
    if (result.ok) setStep('done')
    else {
      setError(result.error ?? 'Неизвестная ошибка')
      setStep('error')
    }
  }

  const finish = async (): Promise<void> => {
    if (uninstallMode) {
      api.close()
      return
    }
    if (launchAfter) await api.launch(installDir)
    api.close()
  }

  return (
    <div className="grid-glow relative flex h-full w-full flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 grid-lines opacity-70" />

      {/* ------- custom title bar (no system frame) ------- */}
      <header className="titlebar relative z-10 flex h-11 flex-none items-center justify-between border-b border-white/[0.06] px-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-emerald-glow to-emerald-deep text-[11px] font-black text-ink-950">
            V
          </span>
          <span className="text-[11px] font-semibold tracking-[0.22em] text-white/70">VERDANT LAUNCHER</span>
          <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-white/45">
            {uninstallMode ? 'УДАЛЕНИЕ' : `УСТАНОВКА · ${info?.version ?? ''}`}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Свернуть"
            onClick={() => api.minimize()}
            className="flex h-7 w-7 items-center justify-center rounded-md text-white/45 transition hover:bg-white/10 hover:text-white"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Закрыть"
            onClick={() => api.close()}
            className="flex h-7 w-7 items-center justify-center rounded-md text-white/45 transition hover:bg-rose-500/80 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      <main className="relative z-10 flex min-h-0 flex-1 gap-5 p-6">
        <AnimatePresence mode="wait">
          {step === 'welcome' ? (
            <motion.section
              key="welcome"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22 }}
              className="flex min-w-0 flex-1 flex-col"
            >
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-soft">
                {uninstallMode ? <Trash2 className="h-3.5 w-3.5" /> : <HardDriveDownload className="h-3.5 w-3.5" />}
                {uninstallMode ? 'Удаление лаунчера' : 'Новая установка'}
              </div>
              <h1 className="mt-2 text-[30px] font-semibold leading-tight tracking-tight text-white">
                {uninstallMode ? 'Удалить Verdant Launcher?' : 'Установим Verdant Launcher'}
              </h1>
              <p className="mt-1.5 max-w-[430px] text-[12.5px] leading-relaxed text-muted">
                {uninstallMode
                  ? 'Файлы лаунчера, ярлыки и запись в реестре будут удалены. Игровые файлы можно сохранить.'
                  : 'Тёмный установщик без системных окон: распакуем лаунчер, создадим ярлыки и запишем деинсталлятор в реестр.'}
              </p>

              <div className="mt-4 rounded-2xl border border-white/8 bg-black/25 p-3 backdrop-blur">
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-faint">
                  <FolderOpen className="h-3 w-3" />
                  Папка установки
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg bg-white/[0.04] px-2.5 py-1.5 font-mono text-[11.5px] text-emerald-100/90">
                    {installDir || '…'}
                  </code>
                  {!uninstallMode ? (
                    <button
                      type="button"
                      onClick={() => void api.chooseDir().then((dir) => dir && setInstallDir(dir))}
                      className="flex-none rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-white/70 transition hover:border-emerald/40 hover:text-white"
                    >
                      Изменить
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="mt-3 space-y-2">
                {uninstallMode ? (
                  <Toggle
                    checked={removeData}
                    onChange={setRemoveData}
                    label="Удалить сохранения и настройки"
                    hint="Папка %APPDATA%\Verdant: настройки, логи, скачанные библиотеки и ассеты. Миры останутся в папках сборок."
                  />
                ) : (
                  <>
                    <Toggle checked={desktopShortcut} onChange={setDesktopShortcut} label="Ярлык на рабочем столе" />
                    <Toggle
                      checked={startMenuShortcut}
                      onChange={setStartMenuShortcut}
                      label="Ярлык в меню «Пуск»"
                      hint="Плюс запись в «Установке и удалении программ» с этим же установщиком в роли деинсталлятора."
                    />
                  </>
                )}
              </div>

              <div className="mt-auto flex items-center gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => void start()}
                  className={
                    'group flex items-center gap-2 rounded-xl px-4 py-2.5 text-[12.5px] font-semibold transition ' +
                    (uninstallMode
                      ? 'bg-rose-500 text-white hover:bg-rose-400'
                      : 'bg-gradient-to-r from-emerald to-emerald-glow text-ink-950 shadow-[0_18px_40px_-18px_rgba(47,226,140,0.75)] hover:brightness-110')
                  }
                >
                  {uninstallMode ? <Trash2 className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
                  {uninstallMode ? 'Удалить' : 'Установить'}
                  <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                </button>
                <button
                  type="button"
                  onClick={() => api.close()}
                  className="rounded-xl border border-white/10 px-3.5 py-2.5 text-[12.5px] text-white/65 transition hover:border-white/25 hover:text-white"
                >
                  Отмена
                </button>
              </div>
            </motion.section>
          ) : null}

          {step === 'progress' ? (
            <motion.section
              key="progress"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22 }}
              className="flex min-w-0 flex-1 flex-col justify-center"
            >
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-soft">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {progress.stage === 'registry' ? 'Реестр' : progress.stage === 'shortcuts' ? 'Ярлыки' : 'Распаковка'}
              </div>
              <div className="mt-3 flex items-end gap-3">
                <span className="font-mono text-[54px] font-semibold leading-none tracking-tight text-white">
                  {Math.floor(progress.percent)}
                </span>
                <span className="mb-1.5 text-[18px] font-medium text-emerald-soft">%</span>
                <span className="mb-2 ml-auto text-right text-[12px] text-muted">
                  {uninstallMode ? 'Удаляем файлы лаунчера' : 'Распаковываем лаунчер'}
                  <br />
                  <span className="text-faint">{progress.detail ?? 'Подготовка…'}</span>
                </span>
              </div>

              <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-deep via-emerald to-emerald-glow"
                  animate={{ width: `${Math.max(2, progress.percent)}%` }}
                  transition={{ type: 'spring', stiffness: 120, damping: 22 }}
                />
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-1.5">
                {STEPS.map((item) => {
                  const active = item.stage === progress.stage
                  const done = stageIndex(progress.stage) > stageIndex(item.stage) || progress.percent >= 100
                  return (
                    <span
                      key={item.stage}
                      className={
                        'flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[10.5px] transition ' +
                        (done
                          ? 'border-emerald/30 bg-emerald/10 text-emerald-soft'
                          : active
                            ? 'border-emerald/40 bg-emerald/[0.06] text-white/85'
                            : 'border-white/8 bg-white/[0.02] text-faint')
                      }
                    >
                      {done ? <Check className="h-3 w-3" strokeWidth={3} /> : <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />}
                      {item.label}
                    </span>
                  )
                })}
              </div>

              <div className="mt-3 flex items-center justify-between text-[11px] text-faint">
                <span>Не закрывайте окно — установка идёт</span>
                <button
                  type="button"
                  onClick={() => void api.cancel()}
                  className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-rose-400/40 hover:text-white"
                >
                  Отмена
                </button>
              </div>
            </motion.section>
          ) : null}

          {step === 'done' ? (
            <motion.section
              key="done"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.25 }}
              className="flex min-w-0 flex-1 flex-col items-start justify-center"
            >
              <motion.span
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 260, damping: 18 }}
                className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald/15 text-emerald-glow"
              >
                <Check className="h-7 w-7" strokeWidth={3} />
              </motion.span>
              <h1 className="mt-4 text-[28px] font-semibold tracking-tight text-white">
                {uninstallMode ? 'Verdant Launcher удалён' : 'Verdant Launcher установлен'}
              </h1>
              <p className="mt-1.5 max-w-[440px] text-[12.5px] leading-relaxed text-muted">
                {uninstallMode
                  ? removeData
                    ? 'Файлы лаунчера, ярлыки, реестр и папка %APPDATA%\\Verdant удалены.'
                    : 'Файлы лаунчера, ярлыки и запись в реестре удалены. Сохранения и настройки остались в %APPDATA%\\Verdant.'
                  : 'Ярлыки на рабочем столе и в меню «Пуск» готовы, деинсталлятор записан в реестр.'}
              </p>
              {!uninstallMode ? (
                <code className="mt-3 rounded-lg bg-white/[0.04] px-2.5 py-1.5 font-mono text-[11.5px] text-emerald-100/90">
                  {installDir}
                </code>
              ) : null}

              <div className="mt-6 flex items-center gap-2">
                {!uninstallMode ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void finish()}
                      className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald to-emerald-glow px-4 py-2.5 text-[12.5px] font-semibold text-ink-950 shadow-[0_18px_40px_-18px_rgba(47,226,140,0.75)] transition hover:brightness-110"
                    >
                      <Sparkles className="h-4 w-4" />
                      Запустить лаунчер
                    </button>
                    <button
                      type="button"
                      onClick={() => (launchAfter ? setLaunchAfter(false) : setLaunchAfter(true))}
                      className="text-[11px] text-faint underline-offset-4 hover:text-white/70 hover:underline"
                    >
                      {launchAfter ? 'не запускать после закрытия' : 'запустить после закрытия'}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => api.close()}
                    className="rounded-xl bg-white/[0.06] px-4 py-2.5 text-[12.5px] font-medium text-white/80 transition hover:bg-white/10"
                  >
                    Закрыть
                  </button>
                )}
              </div>
            </motion.section>
          ) : null}

          {step === 'error' ? (
            <motion.section
              key="error"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex min-w-0 flex-1 flex-col justify-center"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500/15 text-rose-300">
                <X className="h-6 w-6" strokeWidth={3} />
              </span>
              <h1 className="mt-4 text-[26px] font-semibold tracking-tight text-white">Установка не удалась</h1>
              <p className="mt-1.5 max-w-[460px] break-words text-[12.5px] leading-relaxed text-rose-200/80">{error}</p>
              <div className="mt-6 flex gap-2">
                <button
                  type="button"
                  onClick={() => void start()}
                  className="rounded-xl bg-white/[0.08] px-4 py-2.5 text-[12.5px] font-medium text-white/85 transition hover:bg-white/[0.14]"
                >
                  Повторить
                </button>
                <button
                  type="button"
                  onClick={() => api.close()}
                  className="rounded-xl border border-white/10 px-4 py-2.5 text-[12.5px] text-white/60 transition hover:border-white/25 hover:text-white"
                >
                  Закрыть
                </button>
              </div>
            </motion.section>
          ) : null}
        </AnimatePresence>

        {/* ------- right rail: what the installer does ------- */}
        <aside className="relative hidden w-[248px] flex-none flex-col rounded-2xl border border-white/8 bg-gradient-to-b from-emerald/[0.07] to-black/20 p-4 backdrop-blur md:flex">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-soft/80">
            {uninstallMode ? 'Будет удалено' : 'Что установится'}
          </div>
          <div className="mt-3 space-y-3">
            {(uninstallMode
              ? [
                  { icon: Package, title: 'Файлы лаунчера', text: 'Папка установки целиком' },
                  { icon: FolderOpen, title: 'Ярлыки', text: 'Рабочий стол и меню «Пуск»' },
                  { icon: ShieldCheck, title: 'Реестр', text: 'Запись в «Установке программ»' },
                  { icon: Trash2, title: 'Данные', text: removeData ? 'Будут удалены' : 'Останутся на месте' }
                ]
              : [
                  { icon: Package, title: 'Лаунчер', text: 'Распаковка app.zip без прав администратора' },
                  { icon: FolderOpen, title: 'Ярлыки', text: desktopShortcut || startMenuShortcut ? 'Рабочий стол и «Пуск»' : 'Отключены' },
                  { icon: ShieldCheck, title: 'Деинсталлятор', text: 'HKCU\\...\\Uninstall\\VerdantLauncher' },
                  { icon: HardDriveDownload, title: 'Размер', text: info ? formatSize(info.payloadBytes) : '…' }
                ]
            ).map((row) => (
              <div key={row.title} className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-lg bg-emerald/12 text-emerald-soft">
                  <row.icon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[11.5px] font-medium text-white/85">{row.title}</span>
                  <span className="mt-0.5 block text-[10.5px] leading-snug text-faint">{row.text}</span>
                </span>
              </div>
            ))}
          </div>

          <div className="mt-auto rounded-xl border border-emerald/15 bg-emerald/[0.06] p-2.5">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-soft">
              <ShieldCheck className="h-3 w-3" />
              Без UAC
            </div>
            <p className="mt-1 text-[10.5px] leading-snug text-white/55">
              Установка в профиль пользователя: права администратора не запрашиваются.
            </p>
          </div>
        </aside>
      </main>

      <footer className="relative z-10 flex h-9 flex-none items-center justify-between border-t border-white/[0.06] px-4 text-[10.5px] text-faint">
        <span>Verdant Launcher · фирменный установщик на Electron</span>
        <span className="font-mono">{info?.version ? `v${info.version}` : ''}</span>
      </footer>
    </div>
  )
}
