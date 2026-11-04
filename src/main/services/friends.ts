import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  randomUUID,
  type KeyObject
} from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  FriendEntry,
  FriendInvite,
  FriendRequestIn,
  FriendsHosting,
  FriendsState
} from '../../shared/types'
import { logger } from './logger'
import { DirectClient, DirectHost, isSid } from './direct'
import { openTunnel, parseLanPort, type TunnelHandle } from './tunnel'

/**
 * Friends without any server of ours.
 *  - identity: an X25519 key pair; the public key is the friend code (`VRD-…`)
 *  - transport: public ntfy.sh topics, one inbox per user (name = hash of the public key)
 *  - every message is AES-256-GCM encrypted with a key derived from the two
 *    identities, so only the two friends can read or forge it
 */

export const NTFY_BASE = 'https://ntfy.sh'
const CODE_PREFIX = 'VRD-'
const PRESENCE_EVERY_MS = 90_000
const ONLINE_WINDOW_MS = 200_000
const INVITE_TTL_MS = 5 * 60_000
const NAME_RE = /^[A-Za-z0-9_]{3,16}$/
const KEY_RE = /^[A-Za-z0-9_-]{43}$/
const HOST_RE = /^[A-Za-z0-9.-]{1,100}$/
const MAX_INCOMING = 50

export function fail(code: string, message?: string): Error {
  const error = new Error(message ?? code)
  ;(error as Error & { code?: string }).code = code
  return error
}

// ------------------------------------------------------------------ crypto

export interface Identity {
  priv: KeyObject
  pub: string
}

export function createIdentity(): { privB64: string; pub: string } {
  const { publicKey, privateKey } = generateKeyPairSync('x25519')
  const pub = publicKey.export({ format: 'jwk' }).x as string
  const privB64 = (privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer).toString('base64')
  return { privB64, pub }
}

export function loadIdentity(privB64: string, pub: string): Identity {
  return { priv: createPrivateKey({ key: Buffer.from(privB64, 'base64'), format: 'der', type: 'pkcs8' }), pub }
}

function publicKeyOf(pub: string): KeyObject {
  return createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: pub }, format: 'jwk' })
}

export function friendCode(pub: string): string {
  return `${CODE_PREFIX}${pub}`
}

/** Returns the public key from a pasted friend code, or null if it is not valid. */
export function parseFriendCode(input: string): string | null {
  const match = /^VRD-([A-Za-z0-9_-]{43})$/.exec(input.trim())
  if (!match) return null
  try {
    publicKeyOf(match[1])
    return match[1]
  } catch {
    return null
  }
}

export function topicFor(pub: string): string {
  return `verdant-${createHash('sha256').update(pub).digest('hex').slice(0, 40)}`
}

function sharedKey(identity: Identity, theirPub: string): Buffer {
  const secret = diffieHellman({ privateKey: identity.priv, publicKey: publicKeyOf(theirPub) })
  return Buffer.from(hkdfSync('sha256', secret, Buffer.from('verdant-friends'), Buffer.from('v1'), 32))
}

export function seal(identity: Identity, toPub: string, message: Record<string, unknown>): string {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', sharedKey(identity, toPub), nonce)
  cipher.setAAD(Buffer.from(`${identity.pub}>${toPub}`))
  const body = Buffer.concat([cipher.update(JSON.stringify(message), 'utf8'), cipher.final(), cipher.getAuthTag()])
  return JSON.stringify({ v: 1, f: identity.pub, n: nonce.toString('base64'), c: body.toString('base64') })
}

export function open(identity: Identity, envelope: string): { from: string; message: Record<string, unknown> } | null {
  try {
    const data = JSON.parse(envelope) as { v?: number; f?: string; n?: string; c?: string }
    if (data.v !== 1 || typeof data.f !== 'string' || !KEY_RE.test(data.f)) return null
    if (typeof data.n !== 'string' || typeof data.c !== 'string') return null
    const nonce = Buffer.from(data.n, 'base64')
    const body = Buffer.from(data.c, 'base64')
    if (nonce.length !== 12 || body.length < 17 || body.length > 3000) return null
    const decipher = createDecipheriv('aes-256-gcm', sharedKey(identity, data.f), nonce)
    decipher.setAAD(Buffer.from(`${data.f}>${identity.pub}`))
    decipher.setAuthTag(body.subarray(body.length - 16))
    const plain = Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()])
    const message = JSON.parse(plain.toString('utf8')) as unknown
    if (!message || typeof message !== 'object' || Array.isArray(message)) return null
    return { from: data.f, message: message as Record<string, unknown> }
  } catch {
    return null
  }
}

// ----------------------------------------------------------------- service

interface StoredFriend {
  id: string
  name: string
}

interface Stored {
  priv: string
  pub: string
  enabled: boolean
  friends: StoredFriend[]
  incoming: FriendRequestIn[]
  outgoing: { id: string; ts: number }[]
  sinceId: string | null
}

export interface HostInstanceInfo {
  mcVersion: string
  loader: string
}

type Listener = (state: FriendsState) => void

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export class FriendsService {
  private file = ''
  private getName: () => string | null = () => null
  private store: Stored | null = null
  private identity: Identity | null = null
  private listeners = new Set<Listener>()
  private running = false
  private abort: AbortController | null = null
  private presenceTimer: NodeJS.Timeout | null = null
  private connected = false
  private error: string | null = null
  private lastSeen = new Map<string, number>()
  private invites: FriendInvite[] = []
  private seenMessages = new Set<string>()
  private lanPort: number | null = null
  private hosting: (FriendsHosting & { tunnel: TunnelHandle; inviteId: string }) | null = null
  private directHost: DirectHost | null = null
  private clients = new Map<string, DirectClient>()

  init(file: string, getName: () => string | null): void {
    this.file = file
    this.getName = getName
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    const snapshot = this.state()
    for (const listener of this.listeners) {
      try {
        listener(snapshot)
      } catch {
        /* ignore */
      }
    }
  }

  // ---- persistence

  private async load(): Promise<Stored> {
    if (this.store) return this.store
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as Partial<Stored>
      if (typeof parsed.priv === 'string' && typeof parsed.pub === 'string' && KEY_RE.test(parsed.pub)) {
        this.store = {
          priv: parsed.priv,
          pub: parsed.pub,
          enabled: Boolean(parsed.enabled),
          friends: Array.isArray(parsed.friends) ? parsed.friends.filter((f) => KEY_RE.test(f.id) && NAME_RE.test(f.name)) : [],
          incoming: Array.isArray(parsed.incoming) ? parsed.incoming : [],
          outgoing: Array.isArray(parsed.outgoing) ? parsed.outgoing : [],
          sinceId: typeof parsed.sinceId === 'string' ? parsed.sinceId : null
        }
        this.identity = loadIdentity(this.store.priv, this.store.pub)
        return this.store
      }
    } catch {
      /* first start or unreadable file: make a new identity below */
    }
    const created = createIdentity()
    this.store = { priv: created.privB64, pub: created.pub, enabled: false, friends: [], incoming: [], outgoing: [], sinceId: null }
    this.identity = loadIdentity(created.privB64, created.pub)
    await this.save()
    return this.store
  }

  private async save(): Promise<void> {
    if (!this.store || !this.file) return
    const tmp = `${this.file}.tmp`
    try {
      await mkdir(dirname(this.file), { recursive: true })
      await writeFile(tmp, JSON.stringify(this.store, null, 2), 'utf8')
      await rename(tmp, this.file)
    } catch (error) {
      logger.error(`[друзья] не удалось сохранить: ${(error as Error).message}`)
    }
  }

  // ---- lifecycle

  /** Loads the identity and, if the user switched friends on, connects. */
  async start(): Promise<void> {
    const store = await this.load()
    if (store.enabled) this.connect()
    this.emit()
  }

  stop(): void {
    this.running = false
    this.abort?.abort()
    if (this.presenceTimer) clearInterval(this.presenceTimer)
    this.presenceTimer = null
    this.hosting?.tunnel.close()
    this.hosting = null
    this.directHost?.closeAll()
    this.closeDirect()
    this.connected = false
  }

  async setEnabled(enabled: boolean): Promise<FriendsState> {
    const store = await this.load()
    store.enabled = enabled
    await this.save()
    if (enabled) this.connect()
    else {
      await this.stopHosting().catch(() => undefined)
      this.stop()
      this.error = null
    }
    this.emit()
    return this.state()
  }

  private connect(): void {
    if (this.running) return
    this.running = true
    void this.streamLoop()
    void this.presenceTick()
    this.presenceTimer = setInterval(() => void this.presenceTick(), PRESENCE_EVERY_MS)
  }

  // ---- state

  state(): FriendsState {
    const store = this.store
    const now = Date.now()
    const friends: FriendEntry[] = (store?.friends ?? []).map((friend) => {
      const seen = this.lastSeen.get(friend.id) ?? null
      return { id: friend.id, name: friend.name, online: seen !== null && now - seen < ONLINE_WINDOW_MS, lastSeen: seen }
    })
    return {
      enabled: store?.enabled ?? false,
      connected: this.connected,
      code: store ? friendCode(store.pub) : '',
      name: this.getName(),
      friends,
      incoming: store?.incoming ?? [],
      outgoing: store?.outgoing ?? [],
      invites: this.invites.filter((invite) => now - invite.ts < INVITE_TTL_MS),
      lanPort: this.lanPort,
      hosting: this.hosting
        ? { host: this.hosting.host, port: this.hosting.port, mcVersion: this.hosting.mcVersion, loader: this.hosting.loader }
        : null,
      error: this.error
    }
  }

  async snapshot(): Promise<FriendsState> {
    await this.load()
    return this.state()
  }

  private setConnected(value: boolean, error: string | null = null): void {
    if (this.connected === value && this.error === error) return
    this.connected = value
    this.error = error
    this.emit()
  }

  // ---- network

  private async publish(toPub: string, message: Record<string, unknown>): Promise<void> {
    const identity = this.identity
    if (!identity) throw fail('friends_disabled')
    let response: Response
    try {
      response = await fetch(`${NTFY_BASE}/${topicFor(toPub)}`, {
        method: 'POST',
        body: seal(identity, toPub, message),
        signal: AbortSignal.timeout(10_000)
      })
    } catch (error) {
      throw fail('friends_network', (error as Error).message)
    }
    if (!response.ok) throw fail('friends_network', `HTTP ${response.status}`)
  }

  private async streamLoop(): Promise<void> {
    let delay = 2000
    while (this.running && this.store && this.identity) {
      const controller = new AbortController()
      this.abort = controller
      let lastByte = Date.now()
      const watchdog = setInterval(() => {
        if (Date.now() - lastByte > 120_000) controller.abort()
      }, 15_000)
      try {
        const since = this.store.sinceId ?? '12h'
        const response = await fetch(`${NTFY_BASE}/${topicFor(this.identity.pub)}/json?since=${encodeURIComponent(since)}`, {
          signal: controller.signal
        })
        if (!response.ok || !response.body) {
          if (response.status >= 400 && response.status < 500 && response.status !== 429) this.store.sinceId = null
          throw new Error(`HTTP ${response.status}`)
        }
        this.setConnected(true)
        delay = 2000
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          lastByte = Date.now()
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) if (line.trim()) this.handleLine(line)
        }
      } catch (error) {
        if (!this.running) return
        this.setConnected(false, (error as Error).message)
      } finally {
        clearInterval(watchdog)
      }
      if (!this.running) return
      this.setConnected(false, this.error)
      await sleep(delay)
      delay = Math.min(delay * 2, 60_000)
    }
  }

  private handleLine(line: string): void {
    let event: { id?: string; event?: string; message?: string }
    try {
      event = JSON.parse(line)
    } catch {
      return
    }
    if (event.event !== 'message' || typeof event.message !== 'string' || typeof event.id !== 'string') return
    if (this.seenMessages.has(event.id)) return
    this.seenMessages.add(event.id)
    if (this.seenMessages.size > 2000) this.seenMessages = new Set([...this.seenMessages].slice(-1000))
    if (this.store) this.store.sinceId = event.id
    const opened = this.identity ? open(this.identity, event.message) : null
    if (!opened) return
    this.handleMessage(opened.from, opened.message)
  }

  /** Exposed for tests. */
  handleMessage(from: string, message: Record<string, unknown>): void {
    const store = this.store
    if (!store || from === store.pub) return
    const friend = store.friends.find((item) => item.id === from)
    const name = typeof message.name === 'string' && NAME_RE.test(message.name) ? message.name : null
    let changed = false

    switch (message.t) {
      case 'req': {
        if (!name) return
        if (friend || store.outgoing.some((item) => item.id === from)) {
          store.outgoing = store.outgoing.filter((item) => item.id !== from)
          this.addFriend(from, name)
          void this.publish(from, { t: 'acc', name: this.getName() }).catch(() => undefined)
          changed = true
        } else if (!store.incoming.some((item) => item.id === from)) {
          store.incoming = [...store.incoming, { id: from, name, ts: Date.now() }].slice(-MAX_INCOMING)
          changed = true
        }
        break
      }
      case 'acc': {
        if (!name) return
        if (store.outgoing.some((item) => item.id === from) || friend) {
          store.outgoing = store.outgoing.filter((item) => item.id !== from)
          this.addFriend(from, name)
          this.lastSeen.set(from, Date.now())
          changed = true
        }
        break
      }
      case 'rm': {
        if (friend) {
          store.friends = store.friends.filter((item) => item.id !== from)
          this.invites = this.invites.filter((invite) => invite.from !== from)
          this.lastSeen.delete(from)
          changed = true
        }
        break
      }
      case 'hi': {
        if (!friend) return
        this.lastSeen.set(from, Date.now())
        if (name && name !== friend.name) friend.name = name
        changed = true
        break
      }
      case 'inv': {
        if (!friend) return
        const ts = typeof message.ts === 'number' ? message.ts : 0
        const port = typeof message.port === 'number' ? message.port : 0
        const host = typeof message.host === 'string' ? message.host : ''
        const mcVersion = typeof message.mcVersion === 'string' ? message.mcVersion : ''
        const loader = typeof message.loader === 'string' ? message.loader : 'vanilla'
        const id = typeof message.id === 'string' ? message.id : ''
        const p2p = message.p2p === true
        if (Math.abs(Date.now() - ts) > INVITE_TTL_MS) return
        if (!Number.isInteger(port) || port < 1 || port > 65535 || !HOST_RE.test(host)) return
        if (!/^[\w.+-]{1,40}$/.test(mcVersion) || !/^[\w.-]{1,20}$/.test(loader) || !/^[\w-]{8,64}$/.test(id)) return
        this.lastSeen.set(from, Date.now())
        this.invites = [
          ...this.invites.filter((invite) => invite.from !== from),
          { id, from, fromName: friend.name, host, port, mcVersion, loader, p2p, ts: Date.now() }
        ]
        changed = true
        break
      }
      case 'sig': {
        if (!friend) return
        const sid = message.sid
        const inviteId = message.id
        if (!isSid(sid) || typeof inviteId !== 'string') return
        if (message.d === 'h') {
          if (this.hosting && this.directHost && inviteId === this.hosting.inviteId) {
            void this.directHost.handle(from, inviteId, sid, message)
          }
        } else if (message.d === 'c') {
          this.clients.get(sid)?.handleSignal(from, sid, message)
        }
        return
      }
      case 'bye': {
        if (!friend) return
        this.invites = this.invites.filter((invite) => invite.from !== from)
        changed = true
        break
      }
      default:
        return
    }
    if (changed) {
      void this.save()
      this.emit()
    }
  }

  private addFriend(id: string, name: string): void {
    const store = this.store
    if (!store) return
    const existing = store.friends.find((item) => item.id === id)
    if (existing) existing.name = name
    else store.friends = [...store.friends, { id, name }]
    store.incoming = store.incoming.filter((item) => item.id !== id)
  }

  private async presenceTick(): Promise<void> {
    const store = this.store
    const name = this.getName()
    if (!store || !name || !this.running) return
    const hosting = this.hosting
    await Promise.all(
      store.friends.map((friend) =>
        this.publish(
          friend.id,
          hosting
            ? { t: 'inv', name, p2p: true, id: hosting.inviteId, host: hosting.host, port: hosting.port, mcVersion: hosting.mcVersion, loader: hosting.loader, ts: Date.now() }
            : { t: 'hi', name }
        ).catch(() => undefined)
      )
    )
  }

  // ---- actions

  private requireEnabled(): Stored {
    const store = this.store
    if (!store || !store.enabled || !this.identity) throw fail('friends_disabled')
    return store
  }

  async sendRequest(code: string): Promise<FriendsState> {
    await this.load()
    const store = this.requireEnabled()
    const name = this.getName()
    if (!name) throw fail('profile_required', 'Сначала задайте никнейм')
    const pub = parseFriendCode(code)
    if (!pub) throw fail('friends_bad_code')
    if (pub === store.pub) throw fail('friends_self')
    if (store.friends.some((item) => item.id === pub)) throw fail('friends_already')
    await this.publish(pub, { t: 'req', name })
    if (!store.outgoing.some((item) => item.id === pub)) store.outgoing = [...store.outgoing, { id: pub, ts: Date.now() }]
    await this.save()
    this.emit()
    return this.state()
  }

  async accept(id: string): Promise<FriendsState> {
    const store = this.requireEnabled()
    const request = store.incoming.find((item) => item.id === id)
    if (!request) throw fail('friends_not_found')
    const name = this.getName()
    if (!name) throw fail('profile_required', 'Сначала задайте никнейм')
    await this.publish(id, { t: 'acc', name })
    this.addFriend(id, request.name)
    await this.save()
    this.emit()
    return this.state()
  }

  async decline(id: string): Promise<FriendsState> {
    const store = this.requireEnabled()
    store.incoming = store.incoming.filter((item) => item.id !== id)
    await this.save()
    this.emit()
    return this.state()
  }

  async cancelOutgoing(id: string): Promise<FriendsState> {
    const store = this.requireEnabled()
    store.outgoing = store.outgoing.filter((item) => item.id !== id)
    await this.save()
    this.emit()
    return this.state()
  }

  async remove(id: string): Promise<FriendsState> {
    const store = this.requireEnabled()
    store.friends = store.friends.filter((item) => item.id !== id)
    this.invites = this.invites.filter((invite) => invite.from !== id)
    this.lastSeen.delete(id)
    await this.save()
    this.emit()
    void this.publish(id, { t: 'rm' }).catch(() => undefined)
    return this.state()
  }

  isFriendName(name: string): boolean {
    const lower = name.toLowerCase()
    return Boolean(this.store?.friends.some((friend) => friend.name.toLowerCase() === lower))
  }

  // ---- hosting (LAN world through a tunnel)

  /** Feed every line of the game output here. */
  noteGameLine(text: string): void {
    const port = parseLanPort(text)
    if (port && port !== this.lanPort) {
      this.lanPort = port
      this.emit()
    }
  }

  noteGameStopped(): void {
    this.closeDirect()
    if (this.lanPort === null && !this.hosting) return
    this.lanPort = null
    void this.stopHosting().catch(() => undefined)
    this.emit()
  }

  async startHosting(info: HostInstanceInfo): Promise<FriendsHosting> {
    this.requireEnabled()
    if (this.hosting) return this.state().hosting as FriendsHosting
    const localPort = this.lanPort
    if (!localPort) throw fail('friends_no_lan')
    let tunnel: TunnelHandle
    try {
      tunnel = await openTunnel({
        localPort,
        allowLogin: (name) => this.isFriendName(name),
        onLog: (text) => logger.info(`[друзья] ${text}`),
        onClose: (reason) => {
          logger.warn(`[друзья] туннель закрыт: ${reason}`)
          this.hosting = null
          this.emit()
        }
      })
    } catch (error) {
      throw fail('friends_tunnel', (error as Error).message)
    }
    if (!this.directHost) {
      this.directHost = new DirectHost(
        (toPub, message) => this.publish(toPub, message),
        () => this.lanPort,
        (text) => logger.info(`[друзья] ${text}`)
      )
    }
    this.hosting = {
      host: tunnel.host,
      port: tunnel.remotePort,
      mcVersion: info.mcVersion,
      loader: info.loader,
      tunnel,
      inviteId: randomUUID()
    }
    this.emit()
    void this.presenceTick()
    return this.state().hosting as FriendsHosting
  }

  async stopHosting(): Promise<void> {
    const current = this.hosting
    if (!current) return
    this.hosting = null
    this.directHost?.closeAll()
    current.tunnel.close()
    const store = this.store
    if (store) await Promise.all(store.friends.map((friend) => this.publish(friend.id, { t: 'bye' }).catch(() => undefined)))
    this.emit()
  }

  /**
   * Tries to reach the host directly (WebRTC). Returns a local 127.0.0.1 port the
   * game should join, or null when the host has no P2P or the NAT cannot be punched.
   */
  async openDirect(invite: FriendInvite): Promise<number | null> {
    this.closeDirect()
    if (!invite.p2p) return null
    const client = new DirectClient(
      (toPub, message) => this.publish(toPub, message),
      invite.from,
      invite.id,
      (text) => logger.info(`[друзья] ${text}`)
    )
    this.clients.set(client.sid, client)
    try {
      return await client.start()
    } catch (error) {
      logger.warn(`[друзья] прямое соединение не вышло, идём через туннель: ${(error as Error).message}`)
      this.clients.delete(client.sid)
      client.close()
      return null
    }
  }

  closeDirect(): void {
    for (const client of this.clients.values()) client.close()
    this.clients.clear()
  }

  /** Returns the invite a friend sent, for the launch flow. */
  inviteById(id: string): FriendInvite {
    this.requireEnabled()
    const invite = this.invites.find((item) => item.id === id && Date.now() - item.ts < INVITE_TTL_MS)
    if (!invite) throw fail('friends_invite_expired')
    return invite
  }
}

export const friends = new FriendsService()
