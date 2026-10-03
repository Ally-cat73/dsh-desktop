/**
 * Strict, Profile-scoped, NON-SECRET configuration of the Worker host's
 * local-effect plane (D-0c, WO-AERA-CODE-CLAUDE-CODE-GOVERNED-WORKER-INTEGRATION-001):
 * `<profile>/aera-claude-worker.json`, written by the operator after the
 * sitting. Same rules as `aera-collab-runtime-config.ts` — regular file,
 * `{version: 1, environment: {...}}`, closed key allowlist, every key
 * required except the two O-1 provenance keys below — and it never touches
 * `process.env`: it returns a typed value. Any defect is `not-configured`
 * with a reason naming a key, never a value.
 *
 * O-1 U-D (O1_PROVENANCE_SPEC_V2 §7, V2.1 NO-11), the only OPTIONAL keys:
 *   AERA_CLAUDE_WORKER_CLI_ACCOUNT_EMAIL     the address of the claude.ai
 *       account the worker CLI is signed into (§4.4 EMAIL grammar). It is
 *       reduced HERE, at load, to the two digests of the CLI's own
 *       `session_context` note (`cliMetadataDigests`); the address itself is
 *       kept in no object, never logged, never echoed in a reason. Absent: no
 *       CLI digest is ever committed, so that note stays HUMAN (fail-closed).
 *   AERA_CLAUDE_WORKER_PROVENANCE_MANIFEST   `on` | `off` (default `off`):
 *       `on` sends the per-turn provenance manifest in the v2 attest and
 *       writes turns as content blocks; `off` is v1 attests and string turns.
 *
 * The CA pin is checked HERE, at load (review §1.1 / m-7): the CA file must
 * hold exactly one certificate, a CA, whose SHA-256 DER fingerprint equals
 * `AERA_CLAUDE_WORKER_LE_CA_SHA256`. `createPinnedRouterTransport` trusts the
 * PEM it is given but does not compare the fingerprint itself.
 *
 * D-0d2 (D-0d1 F-1): the governed effect catalog is named by
 * `AERA_CLAUDE_WORKER_EFFECT_CATALOG` and pinned by
 * `AERA_CLAUDE_WORKER_EFFECT_CATALOG_SHA256`; it is loaded HERE through
 * `loadGovernedEffectCatalog`, and any defect is `not-configured` (governed
 * mode, and so the worker, unavailable).
 *
 * H-1: `AERA_CLAUDE_WORKER_MODEL_ROUTER_ORIGIN` is the Router hot-path origin
 * the governed CLI's `ANTHROPIC_BASE_URL` is set to: a bare http(s) origin,
 * character-identical to its own URL origin. Composition then requires it to
 * be a member of the bound environment's EXACT allowed Router origin set.
 */
import { X509Certificate } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { isAeraPrincipalId } from '@aera/cis-contracts'
import { caFingerprintSha256 } from '@aera/effect-broker'
import { loadGovernedEffectCatalog, type PinnedGovernedCatalog } from './aera-worker-governed-effects.ts'
import { isClaudeWorkerRouterOrigin } from './aera-claude-worker-host.ts'
import { cliMetadataDigests, isCliAccountEmail, type CliMetadataDigests } from './aera-worker-provenance.ts'

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
  AERA_CLAUDE_WORKER_EFFECT_CATALOG: (v: string) => isAbsolute(v),
  AERA_CLAUDE_WORKER_EFFECT_CATALOG_SHA256: (v: string) => /^[a-f0-9]{64}$/u.test(v),
  AERA_CLAUDE_WORKER_MODEL_ROUTER_ORIGIN: (v: string) => isClaudeWorkerRouterOrigin(v),
} as const
type ConfigKey = keyof typeof VALIDATORS

/** O-1 U-D: the only optional keys (§7). */
const OPTIONAL_VALIDATORS = {
  AERA_CLAUDE_WORKER_CLI_ACCOUNT_EMAIL: (v: string) => isCliAccountEmail(v),
  AERA_CLAUDE_WORKER_PROVENANCE_MANIFEST: (v: string) => v === 'on' || v === 'off',
} as const
type OptionalConfigKey = keyof typeof OPTIONAL_VALIDATORS
const validatorFor = (key: string): ((v: string) => boolean) | undefined =>
  key in VALIDATORS ? VALIDATORS[key as ConfigKey] : key in OPTIONAL_VALIDATORS ? OPTIONAL_VALIDATORS[key as OptionalConfigKey] : undefined

/** O-1 U-D provenance settings: the flag, and only the digests of the CLI note (never the address). */
export interface WorkerProvenanceSettings {
  readonly manifest: boolean
  readonly cliMetadata?: CliMetadataDigests
}

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
  /** The reviewed governed-effect catalog, pinned by the sha256 of its bytes (D-0d1). */
  readonly effectCatalog: PinnedGovernedCatalog
  /** H-1: the Router hot-path origin for the CLI's ANTHROPIC_BASE_URL (exact-set checked at composition). */
  readonly modelRouterOrigin: string
  /** O-1 U-D: the manifest flag and the CLI-note digests (§7; the address is not kept). */
  readonly provenance: WorkerProvenanceSettings
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
  const values: Partial<Record<ConfigKey | OptionalConfigKey, string>> = {}
  for (const [key, raw] of Object.entries(env as Record<string, unknown>)) {
    const validator = validatorFor(key)
    if (validator === undefined) return notConfigured(/^[A-Z0-9_]{1,80}$/u.test(key) ? `CONFIG_UNKNOWN_KEY:${key}` : 'CONFIG_UNKNOWN_KEY')
    const value = typeof raw === 'string' ? raw.trim() : ''
    if (value === '' || !validator(value)) return notConfigured(`CONFIG_INVALID:${key}`)
    values[key as ConfigKey | OptionalConfigKey] = value
  }
  const email = values.AERA_CLAUDE_WORKER_CLI_ACCOUNT_EMAIL
  const provenance: WorkerProvenanceSettings = Object.freeze({
    manifest: values.AERA_CLAUDE_WORKER_PROVENANCE_MANIFEST === 'on',
    ...(email === undefined ? {} : { cliMetadata: cliMetadataDigests(email) }),
  })
  delete values.AERA_CLAUDE_WORKER_CLI_ACCOUNT_EMAIL
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
  const catalog = loadGovernedEffectCatalog(v.AERA_CLAUDE_WORKER_EFFECT_CATALOG, v.AERA_CLAUDE_WORKER_EFFECT_CATALOG_SHA256)
  if (catalog.status !== 'loaded') return notConfigured(catalog.reason)
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
      effectCatalog: catalog.pinned,
      modelRouterOrigin: v.AERA_CLAUDE_WORKER_MODEL_ROUTER_ORIGIN,
      provenance,
    }),
  }
}
