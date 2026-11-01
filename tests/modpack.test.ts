import { describe, expect, it } from 'vitest'
import { parseModrinthIndex } from '../src/main/services/modrinth'

/**
 * The modpack tab depends on reading the required loader out of the pack
 * manifest — that is what makes "install a modpack" work without asking the
 * user which Forge/Fabric build to use.
 */
describe('parseModrinthIndex (modpack manifest)', () => {
  it('detects a Fabric pack and keeps file metadata', () => {
    const parsed = parseModrinthIndex({
      name: 'Fabulously Optimized',
      versionId: 'abc123',
      dependencies: { minecraft: '1.21.4', 'fabric-loader': '0.16.10' },
      files: [
        { path: 'mods/sodium.jar', downloads: ['https://cdn.example/sodium.jar'], fileSize: 1_200_000, env: { client: 'required' } },
        { path: 'mods/serveronly.jar', downloads: ['https://cdn.example/server.jar'], fileSize: 8000, env: { client: 'unsupported' } }
      ]
    })

    expect(parsed.mcVersion).toBe('1.21.4')
    expect(parsed.loader).toBe('fabric')
    expect(parsed.loaderVersion).toBe('0.16.10')
    expect(parsed.files).toHaveLength(2)
    expect(parsed.files[0]).toMatchObject({
      path: 'mods/sodium.jar',
      downloadUrl: 'https://cdn.example/sodium.jar',
      fileSize: 1_200_000,
      client: 'required'
    })
    expect(parsed.files[1].client).toBe('unsupported')
  })

  it.each([
    ['forge', '47.2.0'],
    ['neoforge', '21.1.77'],
    ['quilt-loader', '0.27.2']
  ])('maps the "%s" dependency to the right loader', (dependency, version) => {
    const parsed = parseModrinthIndex({
      dependencies: { minecraft: '1.20.1', [dependency]: version }
    })
    expect(parsed.loader).toBe(dependency === 'quilt-loader' ? 'quilt' : dependency)
    expect(parsed.loaderVersion).toBe(version)
  })

  it('falls back to vanilla with no loader dependency', () => {
    const parsed = parseModrinthIndex({ dependencies: { minecraft: '1.21.1' } })
    expect(parsed.loader).toBe('vanilla')
    expect(parsed.loaderVersion).toBeNull()
    expect(parsed.files).toEqual([])
    expect(parsed.name).toBe('Modpack')
  })

  it('drops files without a download URL', () => {
    const parsed = parseModrinthIndex({
      dependencies: { minecraft: '1.20.1', forge: '47.2.0' },
      files: [{ path: 'mods/broken.jar', downloads: [] }, { path: 'mods/ok.jar', downloads: ['https://x/ok.jar'] }]
    })
    expect(parsed.files.map((file) => file.path)).toEqual(['mods/ok.jar'])
  })
})
