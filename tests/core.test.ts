import { describe, expect, it } from 'vitest'
import { offlineToken, offlineUuid, validateNickname } from '../src/main/services/offline'
import { compareVersionsDesc, neoForgePrefix, parseMavenVersions } from '../src/main/services/versions'
import { splitArgs, buildJvmArgs } from '../src/main/services/launch'
import { readPngSize } from '../src/main/services/profile'
import { requiredJavaMajor } from '../src/main/services/installer'
import { DEFAULT_EXTRA_JVM_ARGS } from '@xmcl/core'

describe('offline account', () => {
  it('generates the same UUID as Java for offline players', () => {
    // UUID.nameUUIDFromBytes("OfflinePlayer:Notch".getBytes(UTF_8))
    expect(offlineUuid('Notch')).toBe('b50ad385-829d-3141-a216-7e7d7539ba7f')
  })

  it('is deterministic and format-correct', () => {
    const uuid = offlineUuid('Steve_123')
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(offlineUuid('Steve_123')).toBe(uuid)
    expect(offlineUuid('Alex')).not.toBe(uuid)
  })

  it('produces a stable non-empty access token', () => {
    const token = offlineToken(offlineUuid('Notch'))
    expect(token).toHaveLength(32)
    expect(token).toBe(offlineToken(offlineUuid('Notch')))
  })

  it('validates nicknames like Minecraft does', () => {
    expect(validateNickname('Notch')).toEqual({ ok: true, name: 'Notch' })
    expect(validateNickname('  Steve_  ')).toEqual({ ok: true, name: 'Steve_' })
    expect(validateNickname('')).toEqual({ ok: false, error: 'empty' })
    expect(validateNickname('ab')).toEqual({ ok: false, error: 'too_short' })
    expect(validateNickname('a'.repeat(17))).toEqual({ ok: false, error: 'too_long' })
    expect(validateNickname('Плохой Ник')).toEqual({ ok: false, error: 'invalid_chars' })
  })
})

describe('maven metadata parsing', () => {
  it('extracts versions from forge metadata', () => {
    const xml = `<metadata><versioning><versions>
      <version>1.20.1-47.2.0</version>
      <version>1.21.1-52.0.1</version>
      <version>1.21.1-52.0.2</version>
    </versions></versioning></metadata>`
    expect(parseMavenVersions(xml)).toEqual(['1.20.1-47.2.0', '1.21.1-52.0.1', '1.21.1-52.0.2'])
  })

  it('sorts semantic-ish loader versions descending', () => {
    const sorted = ['0.9.9', '0.16.10', '0.16.9', '0.15.11'].sort(compareVersionsDesc)
    expect(sorted[0]).toBe('0.16.10')
    expect(sorted[1]).toBe('0.16.9')
    expect(sorted[3]).toBe('0.9.9')
  })

  it('maps Minecraft versions to NeoForge prefixes', () => {
    expect(neoForgePrefix('1.21.1')).toBe('21.1.')
    expect(neoForgePrefix('1.20.4')).toBe('20.4.')
    expect(neoForgePrefix('1.20.1')).toBe('47.1.')
  })
})

describe('launch arguments', () => {
  it('splits quoted jvm args', () => {
    expect(splitArgs('-XX:+UseG1GC -Dfoo="a b" --bar')).toEqual(['-XX:+UseG1GC', '-Dfoo=a b', '--bar'])
    expect(splitArgs('')).toEqual([])
  })

  it('keeps minecraft gc flags but drops the default -Xmx', () => {
    const args = buildJvmArgs('')
    expect(args).not.toContain('-Xmx2G')
    expect(args).toContain('-XX:+UseG1GC')
    expect(args).toContain('-XX:+UnlockExperimentalVMOptions')
    for (const flag of DEFAULT_EXTRA_JVM_ARGS) {
      if (flag !== '-Xmx2G') expect(args).toContain(flag)
    }
  })

  it('lets the user override the garbage collector', () => {
    const args = buildJvmArgs('-XX:+UseZGC')
    expect(args).toContain('-XX:+UseZGC')
    expect(args.some((flag) => flag.includes('UseG1GC'))).toBe(false)
  })
})

describe('png header parsing', () => {
  const png = (width: number, height: number): Buffer => {
    const buffer = Buffer.alloc(26)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0)
    buffer.writeUInt32BE(13, 8)
    buffer.write('IHDR', 12, 'ascii')
    buffer.writeUInt32BE(width, 16)
    buffer.writeUInt32BE(height, 20)
    return buffer
  }

  it('reads 64x64 skins', () => {
    expect(readPngSize(png(64, 64))).toEqual({ width: 64, height: 64 })
  })

  it('reads legacy 64x32 skins', () => {
    expect(readPngSize(png(64, 32))).toEqual({ width: 64, height: 32 })
  })

  it('rejects non-png data', () => {
    expect(readPngSize(Buffer.from('not a png at all, definitely not'))).toBeNull()
  })
})

describe('java requirement heuristics', () => {
  it('maps modern versions to java 21/17/8', () => {
    expect(requiredJavaMajor('1.21.4')).toBe(21)
    expect(requiredJavaMajor('1.20.5')).toBe(21)
    expect(requiredJavaMajor('1.20.1')).toBe(17)
    expect(requiredJavaMajor('1.18.2')).toBe(17)
    expect(requiredJavaMajor('1.16.5')).toBe(8)
    expect(requiredJavaMajor('1.12.2')).toBe(8)
  })
})
