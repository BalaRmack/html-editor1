import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/main/services/net', () => ({ fetchJson: vi.fn() }))

import { filterCompatible } from '../src/main/services/content-logic'
import { modrinthSearch } from '../src/main/services/modrinth'
import { fetchJson } from '../src/main/services/net'

function rawHit(slug: string, categories: string[], versions: string[]): Record<string, unknown> {
  return {
    project_id: `id-${slug}`,
    slug,
    title: slug,
    description: '',
    author: 'a',
    downloads: 1,
    follows: 1,
    icon_url: null,
    categories,
    versions,
    project_type: 'mod',
    date_modified: '2026-01-01T00:00:00Z'
  }
}

describe('Modrinth search results vs. the compatibility filter', () => {
  beforeEach(() => {
    vi.mocked(fetchJson).mockReset()
  })

  it('keeps Forge mods for a Forge 1.12.2 instance (loaders come from categories)', async () => {
    vi.mocked(fetchJson).mockResolvedValue({
      hits: [
        rawHit('jei', ['fabric', 'forge', 'library', 'neoforge'], ['1.12.2', '1.20.1']),
        rawHit('fabric-only', ['fabric', 'utility'], ['1.12.2']),
        rawHit('wrong-version', ['forge'], ['1.20.1'])
      ],
      total_hits: 3,
      offset: 0,
      limit: 20
    })

    const result = await modrinthSearch({ source: 'modrinth', query: '', mcVersion: '1.12.2', loader: 'forge' })
    expect(result.hits.find((hit) => hit.slug === 'jei')?.loaders).toEqual(['fabric', 'forge', 'neoforge'])

    const kept = filterCompatible(result.hits, { mcVersion: '1.12.2', loader: 'forge' }, 'mod')
    expect(kept.map((hit) => hit.slug)).toEqual(['jei'])
  })
})
