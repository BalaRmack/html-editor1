import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { expandCommand, signArtifacts, signingPlan } from '../scripts/sign-artifact.mjs';

/**
 * Code-signing wiring.
 *
 * The signing command itself lives in a GitHub secret, so nothing here can prove
 * that a real certificate works — but it locks the part that quietly breaks
 * releases: template expansion, the silent no-op for local builds, and the
 * order of steps in the pipeline (payload must be signed *before* it is zipped,
 * and the setup exe before it is uploaded).
 */

const root = path.resolve(__dirname, '..');
const read = (relative: string): string => readFileSync(path.join(root, relative), 'utf8');
const release = read('.github/workflows/release.yml');
const ci = read('.github/workflows/ci.yml');
const doc = read('docs/SMARTSCREEN.md');

describe('signing command template', () => {
  it('substitutes {file} and quotes paths with spaces', () => {
    expect(expandCommand('smctl sign --input {file}', 'C:\\Program Files\\Verdant Launcher.exe')).toBe(
      'smctl sign --input "C:\\Program Files\\Verdant Launcher.exe"'
    );
  });

  it('accepts the {path} alias and rejects a template without a placeholder', () => {
    expect(expandCommand('sign {path}', '/tmp/a.exe')).toBe('sign "/tmp/a.exe"');
    expect(() => expandCommand('signtool sign', '/tmp/a.exe')).toThrow(/placeholder/);
  });

  it('reports "none" when the secret is empty, so local builds stay unsigned but working', () => {
    expect(signingPlan(['a.exe'], {}).provider).toBe('none');
    expect(signingPlan(['a.exe'], { VERDANT_SIGN_CMD: '   ' }).provider).toBe('none');
    expect(signingPlan(['a.exe'], { VERDANT_SIGN_CMD: 'signtool sign {file}' })).toEqual({
      provider: 'command',
      command: 'signtool sign {file}',
      files: ['a.exe']
    });
  });
});

describe('signArtifacts', () => {
  it('is a loud no-op without a certificate', async () => {
    const lines: string[] = [];
    const calls: string[] = [];
    const outcome = await signArtifacts(['a.exe', 'b.exe'], {
      env: {},
      log: (line) => lines.push(line),
      exec: async (command) => calls.push(command)
    });
    expect(outcome).toBe('unsigned');
    expect(calls).toEqual([]);
    expect(lines).toEqual([
      'UNSIGNED: a.exe (VERDANT_SIGN_CMD не задан)',
      'UNSIGNED: b.exe (VERDANT_SIGN_CMD не задан)'
    ]);
  });

  it('signs every file in order', async () => {
    const calls: string[] = [];
    const outcome = await signArtifacts(['setup.exe', 'launcher.exe'], {
      env: { VERDANT_SIGN_CMD: 'signtool sign /fd sha256 {file}' },
      log: () => undefined,
      exec: async (command) => calls.push(command)
    });
    expect(outcome).toBe('signed');
    expect(calls).toEqual(['signtool sign /fd sha256 "setup.exe"', 'signtool sign /fd sha256 "launcher.exe"']);
  });

  it('never swallows a failing signer — a half-signed release must not ship', async () => {
    await expect(
      signArtifacts(['setup.exe'], {
        env: { VERDANT_SIGN_CMD: 'signtool sign {file}' },
        log: () => undefined,
        exec: async () => {
          throw new Error('SignTool Error: No certificates were found')
        }
      })
    ).rejects.toThrow(/No certificates were found/);
  });
});

describe('pipeline order', () => {
  it('signs the payload before zipping and the setup exe before uploading', () => {
    const order = [
      'Build launcher payload (unpacked app)',
      'Sign launcher payload',
      'Pack payload into app.zip',
      'Package bootstrapper (single .exe)',
      'Sign bootstrapper',
      'Verify Authenticode signatures',
      'Upload installer artifact'
    ];
    const positions = order.map((step) => release.indexOf(step));
    for (let index = 0; index < positions.length; index++) {
      expect(positions[index], `step "${order[index]}" is missing`).toBeGreaterThan(-1);
      if (index > 0) expect(positions[index], `"${order[index]}" must come after "${order[index - 1]}"`).toBeGreaterThan(positions[index - 1]);
    }
  });

  it('reads the command from one secret, never from a checked-in key', () => {
    expect(release).toContain('VERDANT_SIGN_CMD: ${{ secrets.VERDANT_SIGN_CMD }}');
    expect(ci).toContain('VERDANT_SIGN_CMD: ${{ secrets.VERDANT_SIGN_CMD }}');
    // a certificate file in the repo would be a leak waiting to happen
    expect(release).not.toMatch(/CSC_LINK:\s*\$?\{?\{?\s*secrets/i);
  });

  it('fails the release on an invalid or unstamped signature once a certificate exists', () => {
    expect(release).toContain("if ($expected -and $sig.Status -ne 'Valid') { throw");
    expect(release).toContain("if ($expected -and -not $sig.TimeStamperCertificate) { throw");
    // and warns — rather than fails — while the project is still unsigned
    expect(release).toContain('::warning title=Сборка без подписи::');
    expect(ci).toContain('::warning title=Сборка без подписи::');
  });
});

describe('user-facing SmartScreen copy', () => {
  it('tells people how to unblock the file instead of blaming their antivirus', () => {
    expect(release).toContain('Unblock-File');
    expect(release).toContain('Windows защитила ваш компьютер');
    expect(doc).toContain('Unblock-File');
  });

  it('does not promise that a signature removes the warning instantly', () => {
    expect(doc).toContain('Microsoft убрал «мгновенный обход» даже для EV-сертификатов');
    expect(doc).toContain('Trusted Signing');
    // sentence-initial capital in the doc, so compare case-insensitively
    expect(doc.toLowerCase()).toContain('с июня 2023');
    // "подпись = окна не будет" would be a lie we would have to answer for
    expect(doc).not.toMatch(/подпись (полностью )?убирает (окно|предупреждение)/i);
  });
});
