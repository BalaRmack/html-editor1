import { AnimatePresence, motion } from 'framer-motion'
import {
  Bug,
  CheckCircle2,
  ChevronDown,
  Clipboard,
  Lightbulb,
  Loader2,
  MessageSquarePlus,
  Send,
  TriangleAlert
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FeedbackKind, FeedbackPreview, FeedbackResult } from '../../../shared/types'
import { Badge, Button, IconButton, Input, Modal, Tooltip } from '../components/ui'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { cn } from '../lib/utils'
import { useAppStore } from '../store/app'

const MIN_DESCRIPTION = 10

/** Two round icon buttons at the very bottom of the sidebar (icons only, no emoji). */
export function FeedbackButtons(): JSX.Element {
  const t = useT()
  const openFeedback = useAppStore((state) => state.openFeedback)
  const kind = useAppStore((state) => state.feedbackKind)

  return (
    <div className="flex flex-col items-center gap-1.5 border-t border-white/[0.06] pt-3">
      {(['bug', 'suggestion'] as FeedbackKind[]).map((entry) => (
        <Tooltip
          key={entry}
          side="right"
          content={t(entry === 'bug' ? 'feedback.reportBug' : 'feedback.suggest')}
        >
          <button
            aria-label={t(entry === 'bug' ? 'feedback.reportBug' : 'feedback.suggest')}
            onClick={() => openFeedback(entry)}
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-xl border border-transparent text-faint transition',
              'hover:border-emerald/25 hover:bg-emerald/10 hover:text-emerald-glow',
              kind === entry && 'border-emerald/30 bg-emerald/10 text-emerald-glow'
            )}
          >
            {entry === 'bug' ? <Bug className="h-[17px] w-[17px]" /> : <Lightbulb className="h-[17px] w-[17px]" />}
          </button>
        </Tooltip>
      ))}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="flex-none text-[10px] uppercase tracking-[0.1em] text-faint">{label}</span>
      <span className="min-w-0 break-all text-right text-[11px] text-text/90">{value}</span>
    </div>
  )
}

/**
 * Bug report / suggestion modal.
 *
 * The bug form always attaches the last 100 lines of `latest.log` plus the
 * collected system info — both are previewed here so nothing is sent blindly.
 */
export function FeedbackModal(): JSX.Element {
  const t = useT()
  const kind = useAppStore((state) => state.feedbackKind)
  const close = useAppStore((state) => state.closeFeedback)
  const pushToast = useAppStore((state) => state.pushToast)
  const openSettings = useAppStore((state) => state.openSettings)

  const [description, setDescription] = useState('')
  const [contact, setContact] = useState('')
  const [preview, setPreview] = useState<FeedbackPreview | null>(null)
  const [showInfo, setShowInfo] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<FeedbackResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isBug = kind === 'bug'
  const trimmed = description.trim()
  const valid = trimmed.length >= MIN_DESCRIPTION

  useEffect(() => {
    if (!kind) return
    setDescription('')
    setContact('')
    setResult(null)
    setError(null)
    setShowInfo(false)
    setShowLog(false)
    void api.feedback
      .preview()
      .then(setPreview)
      .catch(() => setPreview(null))
  }, [kind])

  const logLines = preview?.logLines ?? []
  const logCount = logLines.length

  const send = useCallback(async (): Promise<void> => {
    if (!kind || !valid) return
    setSending(true)
    setError(null)
    try {
      const outcome = await api.feedback.send({
        kind,
        description: trimmed,
        contact: contact.trim() || undefined
      })
      setResult(outcome)
      if (outcome.ok) {
        pushToast({ kind: 'success', titleKey: 'feedback.sent' })
      } else if (outcome.code === 'feedback_not_configured') {
        setError(t('feedback.notConfigured'))
      } else if (outcome.code === 'feedback_rate_limited') {
        setError(t('feedback.rateLimited'))
      } else {
        setError(t('feedback.failed'))
      }
    } catch (err) {
      setError((err as Error).message || t('feedback.failed'))
    } finally {
      setSending(false)
    }
  }, [kind, valid, trimmed, contact, pushToast, t])

  const copyReport = useCallback(async (): Promise<void> => {
    const info = preview?.systemInfo
    const text = [
      isBug ? 'BUG' : 'SUGGESTION',
      trimmed,
      contact ? `contact: ${contact}` : '',
      '',
      info ? `OS: ${info.os} (${info.arch})` : '',
      info ? `Launcher: ${info.appVersion} / Electron ${info.electron}` : '',
      info ? `Java: ${info.java ?? 'not found'}` : '',
      '',
      `--- latest.log (${logCount} lines) ---`,
      ...logLines
    ]
      .filter(Boolean)
      .join('\n')
    try {
      await navigator.clipboard.writeText(text)
      pushToast({ kind: 'info', titleKey: 'feedback.copied' })
    } catch {
      pushToast({ kind: 'error', titleKey: 'feedback.copyFailed' })
    }
  }, [preview, isBug, trimmed, contact, logCount, logLines, pushToast])

  const title = useMemo(() => (isBug ? t('feedback.reportBug') : t('feedback.suggest')), [isBug, t])

  return (
    <Modal
      open={Boolean(kind)}
      onClose={close}
      title={title}
      subtitle={isBug ? t('feedback.bugSubtitle') : t('feedback.suggestionSubtitle')}
      width="max-w-2xl"
      footer={
        result?.ok ? (
          <Button variant="primary" onClick={close}>
            {t('common.close')}
          </Button>
        ) : (
          <>
            <Button icon={<Clipboard className="h-4 w-4" />} onClick={() => void copyReport()}>
              {t('feedback.copy')}
            </Button>
            <Button
              variant="primary"
              icon={<Send className="h-4 w-4" />}
              disabled={!valid}
              loading={sending}
              onClick={() => void send()}
            >
              {t('feedback.send')}
            </Button>
          </>
        )
      }
    >
      <AnimatePresence mode="wait">
        {result?.ok ? (
          <motion.div
            key="done"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center gap-3 py-8 text-center"
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald/30 bg-emerald/12 text-emerald-glow">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <h3 className="text-[15px] font-semibold text-text">{t('feedback.sentTitle')}</h3>
            <p className="max-w-sm text-[12px] leading-relaxed text-muted">
              {result.delivered === 'github' ? t('feedback.sentGithub') : t('feedback.sentWebhook')}
            </p>
            <Badge tone="emerald">{t('feedback.attached', { count: result.logLines })}</Badge>
          </motion.div>
        ) : (
          <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-[12px] font-medium text-text">
                  {isBug ? t('feedback.whatHappened') : t('feedback.whatToImprove')}
                </label>
                <span className={cn('text-[10px] tabular-nums', valid ? 'text-faint' : 'text-amber-300')}>
                  {trimmed.length} / 2000
                </span>
              </div>
              <textarea
                autoFocus
                value={description}
                maxLength={2000}
                rows={5}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={isBug ? t('feedback.describePlaceholder') : t('feedback.ideaPlaceholder')}
                className="w-full resize-none rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-[12.5px] leading-relaxed text-text outline-none transition placeholder:text-faint focus:border-emerald/45 focus:bg-white/[0.05]"
              />
              {!valid && trimmed.length > 0 ? (
                <p className="mt-1.5 text-[10.5px] text-amber-300">{t('feedback.tooShort', { min: MIN_DESCRIPTION })}</p>
              ) : null}
            </div>

            {!isBug ? (
              <div>
                <label className="mb-2 block text-[12px] font-medium text-text">{t('feedback.contact')}</label>
                <Input
                  value={contact}
                  onChange={(event) => setContact(event.target.value)}
                  placeholder={t('feedback.contactPlaceholder')}
                  maxLength={120}
                />
                <p className="mt-1.5 text-[10.5px] text-faint">{t('feedback.contactHint')}</p>
              </div>
            ) : null}

            {/* what travels with the report */}
            <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.02]">
              <button
                className="flex w-full items-center gap-2.5 px-4 py-3 text-left"
                onClick={() => setShowInfo((value) => !value)}
              >
                <MessageSquarePlus className="h-4 w-4 flex-none text-emerald-soft" />
                <span className="flex-1 text-[12px] text-text">{t('feedback.systemInfo')}</span>
                <Badge>{t('feedback.auto')}</Badge>
                <ChevronDown className={cn('h-3.5 w-3.5 text-faint transition', showInfo && 'rotate-180')} />
              </button>
              <AnimatePresence initial={false}>
                {showInfo ? (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="divide-y divide-white/[0.04] border-t border-white/[0.06] px-4 py-2">
                      {preview ? (
                        <>
                          <InfoRow label={t('feedback.os')} value={`${preview.systemInfo.os} (${preview.systemInfo.arch})`} />
                          <InfoRow
                            label={t('feedback.launcher')}
                            value={`${preview.systemInfo.appVersion} · Electron ${preview.systemInfo.electron}`}
                          />
                          <InfoRow label={t('feedback.java')} value={preview.systemInfo.java ?? t('feedback.javaMissing')} />
                          <InfoRow label={t('feedback.ram')} value={`${preview.systemInfo.totalMemMB} MB`} />
                          <InfoRow label={t('feedback.instance')} value={preview.systemInfo.instance ?? '—'} />
                        </>
                      ) : (
                        <div className="flex items-center gap-2 py-3 text-[11.5px] text-faint">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('feedback.collecting')}
                        </div>
                      )}
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>

            {isBug ? (
              <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.02]">
                <button
                  className="flex w-full items-center gap-2.5 px-4 py-3 text-left"
                  onClick={() => setShowLog((value) => !value)}
                >
                  <Bug className="h-4 w-4 flex-none text-emerald-soft" />
                  <span className="flex-1 text-[12px] text-text">{t('feedback.logFile')}</span>
                  <Badge tone="emerald">{t('feedback.logLines', { count: logCount })}</Badge>
                  <ChevronDown className={cn('h-3.5 w-3.5 text-faint transition', showLog && 'rotate-180')} />
                </button>
                <AnimatePresence initial={false}>
                  {showLog ? (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <pre className="max-h-[220px] overflow-auto border-t border-white/[0.06] bg-black/40 px-4 py-3 font-mono text-[10.5px] leading-relaxed text-text/75">
                        {logLines.length > 0 ? logLines.join('\n') : t('feedback.logEmpty')}
                      </pre>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>
            ) : null}

            {error ? (
              <div className="rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-[11.5px] text-rose-200">
                <div className="flex items-start gap-2">
                  <TriangleAlert className="mt-0.5 h-4 w-4 flex-none" />
                  <span className="flex-1">{error}</span>
                </div>
                {error === t('feedback.notConfigured') ? (
                  <div className="mt-2 flex items-center gap-2">
                    <Button size="sm" onClick={() => openSettings('general')}>
                      {t('feedback.openSettings')}
                    </Button>
                    <Button size="sm" variant="ghost" icon={<Clipboard className="h-3.5 w-3.5" />} onClick={() => void copyReport()}>
                      {t('feedback.copy')}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>
    </Modal>
  )
}

/** Small helper for the sidebar icon buttons' aria labels. */
export function feedbackLabel(kind: FeedbackKind): string {
  return kind === 'bug' ? 'feedback.reportBug' : 'feedback.suggest'
}

export { IconButton }
