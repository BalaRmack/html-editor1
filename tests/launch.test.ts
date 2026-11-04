import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateArguments, Version } from '@xmcl/core'
import { describe, expect, it } from 'vitest'
import { buildJvmArgs, splitArgs } from '../src/main/services/launch'
import { offlineToken, offlineUuid } from '../src/main/services/offline'

/**
 * Builds a tiny but spec-accurate version manifest and verifies that our launch
 * option assembly produces a correct java command line: memory flags, offline
 * credentials, natives directory, classpath and game arguments.
 */
async function createFakeVersion(root: string, id = 'test-1'): Promise<void> {
  const versionDir = join(root, 'versions', id)
  await mkdir(versionDir, { recursive: true })
  const manifest = {
    id,
    type: 'release',
    mainClass: 'net.minecraft.client.main.Main',
    assets: 'test-assets',
    assetIndex: {
      id: 'test-assets',
      sha1: '0000000000000000000000000000000000000000',
      size: 1,
      totalSize: 1,
      url: 'https://example.invalid/index.json'
    },
    downloads: {
      client: {
        sha1: '0000000000000000000000000000000000000000',
        size: 1,
        url: 'https://example.invalid/client.jar'
      }
    },
    libraries: [
      {
        name: 'com.example:testlib:1.0',
        downloads: {
          artifact: {
            path: 'com/example/testlib/1.0/testlib-1.0.jar',
            sha1: '0000000000000000000000000000000000000000',
            size: 1,
            url: 'https://example.invalid/testlib.jar'
          }
        }
      }
    ],
    arguments: {
      game: [
        '--username',
        '${auth_player_name}',
        '--version',
        '${version_name}',
        '--gameDir',
        '${game_directory}',
        '--assetsDir',
        '${assets_root}',
        '--assetIndex',
        '${assets_index_name}',
        '--uuid',
        '${auth_uuid}',
        '--accessToken',
        '${auth_access_token}',
        '--userType',
        '${user_type}'
      ],
      jvm: ['-Djava.library.path=${natives_directory}', '-cp', '${classpath}']
    }
  }
  await writeFile(join(versionDir, `${id}.json`), JSON.stringify(manifest, null, 2))
  await writeFile(join(versionDir, `${id}.jar`), 'not-a-real-jar')
}

describe('launch command assembly', () => {
  it('produces correct java arguments for an offline profile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'verdant-test-'))
    await createFakeVersion(root)
    const resolved = await Version.parse(root, 'test-1')
    expect(resolved.mainClass).toBe('net.minecraft.client.main.Main')
    expect(resolved.libraries.length).toBe(1)

    const uuid = offlineUuid('Notch')
    const token = offlineToken(uuid)
    const args = await generateArguments({
      gamePath: join(root, 'instances', 'demo', 'minecraft'),
      resourcePath: root,
      javaPath: 'java',
      version: resolved,
      gameProfile: { name: 'Notch', id: uuid },
      accessToken: token,
      userType: 'mojang',
      launcherName: 'Verdant Launcher',
      launcherBrand: '1.0.0',
      minMemory: 1024,
      maxMemory: 6144,
      extraJVMArgs: buildJvmArgs('-XX:+UseZGC'),
      nativeRoot: join(root, 'natives'),
      extraExecOption: { windowsHide: true }
    })

    const line = args.join(' ')
    expect(line.toLowerCase()).toContain('-xms1024m')
    expect(line.toLowerCase()).toContain('-xmx6144m')
    expect(line).toContain('-XX:+UseZGC')
    expect(line).toContain(`-Djava.library.path=${join(root, 'natives')}`)
    expect(line).toContain(`-cp `)
    expect(line).toContain(join('libraries', 'com', 'example', 'testlib', '1.0', 'testlib-1.0.jar'))
    expect(line).toContain(join('versions', 'test-1', 'test-1.jar'))
    expect(line).toContain('--username Notch')
    expect(line).toContain(`--uuid ${uuid}`)
    expect(line).toContain(`--accessToken ${token}`)
    expect(line).toContain('--userType mojang')
    expect(line).toContain(join('instances', 'demo', 'minecraft'))
    expect(line).toContain('net.minecraft.client.main.Main')
  })

  it('keeps the game directory isolated per instance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'verdant-test-'))
    await createFakeVersion(root)
    const resolved = await Version.parse(root, 'test-1')
    const gamePath = join(root, 'instances', 'alpha', 'minecraft')
    const args = await generateArguments({
      gamePath,
      resourcePath: root,
      javaPath: 'java',
      version: resolved,
      gameProfile: { name: 'Steve', id: offlineUuid('Steve') },
      maxMemory: 2048
    })
    expect(args.join(' ')).toContain(`--gameDir ${gamePath}`)
  })
})

describe('arg tokenizer', () => {
  it('handles nested quotes and whitespace', () => {
    expect(splitArgs(`-Dx="1 2" -Dy='3 4'   plain`)).toEqual(['-Dx=1 2', '-Dy=3 4', 'plain'])
  })
})
