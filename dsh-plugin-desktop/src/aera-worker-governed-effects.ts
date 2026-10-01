/**
 * Governed-effect adapter — D-0d1 of
 * WO-AERA-CODE-CLAUDE-CODE-GOVERNED-WORKER-INTEGRATION-001.
 *
 * Maps a validated desktop worker intent (`aera-worker-effect-intent.ts`)
 * onto a request for the vendored `@aera/effect-broker` (`EffectBroker.execute`).
 * It PRODUCES REQUESTS ONLY: it performs nothing, decides no authority and
 * calls neither CAS nor the Router (that is D-0d2's broker wiring).
 *
 * - The closed set is the owner-approved delegation capabilities
 *   (`aera.repo.read`, `aera.repo.patch`, `aera.test.run`; workplan W4.4).
 *   Every other intent kind is refused in governed mode with the typed
 *   `NOT_DELEGATED_IN_GOVERNED_MODE` (controller decision CD-1): commit,
 *   checkpoint, list, build, shell, git reads, context and the no-executor kinds.
 * - Before any effect the configured canonical Working Line and repository
 *   (`WorkerLocalEffectConfig`) must equal, exactly, what the desktop resolved
 *   for the local worktree (`resolveWorktree(line)`). Otherwise CAS would
 *   authorise one canonical resource while the broker wrote another checkout
 *   (review M-4; addendum §24 "a label can substitute for the canonical id").
 *   Labels are never compared.
 * - `exec.test`: the model's argv must equal `[executable, ...argv]` of exactly
 *   one catalog command (review m-6); it then names that entry's parameter
 *   tuple. Model text never builds a command; the broker resolves the trusted
 *   command from the tuple and runs it only in its sandbox.
 * - The broker refuses EVERY effect — read and patch too, not only PROCESS —
 *   without an established sandbox (`broker.ts:236`, review m-12). D-0d2 must
 *   hand it the `aera-worker-sandbox-exec.ts` port.
 * - `effectAttemptId` is host-derived and deterministic
 *   (`<desktopEpochId>:t<turn>:<ordinal>`), never the model's `intentId`
 *   (`catalog.ts` L-8).
 *
 * The catalog is an operator-prepared, reviewed artefact. It is pinned by
 * sha256 over its exact bytes; any defect is `UNAVAILABLE` (governed mode off).
 */
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import {
  assertCapabilityCatalog,
  type CapabilityCatalog,
  type CapabilityConfig,
  type EffectIntent,
  type ProcessCapabilityConfig,
  type TrustedCommand,
} from '@aera/effect-broker'
import { isAeraRepositoryId, isAeraWorkingLineId, type WorkingLineLocation } from '@aera/local-effect-authority'
import type { EffectIntentKind, EffectIntentV1 } from './aera-worker-effect-intent.ts'

/** The closed governed set (CD-1). */
export const GOVERNED_EFFECT_CAPABILITIES = Object.freeze(['aera.repo.read', 'aera.repo.patch', 'aera.test.run'] as const)
export type GovernedEffectCapability = (typeof GOVERNED_EFFECT_CAPABILITIES)[number]

/** Desktop intent kind → governed capability. Kinds absent here are refused. */
export const GOVERNED_INTENT_CAPABILITY: Readonly<Partial<Record<EffectIntentKind, GovernedEffectCapability>>> = Object.freeze({
  'fs.read': 'aera.repo.read',
  'fs.write': 'aera.repo.patch',
  'exec.test': 'aera.test.run',
})

/** The effect-broker catalog kind each governed capability must have. */
export const GOVERNED_CATALOG_KINDS: Readonly<Record<GovernedEffectCapability, CapabilityConfig['kind']>> = Object.freeze({
  'aera.repo.read': 'READ_FILE',
  'aera.repo.patch': 'REPLACE_FILE',
  'aera.test.run': 'PROCESS',
})

/** Config keys (in `aera-claude-worker.json`) that name the catalog and its pin; read by D-0d2. */
export const AERA_CLAUDE_WORKER_EFFECT_CATALOG = 'AERA_CLAUDE_WORKER_EFFECT_CATALOG'
export const AERA_CLAUDE_WORKER_EFFECT_CATALOG_SHA256 = 'AERA_CLAUDE_WORKER_EFFECT_CATALOG_SHA256'
export const MAX_EFFECT_CATALOG_BYTES = 64 * 1024

export type GovernedEffectRefusalCode =
  | 'NOT_DELEGATED_IN_GOVERNED_MODE'
  | 'WORKING_LINE_BINDING_MISMATCH'
  | 'WORKING_LINE_BINDING_INVALID'
  | 'INTENT_WORKING_LINE_MISMATCH'
  | 'TEST_COMMAND_NOT_IN_CATALOG'
  | 'TEST_COMMAND_AMBIGUOUS'
  | 'EFFECT_ATTEMPT_ID_INVALID'

export interface GovernedEffectRefusal {
  readonly ok: false
  readonly code: GovernedEffectRefusalCode
  /** Names ids and kinds only; never file content. */
  readonly reason: string
}

const refusal = (code: GovernedEffectRefusalCode, reason: string): GovernedEffectRefusal => ({ ok: false, code, reason })

// ---------------------------------------------------------------------------
// Catalog pin
// ---------------------------------------------------------------------------

export interface PinnedGovernedCatalog {
  readonly catalog: CapabilityCatalog
  /** sha256 (hex) of the exact catalog file bytes. */
  readonly sha256: string
}

export type GovernedCatalogLoad =
  | { readonly status: 'loaded', readonly pinned: PinnedGovernedCatalog }
  | { readonly status: 'UNAVAILABLE', readonly reason: string }

class CatalogInvalid extends Error {}
const invalid = (what: string): never => {
  throw new CatalogInvalid(what)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

function exactKeys(value: Record<string, unknown>, keys: readonly string[], what: string): void {
  if (Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) invalid(what)
}

const positiveInt = (value: unknown): boolean => typeof value === 'number' && Number.isSafeInteger(value) && value > 0

function parseParameterKey(key: string): Record<string, string> | undefined {
  const values: Record<string, string> = {}
  for (const pair of key.split('&')) {
    const eq = pair.indexOf('=')
    if (eq <= 0) return undefined
    const name = pair.slice(0, eq)
    if (name in values) return undefined
    values[name] = pair.slice(eq + 1)
  }
  return values
}

const canonicalParameterKey = (values: Readonly<Record<string, string>>): string =>
  Object.keys(values).sort().map(key => `${key}=${values[key] ?? ''}`).join('&')

function validateCommand(value: unknown): TrustedCommand {
  if (!isRecord(value)) return invalid('COMMAND')
  exactKeys(value, ['executable', 'argv', 'cwd', 'env', 'timeoutMs', 'maxOutputBytes'], 'COMMAND_FIELDS')
  if (typeof value.executable !== 'string' || typeof value.cwd !== 'string') invalid('COMMAND_FIELDS')
  if (!Array.isArray(value.argv) || !value.argv.every(arg => typeof arg === 'string')) invalid('COMMAND_ARGV')
  if (!isRecord(value.env) || !Object.values(value.env).every(entry => typeof entry === 'string')) invalid('COMMAND_ENV')
  if (!positiveInt(value.timeoutMs) || !positiveInt(value.maxOutputBytes)) invalid('COMMAND_BOUNDS')
  return value as unknown as TrustedCommand
}

function validateProcess(value: Record<string, unknown>): void {
  exactKeys(value, ['kind', 'mutation', 'parameters', 'commands'], 'PROCESS_FIELDS')
  if (value.mutation !== 'READ_ONLY' && value.mutation !== 'WORKSPACE_WRITE') invalid('PROCESS_MUTATION')
  const parameters = value.parameters
  if (!isRecord(parameters) || Object.keys(parameters).length === 0) return invalid('PROCESS_PARAMETERS')
  for (const allowed of Object.values(parameters)) {
    if (!Array.isArray(allowed) || allowed.length === 0 || !allowed.every(item => typeof item === 'string' && item !== '' && !/[&=]/u.test(item))) invalid('PROCESS_PARAMETERS')
  }
  const commands = value.commands
  if (!isRecord(commands) || Object.keys(commands).length === 0) return invalid('PROCESS_NO_COMMANDS')
  for (const [key, command] of Object.entries(commands)) {
    validateCommand(command)
    // Every command key must be the canonical tuple of a full, allowed
    // assignment, so the tuple a match emits resolves to exactly this entry.
    const values = parseParameterKey(key)
    if (values === undefined || canonicalParameterKey(values) !== key) invalid('COMMAND_KEY_NOT_CANONICAL')
    const declared = Object.keys(parameters).sort().join(',')
    if (Object.keys(values ?? {}).sort().join(',') !== declared) invalid('COMMAND_KEY_PARAMETERS')
    for (const [name, chosen] of Object.entries(values ?? {})) {
      if (!(parameters[name] as string[]).includes(chosen)) invalid('COMMAND_KEY_VALUE_NOT_DECLARED')
    }
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

/** Validate a parsed catalog document: exactly the governed set, right kinds, well-formed entries. */
function validateGovernedCatalog(document: unknown): CapabilityCatalog {
  if (!isRecord(document)) return invalid('DOCUMENT')
  exactKeys(document, GOVERNED_EFFECT_CAPABILITIES, 'CAPABILITY_SET')
  for (const capability of GOVERNED_EFFECT_CAPABILITIES) {
    const config = document[capability]
    if (!isRecord(config) || config.kind !== GOVERNED_CATALOG_KINDS[capability]) return invalid(`KIND:${capability}`)
    if (config.kind === 'PROCESS') validateProcess(config)
    else exactKeys(config, ['kind', 'maxBytes'], `FIELDS:${capability}`)
  }
  const catalog = document as unknown as CapabilityCatalog
  try {
    assertCapabilityCatalog(catalog)
  } catch (error) {
    invalid(error instanceof Error ? error.message : 'ASSERT')
  }
  return deepFreeze(catalog)
}

/**
 * Load the operator's reviewed catalog: an absolute regular file (no
 * symlink), at most 64 KiB, whose bytes hash to the configured pin, holding
 * exactly the governed capabilities. Any defect: governed mode UNAVAILABLE.
 */
export function loadGovernedEffectCatalog(file: string, expectedSha256: string): GovernedCatalogLoad {
  const unavailable = (reason: string): GovernedCatalogLoad => ({ status: 'UNAVAILABLE', reason })
  if (!/^[a-f0-9]{64}$/u.test(expectedSha256)) return unavailable('CATALOG_PIN_INVALID')
  if (!isAbsolute(file)) return unavailable('CATALOG_PATH_NOT_ABSOLUTE')
  let bytes: Buffer
  try {
    const stat = lstatSync(file)
    if (!stat.isFile()) return unavailable('CATALOG_NOT_REGULAR_FILE')
    if (stat.size > MAX_EFFECT_CATALOG_BYTES) return unavailable('CATALOG_TOO_LARGE')
    bytes = readFileSync(file)
  } catch {
    return unavailable('CATALOG_MISSING')
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (sha256 !== expectedSha256) return unavailable('CATALOG_PIN_MISMATCH')
  let document: unknown
  try {
    document = JSON.parse(bytes.toString('utf8'))
  } catch {
    return unavailable('CATALOG_NOT_JSON')
  }
  try {
    return { status: 'loaded', pinned: Object.freeze({ catalog: validateGovernedCatalog(document), sha256 }) }
  } catch (error) {
    return unavailable(error instanceof CatalogInvalid ? `CATALOG_INVALID:${error.message}` : 'CATALOG_INVALID')
  }
}

// ---------------------------------------------------------------------------
// M-4 binding, attempt id, test-command match
// ---------------------------------------------------------------------------

/** The configured canonical location (`WorkerLocalEffectConfig` organisation/repository/Working Line ids). */
export interface GovernedWorkingLineBinding {
  readonly organisationId: string
  readonly repositoryId: string
  readonly workingLineId: string
}

/** What the desktop resolved for the local worktree (the Epoch's `CodeWorkingLineV1`). */
export interface ResolvedLocalWorkingLine {
  readonly codeWorkingLineId: string
  readonly repositoryId: string
}

/** M-4: refuse unless the configured canonical ids equal the resolved line's ids exactly. */
export function checkWorkingLineBinding(
  binding: GovernedWorkingLineBinding,
  resolved: ResolvedLocalWorkingLine,
): { readonly ok: true, readonly location: WorkingLineLocation } | GovernedEffectRefusal {
  if (!isAeraWorkingLineId(binding.workingLineId) || !isAeraRepositoryId(binding.repositoryId)) {
    return refusal('WORKING_LINE_BINDING_INVALID', 'the configured Working Line or repository id is not a canonical Aera id')
  }
  if (resolved.codeWorkingLineId !== binding.workingLineId) {
    return refusal('WORKING_LINE_BINDING_MISMATCH', `the local worktree is Working Line ${resolved.codeWorkingLineId}; the governed binding is ${binding.workingLineId}`)
  }
  if (resolved.repositoryId !== binding.repositoryId) {
    return refusal('WORKING_LINE_BINDING_MISMATCH', `the local worktree is repository ${resolved.repositoryId}; the governed binding is ${binding.repositoryId}`)
  }
  return {
    ok: true,
    location: Object.freeze({ organisationId: binding.organisationId, repositoryId: binding.repositoryId, workingLineId: binding.workingLineId }),
  }
}

/** The host's identity for one effect attempt (never model text). */
export interface GovernedEffectAttempt {
  /** The desktop Worker Epoch id (`aera:worker-epoch:<uuid>`). */
  readonly desktopEpochId: string
  readonly turn: number
  /** 1-based position of the intent in the turn's batch. */
  readonly ordinal: number
}

const ATTEMPT_ID = /^[A-Za-z0-9][A-Za-z0-9:._@/-]{0,199}$/u

/** `<desktopEpochId>:t<turn>:<ordinal>`; throws on an invalid tuple. */
export function governedEffectAttemptId(attempt: GovernedEffectAttempt): string {
  const { desktopEpochId, turn, ordinal } = attempt
  if (!Number.isSafeInteger(turn) || turn < 0 || !Number.isSafeInteger(ordinal) || ordinal < 0) throw new RangeError('EFFECT_ATTEMPT_ID_INVALID')
  const id = `${desktopEpochId}:t${String(turn)}:${String(ordinal)}`
  if (desktopEpochId === '' || !ATTEMPT_ID.test(desktopEpochId) || !ATTEMPT_ID.test(id)) throw new RangeError('EFFECT_ATTEMPT_ID_INVALID')
  return id
}

/** m-6: match `[executable, ...argv]` against exactly one catalog command; emit its parameter tuple. */
export function matchTestCommand(
  config: ProcessCapabilityConfig,
  argv: readonly string[],
): { readonly ok: true, readonly parameters: Readonly<Record<string, string>> } | GovernedEffectRefusal {
  const matches: string[] = []
  for (const [key, command] of Object.entries(config.commands)) {
    const full = [command.executable, ...command.argv]
    if (full.length === argv.length && full.every((part, index) => part === argv[index])) matches.push(key)
  }
  if (matches.length > 1) return refusal('TEST_COMMAND_AMBIGUOUS', `the command matches ${String(matches.length)} catalog entries; refusing rather than choosing one`)
  const key = matches[0]
  const parameters = key === undefined ? undefined : parseParameterKey(key)
  if (parameters === undefined) return refusal('TEST_COMMAND_NOT_IN_CATALOG', 'the command is not exactly one reviewed test command (executable and every argument)')
  return { ok: true, parameters: Object.freeze(parameters) }
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

export type GovernedEffectPlan =
  | {
    readonly ok: true
    readonly capability: GovernedEffectCapability
    /** The broker's `location` (the configured canonical ids, checked against the worktree). */
    readonly location: WorkingLineLocation
    /** Hand to `EffectBroker.execute`. */
    readonly request: EffectIntent
  }
  | GovernedEffectRefusal

export interface PlanGovernedEffectInput {
  readonly pinned: PinnedGovernedCatalog
  readonly binding: GovernedWorkingLineBinding
  readonly resolved: ResolvedLocalWorkingLine
  readonly attempt: GovernedEffectAttempt
  readonly intent: EffectIntentV1
}

/** One validated desktop intent → one broker request, or a typed refusal. Performs nothing. */
export function planGovernedEffect(input: PlanGovernedEffectInput): GovernedEffectPlan {
  const { intent } = input
  const bound = checkWorkingLineBinding(input.binding, input.resolved)
  if (!bound.ok) return bound
  if (intent.codeWorkingLineId !== input.binding.workingLineId) {
    return refusal('INTENT_WORKING_LINE_MISMATCH', `the intent names ${intent.codeWorkingLineId}; this Epoch is bound to ${input.binding.workingLineId}`)
  }
  const capability = GOVERNED_INTENT_CAPABILITY[intent.kind]
  if (capability === undefined) {
    return refusal('NOT_DELEGATED_IN_GOVERNED_MODE', `${intent.kind} is not delegated in governed mode (only aera.repo.read, aera.repo.patch and aera.test.run); nothing was performed`)
  }
  let effectAttemptId: string
  try {
    effectAttemptId = governedEffectAttemptId(input.attempt)
  } catch {
    return refusal('EFFECT_ATTEMPT_ID_INVALID', 'the host attempt identity is not a valid effect attempt id')
  }
  const ok = (request: EffectIntent): GovernedEffectPlan => ({ ok: true, capability, location: bound.location, request: Object.freeze(request) })
  switch (capability) {
    case 'aera.repo.read':
      return ok({ effectAttemptId, capability, path: intent.path ?? '' })
    case 'aera.repo.patch':
      return ok({ effectAttemptId, capability, path: intent.path ?? '', content: new TextEncoder().encode(intent.content ?? '') })
    case 'aera.test.run': {
      const config = input.pinned.catalog[capability]
      if (config?.kind !== 'PROCESS') return refusal('TEST_COMMAND_NOT_IN_CATALOG', 'the pinned catalog has no test commands')
      const matched = matchTestCommand(config, intent.argv ?? [])
      if (!matched.ok) return matched
      return ok({ effectAttemptId, capability, parameters: matched.parameters })
    }
  }
}
