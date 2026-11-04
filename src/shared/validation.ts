/**
 * Nickname rules, shared by the renderer (live validation in the profile modal)
 * and the main process (the authoritative check before a profile is written).
 *
 * Keeping one copy means the button can never offer to save a name the backend
 * will reject — which is exactly what the `[profile:set-nickname] invalid_chars`
 * line in the launcher log was about.
 */

/** Minecraft offline-mode rules: Latin letters, digits and underscore, 3–16 chars. */
export const NICKNAME_RE = /^[A-Za-z0-9_]{3,16}$/

export type NicknameError = 'empty' | 'too_short' | 'too_long' | 'invalid_chars'

export type NicknameValidation = { ok: true; name: string } | { ok: false; error: NicknameError }

export function validateNickname(raw: string): NicknameValidation {
  const name = (raw ?? '').trim()
  if (!name) return { ok: false, error: 'empty' }
  if (name.length < 3) return { ok: false, error: 'too_short' }
  if (name.length > 16) return { ok: false, error: 'too_long' }
  if (!NICKNAME_RE.test(name)) return { ok: false, error: 'invalid_chars' }
  return { ok: true, name }
}

/** i18n key for a validation error (`errors.nickname_invalid_chars`, …). */
export function nicknameErrorKey(error: NicknameError): `errors.nickname_${NicknameError}` {
  return `errors.nickname_${error}`
}
