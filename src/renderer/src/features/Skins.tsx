import { motion } from 'framer-motion'
import { ImageUp, RefreshCw, ShieldCheck, Trash2, UserRound } from 'lucide-react'
import { useRef, useState } from 'react'
import { ScreenHeader } from '../components/layout'
import { SkinHead, SkinPreview } from '../components/SkinPreview'
import { Badge, Button, KeyValue, Panel, SectionTitle } from '../components/ui'
import { useT } from '../i18n'
import { api } from '../lib/api'
import { cn } from '../lib/utils'
import { useAppStore } from '../store/app'

export function SkinsScreen(): JSX.Element {
  const t = useT()
  const profile = useAppStore((state) => state.profile)
  const skin = useAppStore((state) => state.skin)
  const refreshSkin = useAppStore((state) => state.refreshSkin)
  const openProfileModal = useAppStore((state) => state.openProfileModal)
  const pushToast = useAppStore((state) => state.pushToast)
  const toastError = useAppStore((state) => state.toastError)

  const [dragActive, setDragActive] = useState(false)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const applySkin = async (data: Uint8Array): Promise<void> => {
    setBusy(true)
    try {
      await api.profile.setSkinBytes(data)
      await refreshSkin()
      pushToast({ kind: 'success', titleKey: 'toast.skinSaved' })
    } catch (error) {
      toastError(error)
    } finally {
      setBusy(false)
    }
  }

  const onFiles = async (files: FileList | null): Promise<void> => {
    const file = files?.[0]
    if (!file) return
    if (!file.type.includes('png') && !file.name.toLowerCase().endsWith('.png')) {
      pushToast({ kind: 'warning', titleKey: 'common.retry', description: t('skins.invalid') })
      return
    }
    const buffer = new Uint8Array(await file.arrayBuffer())
    await applySkin(buffer)
  }

  return (
    <div className="px-7 py-6">
      <ScreenHeader
        eyebrow={t('nav.skins')}
        title={t('skins.title')}
        description={t('skins.subtitle')}
        action={
          <Button icon={<UserRound className="h-4 w-4" />} onClick={() => openProfileModal(true)}>
            {t('skins.change')}
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <Panel className="relative overflow-hidden p-6">
          <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-emerald/20 blur-[80px]" />
          <SectionTitle eyebrow={profile?.name ?? t('top.noProfile')} title={t('skins.preview')} />
          <div className="mt-2 flex items-end justify-center gap-10 py-4">
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center gap-2">
              <div className="skin-checker rounded-2xl border border-white/[0.07] bg-black/25 p-3">
                <SkinPreview dataUrl={skin.dataUrl} view="front" unit={7} />
              </div>
              <span className="text-[10.5px] uppercase tracking-wider text-faint">{t('skins.front')}</span>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.06 }}
              className="flex flex-col items-center gap-2"
            >
              <div className="skin-checker rounded-2xl border border-white/[0.07] bg-black/25 p-3">
                <SkinPreview dataUrl={skin.dataUrl} view="back" unit={7} />
              </div>
              <span className="text-[10.5px] uppercase tracking-wider text-faint">{t('skins.back')}</span>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12 }}
              className="flex flex-col items-center gap-2 pb-1"
            >
              <SkinHead dataUrl={skin.dataUrl} size={76} className="rounded-2xl border border-white/10 shadow-xl" />
              <span className="text-[10.5px] uppercase tracking-wider text-faint">{t('skins.head')}</span>
            </motion.div>
          </div>

          <div
            className={cn(
              'mt-4 flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed border-white/15 bg-white/[0.02] px-5 py-6 text-center transition',
              dragActive && 'drag-over',
              !profile && 'pointer-events-none opacity-50'
            )}
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault()
              setDragActive(true)
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragActive(false)
              void onFiles(event.dataTransfer.files)
            }}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald/10 text-emerald-soft">
              <ImageUp className="h-5 w-5" />
            </div>
            <div className="text-[12px] text-text">{profile ? t('skins.upload') : t('skins.noProfile')}</div>
            <div className="text-[10.5px] text-faint">{t('skins.dropHint')}</div>
            <input
              ref={inputRef}
              type="file"
              accept="image/png"
              className="hidden"
              onChange={(event) => void onFiles(event.target.files)}
            />
          </div>
        </Panel>

        <div className="space-y-5">
          <Panel className="p-5">
            <SectionTitle eyebrow={t('play.offline')} title={t('skins.nickname')} />
            <div className="flex items-center gap-3">
              <SkinHead dataUrl={skin.dataUrl} size={46} />
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold text-text">{profile?.name ?? '—'}</div>
                <div className="truncate font-mono text-[10.5px] text-faint">{profile?.uuid ?? '—'}</div>
              </div>
            </div>
            <div className="mt-4 space-y-1">
              <KeyValue label={t('skins.uuid')} value={<span className="font-mono text-[10.5px]">{profile?.uuid?.slice(0, 18) ?? '—'}…</span>} />
              <KeyValue label={t('skins.variant')} value={t('skins.variant.classic')} />
              <KeyValue
                label={t('skins.preview')}
                value={skin.dataUrl ? <Badge tone="emerald">{t('common.installed')}</Badge> : <Badge>{t('skins.empty')}</Badge>}
              />
            </div>
            <div className="mt-4 flex gap-2">
              <Button
                className="flex-1"
                icon={<RefreshCw className="h-4 w-4" />}
                loading={busy}
                disabled={!profile}
                onClick={async () => {
                  setBusy(true)
                  try {
                    const next = await api.profile.setSkin()
                    if (next) await refreshSkin()
                  } catch (error) {
                    toastError(error)
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                {t('skins.upload')}
              </Button>
              <Button
                variant="danger"
                icon={<Trash2 className="h-4 w-4" />}
                disabled={!skin.dataUrl}
                onClick={async () => {
                  await api.profile.removeSkin()
                  await refreshSkin()
                }}
              >
                {t('skins.remove')}
              </Button>
            </div>
          </Panel>

          <Panel className="p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-emerald/10 text-emerald-soft">
                <ShieldCheck className="h-4.5 w-4.5" />
              </div>
              <div>
                <div className="text-[12.5px] font-medium text-text">{t('play.offline')}</div>
                <p className="mt-1 text-[11.5px] leading-relaxed text-muted">{t('skins.onlineNote')}</p>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
