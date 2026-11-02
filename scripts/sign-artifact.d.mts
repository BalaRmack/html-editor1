/**
 * Types for `scripts/sign-artifact.mjs` (plain ESM, runs unbuilt in CI).
 * Kept next to the script so `tests/signing.test.ts` type-checks strictly.
 */

export type SigningProvider = 'command' | 'none'

export interface SigningPlan {
  provider: SigningProvider
  command: string | null
  files: string[]
}

export interface SignDependencies {
  exec?: (command: string) => Promise<unknown>
  log?: (line: string) => void
  env?: Record<string, string | undefined>
}

export function expandCommand(template: string, file: string): string
export function signingPlan(files: string[], env?: Record<string, string | undefined>): SigningPlan
export function signArtifacts(files: string[], deps?: SignDependencies): Promise<'signed' | 'unsigned'>
