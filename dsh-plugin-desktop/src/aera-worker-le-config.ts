/**
 * Strict, Profile-scoped, NON-SECRET configuration of the Worker host's
 * local-effect plane (D-0c, WO-AERA-CODE-CLAUDE-CODE-GOVERNED-WORKER-INTEGRATION-001):
 * `<profile>/aera-claude-worker.json`, written by the operator after the
 * sitting. Same rules as `aera-collab-runtime-config.ts` — regular file,
 * `{version: 1, environment: {...}}`, closed key allowlist, every key
 * required — except that it never touches `process.env`: it returns a typed
 * value. Any defect is `not-configured` with a reason naming a key, never a
 * value.
 *
 * The CA pin is checked HERE, at load (review §1.1 / m-7): the CA file must
 * hold exactly one certificate, a CA, whose SHA-256 DER fingerprint equals
 * `AERA_CLAUDE_WORKER_LE_CA_SHA256`. `createPinnedRouterTransport` trusts the
 * PEM it is given but does not compare the fingerprint itself.
 */
import { X509Certificate } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { isAeraPrincipalId } from '@aera/cis-contracts'
import { caFingerprintSha256 } from '@aera/effect-broker'

export const AERA_CLAUDE_WORKER_CONFIG_FILENAME = 'aera-claude-worker.json'

const OPAQUE = /^[A-Za-z0-9][A-Za-z0-9:._@/+-]{0,199}$/u
const VALIDATORS = {
  AERA_CLAUDE_WORKER_LE_ROUTER_URL: (v: string) => {
    try {
      const url = new URL(v)
      return url.protocol === 'https:' && url.pathname === '/' && url.search === '' && url.hash === '' && url.username === '' && url.password === ''
    } catch {
      return false
    }
  },
  AERA_CLAUDE_WORKER_LE_CA_FILE: (v: string) => isAbsolute(v),
  AERA_CLAUDE_WORKER_LE_CA_SHA256: (v: string) => /^[a-f0-9]{64}$/u.test(v),
  AERA_CLAUDE_WORKER_LE_ROUTER_URI_SAN: (v: string) => /^spiffe:\/\/[A-Za-z0-9.-]{1,100}\/[\x21-\x7e]{1,200}$/u.test(v),
  AERA_CLAUDE_WORKER_CIS_ISSUER: (v: string) => /^[\x21-\x7e]{1,200}$/u.test(v),
  AERA_CLAUDE_WORKER_AGENT_PRINCIPAL_ID: (v: string) => isAeraPrincipalId(v),
  AERA_CLAUDE_WORKER_INSTALLATION_KEY_ID: (v: string) => /^[A-Za-z0-9_-]{43}$/u.test(v),
  AERA_CLAUDE_WORKER_AERA_SESSION_ID: (v: string) => OPAQUE.test(v),
  AERA_CLAUDE_WORKER_CONNECTION_ID: (v: string) => OPAQUE.test(v),
  AERA_CLAUDE_WORKER_ORGANISATION_ID: (v: string) => OPAQUE.test(v),
  AERA_CLAUDE_WORKER_REPOSITORY_ID: (v: string) => OPAQUE.test(v),
  AERA_CLAUDE_WORKER_WORKING_LINE_ID: (v: string) => OPAQUE.test(v),
} as const
type ConfigKey = keyof typeof VALIDATORS

export interface WorkerLocalEffectConfig {
  readonly routerUrl: string
  readonly caPem: Buffer
  readonly caFingerprintSha256: string
  readonly routerUriSan: string
  readonly cisIssuer: string
  readonly agentPrincipalId: string
  readonly installationKeyId: string
  readonly aeraSessionId: string
  readonly connectionId: string
  readonly organisationId: string
  readonly repositoryId: string
  readonly workingLineId: string
}

export type WorkerLocalEffectConfigResult =
  | { readonly status: 'loaded', readonly config: WorkerLocalEffectConfig }
  | { readonly status: 'not-configured', readonly reason: string }

const notConfigured = (reason: string): WorkerLocalEffectConfigResult => ({ status: 'not-configured', reason })

export function loadWorkerLocalEffectConfig(profileDir: string): WorkerLocalEffectConfigResult {
  const path = join(profileDir, AERA_CLAUDE_WORKER_CONFIG_FILENAME)
  try {
    if (!lstatSync(path).isFile()) return notConfigured('CONFIG_NOT_REGULAR_FILE')
  } catch {
    return notConfigured('CONFIG_MISSING')
  }
  let document: unknown
  try {
    document = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return notConfigured('CONFIG_NOT_JSON')
  }
  if (document === null || typeof document !== 'object' || Array.isArray(document)) return notConfigured('CONFIG_UNSUPPORTED_FIELDS')
  const top = document as Record<string, unknown>
  if (Object.keys(top).sort().join(',') !== 'environment,version') return notConfigured('CONFIG_UNSUPPORTED_FIELDS')
  if (top.version !== 1) return notConfigured('CONFIG_VERSION')
  const env = top.environment
  if (env === null || typeof env !== 'object' || Array.isArray(env)) return notConfigured('CONFIG_UNSUPPORTED_FIELDS')
  const values: Partial<Record<ConfigKey, string>> = {}
  for (const [key, raw] of Object.entries(env as Record<string, unknown>)) {
    if (!(key in VALIDATORS)) return notConfigured(/^[A-Z0-9_]{1,80}$/u.test(key) ? `CONFIG_UNKNOWN_KEY:${key}` : 'CONFIG_UNKNOWN_KEY')
    const value = typeof raw === 'string' ? raw.trim() : ''
    if (value === '' || !VALIDATORS[key as ConfigKey](value)) return notConfigured(`CONFIG_INVALID:${key}`)
    values[key as ConfigKey] = value
  }
  for (const key of Object.keys(VALIDATORS) as ConfigKey[]) if (values[key] === undefined) return notConfigured(`CONFIG_MISSING_KEY:${key}`)
  const v = values as Record<ConfigKey, string>

  let caPem: Buffer
  try {
    const stat = lstatSync(v.AERA_CLAUDE_WORKER_LE_CA_FILE)
    if (!stat.isFile() || stat.size > 64 * 1024) return notConfigured('CONFIG_INVALID:AERA_CLAUDE_WORKER_LE_CA_FILE')
    caPem = readFileSync(v.AERA_CLAUDE_WORKER_LE_CA_FILE)
  } catch {
    return notConfigured('CONFIG_INVALID:AERA_CLAUDE_WORKER_LE_CA_FILE')
  }
  const text = caPem.toString('utf8')
  if ((text.match(/-----BEGIN [A-Z ]+-----/gu) ?? []).length !== 1 || !text.includes('-----BEGIN CERTIFICATE-----')) return notConfigured('LE_CA_NOT_SINGLE_CERTIFICATE')
  try {
    if (!new X509Certificate(caPem).ca) return notConfigured('LE_CA_NOT_A_CA')
    if (caFingerprintSha256(caPem) !== v.AERA_CLAUDE_WORKER_LE_CA_SHA256) return notConfigured('LE_CA_PIN_MISMATCH')
  } catch {
    return notConfigured('LE_CA_NOT_SINGLE_CERTIFICATE')
  }
  return {
    status: 'loaded',
    config: Object.freeze({
      routerUrl: v.AERA_CLAUDE_WORKER_LE_ROUTER_URL,
      caPem,
      caFingerprintSha256: v.AERA_CLAUDE_WORKER_LE_CA_SHA256,
      routerUriSan: v.AERA_CLAUDE_WORKER_LE_ROUTER_URI_SAN,
      cisIssuer: v.AERA_CLAUDE_WORKER_CIS_ISSUER,
      agentPrincipalId: v.AERA_CLAUDE_WORKER_AGENT_PRINCIPAL_ID,
      installationKeyId: v.AERA_CLAUDE_WORKER_INSTALLATION_KEY_ID,
      aeraSessionId: v.AERA_CLAUDE_WORKER_AERA_SESSION_ID,
      connectionId: v.AERA_CLAUDE_WORKER_CONNECTION_ID,
      organisationId: v.AERA_CLAUDE_WORKER_ORGANISATION_ID,
      repositoryId: v.AERA_CLAUDE_WORKER_REPOSITORY_ID,
      workingLineId: v.AERA_CLAUDE_WORKER_WORKING_LINE_ID,
    }),
  }
}
