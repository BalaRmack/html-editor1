import net from 'node:net'

/**
 * Minimal client for the `bore` TCP tunnel protocol (https://github.com/ekzhang/bore).
 * Control connection: JSON messages terminated by a NUL byte.
 *   client -> {"Hello":0}        server -> {"Hello":<public port>}
 *   server -> {"Connection":"<uuid>"} for every visitor; the client then opens a
 *   second connection to the server, sends {"Accept":"<uuid>"} and pipes it to
 *   the local service. The server also sends "Heartbeat" every ~500 ms.
 */

export interface TunnelOptions {
  localPort: number
  localHost?: string
  server?: string
  controlPort?: number
  onLog?: (text: string) => void
  /** Called once when an already established tunnel goes away. */
  onClose?: (reason: string) => void
  /**
   * When set, a visitor whose Minecraft login name this returns false for is
   * dropped before a single byte reaches the game. Server-list pings pass.
   */
  allowLogin?: (name: string) => boolean
}

export interface TunnelHandle {
  host: string
  remotePort: number
  close(): void
}

export const DEFAULT_BORE_SERVER = 'bore.pub'
export const DEFAULT_BORE_PORT = 7835

const HANDSHAKE_TIMEOUT_MS = 10_000
const SILENCE_LIMIT_MS = 15_000
const LOGIN_WAIT_MS = 10_000
const UUID_RE = /^[0-9a-fA-F-]{8,64}$/

export type LoginVerdict = { kind: 'more' } | { kind: 'other' } | { kind: 'login'; name: string } | { kind: 'bad' }

class NeedMore extends Error {}
class Malformed extends Error {}

function varint(buf: Buffer, offset: number): { value: number; next: number } {
  let value = 0
  for (let i = 0; i < 5; i++) {
    if (offset + i >= buf.length) throw new NeedMore()
    const byte = buf[offset + i]
    value |= (byte & 0x7f) << (7 * i)
    if ((byte & 0x80) === 0) return { value, next: offset + i + 1 }
  }
  throw new Malformed()
}

/**
 * Reads the Minecraft Handshake + Login Start packets from the first bytes of a
 * connection and returns the name the visitor wants to log in with.
 */
export function inspectLogin(buf: Buffer): LoginVerdict {
  if (buf.length === 0) return { kind: 'more' }
  if (buf[0] === 0xfe) return { kind: 'other' }
  try {
    const len1 = varint(buf, 0)
    if (len1.value < 1 || len1.value > 300) return { kind: 'bad' }
    const end1 = len1.next + len1.value
    const id1 = varint(buf, len1.next)
    if (id1.value !== 0) return { kind: 'bad' }
    if (buf.length < end1) return { kind: 'more' }
    const protocol = varint(buf, id1.next)
    const hostLen = varint(buf, protocol.next)
    const afterHost = hostLen.next + hostLen.value + 2
    if (hostLen.value < 0 || afterHost >= end1) return { kind: 'bad' }
    const state = varint(buf.subarray(0, end1), afterHost)
    if (state.value === 1) return { kind: 'other' }
    if (state.value !== 2 && state.value !== 3) return { kind: 'bad' }

    const len2 = varint(buf, end1)
    if (len2.value < 1 || len2.value > 300) return { kind: 'bad' }
    const end2 = len2.next + len2.value
    if (buf.length < end2) return { kind: 'more' }
    const id2 = varint(buf, len2.next)
    if (id2.value !== 0) return { kind: 'bad' }
    const nameLen = varint(buf, id2.next)
    if (nameLen.value < 1 || nameLen.value > 64 || nameLen.next + nameLen.value > end2) return { kind: 'bad' }
    return { kind: 'login', name: buf.toString('utf8', nameLen.next, nameLen.next + nameLen.value) }
  } catch (error) {
    if (error instanceof NeedMore) return { kind: 'more' }
    return { kind: 'bad' }
  }
}

function guardVisitor(
  remote: net.Socket,
  local: net.Socket,
  allow: (name: string) => boolean,
  log: (text: string) => void
): void {
  let pending: Buffer = Buffer.alloc(0)
  const reject = (why: string): void => {
    log(why)
    remote.destroy()
    local.destroy()
  }
  const timer = setTimeout(() => reject('гость не представился — отключён'), LOGIN_WAIT_MS)
  const onData = (chunk: Buffer): void => {
    pending = Buffer.concat([pending, chunk])
    const verdict = inspectLogin(pending)
    if (verdict.kind === 'more') {
      if (pending.length > 2048) {
        clearTimeout(timer)
        remote.off('data', onData)
        reject('некорректное начало соединения — отключён')
      }
      return
    }
    clearTimeout(timer)
    remote.off('data', onData)
    if (verdict.kind === 'bad') return reject('некорректное начало соединения — отключён')
    if (verdict.kind === 'login' && !allow(verdict.name)) return reject(`вход «${verdict.name}» отклонён: не в списке друзей`)
    local.write(pending)
    remote.pipe(local)
  }
  remote.on('data', onData)
  remote.on('close', () => clearTimeout(timer))
}

export function openTunnel(options: TunnelOptions): Promise<TunnelHandle> {
  const host = options.server ?? DEFAULT_BORE_SERVER
  const controlPort = options.controlPort ?? DEFAULT_BORE_PORT
  const localHost = options.localHost ?? '127.0.0.1'
  const log = options.onLog ?? ((): void => undefined)

  return new Promise<TunnelHandle>((resolve, reject) => {
    const sockets = new Set<net.Socket>()
    let closed = false
    let settled = false
    let lastData = Date.now()
    let buffer: Buffer = Buffer.alloc(0)

    const control = net.connect({ host, port: controlPort })
    sockets.add(control)
    control.setNoDelay(true)

    const handshakeTimer = setTimeout(() => close('сервер туннелей не ответил'), HANDSHAKE_TIMEOUT_MS)
    const watchdog = setInterval(() => {
      if (Date.now() - lastData > SILENCE_LIMIT_MS) close('сервер туннелей перестал отвечать')
    }, 3000)

    function close(reason: string): void {
      if (closed) return
      closed = true
      clearTimeout(handshakeTimer)
      clearInterval(watchdog)
      for (const socket of sockets) socket.destroy()
      sockets.clear()
      if (!settled) {
        settled = true
        reject(new Error(reason))
      } else {
        options.onClose?.(reason)
      }
    }

    const forward = (id: string): void => {
      if (!UUID_RE.test(id)) return
      const remote = net.connect({ host, port: controlPort })
      const local = net.connect({ host: localHost, port: options.localPort })
      for (const socket of [remote, local]) {
        sockets.add(socket)
        socket.setNoDelay(true)
        socket.on('close', () => sockets.delete(socket))
      }
      const drop = (): void => {
        remote.destroy()
        local.destroy()
      }
      remote.on('error', drop)
      local.on('error', (error) => {
        log(`локальный порт ${options.localPort} недоступен: ${error.message}`)
        drop()
      })
      remote.on('close', () => local.destroy())
      local.on('close', () => remote.destroy())
      remote.on('connect', () => remote.write(`${JSON.stringify({ Accept: id })}\0`))
      local.pipe(remote)
      if (options.allowLogin) guardVisitor(remote, local, options.allowLogin, log)
      else remote.pipe(local)
    }

    const onMessage = (raw: string): void => {
      let message: unknown
      try {
        message = JSON.parse(raw)
      } catch {
        return
      }
      if (message === 'Heartbeat' || !message || typeof message !== 'object') return
      const record = message as Record<string, unknown>
      if (typeof record.Hello === 'number' && !settled) {
        settled = true
        clearTimeout(handshakeTimer)
        log(`туннель открыт: ${host}:${record.Hello}`)
        resolve({ host, remotePort: record.Hello, close: () => close('закрыт') })
      } else if (typeof record.Connection === 'string') {
        forward(record.Connection)
      } else if (typeof record.Error === 'string') {
        close(`сервер туннелей: ${record.Error}`)
      } else if ('Challenge' in record) {
        close('сервер туннелей требует секретный ключ')
      }
    }

    control.on('connect', () => control.write(`${JSON.stringify({ Hello: 0 })}\0`))
    control.on('data', (chunk: Buffer) => {
      lastData = Date.now()
      buffer = Buffer.concat([buffer, chunk])
      let index = buffer.indexOf(0)
      while (index >= 0) {
        const raw = buffer.subarray(0, index).toString('utf8')
        buffer = buffer.subarray(index + 1)
        onMessage(raw)
        index = buffer.indexOf(0)
      }
      if (buffer.length > 65_536) close('некорректный ответ сервера туннелей')
    })
    control.on('error', (error) => close(`нет связи с сервером туннелей: ${error.message}`))
    control.on('close', () => close('соединение с сервером туннелей закрыто'))
  })
}

/**
 * Finds the port the game opened for LAN play in a line of its log. Lines that
 * contain a chat author (`<name>`) are ignored so a player cannot fake one.
 */
export function parseLanPort(line: string): number | null {
  if (/<[^>]{1,32}>/.test(line)) return null
  const match =
    /(?:Started serving on|Local game hosted on port)\s+(\d{2,5})\b/i.exec(line) ??
    /\[CHAT\][^\n]*?(?:порту|порт|port)\s+\[?(\d{4,5})\]?/i.exec(line)
  if (!match) return null
  const port = Number(match[1])
  return port > 0 && port < 65536 ? port : null
}
