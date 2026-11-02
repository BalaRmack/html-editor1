#!/usr/bin/env node
/**
 * Authenticode signing for the Windows artifacts, provider-agnostic.
 *
 * Since June 2023 the CA/Browser Forum forbids exporting a code-signing private
 * key, so a PFX in GitHub Secrets is no longer how real certificates are used:
 * the key lives on a USB token, on a cloud HSM (DigiCert KeyLocker, SSL.com
 * eSigner, Sectigo) or on Azure Artifact Signing. Each of those ships its own
 * CLI. This script is the single place where the build calls it.
 *
 * Configuration: one secret, `VERDANT_SIGN_CMD` — a command template with a
 * `{file}` placeholder. Examples:
 *
 *   DigiCert KeyLocker    smctl sign --keypair-alias verdant --input {file}
 *   SSL.com eSigner       java -jar CodeSignTool.jar sign -username user -input_file_path {file}
 *   USB token + signtool  signtool sign /sha1 THUMBPRINT /tr http://timestamp.digicert.com /td sha256 {file}
 *   Azure Artifact Sign.  powershell -NoProfile -File scripts/azure-sign.ps1 -File {file}
 *
 * Without the variable the script is a no-op that says so out loud: local builds
 * stay unsigned but working, and CI prints an explicit `UNSIGNED` marker that
 * the verification step turns into a warning — or, once the secret exists, into
 * a hard failure (see `.github/workflows/release.yml`).
 */
import { exec as execShell } from 'node:child_process'
import { promisify } from 'node:util'

const runShell = promisify(execShell)

/**
 * Expands `{file}` (alias `{path}`) in the template.
 *
 * The path is always wrapped in double quotes — Windows install dirs contain
 * spaces (`C:\Users\Some One\...`), and `--input {file}` stays correct.
 *
 * @param {string} template
 * @param {string} file
 * @returns {string}
 */
export function expandCommand(template, file) {
  if (!template.includes('{file}') && !template.includes('{path}')) {
    throw new Error('VERDANT_SIGN_CMD must contain a {file} placeholder')
  }
  return template.replace(/\{file\}|\{path\}/g, `"${file}"`)
}

/**
 * Reads the environment once so every caller agrees on the answer.
 *
 * @param {string[]} files
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ provider: 'command' | 'none', command: string | null, files: string[] }}
 */
export function signingPlan(files, env = process.env) {
  const template = String(env['VERDANT_SIGN_CMD'] ?? '').trim()
  return { provider: template ? 'command' : 'none', command: template || null, files }
}

/**
 * Signs every file through the configured command.
 *
 * Returns `'signed'` or `'unsigned'` instead of throwing on a missing config, so
 * a normal local build keeps working. A command that *fails* does throw: a
 * release must never quietly ship a half-signed installer.
 *
 * @param {string[]} files
 * @param {{ exec?: (command: string) => Promise<unknown>, log?: (line: string) => void, env?: Record<string, string | undefined> }} [deps]
 * @returns {Promise<'signed' | 'unsigned'>}
 */
export async function signArtifacts(files, deps = {}) {
  const log = deps.log ?? ((line) => console.log(line))
  const exec = deps.exec ?? ((command) => runShell(command, { windowsHide: true }))
  const plan = signingPlan(files, deps.env ?? process.env)

  if (plan.provider === 'none' || !plan.command) {
    for (const file of files) log(`UNSIGNED: ${file} (VERDANT_SIGN_CMD не задан)`)
    return 'unsigned'
  }
  for (const file of files) {
    log(`signing: ${file}`)
    await exec(expandCommand(plan.command, file))
    log(`signed: ${file}`)
  }
  return 'signed'
}

/* CLI ---------------------------------------------------------------------- */

const invokedDirectly = process.argv[1]?.endsWith('sign-artifact.mjs')
if (invokedDirectly) {
  const files = process.argv.slice(2).filter((arg) => !arg.startsWith('-'))
  if (files.length === 0) {
    console.error('usage: node scripts/sign-artifact.mjs <file> [file...]')
    process.exit(2)
  }
  signArtifacts(files).catch((error) => {
    console.error(`signing failed: ${error.message}`)
    process.exit(1)
  })
}
