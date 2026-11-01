import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Locks the NSIS wizard wiring. The `.nsh` itself is compiled by electron-builder
 * on Windows (see the `installer` CI job), these checks catch the cheap
 * mistakes: missing bitmaps, wrong sizes, a forgotten `nsis.include` or an
 * uninstaller that no longer removes user data.
 */

const root = path.resolve(__dirname, '..');
const installerDir = path.join(root, 'build', 'installer');

function bmpSize(file: string): { width: number; height: number } {
  const buffer = readFileSync(path.join(installerDir, file));
  // "BM" + 24-bit uncompressed DIB: dimensions live in the BITMAPINFOHEADER
  expect(buffer.subarray(0, 2).toString('ascii')).toBe('BM');
  expect(buffer.readUInt32LE(14)).toBe(40); // header size
  expect(buffer.readUInt16LE(28)).toBe(24); // bits per pixel
  return { width: buffer.readInt32LE(18), height: buffer.readInt32LE(22) };
}

/** Minimal reader for the flat `nsis:` block of electron-builder.yml. */
function readNsisBlock(): Record<string, string> {
  // Windows runners check the repo out with CRLF, so split on both endings.
  const lines = readFileSync(path.join(root, 'electron-builder.yml'), 'utf8').split(/\r?\n/);
  const start = lines.findIndex((line) => /^nsis:\s*$/.test(line));
  const values: Record<string, string> = {};
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (!line.startsWith(' ')) break;
    const match = line.match(/^ {2}([\w]+):\s*(.*)$/);
    if (match) values[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return values;
}

const config = { nsis: readNsisBlock() as Record<string, unknown> };

const nshRaw = readFileSync(path.join(root, 'build', 'installer.nsh'));
const nsh = readFileSync(path.join(root, 'build', 'installer.nsh'), 'utf8');

describe('installer assets', () => {
  it('ships MUI-sized sidebars and header', () => {
    expect(bmpSize('installerSidebar.bmp')).toEqual({ width: 164, height: 314 });
    expect(bmpSize('uninstallerSidebar.bmp')).toEqual({ width: 164, height: 314 });
    expect(bmpSize('installerHeader.bmp')).toEqual({ width: 150, height: 57 });
    expect(bmpSize('uninstallerHeader.bmp')).toEqual({ width: 150, height: 57 });
    expect(bmpSize('logo.bmp')).toEqual({ width: 56, height: 56 });
  });

  it('references only bitmaps that exist', () => {
    const fromNsh = [...nsh.matchAll(/\$\{BUILD_RESOURCES_DIR\}[/\\]installer[/\\]([\w.-]+\.bmp)/g)].map((m) => m[1]);
    const fromYml = Object.values(config.nsis)
      .filter((value): value is string => typeof value === 'string' && value.startsWith('build/installer/'))
      .map((value) => path.basename(value));

    expect(fromNsh.length).toBeGreaterThanOrEqual(2);
    expect(fromYml.length).toBeGreaterThanOrEqual(3);
    for (const file of new Set([...fromNsh, ...fromYml])) {
      expect(existsSync(path.join(installerDir, file)), `${file} is referenced by the wizard`).toBe(true);
    }
  });
});

describe('electron-builder wiring', () => {
  it('uses the Verdant include and bitmaps', () => {
    expect(config.nsis.include).toBe('build/installer.nsh');
    expect(config.nsis.installerSidebar).toBe('build/installer/installerSidebar.bmp');
    expect(config.nsis.uninstallerSidebar).toBe('build/installer/uninstallerSidebar.bmp');
    expect(config.nsis.installerHeader).toBe('build/installer/installerHeader.bmp');
  });

  it('keeps user data unless the uninstaller checkbox asks for it', () => {
    expect(config.nsis.deleteAppDataOnUninstall).toBe('false');
    expect(nsh).toContain('Удалить настройки и сохранения');
    expect(nsh).toContain('RMDir /r "$APPDATA\\Verdant"');
    expect(nsh).toContain('!macro customUnInstall');
    expect(nsh).toContain('!macro customUnWelcomePage');
  });

  it('keeps the script UTF-8 with a BOM (Cyrillic copy)', () => {
    // NSIS only decodes Cyrillic correctly when the script is a BOM-marked
    // UTF-8 file; otherwise it falls back to the ANSI code page.
    expect([...nshRaw.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(nsh).toContain('Удаление Verdant Launcher');
  });

  it('themes every MUI page', () => {
    expect(nsh).toContain('!define MUI_BGCOLOR');
    expect(nsh).toContain('!define MUI_TEXTCOLOR');
    expect(nsh).toContain('!define MUI_INSTFILESPAGE_PROGRESSBAR colored');
    expect(nsh).toContain('!define MUI_INSTFILESPAGE_COLORS');
  });
});

describe('version', () => {
  it('keeps APP_VERSION in sync with package.json', () => {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };
    const constants = readFileSync(path.join(root, 'src', 'shared', 'constants.ts'), 'utf8');
    const declared = constants.match(/export const APP_VERSION = '([^']+)'/)?.[1];
    expect(declared).toBe(pkg.version);
  });

  it('does not hardcode the launcher version in the renderer', () => {
    // Minecraft/loader versions are literals everywhere (mock data), so only
    // the app version itself is checked here.
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };
    const files = ['components/layout.tsx', 'lib/mock.ts', 'features/Settings.tsx'];
    for (const file of files) {
      const source = readFileSync(path.join(root, 'src', 'renderer', 'src', file), 'utf8');
      expect(source, `${file} should import APP_VERSION`).toContain('APP_VERSION');
      expect(source.includes(`${pkg.version}'`), `${file} must not embed ${pkg.version}`).toBe(false);
      expect(source.includes(`v${pkg.version}`), `${file} must not embed v${pkg.version}`).toBe(false);
    }
  });
});
