import { ShieldCheck, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { SkinHead } from '../components/SkinPreview'
import { Button, Input, Modal } from '../components/ui'
import { useT, type TKey } from '../i18n'
import { useAppStore } from '../store/app'

export function ProfileModal(): JSX.Element {
  const t = useT()
  const open = useAppStore((state) => state.profileModalOpen)
  const openProfileModal = useAppStore((state) => state.openProfileModal)
  const profile = useAppStore((state) => state.profile)
  const skin = useAppStore((state) => state.skin)
  const setNickname = useAppStore((state) => state.setNickname)

  const [value, setValue] = useState(profile?.name ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setValue(profile?.name ?? '')
      setError(null)
    }
  }, [open, profile?.name])

  const save = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      await setNickname(value)
      openProfileModal(false)
    } catch (err) {
      const code = (err as { code?: string }).code
      setError(code ? t(`errors.${code}` as TKey) : (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => openProfileModal(false)}
      title={t('play.profileCard')}
      subtitle={t('play.offline')}
      width="max-w-md"
      footer={
        <>
          <Button onClick={() => openProfileModal(false)}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={saving} disabled={!value.trim()} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-4 py-2">
        <div className="relative">
          <SkinHead dataUrl={skin.dataUrl} size={88} className="rounded-2xl border border-white/12 shadow-2xl" />
          <span className="absolute -bottom-2 -right-2 flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-ink-850 text-emerald-soft">
            <UserRound className="h-3.5 w-3.5" />
          </span>
        </div>

        <div className="w-full">
          <label className="mb-2 block text-[11.5px] font-medium text-muted">{t('skins.nickname')}</label>
          <Input
            autoFocus
            value={value}
            maxLength={16}
            placeholder="Steve"
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && value.trim()) void save()
            }}
          />
          {error ? <p className="mt-2 text-[11.5px] text-rose-300">{error}</p> : null}
          <p className="mt-2 text-[10.5px] text-faint">3–16 символов: A–Z, 0–9, _</p>
        </div>

        <div className="flex w-full items-start gap-2.5 rounded-xl border border-emerald/20 bg-emerald/[0.06] px-3 py-2.5">
          <ShieldCheck className="mt-0.5 h-4 w-4 flex-none text-emerald-soft" />
          <p className="text-[11px] leading-relaxed text-emerald-soft/90">
            UUID генерируется локально по стандарту Minecraft: MD5 от «OfflinePlayer:{value.trim() || 'Nick'}».
          </p>
        </div>
      </div>
    </Modal>
  )
}
