import { app } from 'electron'
import { join } from 'node:path'

export interface LauncherPaths {
  baseDir: string
  configFile: string
  dataRoot: string
  sharedDir: string
  instancesDir: string
  javaDir: string
  skinsDir: string
  logsDir: string
  cacheDir: string
  modpacksDir: string
}

let overrideRoot: string | null = null

function compute(): LauncherPaths {
  const baseDir = join(app.getPath('appData'), 'Verdant')
  const dataRoot = overrideRoot ?? join(baseDir, 'data')
  return {
    baseDir,
    configFile: join(baseDir, 'config.json'),
    dataRoot,
    sharedDir: join(dataRoot, 'shared'),
    instancesDir: join(dataRoot, 'instances'),
    javaDir: join(dataRoot, 'java'),
    skinsDir: join(dataRoot, 'skins'),
    logsDir: join(dataRoot, 'logs'),
    cacheDir: join(dataRoot, 'cache'),
    modpacksDir: join(dataRoot, 'modpacks')
  }
}

export const paths = {
  get(): LauncherPaths {
    return compute()
  },
  setDataRoot(root: string | null): void {
    overrideRoot = root && root.trim().length > 0 ? root : null
  },
  /** Default location suggested in settings. */
  defaultDataRoot(): string {
    return join(app.getPath('appData'), 'Verdant', 'data')
  },
  instanceDir(instanceId: string): string {
    return join(compute().instancesDir, instanceId)
  },
  instanceGameDir(instanceId: string): string {
    return join(compute().instancesDir, instanceId, 'minecraft')
  },
  instanceIcon(instanceId: string): string {
    return join(compute().instancesDir, instanceId, 'icon.png')
  },
  instanceConfig(instanceId: string): string {
    return join(compute().instancesDir, instanceId, 'instance.json')
  }
}
