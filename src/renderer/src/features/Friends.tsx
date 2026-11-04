import { Check, Copy, Gamepad2, Trash2, UserPlus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ScreenHeader } from '../components/layout'
import { Badge, Button, Input, Panel, SectionTitle } from '../components/ui'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { useAppStore } from '../store/app'
import type { FriendsState } from '../../../shared/types'

export function FriendsScreen(): JSX.Element {
  const t = useT()
  const pushToast = useAppStore((state) => state.pushToast)
  const toastError = useAppStore((state) => state.toastError)

  const [state, setState] = useState<FriendsState | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let alive = true
    void api.friends
      .state()
      .then((next) => {
        if (alive) setState(next)
      })
      .catch((error) => toastError(error))
    const off = api.friends.onChange((next) => {
      if (alive) setState(next)
    })
    return () => {
      alive = false
      off()
    }
  }, [toastError])

  const run = async (key: string, action: () => Promise<unknown>, okToast?: string): Promise<boolean> => {
    setBusy(key)
    try {
      await action()
      if (okToast) pushToast({ kind: 'success', titleKey: okToast })
      return true
    } catch (error) {
      toastError(error)
      return false
    } finally {
      setBusy(null)
    }
  }

  const copyCode = async (): Promise<void> => {
    if (!state) return
    try {
      await navigator.clipboard.writeText(state.code)
      setCopied(true)
      pushToast({ kind: 'success', titleKey: 'friends.copied' })
      window.setTimeout(() => setCopied(false), 1500)
    } catch (error) {
      toastError(error)
    }
  }

  const sendRequest = async (): Promise<void> => {
    const value = code.trim()
    if (!value) return
    const ok = await run('add', () => api.friends.sendRequest(value), 'friends.requestSent')
    if (ok) setCode('')
  }

  const join = async (inviteId: string): Promise<void> => {
    setBusy(`join:${inviteId}`)
    try {
      const result = await api.friends.join(inviteId)
      if (!result.ok) toastError({ code: result.error ?? 'unknown' })
    } catch (error) {
      toastError(error)
    } finally {
      setBusy(null)
    }
  }

  const header = (
    <ScreenHeader eyebrow={t('nav.friends')} title={t('friends.title')} description={t('friends.subtitle')} />
  )

  if (!state) {
    return <div className="px-7 py-6">{header}</div>
  }

  if (!state.enabled) {
    return (
      <div className="px-7 py-6">
        {header}
        <Panel className="p-6">
          <SectionTitle title={t('friends.enableTitle')} />
          <p className="mb-5 max-w-2xl text-[13px] leading-relaxed text-muted">{t('friends.enableHint')}</p>
          <Button
            variant="primary"
            loading={busy === 'enable'}
            onClick={() => void run('enable', () => api.friends.setEnabled(true))}
          >
            {t('friends.enable')}
          </Button>
        </Panel>
      </div>
    )
  }

  const nameOf = (id: string): string => state.friends.find((friend) => friend.id === id)?.name ?? id.slice(0, 8)

  return (
    <div className="px-7 py-6">
      {header}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div className="flex flex-col gap-5">
          <Panel className="p-6">
            <SectionTitle
              title={t('friends.myCode')}
              action={
                state.error ? (
                  <Badge tone="danger">{t('friends.error')}</Badge>
                ) : (
                  <Badge tone={state.connected ? 'emerald' : 'default'}>
                    {state.connected ? t('friends.connected') : t('friends.connecting')}
                  </Badge>
                )
              }
            />
            {!state.name ? <p className="mb-3 text-[12.5px] text-gold">{t('friends.needNick')}</p> : null}
            <div className="flex items-center gap-2">
              <Input readOnly value={state.code} className="font-mono text-[12px]" onFocus={(event) => event.currentTarget.select()} />
              <Button
                icon={copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                onClick={() => void copyCode()}
              >
                {t('friends.copy')}
              </Button>
            </div>
            <p className="mt-3 text-[12px] text-faint">{t('friends.myCodeHint')}</p>
            <div className="mt-5">
              <Button variant="subtle" size="sm" onClick={() => void run('disable', () => api.friends.setEnabled(false))}>
                {t('friends.disable')}
              </Button>
            </div>
          </Panel>

          <Panel className="p-6">
            <SectionTitle title={t('friends.addTitle')} />
            <div className="flex items-center gap-2">
              <Input
                value={code}
                placeholder={t('friends.addPlaceholder')}
                className="font-mono text-[12px]"
                onChange={(event) => setCode(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void sendRequest()
                }}
              />
              <Button
                variant="primary"
                icon={<UserPlus className="h-4 w-4" />}
                loading={busy === 'add'}
                disabled={!code.trim()}
                onClick={() => void sendRequest()}
              >
                {t('friends.add')}
              </Button>
            </div>

            {state.incoming.length > 0 ? (
              <div className="mt-6">
                <div className="eyebrow mb-2">{t('friends.requests')}</div>
                <div className="flex flex-col gap-2">
                  {state.incoming.map((request) => (
                    <div key={request.id} className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.03] px-4 py-3">
                      <span className="truncate text-[13.5px] text-text">{request.name}</span>
                      <div className="flex shrink-0 gap-2">
                        <Button
                          variant="primary"
                          size="sm"
                          icon={<Check className="h-3.5 w-3.5" />}
                          onClick={() => void run(`acc:${request.id}`, () => api.friends.accept(request.id))}
                        >
                          {t('friends.accept')}
                        </Button>
                        <Button
                          size="sm"
                          icon={<X className="h-3.5 w-3.5" />}
                          onClick={() => void run(`dec:${request.id}`, () => api.friends.decline(request.id))}
                        >
                          {t('friends.decline')}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {state.outgoing.length > 0 ? (
              <div className="mt-6">
                <div className="eyebrow mb-2">{t('friends.sent')}</div>
                <div className="flex flex-col gap-2">
                  {state.outgoing.map((request) => (
                    <div key={request.id} className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.03] px-4 py-3">
                      <span className="truncate font-mono text-[12px] text-muted">{request.id.slice(0, 16)}…</span>
                      <Button size="sm" onClick={() => void run(`can:${request.id}`, () => api.friends.cancel(request.id))}>
                        {t('friends.cancel')}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </Panel>
        </div>

        <div className="flex flex-col gap-5">
          {state.invites.length > 0 ? (
            <Panel className="p-6">
              <SectionTitle title={t('friends.invites')} />
              <div className="flex flex-col gap-2">
                {state.invites.map((invite) => (
                  <div key={invite.id} className="flex items-center justify-between gap-3 rounded-2xl bg-emerald/10 px-4 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-[13.5px] text-text">
                        {invite.fromName || nameOf(invite.from)} {t('friends.inviteFrom')}
                      </div>
                      <div className="text-[11.5px] text-faint">
                        {invite.mcVersion} · {invite.loader}
                      </div>
                    </div>
                    <Button
                      variant="primary"
                      size="sm"
                      icon={<Gamepad2 className="h-3.5 w-3.5" />}
                      loading={busy === `join:${invite.id}`}
                      onClick={() => void join(invite.id)}
                    >
                      {t('friends.join')}
                    </Button>
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}

          <Panel className="p-6">
            <SectionTitle title={t('friends.hostTitle')} />
            {state.hosting ? (
              <>
                <div className="mb-3 flex items-center gap-2">
                  <Badge tone="emerald">{t('friends.hostActive')}</Badge>
                  <span className="text-[12px] text-faint">
                    {state.hosting.mcVersion} · {state.hosting.loader}
                  </span>
                </div>
                <Button variant="danger" loading={busy === 'stopHost'} onClick={() => void run('stopHost', () => api.friends.stopHosting())}>
                  {t('friends.hostStop')}
                </Button>
              </>
            ) : state.lanPort ? (
              <>
                <p className="mb-4 text-[13px] text-muted">{t('friends.hostReady')}</p>
                <Button
                  variant="primary"
                  loading={busy === 'startHost'}
                  disabled={state.friends.length === 0}
                  onClick={() => void run('startHost', () => api.friends.startHosting())}
                >
                  {t('friends.hostStart')}
                </Button>
              </>
            ) : (
              <>
                <p className="mb-2 text-[13px] text-muted">{t('friends.hostWaiting')}</p>
                <p className="text-[12px] text-faint">{t('friends.hostHint')}</p>
              </>
            )}
            <p className="mt-4 text-[11.5px] leading-relaxed text-faint">{t('friends.hostWarn')}</p>
          </Panel>

          <Panel className="p-6">
            <SectionTitle title={t('friends.list')} />
            {state.friends.length === 0 ? (
              <p className="text-[13px] text-muted">{t('friends.empty')}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {state.friends.map((friend) => (
                  <div key={friend.id} className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.03] px-4 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="truncate text-[13.5px] text-text">{friend.name}</span>
                      <Badge tone={friend.online ? 'emerald' : 'default'}>
                        {friend.online ? t('friends.online') : t('friends.offline')}
                      </Badge>
                    </div>
                    <Button
                      variant="subtle"
                      size="sm"
                      icon={<Trash2 className="h-3.5 w-3.5" />}
                      onClick={() => void run(`rm:${friend.id}`, () => api.friends.remove(friend.id))}
                    >
                      {t('friends.remove')}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}
