import net from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectLogin, openTunnel, parseLanPort, type TunnelHandle } from '../src/main/services/tunnel'

function varint(value: number): Buffer {
  const bytes: number[] = []
  let v = value
  do {
    let byte = v & 0x7f
    v >>>= 7
    if (v !== 0) byte |= 0x80
    bytes.push(byte)
  } while (v !== 0)
  return Buffer.from(bytes)
}

const str = (s: string): Buffer => Buffer.concat([varint(Buffer.byteLength(s)), Buffer.from(s)])
const packet = (...parts: Buffer[]): Buffer => {
  const body = Buffer.concat(parts)
  return Buffer.concat([varint(body.length), body])
}
const handshake = (state: number, host = 'bore.pub'): Buffer =>
  packet(varint(0), varint(763), str(host), Buffer.from([0x63, 0xdd]), varint(state))
const loginStart = (name: string): Buffer => packet(varint(0), str(name), Buffer.alloc(16, 1))

describe('inspectLogin', () => {
  it('reads the nick from handshake + login start', () => {
    const data = Buffer.concat([handshake(2), loginStart('Steve_1')])
    expect(inspectLogin(data)).toEqual({ kind: 'login', name: 'Steve_1' })
  })

  it('waits for more bytes when the packet is cut', () => {
    const data = Buffer.concat([handshake(2), loginStart('Steve_1')])
    for (const cut of [0, 1, 5, handshake(2).length, data.length - 1]) {
      expect(inspectLogin(data.subarray(0, cut)).kind).toBe('more')
    }
  })

  it('lets server-list pings through', () => {
    expect(inspectLogin(handshake(1)).kind).toBe('other')
    expect(inspectLogin(Buffer.from([0xfe, 0x01])).kind).toBe('other')
  })

  it('rejects garbage', () => {
    expect(inspectLogin(Buffer.from('GET / HTTP/1.1\r\n\r\n')).kind).toBe('bad')
    expect(inspectLogin(Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff])).kind).toBe('bad')
  })
})

describe('parseLanPort', () => {
  it('finds the LAN port', () => {
    expect(parseLanPort('[Server thread/INFO]: Started serving on 54321')).toBe(54321)
    expect(parseLanPort('[CHAT] Local game hosted on port 40001')).toBe(40001)
  })
  it('ignores chat messages and noise', () => {
    expect(parseLanPort('[Server thread/INFO]: <Evil> Started serving on 22')).toBeNull()
    expect(parseLanPort('hello')).toBeNull()
  })
})

/** Tiny stand-in for bore.pub: hands out one "visitor" and exposes the data socket. */
function fakeBore(): Promise<{ port: number; visitor: Promise<net.Socket>; stop(): void }> {
  return new Promise((resolve) => {
    let giveVisitor: (socket: net.Socket) => void = () => undefined
    const visitor = new Promise<net.Socket>((r) => (giveVisitor = r))
    const sockets: net.Socket[] = []
    const server = net.createServer((socket) => {
      sockets.push(socket)
      let buf = Buffer.alloc(0)
      let mode: 'unknown' | 'data' = 'unknown'
      socket.on('error', () => undefined)
      socket.on('data', (chunk) => {
        if (mode === 'data') return
        buf = Buffer.concat([buf, chunk])
        const end = buf.indexOf(0)
        if (end < 0) return
        const msg = JSON.parse(buf.subarray(0, end).toString()) as Record<string, unknown>
        if ('Hello' in msg) {
          socket.write(`${JSON.stringify({ Hello: 4242 })}\0`)
          setTimeout(() => socket.write(`${JSON.stringify({ Connection: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' })}\0`), 30)
        } else if ('Accept' in msg) {
          mode = 'data'
          socket.removeAllListeners('data')
          giveVisitor(socket)
        }
      })
    })
    server.listen(0, '127.0.0.1', () =>
      resolve({
        port: (server.address() as net.AddressInfo).port,
        visitor,
        stop: () => {
          for (const s of sockets) s.destroy()
          server.close()
        }
      })
    )
  })
}

describe('openTunnel with allowLogin', () => {
  const cleanup: Array<() => void> = []
  afterEach(() => {
    while (cleanup.length) cleanup.pop()?.()
  })

  async function setup(allow: (name: string) => boolean): Promise<{ received: Buffer[]; visitor: net.Socket; tunnel: TunnelHandle }> {
    const received: Buffer[] = []
    const game = net.createServer((socket) => socket.on('data', (d) => received.push(d)))
    await new Promise<void>((r) => game.listen(0, '127.0.0.1', r))
    cleanup.push(() => game.close())
    const bore = await fakeBore()
    cleanup.push(() => bore.stop())
    const tunnel = await openTunnel({
      localPort: (game.address() as net.AddressInfo).port,
      server: '127.0.0.1',
      controlPort: bore.port,
      allowLogin: allow
    })
    cleanup.push(() => tunnel.close())
    expect(tunnel.remotePort).toBe(4242)
    return { received, visitor: await bore.visitor, tunnel }
  }

  it('forwards a friend to the game', async () => {
    const { received, visitor } = await setup((name) => name === 'Friend_1')
    visitor.write(Buffer.concat([handshake(2), loginStart('Friend_1')]))
    await new Promise((r) => setTimeout(r, 300))
    expect(Buffer.concat(received).length).toBeGreaterThan(0)
  })

  it('drops a stranger before the game sees anything', async () => {
    const { received, visitor } = await setup((name) => name === 'Friend_1')
    const closed = new Promise<void>((r) => {
      visitor.on('close', () => r())
      visitor.on('error', () => undefined)
    })
    visitor.write(Buffer.concat([handshake(2), loginStart('Stranger')]))
    await closed
    expect(Buffer.concat(received).length).toBe(0)
  })
})
