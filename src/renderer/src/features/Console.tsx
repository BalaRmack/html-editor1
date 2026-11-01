import { Check, Copy, FolderOpen, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ScreenHeader } from '../components/layout'
import { Badge, Button, EmptyState, Panel, Switch } from '../components/ui'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { cn } from '../lib/utils'
import { useAppStore } from '../store/app'

type Filter = 'all' | 'error' | 'warn'

export function ConsoleScreen(): JSX.Element {
  const t = useT()
  const logs = useAppStore((state) => state.logs)
  const clearLogs = useAppStore((state) => state.clearLogs)
  const [filter, setFilter] = useState<Filter>('all')
  const [autoscroll, setAutoscroll] = useState(true)
  const [copied, setCopied] = useState(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const filtered = useMemo(() => {
    if (filter === 'all') return logs
    if (filter === 'error') return logs.filter((line) => line.level === 'error')
    return logs.filter((line) => line.level === 'warn' || line.level === 'error')
  }, [logs, filter])

  useEffect(() => {
    if (!autoscroll) return
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [filtered.length, autoscroll])

  const copyAll = async (): Promise<void> => {
    const text = filtered.map((line) => `[${new Date(line.ts).toLocaleTimeString()}] ${line.text}`).join('\n')
    await navigator.clipboard.writeText(text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  const errors = logs.filter((line) => line.level === 'error').length
  const warnings = logs.filter((line) => line.level === 'warn').length

  return (
    <div className="flex h-full flex-col px-7 py-6">
      <ScreenHeader
        eyebrow={t('nav.consoleHint')}
        title={t('console.title')}
        description={t('console.subtitle')}
        action={
          <div className="flex items-center gap-2">
            <Button size="sm" icon={<FolderOpen className="h-3.5 w-3.5" />} onClick={() => void api.logs.openFolder()}>
              {t('console.openFolder')}
            </Button>
            <Button
              size="sm"
              icon={copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              onClick={() => void copyAll()}
            >
              {copied ? t('console.copied') : t('console.copy')}
            </Button>
            <Button size="sm" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => void clearLogs()}>
              {t('console.clear')}
            </Button>
          </div>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(
          [
            { id: 'all' as Filter, label: t('console.all'), count: logs.length },
            { id: 'error' as Filter, label: t('console.errors'), count: errors },
            { id: 'warn' as Filter, label: t('console.warnings'), count: warnings }
          ]
        ).map((item) => (
          <button
            key={item.id}
            onClick={() => setFilter(item.id)}
            className={cn(
              'flex items-center gap-2 rounded-xl border px-3 py-1.5 text-[11.5px] transition',
              filter === item.id
                ? 'border-emerald/35 bg-emerald/10 text-emerald-soft'
                : 'border-white/[0.07] bg-white/[0.02] text-muted hover:text-text'
            )}
          >
            {item.label}
            <Badge>{item.count}</Badge>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2.5">
          <span className="text-[11px] text-muted">{t('console.autoscroll')}</span>
          <Switch checked={autoscroll} onChange={setAutoscroll} />
        </div>
      </div>

      <Panel className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
          <div className="flex items-center gap-2 text-[11px] text-muted">
            <span className="h-2 w-2 rounded-full bg-emerald-glow/80" />
            verdant ~ launcher.log
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
          </div>
        </div>
        <div className="scroll-area min-h-0 flex-1 bg-black/25 px-4 py-3">
          {filtered.length === 0 ? (
            <EmptyState icon={<TerminalIcon />} title={t('console.empty')} />
          ) : (
            <>
              {filtered.map((line) => (
                <div key={line.seq} className="log-line" data-level={line.level} data-source={line.source}>
                  <span className="mr-2 select-none text-white/25">{new Date(line.ts).toLocaleTimeString()}</span>
                  {line.text}
                </div>
              ))}
              <div ref={bottomRef} />
            </>
          )}
        </div>
      </Panel>
    </div>
  )
}

function TerminalIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" stroke="currentColor" strokeWidth="1.6">
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M7 9l3 3-3 3M13 15h4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
