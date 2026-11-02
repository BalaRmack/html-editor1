/**
 * Types for `scripts/make-winget-manifest.mjs`, so tests can import the
 * generator and still pass `tsc --strict`.
 */

export interface ManifestFile {
  name: string
  content: string
  /** Installer size in bytes, when known (0 for a synthetic manifest). */
  size: number
  fileName: string
}

export const PACKAGE_IDENTIFIER: string
export const PACKAGE_NAME: string
export const PUBLISHER: string
export const GITHUB_REPO: string
export const MANIFEST_VERSION: string

export function installerFileName(version: string): string
export function installerUrl(version: string, repo?: string): string
export function buildManifests(input: { version: string; sha256: string; installerSize?: number }): ManifestFile[]
export function sha256File(path: string): Promise<string>
export function parseArgs(argv: string[]): Record<string, string>
