import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Info,
  Loader2,
  RotateCcw,
  X,
  XCircle
} from 'lucide-react'
import { useEffect, useId, useMemo, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ToastItem } from '../store/app'
import { useAppStore } from '../store/app'
import { useT, localizeError, type TKey } from '../i18n'
import { clamp, cn } from '../lib/utils'

/* -------------------------------------------------------------- buttons */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger' | 'subtle'
  size?: 'sm' | 'md' | 'lg'
  icon?: ReactNode
  loading?: boolean
}

export function Button({ variant = 'ghost', size = 'md', icon, loading, className, children, ...props }: ButtonProps): JSX.Element {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cn(
        'btn',
        variant === 'primary' && 'btn--primary',
        variant === 'ghost' && 'btn--ghost',
        variant === 'danger' && 'btn--danger',
        variant === 'subtle' && 'bg-white/[0.03] text-muted hover:text-text hover:bg-white/[0.06]',
        size === 'sm' && '!px-3 !py-1.5 !text-[12px] !rounded-[10px]',
        size === 'lg' && '!px-6 !py-3 !text-sm',
        className
      )}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  )
}

export function IconButton({
  label,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }): JSX.Element {
  return (
    <button {...props} aria-label={label} title={label} className={cn('icon-btn', className)}>
      {children}
    </button>
  )
}

/* -------------------------------------------------------------- surfaces */

export function Panel({
  className,
  children,
  hover,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { hover?: boolean }): JSX.Element {
  return (
    <div {...props} className={cn('glass rounded-3xl', hover && 'glass-hover', className)}>
      {children}
    </div>
  )
}

export function Badge({
  children,
  tone = 'default',
  className
}: {
  children: ReactNode
  tone?: 'default' | 'emerald' | 'gold' | 'danger'
  className?: string
}): JSX.Element {
  return (
    <span
      className={cn(
        'badge',
        tone === 'emerald' && 'badge--emerald',
        tone === 'gold' && 'badge--gold',
        tone === 'danger' && 'badge--danger',
        className
      )}
    >
      {children}
    </span>
  )
}

export function SectionTitle({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: ReactNode }): JSX.Element {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        {eyebrow ? <div className="eyebrow mb-1.5">{eyebrow}</div> : null}
        <h2 className="text-[17px] font-semibold tracking-tight text-text">{title}</h2>
      </div>
      {action}
    </div>
  )
}

/* -------------------------------------------------------------- inputs */

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  return <input {...props} className={cn('field', className)} />
}

export function Switch({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label?: string
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={checked}
      className="switch"
      data-on={checked}
      onClick={() => onChange(!checked)}
    >
      <span className="switch__knob" />
    </button>
  )
}

export function Slider({
  value,
  min,
  max,
  step = 256,
  onChange,
  accent
}: {
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  accent: string
}): JSX.Element {
  const percent = ((value - min) / Math.max(1, max - min)) * 100
  const id = useId()
  return (
    <div className="w-full">
      <input
        id={id}
        type="range"
        className="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{
          background: `linear-gradient(90deg, ${accent} 0%, ${accent} ${percent}%, rgba(255,255,255,0.08) ${percent}%, rgba(255,255,255,0.08) 100%)`
        }}
      />
    </div>
  )
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  className
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string }[]
  className?: string
}): JSX.Element {
  return (
    <div className={cn('relative', className)}>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="field appearance-none pr-9 cursor-pointer"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} className="bg-ink-800 text-text">
            {option.label}
          </option>
        ))}
      </select>
      <svg className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" viewBox="0 0 20 20" fill="none">
        <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

/* -------------------------------------------------------------- feedback */

export function Spinner({ className }: { className?: string }): JSX.Element {
  return <Loader2 className={cn('h-4 w-4 animate-spin text-emerald-soft', className)} />
}

export function Skeleton({ className }: { className?: string }): JSX.Element {
  return <div className={cn('skeleton', className)} />
}

export function ProgressBar({
  value,
  total,
  percent: explicitPercent,
  className,
  label
}: {
  value: number
  total: number
  /** Pre-computed 0..100 value from the main process (already monotonic). */
  percent?: number
  className?: string
  label?: string
}): JSX.Element {
  const indeterminate = typeof explicitPercent !== 'number' && (!total || total <= 0)
  const percent =
    typeof explicitPercent === 'number' ? clamp(explicitPercent, 0, 100) : indeterminate ? 0 : clamp((value / total) * 100, 0, 100)
  return (
    <div className={cn('w-full', className)}>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-white/[0.07]">
        {indeterminate ? (
          <motion.div
            className="absolute inset-y-0 w-1/3 rounded-full bg-gradient-to-r from-emerald-deep/40 via-emerald-glow to-emerald-deep/40"
            animate={{ x: ['-40%', '260%'] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
          />
        ) : (
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald to-emerald-glow"
            animate={{ width: `${percent}%` }}
            transition={{ type: 'spring', stiffness: 120, damping: 22 }}
            style={{ boxShadow: '0 0 16px rgba(47,226,140,0.55)' }}
          />
        )}
      </div>
      {label ? <div className="mt-2 text-[11px] text-muted">{label}</div> : null}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-emerald-soft">
        {icon}
      </div>
      <div className="max-w-sm space-y-1.5">
        <h3 className="text-[15px] font-semibold text-text">{title}</h3>
        {description ? <p className="text-[12.5px] leading-relaxed text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}

/* -------------------------------------------------------------- modal */

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 'max-w-xl',
  closeOnBackdrop = true
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
  width?: string
  closeOnBackdrop?: boolean
}): JSX.Element | null {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-md"
            onClick={() => closeOnBackdrop && onClose()}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={cn('glass relative w-full overflow-hidden rounded-3xl', width)}
            initial={{ opacity: 0, y: 18, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.99 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
          >
            <div className="flex items-start justify-between gap-4 border-b border-white/[0.07] px-6 py-5">
              <div>
                <h2 className="text-[16px] font-semibold tracking-tight text-text">{title}</h2>
                {subtitle ? <p className="mt-1 text-[12px] text-muted">{subtitle}</p> : null}
              </div>
              <IconButton label="close" onClick={onClose} className="-mr-1 -mt-1">
                <X className="h-4 w-4" />
              </IconButton>
            </div>
            <div className="max-h-[68vh] overflow-y-auto px-6 py-5">{children}</div>
            {footer ? <div className="flex items-center justify-end gap-2 border-t border-white/[0.07] px-6 py-4">{footer}</div> : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body
  )
}

/* -------------------------------------------------------------- tooltip */

export function Tooltip({
  content,
  children,
  side = 'bottom'
}: {
  content: string
  children: ReactNode
  /** `right` is required inside the 86px sidebar, where a centred label would be clipped. */
  side?: 'bottom' | 'right'
}): JSX.Element {
  return (
    <span className="group relative inline-flex">
      {children}
      <span
        className={cn(
          'pointer-events-none absolute z-40 whitespace-nowrap rounded-lg border border-white/10 bg-ink-900/95 px-2.5 py-1.5 text-[11px] text-text opacity-0 shadow-xl transition-opacity duration-150 group-hover:opacity-100',
          side === 'right' ? 'left-full top-1/2 ml-2 -translate-y-1/2' : 'left-1/2 top-full mt-2 -translate-x-1/2'
        )}
      >
        {content}
      </span>
    </span>
  )
}

/* -------------------------------------------------------------- toasts */

const TOAST_ICON = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
  warning: AlertTriangle
}

export function ToastHost({ toasts }: { toasts: ToastItem[] }): JSX.Element {
  const t = useT()
  const dismiss = useAppStore((state) => state.dismissToast)
  // Primitive selector: the banner sits in the same corner, so toasts slide up.
  const updatePhase = useAppStore((state) => state.update?.phase ?? null)
  const updateVisible = updatePhase === 'available' || updatePhase === 'downloading' || updatePhase === 'ready'

  return (
    <div
      className={cn(
        'pointer-events-none fixed right-6 z-[60] flex w-[336px] flex-col gap-2.5 transition-all duration-300',
        updateVisible ? 'bottom-[236px]' : 'bottom-6'
      )}
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          const Icon = TOAST_ICON[toast.kind]
          // Localised sentence for known codes, otherwise whatever the caller passed.
          const localized = toast.errorCode ? localizeError(t, toast.errorCode, toast.vars) : undefined
          const description =
            toast.errorCode && toast.errorCode === 'network_error' && !toast.vars?.file
              ? t('errors.network_error.generic')
              : localized ?? toast.description
          return (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              className="pointer-events-auto flex items-start gap-3 rounded-2xl border border-white/10 bg-ink-850/90 px-4 py-3 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl"
            >
              <span
                className={cn(
                  'mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-lg',
                  toast.kind === 'success' && 'bg-emerald/15 text-emerald-soft',
                  toast.kind === 'error' && 'bg-rose-500/15 text-rose-300',
                  toast.kind === 'warning' && 'bg-amber-400/15 text-amber-300',
                  toast.kind === 'info' && 'bg-sky-400/15 text-sky-300'
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-semibold text-text">
                  {t(toast.titleKey as TKey, toast.vars)}
                </div>
                {description ? (
                  <div className="mt-0.5 break-words text-[11.5px] leading-relaxed text-muted">{description}</div>
                ) : null}
                {toast.action ? (
                  <button
                    className={cn(
                      'mt-2 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition',
                      'border-rose-400/35 bg-rose-400/10 text-rose-100 hover:border-rose-300/60 hover:bg-rose-400/20'
                    )}
                    onClick={() => {
                      dismiss(toast.id)
                      toast.action?.run()
                    }}
                  >
                    <RotateCcw className="h-3 w-3" />
                    {t(toast.action.labelKey as TKey)}
                  </button>
                ) : null}
              </div>
              <button className="icon-btn !h-6 !w-6 text-faint hover:text-text" onClick={() => dismiss(toast.id)} aria-label="dismiss">
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}

/* -------------------------------------------------------------- misc */

export function CheckRow({ label, value, description }: { label: string; value: ReactNode; description?: string }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-text">{label}</div>
        {description ? <div className="mt-0.5 text-[11.5px] leading-relaxed text-muted">{description}</div> : null}
      </div>
      <div className="flex flex-none items-center gap-2">{value}</div>
    </div>
  )
}

export function KeyValue({ label, value }: { label: string; value: ReactNode }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-[12px]">
      <span className="text-muted">{label}</span>
      <span className="max-w-[60%] truncate text-right text-text/90">{value}</span>
    </div>
  )
}

export function StatusDot({ active }: { active: boolean }): JSX.Element {
  return active ? <span className="pulse-dot" /> : <span className="h-2 w-2 rounded-full bg-white/25" />
}

export function useMemoryAccent(usedMb: number, totalMb: number): string {
  return useMemo(() => {
    const ratio = totalMb > 0 ? usedMb / totalMb : 0
    if (ratio > 0.7) return '#f87171'
    if (ratio > 0.5) return '#f5c249'
    return '#2fe28c'
  }, [usedMb, totalMb])
}

export const ICONS = { Check, X }
