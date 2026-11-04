import { AlertTriangle, Check, ShieldCheck, UserRound } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { nicknameErrorKey, validateNickname } from '../../../shared/validation'
import { SkinHead } from '../components/SkinPreview'
import { Button, Input, Modal } from '../components/ui'
import { useT, type TKey } from '../i18n'
import { cn } from '../lib/utils'
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
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setValue(profile?.name ?? '')
      setError(null)
      setTouched(false)
    }
  }, [open, profile?.name])

  // Live validation with the very same rules the main process applies.
  const validation = useMemo(() => validateNickname(value), [value])
  const valid = validation.ok
  const hint = validation.ok ? null : t(nicknameErrorKey(validation.error) as TKey)
  const showHint = Boolean(hint) && (touched || value.trim().length > 0)

  const save = async (): Promise<void> => {
    const check = validateNickname(value)
    if (!check.ok) {
      setTouched(true)
      setError(t(nicknameErrorKey(check.error) as TKey))
      return
    }
    setSaving(true)
    setError(null)
    try {
      await setNickname(check.name)
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
          <Button
            variant="primary"
            loading={saving}
            disabled={!valid}
            title={!valid && hint ? hint : undefined}
            onClick={() => void save()}
          >
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
          <div className="mb-2 flex items-center justify-between">
            <label className="text-[11.5px] font-medium text-muted">{t('skins.nickname')}</label>
            <span className={cn('text-[10px] tabular-nums', value.trim().length > 16 ? 'text-rose-300' : 'text-faint')}>
              {value.trim().length}/16
            </span>
          </div>
          <Input
            autoFocus
            value={value}
            maxLength={16}
            placeholder="Steve"
            aria-invalid={showHint && !valid}
            aria-describedby="nickname-hint"
            className={cn(showHint && !valid && '!border-rose-400/50 focus:!border-rose-400/70')}
            onChange={(event) => {
              setValue(event.target.value.replace(/\s/g, ''))
              setTouched(true)
              setError(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && valid) void save()
            }}
          />

          <div id="nickname-hint" className="mt-2 min-h-[18px]">
            {error ? (
              <p className="flex items-center gap-1.5 text-[11.5px] text-rose-300">
                <AlertTriangle className="h-3.5 w-3.5" /> {error}
              </p>
            ) : showHint && !valid ? (
              <p className="flex items-center gap-1.5 text-[11.5px] text-rose-300">
                <AlertTriangle className="h-3.5 w-3.5" /> {hint}
              </p>
            ) : valid ? (
              <p className="flex items-center gap-1.5 text-[11px] text-emerald-soft">
                <Check className="h-3.5 w-3.5" /> {t('profile.nicknameOk')}
              </p>
            ) : (
              <p className="text-[10.5px] text-faint">{t('profile.nicknameRules')}</p>
            )}
          </div>
        </div>

        <div className="flex w-full items-start gap-2.5 rounded-xl border border-emerald/20 bg-emerald/[0.06] px-3 py-2.5">
          <ShieldCheck className="mt-0.5 h-4 w-4 flex-none text-emerald-soft" />
          <p className="text-[11px] leading-relaxed text-emerald-soft/90">
            {t('profile.uuidHint', { name: value.trim() || 'Nick' })}
          </p>
        </div>
      </div>
    </Modal>
  )
}
