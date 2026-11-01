import { createHash } from 'node:crypto'
import { validateNickname } from '../../shared/validation'

// One source of truth for the rules: the profile modal validates with the very
// same function, so «Сохранить» is never offered for a name we would reject.
export { validateNickname }
export type { NicknameError } from '../../shared/validation'

/**
 * Offline UUID, bit-for-bit identical to Java's `UUID.nameUUIDFromBytes(("OfflinePlayer:" + name).getBytes(UTF_8))`:
 * MD5 of "OfflinePlayer:<nick>" with the RFC-4122 version (3) and variant bits patched in.
 * This is what vanilla servers in online-mode=false use to key player data and world regions.
 */
export function offlineUuid(name: string): string {
  const digest = createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest()
  const bytes = Uint8Array.from(digest)
  bytes[6] = (bytes[6] & 0x0f) | 0x30 // version 3
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // RFC 4122 variant
  const hex = Buffer.from(bytes).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Short stable fingerprint used as an offline access token (never sent to Mojang). */
export function offlineToken(uuid: string): string {
  return createHash('sha256').update(`verdant:${uuid}`).digest('hex').slice(0, 32)
}
