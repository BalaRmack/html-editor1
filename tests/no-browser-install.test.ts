import { readFileSync } from 'node:fs';
import path from 'node:path';

// js-yaml v4 is ESM-first: the named `load` is the portable import
import { load as parseYaml } from 'js-yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';

import {
  buildManifests,
  installerFileName,
  installerUrl,
  parseArgs,
  sha256File
} from '../scripts/make-winget-manifest.mjs';

/**
 * The "no browser, no SmartScreen" channels.
 *
 * SmartScreen's blue dialog is triggered by the mark-of-the-web, not by the
 * absence of a signature. Two of our install paths never produce that mark:
 * a PowerShell download (`install.ps1`) and winget. These tests lock the pieces
 * that make them work: the checksum check in install.ps1 and the manifest
 * fields winget needs to install silently and to find our uninstall entry.
 */

const root = path.resolve(__dirname, '..');
const read = (relative: string): string => readFileSync(path.join(root, relative), 'utf8');
const release = read('.github/workflows/release.yml');
const ci = read('.github/workflows/ci.yml');
const installerMain = read('installer/main.ts');

const ps1Raw = readFileSync(path.join(root, 'scripts', 'install.ps1'));
const ps1 = ps1Raw.toString('utf8');

describe('install.ps1 — download without a browser', () => {
  it('is a PowerShell 5.1-compatible UTF-8 BOM script with CRLF endings', () => {
    // WinPS 5.1 decodes a BOM-less file as ANSI and mangles the Cyrillic output.
    expect([...ps1Raw.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(ps1).toContain('\r\n');
    expect(ps1).toContain('Invoke-WebRequest');
  });

  it('verifies SHA-256 before it starts anything', () => {
    const hashCheck = ps1.indexOf('Get-FileHash');
    const launch = ps1.indexOf('Start-Process');
    expect(hashCheck).toBeGreaterThan(-1);
    expect(launch).toBeGreaterThan(-1);
    expect(hashCheck, 'hash must be checked before the exe runs').toBeLessThan(launch);
    // a mismatch must delete the file, not "try anyway"
    expect(ps1).toMatch(/if \(\$actual -ne \$expected\)[\s\S]{0,200}Remove-Item[\s\S]{0,200}Fail/);
  });

  it('double-checks that the downloaded file has no mark-of-the-web', () => {
    expect(ps1).toContain('Zone.Identifier');
    expect(ps1).toContain('Unblock-File');
  });

  it('can verify without installing, for CI and for cautious users', () => {
    expect(ps1).toContain('[switch]   $VerifyOnly');
    expect(ps1).toMatch(/if \(\$VerifyOnly\) \{\s*Write-Host[\s\S]{0,200}return/);
  });

  it('takes the version from GitHub instead of hardcoding it', () => {
    expect(ps1).toContain('releases/latest');
    expect(ps1).toContain('releases/tags/v');
    expect(ps1).not.toMatch(/Verdant-Launcher-1\.\d+\.\d+-Setup\.exe/);
  });

  it('is attached to the release under its stable name', () => {
    // irm https://github.com/…/releases/latest/download/install.ps1 | iex
    expect(release).toMatch(/scripts\/install\.ps1/);
    expect(release).toMatch(/dist-winget\/checksums\.txt/);
  });

  it('parses under the real PowerShell parser in CI', () => {
    expect(ci).toContain('System.Management.Automation.Language.Parser');
    expect(ci).toContain('scripts/install.ps1');
  });
});

describe('winget manifests', () => {
  const version = '1.2.0';
  const sha = 'ab'.repeat(32);
  const files = buildManifests({ version, sha256: sha });
  const byName = (suffix: string) => files.find((file) => file.name.endsWith(suffix));

  it('emits the four files a winget submission needs', () => {
    expect(files.map((file) => file.name).sort()).toEqual([
      'BalaRmack.VerdantLauncher.installer.yaml',
      'BalaRmack.VerdantLauncher.locale.en-US.yaml',
      'BalaRmack.VerdantLauncher.locale.ru-RU.yaml',
      'BalaRmack.VerdantLauncher.yaml'
    ]);
  });

  it('validates against the official winget JSON schemas', () => {
    // Vendored from microsoft/winget-cli (see scripts/winget-schemas/README.md).
    // This is the same check `winget validate` runs on the Windows runner, only
    // without a winget install — and it runs on every push, not just releases.
    const ajv = addFormats(new Ajv({ allErrors: true, strict: false }));
    const cases: Array<[string, string]> = [
      ['VerdantLauncher.yaml', 'version'],
      ['.installer.yaml', 'installer'],
      ['.locale.en-US.yaml', 'defaultLocale'],
      ['.locale.ru-RU.yaml', 'locale']
    ];
    for (const [suffix, schemaName] of cases) {
      const file = byName(suffix)!;
      const doc = parseYaml(file.content);
      const schema = JSON.parse(
        readFileSync(path.join(root, 'scripts', 'winget-schemas', `manifest.${schemaName}.1.6.0.json`), 'utf8')
      ) as object;
      const validate = ajv.compile(schema);
      const ok = validate(doc);
      expect(ok, `${file.name}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
  });

  it('declares the manifest types winget requires', () => {
    const versionDoc = parseYaml(byName('VerdantLauncher.yaml')!.content) as Record<string, unknown>;
    const installerDoc = parseYaml(byName('.installer.yaml')!.content) as Record<string, unknown>;
    const enDoc = parseYaml(byName('.locale.en-US.yaml')!.content) as Record<string, unknown>;
    const ruDoc = parseYaml(byName('.locale.ru-RU.yaml')!.content) as Record<string, unknown>;
    expect(versionDoc).toMatchObject({
      PackageIdentifier: 'BalaRmack.VerdantLauncher',
      PackageVersion: version,
      DefaultLocale: 'en-US',
      ManifestType: 'version',
      // schema regex demands major.minor.patch — "1.6" is rejected
      ManifestVersion: '1.6.0'
    });
    expect(installerDoc.ManifestType).toBe('installer');
    // exactly one defaultLocale; the rest are plain locale manifests
    expect(enDoc).toMatchObject({ ManifestType: 'defaultLocale', PackageLocale: 'en-US' });
    expect(ruDoc).toMatchObject({ ManifestType: 'locale', PackageLocale: 'ru-RU' });
  });

  it('points at the exact release asset and pins its hash', () => {
    const installer = parseYaml(byName('.installer.yaml')!.content) as {
      Installers: Array<Record<string, unknown>>;
    };
    expect(installer.Installers).toHaveLength(1);
    const entry = installer.Installers[0];
    expect(entry.InstallerUrl).toBe(installerUrl(version));
    expect(entry.InstallerUrl).toBe(
      'https://github.com/BalaRmack/html-editor1/releases/download/v1.2.0/Verdant-Launcher-1.2.0-Setup.exe'
    );
    expect(entry.InstallerSha256).toBe(sha.toUpperCase());
    expect(entry.Architecture).toBe('x64');
  });

  it('installs silently and without popping the launcher, and finds our uninstall entry', () => {
    const installer = parseYaml(byName('.installer.yaml')!.content) as {
      Installers: Array<{
        InstallerSwitches: Record<string, string>;
        AppsAndFeaturesEntries: Array<Record<string, string>>;
      }>;
      Scope: string;
    };
    const entry = installer.Installers[0];
    // --no-launch exists so winget/install.ps1 can install without starting the app
    expect(entry.InstallerSwitches.Silent).toContain('--silent');
    expect(entry.InstallerSwitches.Silent).toContain('--no-launch');
    expect(entry.AppsAndFeaturesEntries[0]).toMatchObject({
      DisplayName: 'Verdant Launcher',
      Publisher: 'BalaRmack',
      DisplayVersion: version
    });
    // per-user install: winget must not ask for elevation
    expect(installer.Scope).toBe('user');
    expect(installerMain).toContain('--no-launch');
  });

  it('names the artifact exactly like the release does', () => {
    expect(installerFileName(version)).toBe('Verdant-Launcher-1.2.0-Setup.exe');
    // electron-builder.installer.yml keeps the same pattern
    expect(read('electron-builder.installer.yml')).toContain(
      'artifactName: Verdant-Launcher-${version}-Setup.${ext}'
    );
  });

  it('reads --flag value pairs and hashes a real file', async () => {
    expect(parseArgs(['--version', '1.2.0', '--out', 'dist-winget', '--keep'])).toEqual({
      version: '1.2.0',
      out: 'dist-winget',
      keep: 'true'
    });
    const digest = await sha256File(path.join(root, 'package.json'));
    expect(digest).toMatch(/^[0-9A-F]{64}$/);
  });

  it('is generated in CI from the signed exe, so the hash is never stale', () => {
    const signIndex = release.indexOf('Sign bootstrapper');
    const manifestIndex = release.indexOf('Write checksums + winget manifest');
    expect(manifestIndex).toBeGreaterThan(signIndex);
    expect(release).toContain('--from "$setup"');
  });
});

describe('what still cannot be fixed', () => {
  it('documents that a browser download needs a certificate, not a workaround', () => {
    const doc = read('docs/SMARTSCREEN.md');
    expect(doc).toContain('winget');
    expect(doc).toContain('install.ps1');
    // the honest limit must stay in the document
    expect(doc).toMatch(/браузер[\s\S]{0,400}(сертификат|подпис)/i);
  });
});
