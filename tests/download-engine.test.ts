import { describe, expect, it } from 'vitest'
import { formatEta, formatSpeed } from '../src/shared/format'
import { Limiter, ProgressTracker, settleAll } from '../src/main/services/downloader'
import {
  getNetworkState,
  markNetworkFailure,
  markNetworkSuccess,
  resetNetworkState,
  rewriteToMirror,
  urlCandidates
} from '../src/main/services/mirror'

describe('ProgressTracker — the bar never moves backwards', () => {
  it('keeps 90% when the task graph discovers more files (the 1.1.1 bug)', () => {
    const tracker = new ProgressTracker()
    tracker.beginPhase({ key: 'libraries', from: 0, to: 100 })
    const first = tracker.report(900, 1000) // 90%
    expect(Math.round(first.percent)).toBe(90)

    // xmcl now reports a bigger total and a smaller ratio: 1400/2000 = 70%.
    const second = tracker.report(1400, 2000)
    expect(second.percent).toBeGreaterThanOrEqual(first.percent)
    expect(Math.round(second.percent)).toBe(90)
  })

  it('never returns a smaller percent for any sequence', () => {
    const tracker = new ProgressTracker()
    tracker.beginPhase({ key: 'libraries', from: 0, to: 100 })
    const samples = [
      [10, 100],
      [90, 100],
      [20, 400],
      [5, 10_000],
      [9_999, 10_000]
    ]
    let previous = -1
    for (const [done, total] of samples) {
      const snapshot = tracker.report(done, total)
      expect(snapshot.percent).toBeGreaterThanOrEqual(previous)
      previous = snapshot.percent
    }
  })

  it('maps phases onto their slice of the single bar', () => {
    const tracker = new ProgressTracker()
    tracker.beginPhase({ key: 'version', from: 3, to: 38 })
    expect(tracker.report(0, 1000).percent).toBe(3)
    expect(Math.round(tracker.report(500, 1000).percent)).toBe(21)
    tracker.beginPhase({ key: 'libraries', from: 55, to: 96 })
    expect(tracker.report(0, 100).percent).toBeGreaterThanOrEqual(55)
  })

  it('computes a speed and a remaining time once bytes flow', () => {
    let now = 0
    const tracker = new ProgressTracker(() => now)
    tracker.beginPhase({ key: 'libraries', from: 0, to: 100 })
    tracker.report(0, 10_000_000)
    now = 1000
    tracker.report(1_000_000, 10_000_000)
    now = 2000
    const snapshot = tracker.report(2_000_000, 10_000_000)
    expect(snapshot.bytesPerSecond).toBeGreaterThan(0)
    expect(snapshot.etaSeconds).toBeGreaterThan(0)
  })

  it('reports no ETA while the speed is unknown', () => {
    const tracker = new ProgressTracker()
    tracker.beginPhase({ key: 'libraries', from: 0, to: 100 })
    expect(tracker.report(10, 1000).etaSeconds).toBeNull()
  })
})

describe('Limiter', () => {
  it('never runs more than `limit` tasks at once', async () => {
    const limiter = new Limiter(4)
    let active = 0
    let peak = 0
    await Promise.all(
      Array.from({ length: 40 }, () =>
        limiter.run(async () => {
          active += 1
          peak = Math.max(peak, active)
          await new Promise((resolve) => setTimeout(resolve, 3))
          active -= 1
        })
      )
    )
    expect(peak).toBeLessThanOrEqual(4)
    expect(peak).toBeGreaterThan(1)
  })

  it('isolates failures: one rejected item does not stop the rest', async () => {
    const items = [1, 2, 3, 4, 5]
    const seen: number[] = []
    const result = await settleAll(items, 3, async (item) => {
      if (item === 3) throw new Error('boom')
      seen.push(item)
    })
    expect(result.ok).toBe(4)
    expect(result.failed).toHaveLength(1)
    expect(seen.sort()).toEqual([1, 2, 4, 5])
  })
})

describe('BMCLAPI mirror', () => {
  it('rewrites every blocked Mojang host', () => {
    expect(rewriteToMirror('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json')).toBe(
      'https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json'
    )
    expect(rewriteToMirror('https://piston-data.mojang.com/v1/objects/abc/client.jar')).toBe(
      'https://bmclapi2.bangbang93.com/v1/objects/abc/client.jar'
    )
    expect(rewriteToMirror('https://libraries.minecraft.net/com/google/guava/guava-31.jar')).toBe(
      'https://bmclapi2.bangbang93.com/maven/com/google/guava/guava-31.jar'
    )
    expect(rewriteToMirror('https://resources.download.minecraft.net/ab/abcdef')).toBe(
      'https://bmclapi2.bangbang93.com/assets/ab/abcdef'
    )
    expect(rewriteToMirror('https://maven.fabricmc.net/net/fabricmc/loader/0.15.0/loader.jar')).toBe(
      'https://bmclapi2.bangbang93.com/maven/net/fabricmc/loader/0.15.0/loader.jar'
    )
    expect(rewriteToMirror('https://meta.fabricmc.net/v2/versions/loader')).toBe(
      'https://bmclapi2.bangbang93.com/fabric-meta/v2/versions/loader'
    )
    expect(rewriteToMirror('https://maven.minecraftforge.net/net/minecraftforge/forge/1.20.1/x.jar')).toBe(
      'https://bmclapi2.bangbang93.com/maven/net/minecraftforge/forge/1.20.1/x.jar'
    )
  })

  it('leaves unrelated hosts alone', () => {
    expect(rewriteToMirror('https://api.modrinth.com/v2/project/fabric-api')).toBe(
      'https://api.modrinth.com/v2/project/fabric-api'
    )
    expect(rewriteToMirror('https://cdn.modrinth.com/data/x/versions/y.jar')).toBe(
      'https://cdn.modrinth.com/data/x/versions/y.jar'
    )
  })

  it('prefers the official host until the session flips to the mirror', () => {
    resetNetworkState()
    const url = 'https://piston-data.mojang.com/v1/objects/abc/client.jar'
    expect(urlCandidates(url)[0]).toBe(url)
    expect(getNetworkState().mode).toBe('unknown')
  })

  it('switches every later request to BMCLAPI after repeated failures', () => {
    resetNetworkState()
    const url = 'https://libraries.minecraft.net/com/google/guava/guava-31.jar'
    markNetworkFailure('connect ETIMEDOUT')
    markNetworkFailure('connect ETIMEDOUT')
    expect(getNetworkState().mode).toBe('mirror')
    const candidates = urlCandidates(url)
    expect(candidates[0]).toBe('https://bmclapi2.bangbang93.com/maven/com/google/guava/guava-31.jar')
    // the official URL stays as a fallback, never disappears
    expect(candidates[1]).toBe(url)
    // and a single success does not flip us back
    markNetworkSuccess(true)
    expect(urlCandidates(url)[0]).toContain('bmclapi')
    resetNetworkState()
  })
})

describe('formatting', () => {
  it('prints megabytes per second', () => {
    expect(formatSpeed(5 * 1024 * 1024)).toBe('5.0 МБ/с')
    expect(formatSpeed(0)).toBe('0 КБ/с')
    expect(formatSpeed(2048)).toBe('2 КБ/с')
  })

  it('prints a human ETA', () => {
    expect(formatEta(42)).toBe('42 с')
    expect(formatEta(125)).toBe('2:05')
    expect(formatEta(null)).toBe('—')
  })
})

describe('resumable streaming downloads', () => {
  const PAYLOAD = Buffer.alloc(512 * 1024)
  for (let i = 0; i < PAYLOAD.length; i++) PAYLOAD[i] = i % 251

  async function serve(handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void) {
    const { createServer } = await import('node:http')
    const server = createServer(handler)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    return { server, base: `http://127.0.0.1:${port}` }
  }

  it('continues a .part file with a Range request instead of restarting', async () => {
    const { downloadFile } = await import('../src/main/services/downloader')
    const { mkdtemp, readFile, writeFile, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const ranges: Array<string | undefined> = []
    const { server, base } = await serve((req, res) => {
      ranges.push(req.headers.range)
      const match = /bytes=(\d+)-/.exec(req.headers.range ?? '')
      const start = match ? Number(match[1]) : 0
      res.writeHead(match ? 206 : 200, {
        'content-length': String(PAYLOAD.length - start),
        'content-type': 'application/octet-stream'
      })
      res.end(PAYLOAD.subarray(start))
    })
    const dir = await mkdtemp(join(tmpdir(), 'verdant-resume-'))
    const target = join(dir, 'blob.bin')
    try {
      await writeFile(`${target}.part`, PAYLOAD.subarray(0, 200 * 1024))
      const outcome = await downloadFile({ url: `${base}/blob.bin`, destination: target, name: 'blob.bin' }, { retries: 1 })
      expect(outcome).toBe('downloaded')
      expect(ranges[0]).toBe(`bytes=${200 * 1024}-`)
      const saved = await readFile(target)
      expect(saved.length).toBe(PAYLOAD.length)
      expect(saved.equals(PAYLOAD)).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
      server.close()
    }
  })

  it('follows redirects (the mirror answers with 302 to its CDN)', async () => {
    const { keepAliveFetch } = await import('../src/main/services/downloader')
    const { server, base } = await serve((req, res) => {
      if (req.url === '/redirect') {
        res.writeHead(302, { location: '/real' })
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('verdant')
    })
    try {
      const response = await keepAliveFetch(`${base}/redirect`)
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('verdant')
    } finally {
      server.close()
    }
  })
})
