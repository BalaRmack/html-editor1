import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Locks the **custom bootstrapper** wiring (1.2.0).
 *
 * The NSIS wizard is gone: the launcher now ships as an unpacked payload inside
 * a small Electron app that unpacks it, writes shortcuts and registers itself in
 * «Установка и удаление программ». These checks catch the cheap mistakes that a
 * Windows-only build would otherwise reveal ten minutes into CI:
 *  · `electron-builder.installer.yml` losing `extraResources` (empty payload),
 *  · the registry entry drifting away from the uninstaller path,
 *  · the hash-checked shell of `installer/core.ts` forgetting the data-wipe flag,
 *  · a frameless window turning into a white system dialog again.
 */

const root = path.resolve(__dirname, '..');

const read = (relative: string): string => readFileSync(path.join(root, relative), 'utf8');

/** Minimal reader for the flat `key: value` pairs of a top-level YAML block. */
function yamlBlock(file: string, block: string): Record<string, string> {
  const lines = read(file).split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^${block}:\\s*$`).test(line));
  expect(start, `${block}: block must exist in ${file}`).toBeGreaterThanOrEqual(0);
  const values: Record<string, string> = {};
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (!line.startsWith(' ')) break;
    const match = line.match(/^ {2}([\w-]+):\s*(.+)$/);
    if (match) values[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return values;
}

const core = read('installer/core.ts');
const main = read('installer/main.ts');
const app = read('installer/renderer/App.tsx');
const setupYml = read('electron-builder.installer.yml');
const launcherYml = read('electron-builder.yml');

describe('bootstrapper package', () => {
  it('ships the payload next to main.js instead of an NSIS script', () => {
    expect(setupYml).toContain('dist-payload/app.zip');
    expect(setupYml).toContain('to: app.zip');
    expect(setupYml).not.toMatch(/^\s*nsis:/m);
    expect(setupYml).toContain('target: portable');
    expect(launcherYml).not.toMatch(/^\s*nsis:/m);
    expect(existsSync(path.join(root, 'build', 'installer.nsh'))).toBe(false);
  });

  it('bundles every file the bootstrapper needs at runtime', () => {
    const files = yamlBlock('electron-builder.installer.yml', 'files') ?? {};
    // the `files:` list is a YAML array, so assert on the raw text instead
    expect(setupYml).toMatch(/- main\.js/);
    expect(setupYml).toMatch(/- preload\.js/);
    expect(setupYml).toMatch(/- renderer\/\*\*\/\*/);
    expect(setupYml).toMatch(/- package\.json/);
    expect(Object.keys(files)).toHaveLength(0);
  });

  it('keeps the setup artifact name stable for the updater', () => {
    expect(setupYml).toContain('artifactName: Verdant-Launcher-${version}-Setup.${ext}');
    // the updater streams this exact name from the release page
    expect(read('src/main/services/updater.ts')).toContain("'--silent'");
  });
});

describe('uninstall registration', () => {
  it('points DisplayIcon and UninstallString at the installed copies', () => {
    expect(core).toContain("export const APP_ID = 'VerdantLauncher'");
    expect(core).toContain('HKCU');
    expect(core).toContain('Microsoft');
    expect(core).toContain('CurrentVersion');
    expect(core).toContain('Uninstall');
    expect(core).toContain('${APP_ID}');
    expect(core).toContain('UninstallString');
    expect(core).toContain('QuietUninstallString');
    expect(core).toContain('--uninstall');
    expect(core).toContain('--silent');
    expect(core).toContain('EstimatedSize');
  });

  it('installs into LOCALAPPDATA without elevation', () => {
    expect(core).toContain("'LOCALAPPDATA'");
    expect(core).toContain("'VerdantLauncher'");
    expect(core).not.toContain('ProgramFiles');
    expect(core).toContain("'Desktop'");
    expect(core).toContain("'Start Menu'");
  });

  it('wipes user data only when the checkbox asked for it', () => {
    expect(core).toContain('removeData');
    expect(app).toContain('Удалить сохранения и настройки');
    // the launcher's own folder (%APPDATA%\\Verdant) survives a plain uninstall
    expect(core).toMatch(/removeData[\s\S]{0,200}dataDir/);
    // %APPDATA%\Verdant is resolved once and shared by install + uninstall
    expect(core).toContain("process.env['APPDATA']");
    expect(core).toContain("'Verdant'");
  });
});

describe('frameless window', () => {
  it('has no system chrome and keeps the preload sandboxed', () => {
    expect(main).toContain('frame: false');
    expect(main).toContain('contextIsolation: true');
    expect(main).toContain('nodeIntegration: false');
    expect(main).toContain("backgroundColor: '#06110c'");
  });

  it('waits for the running launcher before overwriting it', () => {
    expect(main).toContain('--wait-pid');
    expect(main).toContain('waitForExit');
  });
});

describe('bootstrapper UI', () => {
  it('uses the Verdant palette and no emoji', () => {
    expect(app).toContain('emerald');
    // every icon comes from lucide-react; a literal emoji would break the look
    expect(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(app)).toBe(false);
  });

  it('shows the same install steps as the launcher progress card', () => {
    expect(app).toContain('Подготовка');
    expect(app).toContain('Распаковка');
    expect(app).toContain('Ярлыки');
    expect(app).toContain('Реестр');
  });
});

describe('version', () => {
  it('keeps APP_VERSION in sync with package.json', () => {
    const pkg = JSON.parse(read('package.json')) as { version: string };
    const constants = read('src/shared/constants.ts');
    const declared = constants.match(/export const APP_VERSION = '([^']+)'/)?.[1];
    expect(declared).toBe(pkg.version);
  });

  it('keeps the bootstrapper manifest in sync too', () => {
    const pkg = JSON.parse(read('package.json')) as { version: string };
    const setup = JSON.parse(read('installer/app/package.json')) as { version: string; main: string };
    expect(setup.version).toBe(pkg.version);
    expect(setup.main).toBe('main.js');
  });

  it('does not hardcode the launcher version in the renderer', () => {
    // Minecraft/loader versions are literals everywhere (mock data), so only
    // the app version itself is checked here.
    const pkg = JSON.parse(read('package.json')) as { version: string };
    const files = ['components/layout.tsx', 'lib/mock.ts', 'features/Settings.tsx'];
    for (const file of files) {
      const source = read(path.join('src', 'renderer', 'src', file));
      expect(source, `${file} should import APP_VERSION`).toContain('APP_VERSION');
      expect(source.includes(`${pkg.version}'`), `${file} must not embed ${pkg.version}`).toBe(false);
      expect(source.includes(`v${pkg.version}`), `${file} must not embed v${pkg.version}`).toBe(false);
    }
  });
});
