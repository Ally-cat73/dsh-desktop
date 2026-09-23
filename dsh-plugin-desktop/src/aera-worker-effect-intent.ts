/**
 * Typed effect intents — WO-AERA-CODE-CLAUDE-CODE-GOVERNED-WORKER-INTEGRATION-001 §9.
 *
 * A worker has no tool. The ONLY way it can ask for anything to happen is to
 * end a turn with one fenced `aera-effect-intents` JSON block. This module
 * parses and validates that block — strictly: unknown keys, unknown kinds,
 * oversize content, more than one block, or malformed JSON are REJECTED
 * proposals, never best-effort executions.
 *
 * AN INTENT IS DATA. A generated command is not a ran command and a generated
 * patch is not an applied patch. Nothing in this module can perform anything;
 * intents are translated onto the canonical `ProviderEvent` `ACTION_REQUEST`
 * operation/resource pair (the vocabulary `executeProviderRunThroughSentinel`
 * governs) and handed to the Aera broker.
 */

import type { ProviderEvent } from '@aera/participation-runtime'

export const EFFECT_INTENT_FENCE = 'aera-effect-intents'
export const EFFECT_INTENT_BATCH_VERSION = 'AeraEffectIntentBatchV1'
export const MAX_INTENTS_PER_TURN = 16
export const MAX_WRITE_BYTES = 256 * 1024
const MAX_TEXT_FIELD = 4_096
const MAX_ARGV = 64

export const EFFECT_INTENT_KINDS = [
  'context.read',
  'fs.list',
  'fs.read',
  'fs.write',
  'exec.test',
  'exec.build',
  'exec.shell',
  'git.status',
  'git.diff',
  'git.log',
  'git.commit',
  'checkpoint',
  // Typed and recorded, but with NO broker executor in V1:
  'package.install',
  'network.request',
  'git.push',
  'deploy',
  'external.action',
] as const
export type EffectIntentKind = (typeof EFFECT_INTENT_KINDS)[number]

/** Kinds V1 records and refuses because no Aera executor exists for them. */
export const NO_EXECUTOR_INTENT_KINDS: readonly EffectIntentKind[] = Object.freeze([
  'package.install',
  'network.request',
  'git.push',
  'deploy',
  'external.action',
])

/** The authority class an intent needs (the grant vocabulary). */
export const WORKER_EFFECT_CLASSES = [
  'context.read',
  'fs.read',
  'fs.write',
  'exec.test',
  'exec.build',
  'exec.shell',
  'git.read',
  'git.commit',
  'checkpoint',
  'package',
  'network',
  'deploy',
  'external',
] as const
export type WorkerEffectClass = (typeof WORKER_EFFECT_CLASSES)[number]

/** Classes that never mutate anything. Read authority implies nothing else. */
export const READ_ONLY_EFFECT_CLASSES: readonly WorkerEffectClass[] = Object.freeze(['context.read', 'fs.read', 'git.read'])

export function effectClassOf(kind: EffectIntentKind): WorkerEffectClass {
  switch (kind) {
    case 'context.read': return 'context.read'
    case 'fs.list':
    case 'fs.read': return 'fs.read'
    case 'fs.write': return 'fs.write'
    case 'exec.test': return 'exec.test'
    case 'exec.build': return 'exec.build'
    case 'exec.shell': return 'exec.shell'
    case 'git.status':
    case 'git.diff':
    case 'git.log': return 'git.read'
    case 'git.commit': return 'git.commit'
    case 'checkpoint': return 'checkpoint'
    case 'package.install': return 'package'
    case 'network.request':
    case 'git.push': return 'network'
    case 'deploy': return 'deploy'
    case 'external.action': return 'external'
  }
}

/** One validated intent. Every field is data proposed by the worker. */
export interface EffectIntentV1 {
  readonly intentId: string
  readonly kind: EffectIntentKind
  readonly codeWorkingLineId: string
  readonly path?: string
  readonly content?: string
  readonly argv?: readonly string[]
  readonly paths?: readonly string[]
  readonly message?: string
  readonly ref?: string
  readonly url?: string
  readonly target?: string
  readonly description?: string
  readonly summary?: string
}

export const INTENT_BATCH_STATUSES = ['CONTINUE', 'HANDOFF', 'DONE'] as const
export type IntentBatchStatus = (typeof INTENT_BATCH_STATUSES)[number]

export interface WorkerHandoffV1 {
  readonly summary: string
  readonly nextSteps: readonly string[]
}

export interface EffectIntentBatchV1 {
  readonly version: typeof EFFECT_INTENT_BATCH_VERSION
  readonly epochId: string
  readonly status: IntentBatchStatus
  readonly intents: readonly EffectIntentV1[]
  readonly handoff?: WorkerHandoffV1
}

export type IntentExtraction =
  | { readonly kind: 'NONE' }
  | { readonly kind: 'BATCH', readonly batch: EffectIntentBatchV1 }
  | { readonly kind: 'MALFORMED', readonly reason: string }

/** Which optional fields each kind may carry (strict: anything else is refused). */
const KIND_FIELDS: Readonly<Record<EffectIntentKind, readonly string[]>> = {
  'context.read': ['target', 'ref'],
  'fs.list': ['path'],
  'fs.read': ['path'],
  'fs.write': ['path', 'content'],
  'exec.test': ['argv'],
  'exec.build': ['argv'],
  'exec.shell': ['argv'],
  'git.status': [],
  'git.diff': ['ref'],
  'git.log': ['ref'],
  'git.commit': ['paths', 'message'],
  'checkpoint': ['summary'],
  'package.install': ['argv', 'target'],
  'network.request': ['url', 'target'],
  'git.push': ['ref', 'target'],
  'deploy': ['target'],
  'external.action': ['target'],
}
const REQUIRED_FIELDS: Readonly<Partial<Record<EffectIntentKind, readonly string[]>>> = {
  'context.read': ['target'],
  'fs.list': ['path'],
  'fs.read': ['path'],
  'fs.write': ['path', 'content'],
  'exec.test': ['argv'],
  'exec.build': ['argv'],
  'exec.shell': ['argv'],
  'git.commit': ['paths', 'message'],
}
const COMMON_FIELDS = ['intentId', 'kind', 'codeWorkingLineId', 'description']

function isKind(value: unknown): value is EffectIntentKind {
  return typeof value === 'string' && (EFFECT_INTENT_KINDS as readonly string[]).includes(value)
}

function boundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

function stringList(value: unknown, maxItems: number, maxLength: number): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= maxItems
    && value.every(item => typeof item === 'string' && item.length > 0 && item.length <= maxLength)
}

/** Validate one intent object. */
export function validateEffectIntent(value: unknown): { ok: true, intent: EffectIntentV1 } | { ok: false, reason: string } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ok: false, reason: 'intent is not an object' }
  const raw = value as Record<string, unknown>
  if (!isKind(raw.kind)) return { ok: false, reason: `unknown intent kind ${String(raw.kind)}` }
  const kind = raw.kind
  if (!boundedString(raw.intentId, 64) || !/^[A-Za-z0-9._:-]+$/u.test(raw.intentId)) return { ok: false, reason: 'intentId must be a short identifier' }
  if (!boundedString(raw.codeWorkingLineId, 200)) return { ok: false, reason: 'codeWorkingLineId is required' }
  const allowed = new Set([...COMMON_FIELDS, ...KIND_FIELDS[kind]])
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) return { ok: false, reason: `field ${key} is not allowed on ${kind}` }
  }
  for (const key of REQUIRED_FIELDS[kind] ?? []) {
    if (raw[key] === undefined) return { ok: false, reason: `${kind} requires ${key}` }
  }
  if (raw.path !== undefined && !boundedString(raw.path, 1_024)) return { ok: false, reason: 'path must be a non-empty string' }
  if (raw.content !== undefined && (typeof raw.content !== 'string' || Buffer.byteLength(raw.content, 'utf8') > MAX_WRITE_BYTES)) {
    return { ok: false, reason: `content must be a string of at most ${String(MAX_WRITE_BYTES)} bytes` }
  }
  if (raw.argv !== undefined && !stringList(raw.argv, MAX_ARGV, MAX_TEXT_FIELD)) return { ok: false, reason: 'argv must be a non-empty array of strings (never a shell string)' }
  if (raw.paths !== undefined && !stringList(raw.paths, 256, 1_024)) return { ok: false, reason: 'paths must be a non-empty array of strings' }
  for (const key of ['message', 'ref', 'url', 'target', 'description', 'summary']) {
    if (raw[key] !== undefined && !boundedString(raw[key], MAX_TEXT_FIELD)) return { ok: false, reason: `${key} must be a bounded string` }
  }
  const pick = <K extends keyof EffectIntentV1>(key: K): Partial<Pick<EffectIntentV1, K>> =>
    raw[key] === undefined ? {} : { [key]: raw[key] } as Partial<Pick<EffectIntentV1, K>>
  return {
    ok: true,
    intent: {
      intentId: raw.intentId,
      kind,
      codeWorkingLineId: raw.codeWorkingLineId,
      ...pick('path'), ...pick('content'), ...pick('argv'), ...pick('paths'), ...pick('message'),
      ...pick('ref'), ...pick('url'), ...pick('target'), ...pick('description'), ...pick('summary'),
    },
  }
}

const TICKS = '`'.repeat(3)
const FENCE_PATTERN = new RegExp(`${TICKS}${EFFECT_INTENT_FENCE}[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n${TICKS}`, 'gu')

/** Extract and validate the (at most one) intent block from a worker turn. */
export function extractIntentBatch(text: string): IntentExtraction {
  const matches = [...text.matchAll(FENCE_PATTERN)]
  if (matches.length === 0) {
    return text.includes(`\`\`\`${EFFECT_INTENT_FENCE}`)
      ? { kind: 'MALFORMED', reason: 'unterminated intent block' }
      : { kind: 'NONE' }
  }
  if (matches.length > 1) return { kind: 'MALFORMED', reason: 'more than one intent block in one turn' }
  let parsed: unknown
  try {
    parsed = JSON.parse(matches[0]?.[1] ?? '')
  } catch {
    return { kind: 'MALFORMED', reason: 'intent block is not JSON' }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { kind: 'MALFORMED', reason: 'intent block is not an object' }
  const batch = parsed as Record<string, unknown>
  for (const key of Object.keys(batch)) {
    if (!['version', 'epochId', 'status', 'intents', 'handoff'].includes(key)) return { kind: 'MALFORMED', reason: `batch field ${key} is not allowed` }
  }
  if (batch.version !== EFFECT_INTENT_BATCH_VERSION) return { kind: 'MALFORMED', reason: `version must be ${EFFECT_INTENT_BATCH_VERSION}` }
  if (!boundedString(batch.epochId, 200)) return { kind: 'MALFORMED', reason: 'epochId is required' }
  if (typeof batch.status !== 'string' || !(INTENT_BATCH_STATUSES as readonly string[]).includes(batch.status)) {
    return { kind: 'MALFORMED', reason: 'status must be CONTINUE, HANDOFF or DONE' }
  }
  const intentsRaw = batch.intents ?? []
  if (!Array.isArray(intentsRaw)) return { kind: 'MALFORMED', reason: 'intents must be an array' }
  if (intentsRaw.length > MAX_INTENTS_PER_TURN) return { kind: 'MALFORMED', reason: `more than ${String(MAX_INTENTS_PER_TURN)} intents in one turn` }
  const intents: EffectIntentV1[] = []
  const seen = new Set<string>()
  for (const item of intentsRaw) {
    const validated = validateEffectIntent(item)
    if (!validated.ok) return { kind: 'MALFORMED', reason: validated.reason }
    if (seen.has(validated.intent.intentId)) return { kind: 'MALFORMED', reason: `duplicate intentId ${validated.intent.intentId}` }
    seen.add(validated.intent.intentId)
    intents.push(validated.intent)
  }
  let handoff: WorkerHandoffV1 | undefined
  if (batch.handoff !== undefined) {
    const raw = batch.handoff as Record<string, unknown> | null
    if (raw === null || typeof raw !== 'object' || !boundedString(raw.summary, MAX_TEXT_FIELD)) {
      return { kind: 'MALFORMED', reason: 'handoff requires a bounded summary' }
    }
    const nextSteps = raw.nextSteps ?? []
    if (!Array.isArray(nextSteps) || nextSteps.length > 32 || !nextSteps.every(step => boundedString(step, 1_024))) {
      return { kind: 'MALFORMED', reason: 'handoff.nextSteps must be a bounded list of strings' }
    }
    handoff = { summary: raw.summary, nextSteps: nextSteps as string[] }
  }
  return {
    kind: 'BATCH',
    batch: {
      version: EFFECT_INTENT_BATCH_VERSION,
      epochId: batch.epochId,
      status: batch.status as IntentBatchStatus,
      intents,
      ...(handoff === undefined ? {} : { handoff }),
    },
  }
}

/**
 * Translate onto the canonical `ProviderEvent` ACTION_REQUEST shape — the same
 * operation/resource vocabulary the participation runtime's Sentinel binding
 * records. The input is the intent itself: data, never a capability.
 */
export function intentToActionRequest(
  intent: EffectIntentV1,
  repositoryId: string,
): Extract<ProviderEvent, { kind: 'ACTION_REQUEST' }> {
  const effectClass = effectClassOf(intent.kind)
  const resource = intent.kind === 'context.read'
    ? `aera:context:${intent.target ?? ''}`
    : intent.path !== undefined
      ? `repo:${repositoryId}:${intent.path}`
      : intent.url !== undefined
        ? `url:${intent.url}`
        : `repo:${repositoryId}`
  return { kind: 'ACTION_REQUEST', operation: effectClass, resource, input: intent }
}
