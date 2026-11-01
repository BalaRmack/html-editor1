import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  decideUpdate,
  isNewerVersion,
  normalizeRelease,
  parseVersion,
  pickInstallerAsset,
  releaseKey,
  type GitHubRelease
} from '../src/main/services/update-logic'

/** A realistic GitHub `releases/latest` payload. */
const release: GitHubRelease = {
  tag_name: 'v1.2.0',
  name: 'Verdant Launcher 1.2.0',
  body: '### Что нового\n- Авто-обновления\n- Splash screen',
  html_url: 'https://github.com/BalaRmack/html-editor1/releases/tag/v1.2.0',
  published_at: '2026-11-01T10:00:00Z',
  draft: false,
  assets: [
    {
      name: 'Verdant-Launcher-1.2.0-Setup.exe.blockmap',
      browser_download_url: 'https://example.invalid/b.blockmap',
      size: 100
    },
    {
      name: 'Verdant-Launcher-1.2.0-Setup.exe',
      browser_download_url: 'https://example.invalid/setup.exe',
      size: 122_000_000
    },
    { name: 'latest.yml', browser_download_url: 'https://example.invalid/latest.yml', size: 512 }
  ]
}

describe('parseVersion', () => {
  it('reads plain, prefixed and partial versions', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3])
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3])
    expect(parseVersion('v1.2')).toEqual([1, 2])
    expect(parseVersion('  V10 ')).toEqual([10])
  })

  it('sorts prereleases below the matching release', () => {
    expect(parseVersion('1.2.0-beta.1')).toEqual([1, 2, 0, -1])
    expect(parseVersion('1.2.0+build.7')).toEqual([1, 2, 0, -1])
    expect(isNewerVersion('1.2.0', '1.2.0-beta.1')).toBe(true)
  })

  it('rejects non-numeric tags', () => {
    expect(parseVersion('')).toBeNull()
    expect(parseVersion('latest')).toBeNull()
    expect(parseVersion('v1.x.0')).toBeNull()
  })
})

describe('compareVersions', () => {
  it('treats missing segments as zero', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
    expect(compareVersions('v1.2.1', '1.2.0')).toBe(1)
    expect(compareVersions('1.1.9', '1.2.0')).toBe(-1)
  })

  it('compares each segment numerically, not lexicographically', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1)
    expect(compareVersions('0.9.0', '0.10.0')).toBe(-1)
  })

  it('never claims an update for garbage', () => {
    expect(compareVersions('garbage', 'garbage')).toBe(0)
    expect(isNewerVersion('garbage', '1.0.0')).toBe(false)
  })
})

describe('pickInstallerAsset', () => {
  it('prefers the setup exe over the blockmap', () => {
    expect(pickInstallerAsset(release.assets)?.name).toBe('Verdant-Launcher-1.2.0-Setup.exe')
  })

  it('falls back to the first exe and skips blockmaps', () => {
    expect(
      pickInstallerAsset([
        { name: 'app.exe.blockmap', browser_download_url: 'a' },
        { name: 'app.exe', browser_download_url: 'b' }
      ])?.browser_download_url
    ).toBe('b')
  })

  it('returns null when the release has no installer', () => {
    expect(pickInstallerAsset([{ name: 'latest.yml' }])).toBeNull()
    expect(pickInstallerAsset([])).toBeNull()
    expect(pickInstallerAsset(undefined)).toBeNull()
  })
})

describe('normalizeRelease', () => {
  it('maps a GitHub payload to the UI shape', () => {
    const result = normalizeRelease(release)
    expect(result).not.toBeNull()
    expect(result).toMatchObject({
      version: '1.2.0',
      tag: 'v1.2.0',
      name: 'Verdant Launcher 1.2.0',
      assetName: 'Verdant-Launcher-1.2.0-Setup.exe',
      assetUrl: 'https://example.invalid/setup.exe',
      sizeBytes: 122_000_000
    })
    expect(result?.notes).toContain('Splash screen')
  })

  it('ignores drafts, untagged and unparsable releases', () => {
    expect(normalizeRelease(null)).toBeNull()
    expect(normalizeRelease({ ...release, draft: true })).toBeNull()
    expect(normalizeRelease({ ...release, tag_name: undefined })).toBeNull()
    expect(normalizeRelease({ ...release, tag_name: 'nightly' })).toBeNull()
  })

  it('falls back to a generated title and truncates huge notes', () => {
    const result = normalizeRelease({ tag_name: 'v2.0.0', body: 'x'.repeat(9000), assets: [] })
    expect(result?.name).toBe('Verdant Launcher 2.0.0')
    expect(result?.notes).toHaveLength(4000)
    expect(result?.assetName).toBeNull()
  })
})

describe('decideUpdate', () => {
  const normalized = normalizeRelease(release)

  it('notifies about a newer release', () => {
    expect(decideUpdate({ release: normalized, currentVersion: '1.1.0' })).toBe('notify')
  })

  it('stays quiet when the installed build is current or newer', () => {
    expect(decideUpdate({ release: normalized, currentVersion: '1.2.0' })).toBe('up-to-date')
    expect(decideUpdate({ release: normalized, currentVersion: '1.3.0' })).toBe('up-to-date')
  })

  it('honours a skipped version until another release appears', () => {
    expect(decideUpdate({ release: normalized, currentVersion: '1.1.0', skippedVersion: '1.2.0' })).toBe('skipped')
    expect(decideUpdate({ release: normalized, currentVersion: '1.1.0', skippedVersion: 'v1.2.0' })).toBe('skipped')
    expect(decideUpdate({ release: normalized, currentVersion: '1.1.0', skippedVersion: '1.0.9' })).toBe('notify')
  })

  it('hides a deferred release until the next launch', () => {
    expect(decideUpdate({ release: normalized, currentVersion: '1.1.0', deferred: true })).toBe('deferred')
    // Skipping any version wins over a deferral.
    expect(
      decideUpdate({ release: normalized, currentVersion: '1.1.0', deferred: true, skippedVersion: '1.2.0' })
    ).toBe('skipped')
  })

  it('reports up-to-date when GitHub is unreachable but a cached release already applies', () => {
    expect(decideUpdate({ release: null, currentVersion: '1.1.0' })).toBe('up-to-date')
  })
})

describe('releaseKey', () => {
  it('is stable for the same tag+size and empty without a release', () => {
    const a = normalizeRelease(release)
    const b = normalizeRelease(release)
    expect(releaseKey(a)).toBe(releaseKey(b))
    expect(releaseKey(a)).toBe('v1.2.0:122000000')
    expect(releaseKey(null)).toBe('')
  })
})
