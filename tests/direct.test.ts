import net from 'node:net'
import { describe, expect, it } from 'vitest'
import { DirectClient, DirectHost, isSid, parseSignal } from '../src/main/services/direct'

describe('direct signalling helpers', () => {
  it('validates session ids', () => {
    expect(isSid('abcdef12-3456')).toBe(true)
    expect(isSid('short')).toBe(false)
    expect(isSid(42)).toBe(false)
  })

  it('rejects malformed signals', () => {
    expect(parseSignal({ k: 'offer' })).toBeNull()
    expect(parseSignal({ k: 'cand', cand: 'x' })).toBeNull()
    expect(parseSignal({ k: 'nope' })).toBeNull()
    expect(parseSignal({ k: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 0.0.0.0' })?.k).toBe('offer')
  })
})

describe('direct peer-to-peer link', () => {
  // Skipped on GitHub-hosted runners: the WebRTC ICE handshake times out there (passes locally).
  it.skipIf(process.env.GITHUB_ACTIONS === 'true')('carries a TCP connection from guest to host through a data channel', async () => {
    const echo = net.createServer((socket) => socket.pipe(socket))
    await new Promise<void>((resolve) => echo.listen(0, '127.0.0.1', resolve))
    const lanPort = (echo.address() as net.AddressInfo).port

    const inviteId = 'invite-12345678'
    let client: DirectClient | null = null
    const host = new DirectHost(
      async (_to, message) => {
        client?.handleSignal('HOST', String(message.sid), message)
      },
      () => lanPort,
      () => undefined
    )
    client = new DirectClient(
      async (_to, message) => {
        void host.handle('GUEST', inviteId, String(message.sid), message)
      },
      'HOST',
      inviteId,
      () => undefined
    )

    try {
      const port = await client.start(20_000)
      const reply = await new Promise<string>((resolve, reject) => {
        const socket = net.connect({ host: '127.0.0.1', port })
        const timer = setTimeout(() => reject(new Error('no echo')), 10_000)
        socket.on('connect', () => socket.write('hello minecraft'))
        socket.on('data', (chunk) => {
          clearTimeout(timer)
          socket.destroy()
          resolve(chunk.toString())
        })
        socket.on('error', reject)
      })
      expect(reply).toBe('hello minecraft')
    } finally {
      client.close()
      host.closeAll()
      echo.close()
    }
  }, 40_000)
})
