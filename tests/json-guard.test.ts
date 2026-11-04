import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  dropIfBrokenJson,
  isJsonFileValid,
  looksCorrupt,
  parseJsonGuard,
  purgeBrokenJsonIn
} from '../src/main/services/json-guard'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'verdant-json-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('parseJsonGuard', () => {
  it('parses valid JSON', () => {
    expect(parseJsonGuard('{"objects":{"a":{"hash":"00"}}}')).toEqual({
      ok: true,
      value: { objects: { a: { hash: '00' } } }
    })
  })

  it('flags the real-world NUL-padded asset index', () => {
    const corrupted = '\u0000'.repeat(64)
    expect(looksCorrupt(corrupted)).toBe(true)
    const result = parseJsonGuard(corrupted)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('NUL')
  })

  it('flags empty and truncated files', () => {
    expect(parseJsonGuard('').ok).toBe(false)
    expect(parseJsonGuard('   \n ').ok).toBe(false)
    expect(parseJsonGuard('{"objects":').ok).toBe(false)
  })
})

describe('dropIfBrokenJson', () => {
  it('deletes a corrupt file and reports that it must be re-downloaded', async () => {
    const file = join(root, 'index.json')
    await writeFile(file, '\u0000\u0000\u0000', 'utf8')
    expect(await dropIfBrokenJson(file)).toBe(true)
    await expect(readFile(file)).rejects.toThrow()
  })

  it('keeps a valid file intact', async () => {
    const file = join(root, 'versions', '1.21.4.json')
    await mkdir(join(root, 'versions'), { recursive: true })
    await writeFile(file, '{"id":"1.21.4"}', 'utf8')
    expect(await dropIfBrokenJson(file)).toBe(false)
    expect(await isJsonFileValid(file)).toBe(true)
  })

  it('treats a zero-byte file as broken', async () => {
    const file = join(root, 'empty.json')
    await writeFile(file, '', 'utf8')
    expect(await dropIfBrokenJson(file)).toBe(true)
  })

  it('is a no-op for a missing file', async () => {
    expect(await dropIfBrokenJson(join(root, 'nope.json'))).toBe(false)
  })
})

describe('purgeBrokenJsonIn', () => {
  it('removes only unparsable json files in a folder', async () => {
    const indexes = join(root, 'assets', 'indexes')
    await mkdir(indexes, { recursive: true })
    await writeFile(join(indexes, '34.json'), '\u0000\u0000', 'utf8')
    await writeFile(join(indexes, '35.json'), '{"objects":{}}', 'utf8')
    await writeFile(join(indexes, 'readme.txt'), 'not json', 'utf8')

    const removed = await purgeBrokenJsonIn(indexes, 0)
    expect(removed).toHaveLength(1)
    expect(removed[0].endsWith('34.json')).toBe(true)
    expect(await isJsonFileValid(join(indexes, '35.json'))).toBe(true)
    // non-json files are never touched
    expect(await readFile(join(indexes, 'readme.txt'), 'utf8')).toBe('not json')
  })

  it('walks one level down for version folders', async () => {
    const versions = join(root, 'versions')
    await mkdir(join(versions, 'fabric-1.21.4'), { recursive: true })
    await mkdir(join(versions, '1.21.4'), { recursive: true })
    await writeFile(join(versions, 'fabric-1.21.4', 'fabric-1.21.4.json'), 'broken{', 'utf8')
    await writeFile(join(versions, '1.21.4', '1.21.4.json'), '{"id":"1.21.4"}', 'utf8')

    const removed = await purgeBrokenJsonIn(versions, 1)
    expect(removed).toHaveLength(1)
    expect(removed[0]).toContain('fabric-1.21.4')
    expect(await isJsonFileValid(join(versions, '1.21.4', '1.21.4.json'))).toBe(true)
  })

  it('returns an empty list for a missing folder', async () => {
    expect(await purgeBrokenJsonIn(join(root, 'nope'), 1)).toEqual([])
  })
})
