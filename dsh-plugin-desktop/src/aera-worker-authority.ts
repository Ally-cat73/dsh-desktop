/**
 * Worker effect authority — WO-AERA-CODE-CLAUDE-CODE-GOVERNED-WORKER-INTEGRATION-001 §10 (CAS/authority leg).
 *
 * NO PARALLEL AUTHORITY SYSTEM. Authority for a worker effect is read from the
 * canonical institutional record that already exists for exactly this purpose:
 * an owner `DecisionV1` whose `authorisedEffects` field ("what this decision
 * authorised someone to do") names the effect class, whose
 * `codeWorkingLineIds` names the Working Line, and whose decider is the Work
 * Order's owner. Revocation is the canonical `supersedeDecision(… 'REVOKED')`.
 * This module only READS those records; it has no store of its own.
 *
 * Honesty about CAS. The canonical CAS port in the participation runtime is
 * `RECORDED_NOT_ENFORCED`: it records a request and returns no verdict. The
 * broker still consults it on every intent (so the CAS record exists), and
 * ENFORCEMENT happens here, in Aera Code, against the owner's recorded
 * decisions. Nothing labels this "CAS enforcement".
 *
 * Evaluation is LIVE on every intent — a revocation takes effect on the very
 * next intent, with no worker restart and no cached authority in the worker.
 * Read authority never implies mutation authority.
 */

import type { DecisionV1 } from '@aera/participation-contracts'
import {
  READ_ONLY_EFFECT_CLASSES,
  WORKER_EFFECT_CLASSES,
  type WorkerEffectClass,
} from './aera-worker-effect-intent.ts'

/** Grant-string prefix inside `DecisionV1.authorisedEffects`. */
export const WORKER_GRANT_PREFIX = 'aera-worker/v1:'

export interface WorkerGrant {
  readonly effectClass: WorkerEffectClass
  /** For exec.* only: the argv must start with exactly these elements. */
  readonly argvPrefix?: readonly string[]
}

/** Render one grant string, e.g. `aera-worker/v1:exec.test argv=["corepack","yarn","vitest"]`. */
export function formatWorkerGrant(grant: WorkerGrant): string {
  const base = `${WORKER_GRANT_PREFIX}${grant.effectClass}`
  return grant.argvPrefix === undefined ? base : `${base} argv=${JSON.stringify(grant.argvPrefix)}`
}

/** Parse one grant string; anything else in `authorisedEffects` is not a worker grant. */
export function parseWorkerGrant(value: string): WorkerGrant | undefined {
  if (!value.startsWith(WORKER_GRANT_PREFIX)) return undefined
  const rest = value.slice(WORKER_GRANT_PREFIX.length)
  const match = /^([a-z.]+)(?: argv=(\[.*\]))?$/u.exec(rest)
  if (match === null) return undefined
  const effectClass = match[1] as WorkerEffectClass
  if (!(WORKER_EFFECT_CLASSES as readonly string[]).includes(effectClass)) return undefined
  if (match[2] === undefined) return { effectClass }
  if (!effectClass.startsWith('exec.')) return undefined
  try {
    const argvPrefix = JSON.parse(match[2]) as unknown
    if (!Array.isArray(argvPrefix) || argvPrefix.length === 0 || !argvPrefix.every(item => typeof item === 'string')) return undefined
    return { effectClass, argvPrefix: argvPrefix as string[] }
  } catch {
    return undefined
  }
}

/** One active grant as the envelope shows it. */
export interface WorkerAuthorityEnvelopeEntry {
  readonly decisionId: string
  readonly grant: WorkerGrant
  readonly codeWorkingLineIds: readonly string[]
  readonly authorisedBy: string
  readonly decidedAt?: string
}

export type WorkerAuthorityResult =
  | {
      readonly kind: 'AUTHORISED'
      readonly decisionId: string
      readonly authorisedBy: string
      readonly effectClass: WorkerEffectClass
    }
  | {
      readonly kind: 'DENIED'
      readonly code:
        | 'NO_GRANT'
        | 'AUTHORITY_REVOKED'
        | 'READ_ONLY_AUTHORITY'
        | 'WORKING_LINE_NOT_GRANTED'
        | 'ARGV_NOT_GRANTED'
        | 'OWNER_UNKNOWN'
      readonly reason: string
      readonly effectClass: WorkerEffectClass
    }

/** Is this decision an owner grant, decided and authorised by the owner? */
function ownerDecided(decision: DecisionV1, ownerPrincipalId: string): boolean {
  const contribution = (decision as { contribution?: { performedBy?: string, authorisedBy?: string } }).contribution
  return contribution?.performedBy === ownerPrincipalId && contribution.authorisedBy === ownerPrincipalId
}

function grantsOf(decision: DecisionV1): WorkerGrant[] {
  return decision.authorisedEffects
    .map(parseWorkerGrant)
    .filter((grant): grant is WorkerGrant => grant !== undefined)
}

/** The currently active worker grants on a Work Order (optionally one line). */
export function workerAuthorityEnvelope(input: {
  readonly decisions: readonly DecisionV1[]
  readonly ownerPrincipalId: string | undefined
  readonly workOrderId: string
  readonly codeWorkingLineId?: string
}): WorkerAuthorityEnvelopeEntry[] {
  if (input.ownerPrincipalId === undefined) return []
  const owner = input.ownerPrincipalId
  return input.decisions
    .filter(decision => decision.workOrderId === input.workOrderId
      && decision.status === 'RECORDED'
      && ownerDecided(decision, owner)
      && (input.codeWorkingLineId === undefined || decision.codeWorkingLineIds.includes(input.codeWorkingLineId as never)))
    .flatMap(decision => grantsOf(decision).map(grant => ({
      decisionId: decision.decisionId,
      grant,
      codeWorkingLineIds: [...decision.codeWorkingLineIds],
      authorisedBy: owner,
      ...(decision.decidedAt === undefined ? {} : { decidedAt: decision.decidedAt }),
    })))
}

function argvCovered(grant: WorkerGrant, argv: readonly string[] | undefined): boolean {
  if (grant.argvPrefix === undefined) return true
  if (argv === undefined || argv.length < grant.argvPrefix.length) return false
  return grant.argvPrefix.every((element, index) => argv[index] === element)
}

/**
 * Evaluate one effect against the owner's recorded decisions. Pure; the
 * caller passes the CURRENT decision list, read from the store at the moment
 * of the intent.
 */
export function evaluateWorkerAuthority(input: {
  readonly decisions: readonly DecisionV1[]
  readonly ownerPrincipalId: string | undefined
  readonly workOrderId: string
  readonly codeWorkingLineId: string
  readonly effectClass: WorkerEffectClass
  readonly argv?: readonly string[]
}): WorkerAuthorityResult {
  const { effectClass } = input
  if (input.ownerPrincipalId === undefined) {
    return { kind: 'DENIED', code: 'OWNER_UNKNOWN', reason: 'the Work Order has no recorded owner principal; nobody can have granted worker authority', effectClass }
  }
  const active = workerAuthorityEnvelope({ decisions: input.decisions, ownerPrincipalId: input.ownerPrincipalId, workOrderId: input.workOrderId })
  const onLine = active.filter(entry => entry.codeWorkingLineIds.includes(input.codeWorkingLineId))
  const matching = onLine.filter(entry => entry.grant.effectClass === effectClass)
  const covered = matching.find(entry => argvCovered(entry.grant, input.argv))
  if (covered !== undefined) {
    return { kind: 'AUTHORISED', decisionId: covered.decisionId, authorisedBy: covered.authorisedBy, effectClass }
  }
  if (matching.length > 0) {
    return { kind: 'DENIED', code: 'ARGV_NOT_GRANTED', reason: `the ${effectClass} grant pins an argv prefix this command does not start with`, effectClass }
  }
  if (onLine.length > 0 && onLine.every(entry => READ_ONLY_EFFECT_CLASSES.includes(entry.grant.effectClass))
    && !READ_ONLY_EFFECT_CLASSES.includes(effectClass)) {
    return { kind: 'DENIED', code: 'READ_ONLY_AUTHORITY', reason: `only read authority is granted on this Working Line; ${effectClass} mutates and was not granted`, effectClass }
  }
  const revoked = input.decisions.some(decision => decision.workOrderId === input.workOrderId
    && decision.status !== 'RECORDED'
    && ownerDecided(decision, input.ownerPrincipalId as string)
    && decision.codeWorkingLineIds.includes(input.codeWorkingLineId as never)
    && grantsOf(decision).some(grant => grant.effectClass === effectClass))
  if (revoked) {
    return { kind: 'DENIED', code: 'AUTHORITY_REVOKED', reason: `the owner's ${effectClass} grant on this Working Line was revoked`, effectClass }
  }
  if (onLine.length === 0 && active.length > 0) {
    return { kind: 'DENIED', code: 'WORKING_LINE_NOT_GRANTED', reason: 'worker authority exists on this Work Order, but not for this Working Line', effectClass }
  }
  return { kind: 'DENIED', code: 'NO_GRANT', reason: `no owner decision grants ${effectClass} on this Working Line`, effectClass }
}
