import { motion } from 'framer-motion'
import {
  ChevronRight,
  Gamepad2,
  Layers,
  Minus,
  Package,
  Settings2,
  Square,
  Terminal,
  UserRound,
  X,
  Maximize2
} from 'lucide-react'
import type { ReactNode } from 'react'
import { APP_VERSION } from '../../../shared/constants'
import { useT, type TKey } from '../i18n'
import { api } from '../lib/api'
import { cn } from '../lib/utils'
import { useAppStore, type Screen } from '../store/app'
import { SkinHead } from './SkinPreview'

const NAV: { screen: Screen; icon: typeof Gamepad2; key: TKey }[] = [
  { screen: 'play', icon: Gamepad2, key: 'nav.play' },
  { screen: 'instances', icon: Layers, key: 'nav.instances' },
  { screen: 'mods', icon: Package, key: 'nav.mods' },
  { screen: 'skins', icon: UserRound, key: 'nav.skins' }
]

const NAV_BOTTOM: { screen: Screen; icon: typeof Terminal; key: TKey }[] = [
  { screen: 'console', icon: Terminal, key: 'nav.console' },
  { screen: 'settings', icon: Settings2, key: 'nav.settings' }
]

function WindowControls(): JSX.Element | null {
  const platform = useAppStore((state) => state.systemInfo?.platform)
  if (platform === 'darwin') return null

  return (
    <div className="no-drag flex items-center gap-1">
      <button className="icon-btn !h-8 !w-9 !rounded-lg" aria-label="minimize" onClick={() => api.app.minimize()}>
        <Minus className="h-3.5 w-3.5" />
      </button>
      <button
        className="icon-btn !h-8 !w-9 !rounded-lg"
        aria-label="maximize"
        onClick={() => void api.app.toggleMaximize()}
      >
        <Square className="h-3 w-3" />
      </button>
      <button
        className="icon-btn !h-8 !w-9 !rounded-lg hover:!bg-rose-500/20 hover:!text-rose-200"
        aria-label="close"
        onClick={() => api.app.close()}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export function TitleBar(): JSX.Element {
  return (
    <header className="drag-region relative z-30 flex h-10 flex-none items-center justify-between border-b border-white/[0.05] bg-black/20 px-4">
      <div className="flex items-center gap-3">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-emerald-soft to-emerald-deep shadow-[0_0_18px_rgba(47,226,140,0.45)]">
          <span className="pixel text-[9px] font-bold text-ink-950">V</span>
        </div>
        <span className="logo-mark text-[10px]">VERDANT</span>
        <span className="hidden text-[10px] uppercase tracking-[0.28em] text-faint sm:block">launcher</span>
      </div>
      <div className="text-[10px] uppercase tracking-[0.24em] text-faint">v{APP_VERSION}</div>
      <WindowControls />
    </header>
  )
}

function NavButton({
  active,
  icon: Icon,
  label,
  onClick
}: {
  active: boolean
  icon: typeof Gamepad2
  label: string
  onClick: () => void
}): JSX.Element {
  return (
    <div className="group relative flex items-center justify-center">
      <button className="nav-item no-drag" data-active={active} onClick={onClick} aria-label={label} aria-current={active}>
        {active ? (
          <motion.span layoutId="nav-pill" className="nav-pill" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />
        ) : null}
        <Icon className="relative z-10 h-[19px] w-[19px]" strokeWidth={1.9} />
      </button>
      <span className="pointer-events-none absolute left-[62px] z-40 whitespace-nowrap rounded-lg border border-white/10 bg-ink-900/95 px-2.5 py-1.5 text-[11px] text-text opacity-0 shadow-xl transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100 -translate-x-1">
        {label}
      </span>
      {active ? <span className="nav-indicator" /> : null}
    </div>
  )
}

export function Sidebar(): JSX.Element {
  const t = useT()
  const screen = useAppStore((state) => state.screen)
  const setScreen = useAppStore((state) => state.setScreen)
  const game = useAppStore((state) => state.game)

  return (
    <nav className="relative z-20 flex w-[86px] flex-none flex-col items-center border-r border-white/[0.05] bg-white/[0.012] py-5">
      <div className="flex flex-1 flex-col items-center gap-2">
        {NAV.map((item) => (
          <NavButton
            key={item.screen}
            active={screen === item.screen}
            icon={item.icon}
            label={t(item.key)}
            onClick={() => setScreen(item.screen)}
          />
        ))}
      </div>
      <div className="flex flex-col items-center gap-2">
        {game.state === 'running' ? (
          <div className="mb-2 flex flex-col items-center gap-1.5" title={t('top.running')}>
            <span className="pulse-dot" />
            <span className="text-[8px] uppercase tracking-wider text-emerald-soft/80">live</span>
          </div>
        ) : null}
        {NAV_BOTTOM.map((item) => (
          <NavButton
            key={item.screen}
            active={screen === item.screen}
            icon={item.icon}
            label={t(item.key)}
            onClick={() => setScreen(item.screen)}
          />
        ))}
      </div>
    </nav>
  )
}

const TITLES: Record<Screen, TKey> = {
  play: 'nav.play',
  instances: 'nav.instances',
  mods: 'nav.mods',
  skins: 'nav.skins',
  settings: 'nav.settings',
  console: 'nav.console'
}

export function TopBar(): JSX.Element {
  const t = useT()
  const screen = useAppStore((state) => state.screen)
  const profile = useAppStore((state) => state.profile)
  const skin = useAppStore((state) => state.skin)
  const game = useAppStore((state) => state.game)
  const openProfileModal = useAppStore((state) => state.openProfileModal)
  const setScreen = useAppStore((state) => state.setScreen)

  const statusText =
    game.state === 'running'
      ? t('top.running')
      : game.state === 'idle' || game.state === 'exited'
        ? t('top.idle')
        : t('top.preparing')

  return (
    <div className="flex h-[68px] flex-none items-center justify-between gap-4 border-b border-white/[0.05] px-7">
      <div className="flex min-w-0 items-center gap-3">
        <h1 className="pixel truncate text-[13px] text-text">{t(TITLES[screen])}</h1>
        <ChevronRight className="h-4 w-4 flex-none text-faint" />
        <span className="flex items-center gap-2 text-[11.5px] text-muted">
          <span className={cn('h-1.5 w-1.5 rounded-full', game.state === 'running' ? 'bg-emerald-glow' : 'bg-white/25')} />
          {statusText}
        </span>
      </div>

      <div className="no-drag flex items-center gap-3">
        <button
          className="flex items-center gap-2.5 rounded-2xl border border-white/[0.07] bg-white/[0.03] px-2.5 py-1.5 transition hover:border-emerald/30 hover:bg-white/[0.06]"
          onClick={() => openProfileModal(true)}
        >
          <SkinHead dataUrl={skin.dataUrl} size={30} className="shadow-lg" />
          <span className="flex flex-col items-start leading-tight">
            <span className="text-[12px] font-semibold text-text">{profile?.name ?? t('top.noProfile')}</span>
            <span className="text-[10px] text-faint">{profile ? t('play.offline') : t('top.editProfile')}</span>
          </span>
        </button>
        <button className="icon-btn" aria-label={t('nav.settings')} onClick={() => setScreen('settings')}>
          <Settings2 className="h-[18px] w-[18px]" />
        </button>
      </div>
    </div>
  )
}

export function PageTransition({ screen, children }: { screen: Screen; children: ReactNode }): JSX.Element {
  const reduceMotion = useAppStore((state) => state.settings.reduceMotion)
  return (
    <motion.div
      key={screen}
      className="scroll-area min-h-0 flex-1"
      initial={reduceMotion ? false : { opacity: 0, y: 10, filter: 'blur(6px)' }}
      animate={reduceMotion ? {} : { opacity: 1, y: 0, filter: 'blur(0px)' }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {children}
    </motion.div>
  )
}

export function Background(): JSX.Element {
  const animations = useAppStore((state) => state.settings.animations)
  const reduceMotion = useAppStore((state) => state.settings.reduceMotion)
  if (!animations || reduceMotion) return <></>
  return (
    <>
      <div className="aurora aurora--one" />
      <div className="aurora aurora--two" />
    </>
  )
}

export function ScreenHeader({
  eyebrow,
  title,
  description,
  action
}: {
  eyebrow?: string
  title: string
  description?: string
  action?: ReactNode
}): JSX.Element {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow ? <div className="eyebrow mb-2">{eyebrow}</div> : null}
        <h2 className="text-[22px] font-semibold tracking-tight text-text">{title}</h2>
        {description ? <p className="mt-1.5 max-w-xl text-[12.5px] leading-relaxed text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}

export { Maximize2 }
