import net from 'node:net'
import { randomUUID } from 'node:crypto'
import type { DataChannel, PeerConnection, RtcConfig } from 'node-datachannel'

/**
 * Direct (peer-to-peer) transport for friends, built on WebRTC data channels.
 * Signalling (offer / answer / ICE candidates) travels through the already
 * encrypted friends channel, so only the two friends can take part. Every
 * Minecraft TCP connection becomes its own reliable data channel.
 *
 *   guest: Minecraft -> 127.0.0.1:<proxy port> -> data channel ==(NAT hole punch)==>
 *   host:  data channel -> 127.0.0.1:<LAN port> -> the hosted world
 *
 * If the NAT cannot be punched the caller falls back to the bore tunnel.
 */

type Ndc = { PeerConnection: new (name: string, config: RtcConfig) => PeerConnection }

let ndcPromise: Promise<Ndc> | null = null
function loadNdc(): Promise<Ndc> {
  if (!ndcPromise) {
    ndcPromise = import('node-datachannel').then((module) => {
      const loaded = module as unknown as Partial<Ndc> & { default?: Ndc }
      return (loaded.PeerConnection ? (loaded as Ndc) : (loaded.default as Ndc))
    })
    ndcPromise.catch(() => {
      ndcPromise = null
    })
  }
  return ndcPromise
}

export type Signal = (toPub: string, message: Record<string, unknown>) => Promise<void>

const ICE_SERVERS = ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478']
const CHUNK = 16 * 1024
const HIGH_WATER = 1024 * 1024
const LOW_WATER = 256 * 1024
const MAX_CHANNELS = 32
const HOST_SESSION_WAIT_MS = 30_000
const SID_RE = /^[\w-]{8,64}$/

export interface ParsedSignal {
  k: 'offer' | 'answer' | 'cand'
  sdp?: string
  cand?: string
  mid?: string
}

export function isSid(value: unknown): value is string {
  return typeof value === 'string' && SID_RE.test(value)
}

export function parseSignal(message: Record<string, unknown>): ParsedSignal | null {
  const k = message.k
  if (k === 'offer' || k === 'answer') {
    if (typeof message.sdp !== 'string' || message.sdp.length < 10 || message.sdp.length > 2800) return null
    return { k, sdp: message.sdp }
  }
  if (k === 'cand') {
    if (typeof message.cand !== 'string' || message.cand.length > 600) return null
    if (typeof message.mid !== 'string' || message.mid.length > 64) return null
    return { k, cand: message.cand, mid: message.mid }
  }
  return null
}

/** Pipes a TCP socket into a data channel and back, with back-pressure. */
export function bridge(socket: net.Socket, channel: DataChannel, waitOpen: boolean): void {
  let done = false
  const finish = (): void => {
    if (done) return
    done = true
    socket.destroy()
    try {
      channel.close()
    } catch {
      /* already closed */
    }
  }
  socket.setNoDelay(true)
  channel.setBufferedAmountLowThreshold(LOW_WATER)
  channel.onBufferedAmountLow(() => {
    if (!done) socket.resume()
  })
  channel.onMessage((message) => {
    if (done || typeof message === 'string') return
    socket.write(Buffer.isBuffer(message) ? message : Buffer.from(message))
  })
  channel.onClosed(finish)
  channel.onError(finish)
  socket.on('data', (chunk: Buffer) => {
    if (done) return
    try {
      for (let i = 0; i < chunk.length; i += CHUNK) channel.sendMessageBinary(chunk.subarray(i, i + CHUNK))
      if (channel.bufferedAmount() > HIGH_WATER) socket.pause()
    } catch {
      finish()
    }
  })
  socket.on('close', finish)
  socket.on('error', finish)
  if (waitOpen) {
    socket.pause()
    channel.onOpen(() => socket.resume())
  }
}

/** A peer connection that queues ICE candidates until the remote description is known. */
class Link {
  private remoteSet = false
  private queue: { cand: string; mid: string }[] = []
  private closed = false

  constructor(readonly pc: PeerConnection) {}

  setRemote(sdp: string, type: 'offer' | 'answer'): void {
    this.pc.setRemoteDescription(sdp, type)
    this.remoteSet = true
    for (const item of this.queue.splice(0)) this.addCandidate(item.cand, item.mid)
  }

  addCandidate(cand: string, mid: string): void {
    if (!this.remoteSet) {
      if (this.queue.length < 50) this.queue.push({ cand, mid })
      return
    }
    try {
      this.pc.addRemoteCandidate(cand, mid)
    } catch {
      /* a bad candidate must not kill the session */
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    try {
      this.pc.close()
    } catch {
      /* ignore */
    }
  }
}

interface HostSession {
  from: string
  link: Link
  channels: number
  connected: boolean
  timer: NodeJS.Timeout
}

/** Host side: answers offers from friends and forwards their channels to the LAN world. */
export class DirectHost {
  private sessions = new Map<string, HostSession>()

  constructor(
    private send: Signal,
    private lanPort: () => number | null,
    private log: (text: string) => void
  ) {}

  async handle(from: string, inviteId: string, sid: string, message: Record<string, unknown>): Promise<void> {
    const signal = parseSignal(message)
    if (!signal || signal.k === 'answer') return
    let ndc: Ndc
    try {
      ndc = await loadNdc()
    } catch (error) {
      this.log(`прямое соединение недоступно: ${(error as Error).message}`)
      return
    }
    const key = `${from}:${sid}`
    let session = this.sessions.get(key)
    if (!session) {
      for (const [otherKey, other] of this.sessions) {
        if (other.from === from) this.drop(otherKey)
      }
      session = this.create(ndc, from, inviteId, sid, key)
    }
    try {
      if (signal.k === 'offer') session.link.setRemote(signal.sdp as string, 'offer')
      else session.link.addCandidate(signal.cand as string, signal.mid as string)
    } catch (error) {
      this.log(`прямое соединение: ${(error as Error).message}`)
      this.drop(key)
    }
  }

  private create(ndc: Ndc, from: string, inviteId: string, sid: string, key: string): HostSession {
    const pc = new ndc.PeerConnection(`host-${sid.slice(0, 8)}`, { iceServers: ICE_SERVERS })
    const link = new Link(pc)
    const session: HostSession = {
      from,
      link,
      channels: 0,
      connected: false,
      timer: setTimeout(() => {
        if (!session.connected) this.drop(key)
      }, HOST_SESSION_WAIT_MS)
    }
    this.sessions.set(key, session)
    const reply = (extra: Record<string, unknown>): void => {
      void this.send(from, { t: 'sig', d: 'c', id: inviteId, sid, ...extra }).catch(() => undefined)
    }
    pc.onLocalDescription((sdp, type) => reply({ k: type, sdp }))
    pc.onLocalCandidate((cand, mid) => reply({ k: 'cand', cand, mid }))
    pc.onStateChange((state) => {
      if (state === 'connected') {
        session.connected = true
        clearTimeout(session.timer)
        this.log('друг подключился напрямую (P2P)')
      } else if (state === 'failed' || state === 'closed') {
        this.drop(key)
      }
    })
    pc.onDataChannel((channel) => {
      if (channel.getLabel() !== 'mc') return
      const port = this.lanPort()
      if (!port || session.channels >= MAX_CHANNELS) {
        channel.close()
        return
      }
      session.channels++
      const socket = net.connect({ host: '127.0.0.1', port })
      socket.on('close', () => {
        session.channels--
      })
      bridge(socket, channel, false)
    })
    return session
  }

  private drop(key: string): void {
    const session = this.sessions.get(key)
    if (!session) return
    this.sessions.delete(key)
    clearTimeout(session.timer)
    session.link.close()
  }

  closeAll(): void {
    for (const key of [...this.sessions.keys()]) this.drop(key)
  }
}

/** Guest side: connects to the host and exposes the world on a local port. */
export class DirectClient {
  private link: Link | null = null
  private server: net.Server | null = null
  private closed = false
  readonly sid = randomUUID()

  constructor(
    private send: Signal,
    private hostPub: string,
    private inviteId: string,
    private log: (text: string) => void
  ) {}

  /** Resolves with the local proxy port once the direct link is up, rejects on failure or timeout. */
  async start(timeoutMs = 15_000): Promise<number> {
    const ndc = await loadNdc()
    return new Promise<number>((resolve, reject) => {
      let settled = false
      let timer: NodeJS.Timeout | null = null
      const fail = (reason: string): void => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        this.close()
        reject(new Error(reason))
      }
      timer = setTimeout(() => fail('не удалось пробить NAT (таймаут)'), timeoutMs)

      const pc = new ndc.PeerConnection(`guest-${this.sid.slice(0, 8)}`, { iceServers: ICE_SERVERS })
      const link = new Link(pc)
      this.link = link
      const signal = (extra: Record<string, unknown>): void => {
        void this.send(this.hostPub, { t: 'sig', d: 'h', id: this.inviteId, sid: this.sid, ...extra }).catch(() => undefined)
      }
      pc.onLocalDescription((sdp, type) => signal({ k: type, sdp }))
      pc.onLocalCandidate((cand, mid) => signal({ k: 'cand', cand, mid }))
      pc.onStateChange((state) => {
        if (state !== 'failed' && state !== 'closed') return
        if (!settled) fail(`соединение ${state}`)
        else {
          this.log('прямое соединение разорвано')
          this.close()
        }
      })
      // The first channel triggers the offer; once it opens the link is usable.
      const control = pc.createDataChannel('ctl')
      control.onOpen(() => {
        if (settled) return
        this.listen().then(
          (port) => {
            if (settled) return
            settled = true
            if (timer) clearTimeout(timer)
            resolve(port)
          },
          (error: Error) => fail(error.message)
        )
      })
    })
  }

  handleSignal(from: string, sid: string, message: Record<string, unknown>): void {
    if (from !== this.hostPub || sid !== this.sid || !this.link || this.closed) return
    const signal = parseSignal(message)
    if (!signal) return
    try {
      if (signal.k === 'answer') this.link.setRemote(signal.sdp as string, 'answer')
      else if (signal.k === 'cand') this.link.addCandidate(signal.cand as string, signal.mid as string)
    } catch (error) {
      this.log(`прямое соединение: ${(error as Error).message}`)
      this.close()
    }
  }

  private listen(): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const server = net.createServer((socket) => {
        const link = this.link
        if (!link || this.closed) {
          socket.destroy()
          return
        }
        try {
          bridge(socket, link.pc.createDataChannel('mc'), true)
        } catch {
          socket.destroy()
        }
      })
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (address && typeof address === 'object') {
          this.server = server
          resolve(address.port)
        } else {
          server.close()
          reject(new Error('не удалось открыть локальный порт'))
        }
      })
    })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.server?.close()
    this.server = null
    this.link?.close()
  }
}
