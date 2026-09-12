/** Strict, Profile-scoped bootstrap for non-secret AERA collaboration identity. */

import { lstatSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

export const AERA_COLLAB_RUNTIME_CONFIG_FILENAME = 'aera-collaboration.json'

const PATH_KEYS = new Set([
  'AERA_COLLAB_STORE_DIR',
  'AERA_COLLAB_CORPUS_ROOT',
  'AERA_COLLAB_STACK_ROOT',
  'AERA_COLLAB_WORKSPACE_ROOT',
])

const REQUIRED_KEYS = new Set([
  ...PATH_KEYS,
  'AERA_COLLAB_PRINCIPAL_ID',
  'AERA_COLLAB_PRINCIPAL_NAME',
  'AERA_COLLAB_AGENT_NAME',
  'AERA_COLLAB_AGENT_ROLE',
  'AERA_COLLAB_DELEGATION_ID',
])

const OPTIONAL_KEYS = new Set([
  'AERA_COLLAB_REPOSITORY_ID',
  'AERA_COLLAB_AGENT_PROVIDER_HINT',
])

const ALLOWED_KEYS = new Set([...REQUIRED_KEYS, ...OPTIONAL_KEYS])
const AGENT_ROLES = new Set(['ORCHESTRATOR', 'IMPLEMENTER', 'REVIEWER', 'NAVIGATOR'])
const PRINCIPAL_ID = /^aera:participant:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REPOSITORY_ID = /^aera-repo:[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/

export interface AeraCollaborationProfileConfigOptions {
  readonly profileDir: string
  readonly environment?: NodeJS.ProcessEnv
}

export type AeraCollaborationProfileConfigResult =
  | { readonly status: 'not-configured' }
  | { readonly status: 'loaded', readonly fieldCount: number }

function requiredObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Aera collaboration Profile configuration ${label} must be an object`)
  }
  return value as Record<string, unknown>
}

/**
 * Apply the selected Profile's complete non-secret collaboration identity.
 *
 * Profile selection is authoritative: a valid document replaces ambient
 * values for this allowlisted namespace, preventing a process launched from
 * another Profile's shell from cross-routing its collaboration store. The
 * document may never carry Gateway credentials or any other arbitrary field.
 * Missing documents retain the existing honest-unavailable behavior.
 */
export function applyAeraCollaborationProfileConfig(
  options: AeraCollaborationProfileConfigOptions,
): AeraCollaborationProfileConfigResult {
  const environment = options.environment ?? process.env
  const path = join(options.profileDir, AERA_COLLAB_RUNTIME_CONFIG_FILENAME)
  let stat
  try {
    stat = lstatSync(path)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'not-configured' }
    throw cause
  }
  if (!stat.isFile()) {
    throw new Error('Aera collaboration Profile configuration must be a regular file')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (cause) {
    throw new Error(
      `Aera collaboration Profile configuration is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
  const document = requiredObject(parsed, 'document')
  const documentKeys = Object.keys(document).sort()
  if (documentKeys.length !== 2 || documentKeys[0] !== 'environment' || documentKeys[1] !== 'version') {
    throw new Error('Aera collaboration Profile configuration has unsupported document fields')
  }
  if (document.version !== 1) {
    throw new Error('Aera collaboration Profile configuration version must be 1')
  }
  const rawEnvironment = requiredObject(document.environment, 'environment')
  const resolved: Record<string, string> = {}
  for (const [key, rawValue] of Object.entries(rawEnvironment)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new Error(`Aera collaboration Profile configuration has unsupported environment key ${key}`)
    }
    if (typeof rawValue !== 'string' || rawValue.trim() === '') {
      throw new Error(`Aera collaboration Profile configuration ${key} must be a non-empty string`)
    }
    const value = rawValue.trim()
    if (PATH_KEYS.has(key) && !isAbsolute(value)) {
      throw new Error(`Aera collaboration Profile configuration ${key} must be an absolute path`)
    }
    resolved[key] = value
  }
  for (const key of REQUIRED_KEYS) {
    if (resolved[key] === undefined) {
      throw new Error(`Aera collaboration Profile configuration is missing required key ${key}`)
    }
  }
  if (!PRINCIPAL_ID.test(resolved.AERA_COLLAB_PRINCIPAL_ID!)) {
    throw new Error('Aera collaboration Profile configuration principal id is invalid')
  }
  if (!AGENT_ROLES.has(resolved.AERA_COLLAB_AGENT_ROLE!)) {
    throw new Error('Aera collaboration Profile configuration agent role is invalid')
  }
  if (
    resolved.AERA_COLLAB_REPOSITORY_ID !== undefined
    && !REPOSITORY_ID.test(resolved.AERA_COLLAB_REPOSITORY_ID)
  ) {
    throw new Error('Aera collaboration Profile configuration repository id is invalid')
  }

  // Mutate the process environment only after the entire document validates.
  for (const [key, value] of Object.entries(resolved)) environment[key] = value
  return { status: 'loaded', fieldCount: Object.keys(resolved).length }
}
