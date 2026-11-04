import { describe, expect, it } from 'vitest'
import { joinLaunchOptions } from '../src/main/services/launch'

describe('joinLaunchOptions', () => {
  it('uses --server for versions older than 1.20', () => {
    for (const version of ['1.8.9', '1.12.2', '1.16.5', '1.19.4']) {
      expect(joinLaunchOptions(version, 'bore.pub', 28206)).toEqual({ server: { ip: 'bore.pub', port: 28206 } })
    }
  })

  it('uses quick play for 1.20 and newer releases', () => {
    for (const version of ['1.20', '1.20.1', '1.21.4']) {
      expect(joinLaunchOptions(version, 'bore.pub', 28206)).toEqual({ quickPlayMultiplayer: 'bore.pub:28206' })
    }
  })

  it('treats 23w+ snapshots as modern and older snapshots as legacy', () => {
    expect(joinLaunchOptions('23w31a', 'h', 1)).toEqual({ quickPlayMultiplayer: 'h:1' })
    expect(joinLaunchOptions('22w45a', 'h', 1)).toEqual({ server: { ip: 'h', port: 1 } })
  })

  it('falls back to --server for unknown version strings', () => {
    expect(joinLaunchOptions('weird-version', 'h', 1)).toEqual({ server: { ip: 'h', port: 1 } })
  })
})
