import { describe, expect, it } from 'vitest'
import {
  FriendsService,
  createIdentity,
  friendCode,
  loadIdentity,
  open,
  parseFriendCode,
  seal,
  topicFor
} from '../src/main/services/friends'

function person() {
  const created = createIdentity()
  return loadIdentity(created.privB64, created.pub)
}

describe('friend code', () => {
  it('round-trips and rejects junk', () => {
    const a = person()
    expect(parseFriendCode(friendCode(a.pub))).toBe(a.pub)
    expect(parseFriendCode(`  ${friendCode(a.pub)}  `)).toBe(a.pub)
    expect(parseFriendCode('VRD-short')).toBeNull()
    expect(parseFriendCode(a.pub)).toBeNull()
    expect(parseFriendCode('')).toBeNull()
  })

  it('gives a stable, key-independent-looking topic', () => {
    const a = person()
    expect(topicFor(a.pub)).toBe(topicFor(a.pub))
    expect(topicFor(a.pub)).toMatch(/^verdant-[0-9a-f]{40}$/)
    expect(topicFor(a.pub)).not.toContain(a.pub)
  })
})

describe('sealed messages', () => {
  it('only the addressed friend can read it, and learns who sent it', () => {
    const a = person()
    const b = person()
    const envelope = seal(a, b.pub, { t: 'hi', name: 'Alex' })
    expect(open(b, envelope)).toEqual({ from: a.pub, message: { t: 'hi', name: 'Alex' } })
    expect(open(person(), envelope)).toBeNull()
  })

  it('rejects tampering and a spoofed sender', () => {
    const a = person()
    const b = person()
    const eve = person()
    const envelope = JSON.parse(seal(a, b.pub, { t: 'hi', name: 'Alex' })) as { f: string; c: string }
    // claim to be someone else
    expect(open(b, JSON.stringify({ ...envelope, f: eve.pub }))).toBeNull()
    // flip a byte of the ciphertext
    const body = Buffer.from(envelope.c, 'base64')
    body[0] ^= 1
    expect(open(b, JSON.stringify({ ...envelope, c: body.toString('base64') }))).toBeNull()
    expect(open(b, 'not json')).toBeNull()
  })

  it('a message to b cannot be replayed as a message to someone else', () => {
    const a = person()
    const b = person()
    const c = person()
    expect(open(c, seal(a, b.pub, { t: 'hi', name: 'Alex' }))).toBeNull()
  })
})

async function service(name = 'Me_1') {
  const svc = new FriendsService()
  svc.init('', () => name)
  await svc.snapshot()
  return svc
}

const OTHER = person().pub
const invite = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  t: 'inv',
  name: 'Alex_2',
  id: 'abcdef12-3456',
  host: 'bore.pub',
  port: 12345,
  mcVersion: '1.20.1',
  loader: 'vanilla',
  ts: Date.now(),
  ...over
})

describe('FriendsService.handleMessage', () => {
  it('queues a request, ignores bad names and itself', async () => {
    const svc = await service()
    svc.handleMessage(OTHER, { t: 'req', name: 'bad name!' })
    expect(svc.state().incoming).toHaveLength(0)
    svc.handleMessage(OTHER, { t: 'req', name: 'Alex_2' })
    expect(svc.state().incoming).toEqual([expect.objectContaining({ id: OTHER, name: 'Alex_2' })])
    svc.handleMessage(OTHER, { t: 'req', name: 'Alex_2' })
    expect(svc.state().incoming).toHaveLength(1)
    const own = svc.state().code.replace('VRD-', '')
    svc.handleMessage(own, { t: 'req', name: 'Me_1' })
    expect(svc.state().incoming).toHaveLength(1)
  })

  it('does not become friends from an unsolicited acceptance', async () => {
    const svc = await service()
    svc.handleMessage(OTHER, { t: 'acc', name: 'Alex_2' })
    expect(svc.state().friends).toHaveLength(0)
  })

  it('ignores invites from strangers and accepts them from friends', async () => {
    const svc = await service()
    svc.handleMessage(OTHER, invite())
    expect(svc.state().invites).toHaveLength(0)

    const internals = svc as unknown as { store: { friends: { id: string; name: string }[] } }
    internals.store.friends.push({ id: OTHER, name: 'Alex_2' })
    svc.handleMessage(OTHER, invite())
    expect(svc.state().invites).toEqual([expect.objectContaining({ host: 'bore.pub', port: 12345, fromName: 'Alex_2' })])
    expect(svc.state().friends[0].online).toBe(true)
    expect(svc.isFriendName('alex_2')).toBe(true)
    expect(svc.isFriendName('Stranger')).toBe(false)
  })

  it('rejects malformed or stale invites', async () => {
    const svc = await service()
    const internals = svc as unknown as { store: { friends: { id: string; name: string }[] } }
    internals.store.friends.push({ id: OTHER, name: 'Alex_2' })
    for (const bad of [
      { port: 0 },
      { port: 70000 },
      { port: 'x' },
      { host: 'evil host; rm -rf' },
      { mcVersion: '1.20 --demo' },
      { ts: Date.now() - 3_600_000 }
    ]) {
      svc.handleMessage(OTHER, invite(bad))
    }
    expect(svc.state().invites).toHaveLength(0)
  })

  it('drops a friend when they remove us', async () => {
    const svc = await service()
    const internals = svc as unknown as { store: { friends: { id: string; name: string }[] } }
    internals.store.friends.push({ id: OTHER, name: 'Alex_2' })
    svc.handleMessage(OTHER, { t: 'rm' })
    expect(svc.state().friends).toHaveLength(0)
  })
})

describe('FriendsService LAN port', () => {
  it('takes the port from the game log and clears it when the game stops', async () => {
    const svc = await service()
    svc.noteGameLine('[Server thread/INFO]: Started serving on 40555')
    expect(svc.state().lanPort).toBe(40555)
    svc.noteGameLine('[Server thread/INFO]: <Evil> Started serving on 22')
    expect(svc.state().lanPort).toBe(40555)
    svc.noteGameStopped()
    expect(svc.state().lanPort).toBeNull()
  })
})
