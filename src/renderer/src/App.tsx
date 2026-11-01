import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, FolderOpen } from 'lucide-react'
import { useEffect } from 'react'
import { Background, PageTransition, Sidebar, TitleBar, TopBar } from './components/layout'
import { Button, Modal, ToastHost } from './components/ui'
import { ConsoleScreen } from './features/Console'
import { InstanceWizard } from './features/InstanceWizard'
import { InstancesScreen } from './features/Instances'
import { ModsScreen } from './features/Mods'
import { PlayScreen } from './features/Play'
import { ProfileModal } from './features/ProfileModal'
import { SettingsScreen } from './features/Settings'
import { SkinsScreen } from './features/Skins'
import { useT } from './i18n'
import { api } from './lib/api'
import { useAppStore } from './store/app'

function Splash(): JSX.Element {
  return (
    <div className="app-shell flex items-center justify-center">
      <Background />
      <motion.div
        className="flex flex-col items-center gap-5"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="flex h-20 w-20 items-center justify-center rounded-[26px] bg-gradient-to-br from-emerald-soft to-emerald-deep shadow-[0_0_60px_rgba(47,226,140,0.45)]">
          <span className="pixel text-[26px] text-ink-950">V</span>
        </div>
        <div className="pixel text-[12px] text-text">VERDANT</div>
        <div className="flex items-center gap-1.5">
          {[0, 1, 2].map((index) => (
            <motion.span
              key={index}
              className="h-1.5 w-1.5 rounded-full bg-emerald-glow"
              animate={{ opacity: [0.25, 1, 0.25], y: [0, -3, 0] }}
              transition={{ duration: 1.1, repeat: Infinity, delay: index * 0.14 }}
            />
          ))}
        </div>
      </motion.div>
    </div>
  )
}

function CrashModal(): JSX.Element {
  const t = useT()
  const crash = useAppStore((state) => state.crash)
  const setCrash = useAppStore((state) => state.setCrash)
  if (!crash) return <></>

  return (
    <Modal
      open={Boolean(crash)}
      onClose={() => setCrash(null)}
      title={t('toast.launchError')}
      subtitle={crash.location}
      width="max-w-2xl"
      footer={
        <>
          <Button icon={<FolderOpen className="h-4 w-4" />} onClick={() => void api.app.openPath(crash.location)}>
            {t('console.openFolder')}
          </Button>
          <Button variant="primary" onClick={() => setCrash(null)}>
            {t('common.close')}
          </Button>
        </>
      }
    >
      <div className="mb-3 flex items-center gap-2 text-[12px] text-amber-200">
        <AlertTriangle className="h-4 w-4" />
        Minecraft завершился с ошибкой (код {crash.code ?? '—'})
      </div>
      <pre className="max-h-[340px] overflow-auto rounded-xl border border-white/[0.07] bg-black/40 p-3 font-mono text-[10.5px] leading-relaxed text-rose-100/80">
        {crash.report.slice(0, 6000)}
      </pre>
    </Modal>
  )
}

export default function App(): JSX.Element {
  const ready = useAppStore((state) => state.ready)
  const screen = useAppStore((state) => state.screen)
  const toasts = useAppStore((state) => state.toasts)
  const init = useAppStore((state) => state.init)

  useEffect(() => {
    void init()
  }, [init])

  if (!ready) return <Splash />

  return (
    <div className="app-shell">
      <Background />
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <AnimatePresence mode="wait" initial={false}>
            <PageTransition screen={screen}>
              {screen === 'play' ? <PlayScreen /> : null}
              {screen === 'instances' ? <InstancesScreen /> : null}
              {screen === 'mods' ? <ModsScreen /> : null}
              {screen === 'skins' ? <SkinsScreen /> : null}
              {screen === 'settings' ? <SettingsScreen /> : null}
              {screen === 'console' ? <ConsoleScreen /> : null}
            </PageTransition>
          </AnimatePresence>
        </div>
      </div>

      <InstanceWizard />
      <ProfileModal />
      <CrashModal />
      <ToastHost toasts={toasts} />
    </div>
  )
}
