/**
 * Aera Session ↔ Worker Epoch orchestration —
 * WO-AERA-CODE-CLAUDE-CODE-GOVERNED-WORKER-INTEGRATION-001 §6/§8/§12/§13/§14/§24.
 *
 * THE DESIGN TEST (§24): Claude Code can disappear and Aera still knows what
 * work exists, why, what authority exists, what has actually been performed,
 * what remains, and how a replacement continues. Every one of those facts is
 * read here from the durable participation store — never from a worker
 * process, its conversation, or its memory:
 *
 *   what work / why          Work Order admission (+ effective lifecycle)
 *   where                    the Working Line and its recorded location
 *   authority                owner DecisionV1 grants, evaluated live
 *   what was performed       EXECUTION_EVIDENCE written by the broker
 *   what remains             the latest worker handoff (ANALYTICAL, labelled)
 *                            + the latest checkpoint (Aera's own observation)
 *   how a replacement goes   a fresh Epoch oriented from all of the above
 *
 * The Aera Session is a `ParticipationSession` of the Aera Code Worker Host
 * principal under the Work Order. A Worker Epoch is one worker process inside
 * it, recorded as OBSERVATIONAL evidence (started / terminal). Exactly one
 * Epoch is current; anything proposed under another Epoch id is STALE_EPOCH.
 * The exact context each Epoch received is recorded (§13).
 *
 * D-0d2: with the governed effect plane (the only composition the product
 * builds), each Epoch opens ONE vendored EffectBroker over the CIS Worker Epoch
 * before anything is recorded or spawned (the Working Line binding is checked,
 * the journal reconciled); authority is then CAS through the Router, and the
 * owner's local DecisionV1 grants are neither consulted nor shown as authority.
 */

import { createHash, randomUUID } from 'node:crypto'
import type { ParticipationStore } from '@aera/participation-runtime'
import type { AgentRole, ParticipationSession } from '@aera/evidentiary-work-graph-contracts'
import type { DecisionV1, TypedEvidenceV1 } from '@aera/participation-contracts'
import type { AeraPrincipalId } from '@aera/cis-contracts'
import {
  DEFAULT_WORKER_EPOCH_LIMITS,
  WorkerRefusal,
  type WorkerAdapter,
  type WorkerEpochHandle,
  type WorkerEpochLimits,
  type WorkerEpochTerminal,
  type WorkerLiveEvent,
  type WorkerRuntimeIdentity,
  type WorkerTurnCompleted,
} from './aera-worker-adapter.ts'
import {
  EFFECT_INTENT_BATCH_VERSION,
  EFFECT_INTENT_FENCE,
  EFFECT_INTENT_KINDS,
  EFFECT_INTENT_TAG_CLOSE,
  EFFECT_INTENT_TAG_OPEN,
  NO_EXECUTOR_INTENT_KINDS,
  extractIntentBatch,
  type WorkerHandoffV1,
} from './aera-worker-effect-intent.ts'
import {
  formatWorkerGrant,
  workerAuthorityEnvelope,
  type WorkerGrant,
} from './aera-worker-authority.ts'
import {
  WorkerEffectBroker,
  boundObservation,
  redact,
  type SentinelGate,
  type GovernedEffectPlane,
  type GovernedEpochEffects,
  type WorkerBoundaryPrincipals,
  type WorkerBrokerOutcome,
  type WorkerEffectBrokerDeps,
} from './aera-worker-effect-broker.ts'
import type { ModelInvocationAttestor } from './aera-worker-model-attest.ts'
import {
  CLAUDE_CLI_PROVENANCE_PIN,
  assertFixedHeaderSeparation,
  boundHostTurn,
  buildObservationBlocks,
  buildOrientationBlocks,
  hostManifestDigest,
  planTurnProvenance,
  turnAuditDescriptors,
  type BriefingFacts,
  type CliMetadataDigests,
  type HostBlock,
  type OrientationInput,
  type TurnProvenancePlan,
} from './aera-worker-provenance.ts'

export const WORKER_HOST_ADAPTER_ID = 'aera-worker-host'
export const WORKER_HOST_PRINCIPAL_NAME = 'Aera Code Worker Host'
export const WORKER_BROKER_PRINCIPAL_NAME = 'Aera Code Execution Broker'
export const WORKER_VERIFIER_PRINCIPAL_NAME = 'Aera Code Effect Verifier'
export const workerPrincipalName = (workerType: string): string => `Aera Code Worker (${workerType})`

const EPOCH_STARTED = 'Worker Epoch started: '
const EPOCH_TERMINAL = 'Worker Epoch terminal: '
const EPOCH_CONTEXT = 'Worker Epoch context supplied: '
/** H-1 (CD-4 / m-13): the native CLI session id = the Router's Gateway Session bootstrap hint. */
const EPOCH_GATEWAY_SESSION = 'Worker Epoch Gateway Session: '
const NATIVE_SESSION_ID = /^[A-Za-z0-9-]{1,64}$/u
const WORKER_HANDOFF = 'Worker handoff: '
const SESSION_ENVIRONMENT = 'Aera worker session environment: '
/** O-1 U-D §5.5: the companion of the Epoch-context record (per-block digests, host-only manifest digest). */
const EPOCH_CONTEXT_PROVENANCE = 'Worker Epoch context provenance: '

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

export interface AeraWorkerManagerConfig {
  /** The human principal this desktop speaks for (AERA_COLLAB_PRINCIPAL_ID). */
  readonly humanPrincipalId: string
  /** The recorded delegation authorising Aera Code's agent participation (AERA_COLLAB_DELEGATION_ID). */
  readonly delegationId: string
  /** The environment Aera Code is bound to (AERA_DEV | CANARY). */
  readonly environmentId: string
  readonly limits?: WorkerEpochLimits
  /** O-1 U-D: present only when the provenance manifest is on (§7, V2.1 NO-2). */
  readonly provenance?: WorkerProvenanceConfig
}

/** O-1 U-D manifest mode: the pinned model and CLI version it is checked against, and the CLI-note digests. */
export interface WorkerProvenanceConfig {
  readonly manifest: boolean
  readonly model: string
  readonly cliVersion: string
  readonly cliMetadata?: CliMetadataDigests
}

export interface AeraWorkerManagerDeps {
  readonly store: ParticipationStore
  readonly adapter: WorkerAdapter
  readonly gate: SentinelGate
  readonly config: AeraWorkerManagerConfig
  readonly broker?: Partial<Omit<WorkerEffectBrokerDeps, 'store' | 'principals' | 'gate'>>
  /**
   * U8 D-2: the model-invocation attest gate. When composed (governed mode,
   * D-3), the CLI is not spawned and no turn is written unless a fresh
   * attestation for the current Worker Epoch is held.
   */
  readonly modelAttest?: ModelAttestGate
  /** D-0d2: governed effects (AUTHORITY = CAS through the Router). The product always composes it. */
  readonly effectPlane?: GovernedEffectPlane
  /** O-1 U-D: content-free per-turn provenance descriptors (no text, no address, no unproven digest). */
  readonly log?: (line: string) => void
}

/** The part of the U8 attestor the session manager drives. */
export type ModelAttestGate = Pick<ModelInvocationAttestor, 'ensureFresh' | 'noteTurnActivity' | 'setTurnPossible' | 'stop'> & Partial<Pick<ModelInvocationAttestor, 'attestTurn'>>

const modelAuthorityRefusal = (result: Exclude<Awaited<ReturnType<ModelAttestGate['ensureFresh']>>, { ok: true }>): string =>
  result.state === 'MODEL_AUTHORITY_UNAVAILABLE'
    ? `MODEL_AUTHORITY_UNAVAILABLE:${result.code}`
    : `MODEL_AUTHORITY_UNAVAILABLE (MODEL_AUTHORITY_REFUSED:${result.code})`

/** Parsed Epoch lifecycle record. */
export interface WorkerEpochRecord {
  readonly epochId: string
  readonly sequence: number
  readonly aeraSessionId: string
  readonly workOrderId: string
  readonly codeWorkingLineId: string
  readonly startedAt: string
  readonly runtime: WorkerRuntimeIdentity
  readonly environmentId: string
  readonly pid?: number
  readonly contextSha256: string
  readonly terminal?: { readonly status: string, readonly reason: string, readonly recordedAt: string }
}

export interface WorkerEpochRunResult {
  readonly epochId: string
  readonly sequence: number
  readonly aeraSessionId: string
  readonly terminal: WorkerEpochTerminal
  readonly outcomes: readonly WorkerBrokerOutcome[]
  readonly handoffEvidenceId?: string
  readonly orientation: string
}

export type WorkerLiveState = 'IDLE' | 'STARTING' | 'RUNNING' | 'WAITING_FOR_AERA' | 'ENDING'

/** Read-only projection for the minimal UI (§15). */
export interface AeraWorkerStatusView {
  readonly workOrderId: string
  readonly provider: string
  readonly workerType: string
  readonly environmentId: string
  readonly aeraSessionId?: string
  readonly liveState: WorkerLiveState
  readonly currentEpoch?: WorkerEpochRecord
  readonly lastTerminal?: WorkerEpochRecord
  readonly epochCount: number
  /** D-0d2: CAS whenever the governed effect plane is composed (no local grant is authority). */
  readonly authorityMode?: 'CAS'
  readonly authClass?: string
  readonly modelReported?: string
  readonly authorityEnvelope: readonly { readonly decisionId: string, readonly grant: string, readonly codeWorkingLineIds: readonly string[] }[]
  readonly recentEffects: readonly { readonly subject: string, readonly outcome?: string, readonly evidenceClass: string, readonly recordedAt: string }[]
}

function parseJson(body: string | undefined): Record<string, unknown> | undefined {
  if (body === undefined) return undefined
  try {
    const value = JSON.parse(body) as unknown
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

/** The worker's protocol prompt: rules and format only — no institutional authority. */
export function buildWorkerSystemPrompt(input: {
  readonly epochId: string
  readonly codeWorkingLineId: string
}): string {
  return [
    'You are a governed reasoning worker inside Aera Code. Aera is the operating environment; you are compute.',
    'You have NO tools. You cannot read or write files, run commands, use git, install packages or reach the network yourself, and you must not claim to have done so.',
    // O-1 U-D F2-1: the backtick-free tag form (no fence is ever shown; code_security.011).
    `To request an effect, end your reply with exactly one ${EFFECT_INTENT_TAG_OPEN}…${EFFECT_INTENT_TAG_CLOSE} block containing JSON, for example:`,
    `${EFFECT_INTENT_TAG_OPEN}${JSON.stringify({
      version: EFFECT_INTENT_BATCH_VERSION,
      epochId: input.epochId,
      status: 'CONTINUE',
      intents: [{ intentId: 'i1', kind: 'fs.read', codeWorkingLineId: input.codeWorkingLineId, path: 'README.md' }],
    })}${EFFECT_INTENT_TAG_CLOSE}`,
    `Intent kinds: ${EFFECT_INTENT_KINDS.join(', ')}. Fields: path (relative to the Working Line worktree), content (fs.write, whole file), argv (exec.*, an array — never a shell string), paths + message (git.commit), ref (git.diff/git.log), target (context.read: "wo-payload@<offset>", "evidence/<id>", "decision/<id>", "checkpoints"), summary (checkpoint).`,
    `No executor exists for ${NO_EXECUTOR_INTENT_KINDS.join(', ')}; such intents are recorded and refused.`,
    'status: CONTINUE when you want observations back; HANDOFF with {"handoff":{"summary":"…","nextSteps":["…"]}} to hand the work to the next worker; DONE when you believe your part is complete (Aera, not you, decides closure).',
    'Aera decides every intent: authority, policy, execution. You receive observations in the next message. Only an observation marked PERFORMED means something happened; a proposal is not an effect, a generated patch is not an applied patch, and "done" is not closure.',
    `Always use epochId ${input.epochId} and codeWorkingLineId ${input.codeWorkingLineId}.`,
    'The orientation you receive is context supplied by Aera from its durable record. Context is cache, not authority.',
  ].join('\n')
}

/** Orchestrates Aera Sessions and Worker Epochs over the durable store. */
export class AeraWorkerSessionManager {
  private readonly live = new Map<string, { handle: WorkerEpochHandle | undefined, state: WorkerLiveState, epochId: string, authClass?: string, modelReported?: string }>()
  /** Work Orders whose Epoch start is awaiting the model-authority gate (no second start meanwhile). */
  private readonly gating = new Set<string>()
  private readonly limits: WorkerEpochLimits

  constructor(private readonly deps: AeraWorkerManagerDeps) {
    this.limits = deps.config.limits ?? DEFAULT_WORKER_EPOCH_LIMITS
  }

  private get store(): ParticipationStore {
    return this.deps.store
  }

  /** The Work Order's owner (HUMAN), from its admission row. */
  ownerOf(workOrderId: string): AeraPrincipalId | undefined {
    const order = this.store.listWorkOrders().find(row => row.workOrderId === workOrderId)
    if (order === undefined) throw new WorkerRefusal('WORK_ORDER_NOT_FOUND', `${workOrderId} is not registered; a worker never creates a Work Order`)
    return order.owner?.principalId
  }

  /** Durable principals of the boundary (issued once, by the configured human). */
  principals(workOrderId: string): WorkerBoundaryPrincipals {
    const owner = this.ownerOf(workOrderId)
    const createdBy = this.deps.config.humanPrincipalId as Parameters<ParticipationStore['ensureAgentPrincipal']>[0]['createdBy']
    const ensure = (displayName: string, agentRole: AgentRole, providerClassHint?: string): AeraPrincipalId =>
      this.store.ensureAgentPrincipal({ displayName, agentRole, createdBy, ...(providerClassHint === undefined ? {} : { providerClassHint }) }).principalId
    return {
      host: ensure(WORKER_HOST_PRINCIPAL_NAME, 'ORCHESTRATOR'),
      broker: ensure(WORKER_BROKER_PRINCIPAL_NAME, 'IMPLEMENTER'),
      verifier: ensure(WORKER_VERIFIER_PRINCIPAL_NAME, 'REVIEWER'),
      worker: ensure(workerPrincipalName(this.deps.adapter.workerType), 'IMPLEMENTER', this.deps.adapter.workerType),
      owner,
    }
  }

  /** The open Aera Session for this Work Order, if any. */
  findAeraSession(workOrderId: string): ParticipationSession | undefined {
    const host = this.store.listParticipants().find(row => (row as { displayName?: string }).displayName === WORKER_HOST_PRINCIPAL_NAME)
    if (host === undefined) return undefined
    return this.store.listSessions()
      .filter(session => session.principalId === host.principalId
        && session.workOrderId === workOrderId
        && session.providerAdapterId === WORKER_HOST_ADAPTER_ID
        && session.endedAt === undefined)
      .at(-1)
  }

  /**
   * Open — or resume — the durable Aera Session. The same Session survives
   * worker crashes, rotations and Aera Code restarts; its environment binding
   * is recorded once and enforced on every later Epoch start.
   */
  openAeraSession(workOrderId: string): ParticipationSession {
    const principals = this.principals(workOrderId)
    const existing = this.findAeraSession(workOrderId)
    const session = existing ?? this.store.openSession({
      principalId: principals.host as Parameters<ParticipationStore['openSession']>[0]['principalId'],
      workOrderId,
      delegationRef: {
        delegationId: this.deps.config.delegationId,
        delegatorPrincipalId: this.deps.config.humanPrincipalId as Parameters<ParticipationStore['openSession']>[0]['principalId'],
        authorityMode: 'RECORDED_NOT_ENFORCED',
      },
      providerAdapterId: WORKER_HOST_ADAPTER_ID,
    })
    const bound = this.store.listTypedEvidence(workOrderId)
      .filter(row => row.subject.startsWith(SESSION_ENVIRONMENT) && parseJson(row.body)?.aeraSessionId === session.sessionId)
      .map(row => String(parseJson(row.body)?.environmentId))[0]
    if (bound !== undefined && bound !== this.deps.config.environmentId) {
      throw new WorkerRefusal('WORKER_SESSION_ENVIRONMENT_MISMATCH', `Aera Session ${session.sessionId} is bound to ${bound}; Aera Code is now bound to ${this.deps.config.environmentId}. Environments are never mixed within one Session.`)
    }
    if (bound === undefined) {
      this.store.recordTypedEvidence({
        sessionId: session.sessionId,
        idempotencyKey: `${session.sessionId}:environment`,
        authorisingWorkOrderId: workOrderId,
        workOrderId,
        evidenceClass: 'OBSERVATIONAL_EVIDENCE',
        subject: `${SESSION_ENVIRONMENT}${session.sessionId}`,
        body: JSON.stringify({ aeraSessionId: session.sessionId, environmentId: this.deps.config.environmentId }),
      })
    }
    return session
  }

  /** Record the owner's grant of worker effect classes on one Working Line. */
  grantAuthority(input: {
    readonly workOrderId: string
    readonly codeWorkingLineId: string
    readonly grants: readonly WorkerGrant[]
    readonly rationale?: string
  }): DecisionV1 {
    const owner = this.ownerOf(input.workOrderId)
    if (owner === undefined || owner !== this.deps.config.humanPrincipalId) {
      throw new WorkerRefusal('GRANT_REFUSED_NOT_OWNER', 'Only the Work Order owner can grant worker authority; this desktop does not speak for the owner of this order.')
    }
    if (input.grants.length === 0) throw new WorkerRefusal('GRANT_EMPTY', 'A grant names at least one effect class')
    const line = this.store.listCodeWorkingLines(input.workOrderId).find(row => row.codeWorkingLineId === input.codeWorkingLineId)
    if (line === undefined) throw new WorkerRefusal('WORKING_LINE_NOT_FOUND', 'The Working Line is not recorded under this Work Order')
    const session = this.openAeraSession(input.workOrderId)
    const effects = input.grants.map(formatWorkerGrant)
    return this.store.recordDecision({
      sessionId: session.sessionId,
      idempotencyKey: randomUUID(),
      authorisingWorkOrderId: input.workOrderId,
      workOrderId: input.workOrderId,
      subject: `Authorise governed worker effects on ${line.label ?? line.codeWorkingLineId}`,
      options: [
        { optionId: 'grant', label: `Grant ${effects.join(', ')}` },
        { optionId: 'withhold', label: 'Withhold worker authority' },
      ],
      selectedOptionId: 'grant',
      ...(input.rationale === undefined ? {} : { rationale: input.rationale }),
      codeWorkingLineIds: [line.codeWorkingLineId],
      authorisedEffects: effects,
      decidedBy: owner as NonNullable<Parameters<ParticipationStore['recordDecision']>[0]['decidedBy']>,
      authorisedBy: owner as NonNullable<Parameters<ParticipationStore['recordDecision']>[0]['authorisedBy']>,
    }).decision
  }

  /** Revoke a grant (canonical supersedeDecision). Takes effect on the next intent. */
  revokeAuthority(input: { readonly workOrderId: string, readonly decisionId: string, readonly note?: string }): DecisionV1 {
    const owner = this.ownerOf(input.workOrderId)
    if (owner === undefined || owner !== this.deps.config.humanPrincipalId) {
      throw new WorkerRefusal('REVOKE_REFUSED_NOT_OWNER', 'Only the Work Order owner can revoke worker authority.')
    }
    const session = this.openAeraSession(input.workOrderId)
    return this.store.supersedeDecision({
      sessionId: session.sessionId,
      authorisingWorkOrderId: input.workOrderId,
      decisionId: input.decisionId as Parameters<ParticipationStore['supersedeDecision']>[0]['decisionId'],
      status: 'REVOKED',
      ...(input.note === undefined ? {} : { note: input.note }),
    }).decision
  }

  /** All Epochs of an Aera Session, from durable evidence only. */
  epochs(workOrderId: string, aeraSessionId: string): WorkerEpochRecord[] {
    const evidence = this.store.listTypedEvidence(workOrderId)
    const terminals = new Map<string, { status: string, reason: string, recordedAt: string }>()
    for (const row of evidence) {
      if (!row.subject.startsWith(EPOCH_TERMINAL)) continue
      const body = parseJson(row.body)
      if (body?.aeraSessionId !== aeraSessionId || typeof body.epochId !== 'string') continue
      if (!terminals.has(body.epochId)) {
        terminals.set(body.epochId, { status: String(body.status), reason: String(body.reason), recordedAt: row.recordedAt })
      }
    }
    return evidence
      .filter(row => row.subject.startsWith(EPOCH_STARTED))
      .map(row => ({ row, body: parseJson(row.body) }))
      .filter(({ body }) => body?.aeraSessionId === aeraSessionId)
      .map(({ row, body }) => {
        const record = body as Record<string, unknown>
        const epochId = String(record.epochId)
        const terminal = terminals.get(epochId)
        return {
          epochId,
          sequence: Number(record.sequence),
          aeraSessionId,
          workOrderId,
          codeWorkingLineId: String(record.codeWorkingLineId),
          startedAt: row.recordedAt,
          runtime: record.runtime as WorkerRuntimeIdentity,
          environmentId: String(record.environmentId),
          ...(typeof record.pid === 'number' ? { pid: record.pid } : {}),
          contextSha256: String(record.contextSha256),
          ...(terminal === undefined ? {} : { terminal }),
        }
      })
      .sort((left, right) => left.sequence - right.sequence)
  }

  /** The current Epoch: the latest started with no terminal. LIVE from the store. */
  currentEpochId(workOrderId: string, aeraSessionId: string): string | undefined {
    const latest = this.epochs(workOrderId, aeraSessionId).at(-1)
    return latest !== undefined && latest.terminal === undefined ? latest.epochId : undefined
  }

  /**
   * Bounded institutional orientation for a fresh Epoch (§8/§13), rebuilt
   * from durable records only. It carries NO prior worker conversation.
   *
   * O-1 U-D (spec §5): the facts are routed by ORIGIN into the three blocks
   * of `buildOrientationBlocks` — Aera-minted ids/digests/counts/enums
   * (BRIEFING), records (RECORD), every owner- or human-originated field
   * (HUMAN). F2-2: the Work Order payload is NOT inlined; only its length and
   * sha256 and the `context.read` pointer are.
   */
  orientationFacts(input: {
    readonly workOrderId: string
    readonly codeWorkingLineId: string
    readonly aeraSessionId: string
    readonly epochId: string
    readonly sequence: number
    readonly task: string
  }): OrientationInput {
    const store = this.store
    const order = store.listWorkOrders().find(row => row.workOrderId === input.workOrderId)
    if (order === undefined) throw new WorkerRefusal('WORK_ORDER_NOT_FOUND', `${input.workOrderId} is not registered`)
    const state = store.effectiveWorkOrderState(input.workOrderId)
    const line = store.listCodeWorkingLines(input.workOrderId).find(row => row.codeWorkingLineId === input.codeWorkingLineId)
    if (line === undefined) throw new WorkerRefusal('WORKING_LINE_NOT_FOUND', 'The Working Line is not recorded under this Work Order')
    const payload = order.exactPayload ?? ''
    const events = store.listEvents().filter(event => event.workOrderId === input.workOrderId)
    const repaired = new Set(events.filter(event => event.eventKind === 'REPAIR_RECORDED').map(event => event.repairsEventId))
    const blocker = events.filter(event => event.eventKind === 'BREAK_REPORTED' && !repaired.has(event.eventId)).at(-1)
    const checkpoint = store.listCodeCheckpoints(line.codeWorkingLineId).at(-1)
    const evidence = store.listTypedEvidence(input.workOrderId)
      .filter(row => (row.links.codeWorkingLineIds ?? []).includes(line.codeWorkingLineId))
    const handoff = evidence.filter(row => row.subject.startsWith(WORKER_HANDOFF)).at(-1)
    const performedAll = evidence.filter(row => row.evidenceClass === 'EXECUTION_EVIDENCE')
    const deniedAll = evidence.filter(row => row.evidenceClass === 'DECISION_EVIDENCE' && row.subject.startsWith('Worker effect denied'))
    const performed = performedAll.slice(-20)
    const denied = deniedAll.slice(-10)
    const envelope = workerAuthorityEnvelope({
      decisions: store.listDecisions(input.workOrderId),
      ownerPrincipalId: order.owner?.principalId,
      workOrderId: input.workOrderId,
      codeWorkingLineId: line.codeWorkingLineId,
    })
    const bindings = store.listRepositoryBindings(input.workOrderId)
    const handoffBody = parseJson(handoff?.body)
    return {
      briefing: {
        sequence: input.sequence,
        epochId: input.epochId,
        aeraSessionId: input.aeraSessionId,
        lifecycleState: (state?.lifecycleState ?? 'UNRECORDED') as BriefingFacts['lifecycleState'],
        stateSource: (state?.source ?? 'UNRECORDED') as BriefingFacts['stateSource'],
        payloadLength: payload.length,
        payloadSha256: sha256(payload),
        codeWorkingLineId: line.codeWorkingLineId,
        originRevision: line.originRevision,
        lineLifecycle: line.lifecycle as BriefingFacts['lineLifecycle'],
        ...(checkpoint === undefined ? {} : { checkpoint: { lineSequence: checkpoint.lineSequence, checkpointId: checkpoint.checkpointId } }),
        ...(handoff === undefined ? {} : { handoffEvidenceId: handoff.evidenceId }),
        performedCount: performedAll.length,
        deniedCount: deniedAll.length,
        bindingCount: bindings.length,
      },
      owner: {
        workOrderId: order.workOrderId,
        title: order.title,
        ...(blocker === undefined ? {} : { blocker: blocker.summary }),
        ...(line.label === undefined ? {} : { label: line.label }),
        ...(line.branchRef === undefined ? {} : { branchRef: line.branchRef }),
        repositoryId: line.repositoryId,
        bindings: bindings.map(row => ({ repositoryId: row.repositoryId, role: row.role })),
        task: redact(input.task),
      },
      records: {
        ...(checkpoint === undefined ? {} : { checkpoint: { stateRef: checkpoint.stateRef, ...(checkpoint.summary === undefined ? {} : { summary: checkpoint.summary }) } }),
        ...(handoff === undefined ? {} : {
          handoff: {
            summary: String(handoffBody?.summary ?? ''),
            nextSteps: Array.isArray(handoffBody?.nextSteps) ? (handoffBody.nextSteps as unknown[]).map(String) : [],
          },
        }),
        performed: performed.map(row => ({ subject: row.subject, ...(row.outcome === undefined ? {} : { outcome: row.outcome }), evidenceId: row.evidenceId })),
        denied: denied.map(row => ({ subject: row.subject })),
      },
      authority: this.deps.effectPlane !== undefined
        ? { kind: 'CAS' }
        : { kind: 'LOCAL_ENVELOPE', grants: envelope.map(entry => ({ grant: formatWorkerGrant(entry.grant), decisionId: entry.decisionId })) },
    }
  }

  /**
   * One turn's blocks → the 45,000-char bound (N-14) → the NO-A layout check
   * → the manifest plan (N-3, N-4). The CLI-note digests are offered only on
   * the first turn of the CLI process and only in manifest mode.
   */
  private planTurn(blocks: readonly HostBlock[], firstTurn: boolean): TurnProvenancePlan {
    const bounded = boundHostTurn(blocks)
    assertFixedHeaderSeparation(bounded)
    const cliDigests = firstTurn && this.deps.config.provenance?.manifest === true ? this.deps.config.provenance.cliMetadata : undefined
    return planTurnProvenance({ blocks: bounded, firstTurn, ...(cliDigests === undefined ? {} : { cliDigests }) })
  }

  /** Record a turn's provenance notice (collisions N-4, not-well-formed N-3): counts only. */
  private recordProvenanceNotice(session: ParticipationSession, workOrderId: string, codeWorkingLineId: string, epochId: string, turn: number, plan: TurnProvenancePlan): void {
    if (plan.collisions === 0 && plan.notWellFormed === 0) return
    this.recordEvidence(session, workOrderId, {
      idempotencyKey: `${epochId}:turn${String(turn)}:provenance-notice`,
      evidenceClass: 'OBSERVATIONAL_EVIDENCE',
      subject: `Worker provenance notice (${epochId} turn ${String(turn)})`,
      outcome: 'RECORDED',
      body: JSON.stringify({ epochId, turn, collisions: plan.collisions, notWellFormed: plan.notWellFormed, cliMetadata: plan.cliState }),
      links: { codeWorkingLineIds: [codeWorkingLineId as never] },
    })
  }

  private recordEvidence(session: ParticipationSession, workOrderId: string, input: Omit<Parameters<ParticipationStore['recordTypedEvidence']>[0], 'sessionId' | 'authorisingWorkOrderId' | 'workOrderId'>): TypedEvidenceV1 {
    return this.store.recordTypedEvidence({ sessionId: session.sessionId, authorisingWorkOrderId: workOrderId, workOrderId, ...input }).evidence
  }

  /** Record the terminal of any open Epoch this process does not hold (crash of Aera Code itself, etc.). */
  private closeUncleanEpochs(session: ParticipationSession, workOrderId: string): void {
    for (const epoch of this.epochs(workOrderId, session.sessionId)) {
      if (epoch.terminal !== undefined) continue
      const liveHere = [...this.live.values()].some(entry => entry.epochId === epoch.epochId && entry.handle !== undefined)
      if (liveHere) throw new WorkerRefusal('EPOCH_ALREADY_RUNNING', `Epoch ${epoch.epochId} is still running in this Aera Code process; cancel it first`)
      let processAlive = false
      if (epoch.pid !== undefined) {
        try { process.kill(epoch.pid, 0); processAlive = true } catch { processAlive = false }
      }
      this.recordEvidence(session, workOrderId, {
        idempotencyKey: `${epoch.epochId}:terminal`,
        evidenceClass: 'OBSERVATIONAL_EVIDENCE',
        subject: `${EPOCH_TERMINAL}${epoch.epochId} SUPERSEDED_UNCLEAN`,
        outcome: 'RECORDED',
        body: JSON.stringify({
          epochId: epoch.epochId,
          aeraSessionId: session.sessionId,
          status: 'SUPERSEDED_UNCLEAN',
          reason: `no terminal was recorded for this Epoch; superseded by a new Epoch. Recorded pid ${String(epoch.pid)} alive at supersession: ${processAlive ? 'yes (not signalled: pid identity cannot be proven after a host restart)' : 'no'}`,
        }),
        links: { codeWorkingLineIds: [epoch.codeWorkingLineId as never] },
      })
    }
  }

  /**
   * Run one Worker Epoch to its terminal: start → orient → turns (intents
   * governed by the broker, observations returned) → handoff → terminal.
   */
  async runEpoch(input: {
    readonly workOrderId: string
    readonly codeWorkingLineId: string
    readonly task: string
    readonly onEvent?: (event: WorkerLiveEvent) => void
    readonly limits?: Partial<WorkerEpochLimits>
  }): Promise<WorkerEpochRunResult> {
    const { workOrderId, codeWorkingLineId } = input
    const liveKey = workOrderId
    if (this.live.get(liveKey)?.handle !== undefined || this.gating.has(liveKey)) {
      throw new WorkerRefusal('EPOCH_ALREADY_RUNNING', 'A Worker Epoch is already running for this Work Order in this Aera Code process')
    }
    const provenance = this.deps.config.provenance?.manifest === true ? this.deps.config.provenance : undefined
    if (provenance !== undefined) {
      // V2.1 NO-2 / A61: manifest mode only on the reviewed pin — before any attest, record or spawn.
      if (!CLAUDE_CLI_PROVENANCE_PIN.models.includes(provenance.model)) {
        throw new WorkerRefusal('PROVENANCE_MODEL_NOT_REVIEWED', `The provenance manifest is reviewed only for ${CLAUDE_CLI_PROVENANCE_PIN.models.join(', ')}; the pinned model is not in that set. The worker process was not started.`)
      }
      if (provenance.cliVersion !== CLAUDE_CLI_PROVENANCE_PIN.cliVersion) {
        throw new WorkerRefusal('PROVENANCE_CLI_NOT_REVIEWED', `The provenance manifest is reviewed only for Claude CLI ${CLAUDE_CLI_PROVENANCE_PIN.cliVersion}; a re-pin needs a fresh review. The worker process was not started.`)
      }
      if (this.deps.modelAttest?.attestTurn === undefined) {
        throw new WorkerRefusal('PROVENANCE_ATTEST_UNAVAILABLE', 'The provenance manifest needs the model-invocation attestor; the worker process was not started.')
      }
    }
    const modelAttest = this.deps.modelAttest
    if (modelAttest !== undefined) {
      // U8 D-2 (C-4): no fresh model-invocation attestation, no CLI process — and nothing recorded.
      this.gating.add(liveKey)
      let authority: Awaited<ReturnType<ModelAttestGate['ensureFresh']>>
      try {
        authority = await modelAttest.ensureFresh()
      } finally {
        this.gating.delete(liveKey)
      }
      if (!authority.ok) {
        throw new WorkerRefusal('MODEL_AUTHORITY_UNAVAILABLE', `${modelAuthorityRefusal(authority)}: the worker process was not started.`)
      }
    }
    const session = this.openAeraSession(workOrderId)
    const principals = this.principals(workOrderId)
    const line = this.store.listCodeWorkingLines(workOrderId).find(row => row.codeWorkingLineId === codeWorkingLineId)
    if (line === undefined) throw new WorkerRefusal('WORKING_LINE_NOT_FOUND', 'The Working Line is not recorded under this Work Order')
    this.closeUncleanEpochs(session, workOrderId)

    const epochId = `aera:worker-epoch:${randomUUID()}`
    // D-0d2: open this Epoch's governed effects BEFORE anything is recorded or spawned; a refusal is typed.
    let governed: GovernedEpochEffects | undefined
    if (this.deps.effectPlane !== undefined) {
      this.gating.add(liveKey)
      try {
        const located = await new WorkerEffectBroker({ store: this.store, principals, gate: this.deps.gate, ...this.deps.broker }).resolveWorktree(line)
        if (!located.ok) throw new WorkerRefusal('WORKING_LINE_LOCATION_MISMATCH', located.reason)
        governed = await this.deps.effectPlane.openEpoch({ desktopEpochId: epochId, line, workspaceRoot: located.root })
      } finally {
        this.gating.delete(liveKey)
      }
    }
    const sequence = this.epochs(workOrderId, session.sessionId).length + 1
    const limits: WorkerEpochLimits = { ...this.limits, ...input.limits }
    const systemPrompt = buildWorkerSystemPrompt({ epochId, codeWorkingLineId })
    // Sanitised ONCE, per block; the worker receives exactly the recorded text (O-1 U-D §5.4 layout).
    const orientationBuilt = buildOrientationBlocks(this.orientationFacts({ workOrderId, codeWorkingLineId, aeraSessionId: session.sessionId, epochId, sequence, task: input.task }))
    const firstPlan = this.planTurn(orientationBuilt.blocks.map(block => ({ ...block, text: boundObservation(block.text) })), true)
    const orientation = firstPlan.emitted.join('\n\n')
    const contextText = `SYSTEM PROMPT\n${systemPrompt}\n\nORIENTATION\n${orientation}`
    const contextSha256 = sha256(contextText)
    // §13: exactly what this Epoch receives, recorded BEFORE it receives it.
    this.recordEvidence(session, workOrderId, {
      idempotencyKey: `${epochId}:context`,
      evidenceClass: 'SOURCE_EVIDENCE',
      subject: `${EPOCH_CONTEXT}${epochId}`,
      body: contextText,
      sourceRef: `sha256:${contextSha256}`,
      links: { codeWorkingLineIds: [codeWorkingLineId as never] },
    })
    // O-1 U-D §5.5 (N-11): the ordered per-block digests and the host-only manifest digest (no CLI entry).
    this.recordEvidence(session, workOrderId, {
      idempotencyKey: `${epochId}:context-provenance`,
      evidenceClass: 'SOURCE_EVIDENCE',
      subject: `${EPOCH_CONTEXT_PROVENANCE}${epochId}`,
      body: JSON.stringify({
        contextSha256,
        hostBlocks: firstPlan.blocks.map((block, index) => ({ class: block.class, sha256: `sha256:${sha256(firstPlan.emitted[index] ?? '')}` })),
        hostManifestDigest: hostManifestDigest(firstPlan.entries),
        demotedFields: orientationBuilt.demoted,
      }),
      sourceRef: `sha256:${contextSha256}`,
      links: { codeWorkingLineIds: [codeWorkingLineId as never] },
    })

    this.live.set(liveKey, { handle: undefined, state: 'STARTING', epochId })
    let handle: WorkerEpochHandle
    /*
     * H-1 (CD-4 / m-13): record each distinct native session id the CLI reports
     * in `system/init` — the `x-claude-code-session-id` the Router bootstraps
     * the governed Gateway Session from. CD-4 keeps one Gateway Session per
     * window by running one desktop Epoch per window (a runbook rule); this
     * record is the CQ-5 evidence of how many there were. An Epoch Aera cannot
     * record is an Epoch that must not run.
     */
    const nativeSessions = new Set<string>()
    let startedHandle: WorkerEpochHandle | undefined
    const recordNativeSession = (nativeSessionId: string): void => {
      if (nativeSessions.has(nativeSessionId) || !NATIVE_SESSION_ID.test(nativeSessionId)) return
      nativeSessions.add(nativeSessionId)
      try {
        this.recordEvidence(session, workOrderId, {
          idempotencyKey: `${epochId}:gateway-session:${nativeSessionId}`,
          evidenceClass: 'OBSERVATIONAL_EVIDENCE',
          subject: `${EPOCH_GATEWAY_SESSION}${epochId}`,
          outcome: 'RECORDED',
          body: JSON.stringify({ epochId, aeraSessionId: session.sessionId, nativeSessionId, sequence: nativeSessions.size }),
          links: { codeWorkingLineIds: [codeWorkingLineId as never] },
        })
      } catch {
        void startedHandle?.cancel('the Gateway Session hint could not be recorded')
      }
    }
    try {
      handle = await this.deps.adapter.startEpoch({
        epochId,
        aeraSessionId: session.sessionId,
        workOrderId,
        codeWorkingLineId,
        systemPrompt,
        limits,
        onEvent: (event) => {
          const entry = this.live.get(liveKey)
          if (entry !== undefined && event.kind === 'RUNTIME_READY') entry.modelReported = event.model
          if (event.kind === 'RUNTIME_READY' && event.providerSessionId !== undefined) recordNativeSession(event.providerSessionId)
          input.onEvent?.(event)
        },
      })
    } catch (error) {
      this.live.delete(liveKey)
      throw error
    }
    startedHandle = handle
    const liveEntry = { handle, state: 'RUNNING' as WorkerLiveState, epochId } as { handle: WorkerEpochHandle | undefined, state: WorkerLiveState, epochId: string, authClass?: string, modelReported?: string }
    this.live.set(liveKey, liveEntry)
    modelAttest?.setTurnPossible(true)
    const recordStarted = (): void => { this.recordEvidence(session, workOrderId, {
      idempotencyKey: `${epochId}:started`,
      evidenceClass: 'OBSERVATIONAL_EVIDENCE',
      subject: `${EPOCH_STARTED}${epochId}`,
      outcome: 'RECORDED',
      body: JSON.stringify({
        epochId,
        sequence,
        aeraSessionId: session.sessionId,
        workOrderId,
        codeWorkingLineId,
        workerType: this.deps.adapter.workerType,
        adapterId: this.deps.adapter.adapterId,
        runtime: handle.runtime,
        environmentId: this.deps.config.environmentId,
        ...(handle.pid === undefined ? {} : { pid: handle.pid }),
        contextSha256,
        limits,
        workerPrincipal: principals.worker,
      }),
      links: { codeWorkingLineIds: [codeWorkingLineId as never] },
    }) }
    try {
      recordStarted()
    } catch (error) {
      // An Epoch Aera cannot record is an Epoch that must not run.
      this.live.delete(liveKey)
      modelAttest?.stop()
      await handle.cancel('the Epoch start could not be recorded')
      throw error
    }

    const broker = new WorkerEffectBroker({
      store: this.store,
      principals,
      gate: this.deps.gate,
      ...this.deps.broker,
      ...(governed === undefined ? {} : { governed }),
    })
    const outcomes: WorkerBrokerOutcome[] = []
    /** N-4: the host's attempt turn — monotonic within this desktop Epoch, never the adapter's count. */
    let attemptTurn = 0
    let handoffEvidenceId: string | undefined
    let modelId: string | undefined
    /** O-1 U-D: the host turns written in this desktop Epoch (turnSeq base = sequence * 1000 + writtenTurns). */
    let writtenTurns = 0
    let nextBlocks: readonly HostBlock[] | undefined
    let silentTurns = 0
    let terminal: WorkerEpochTerminal | undefined
    let ended = false
    try {
      while (!ended) {
        writtenTurns += 1
        // Blocks → bound → NO-A layout check → manifest plan (CLI digest on the first turn only).
        const plan = nextBlocks === undefined ? firstPlan : this.planTurn(nextBlocks, false)
        this.recordProvenanceNotice(session, workOrderId, codeWorkingLineId, epochId, writtenTurns, plan)
        this.deps.log?.(`aera-worker-provenance: ${JSON.stringify({ epochId, turn: writtenTurns, ...turnAuditDescriptors(plan) })}`)
        if (modelAttest !== undefined) {
          // U8 D-2 (C-4): every stdin turn write needs a fresh attestation; otherwise no write, typed terminal.
          // O-1 U-D: with the manifest on, that attestation is this turn's own v2 attest carrying its manifest.
          const authority = provenance !== undefined && plan.entries.length > 0 && modelAttest.attestTurn !== undefined
            ? await modelAttest.attestTurn({ baseTurnSeq: sequence * 1000 + writtenTurns, entries: plan.entries })
            : await modelAttest.ensureFresh()
          if (!authority.ok) {
            const reason = `${modelAuthorityRefusal(authority)}: no further turn was written to the worker.`
            terminal = { ...await handle.cancel(reason), status: 'MODEL_AUTHORITY_UNAVAILABLE', reason }
            break
          }
          modelAttest.noteTurnActivity()
        }
        liveEntry.state = 'RUNNING'
        // Manifest on: one stream-json text block per host block (whole-block digests). Off: one string, as before.
        const outcome = await handle.runTurn(provenance !== undefined ? plan.emitted : plan.emitted.join('\n\n'))
        modelAttest?.noteTurnActivity()
        if (outcome.kind === 'EPOCH_TERMINATED') {
          terminal = outcome.terminal
          break
        }
        liveEntry.state = 'WAITING_FOR_AERA'
        liveEntry.authClass = outcome.authClass
        modelId = outcome.modelReported ?? modelId
        this.recordTurn(session, workOrderId, codeWorkingLineId, epochId, sequence, outcome, principals.worker)
        const extraction = extractIntentBatch(outcome.text)
        /** `kind`: the intent kind, or HOST_NOTICE for Aera's own notices (observation tool, spec §3.1). */
        const observations: { kind: string, text: string }[] = []
        const notice = (text: string): void => { observations.push({ kind: 'HOST_NOTICE', text }) }
        if (extraction.kind === 'NONE') {
          silentTurns += 1
          if (silentTurns >= 2) { ended = true; break }
          notice(`No ${EFFECT_INTENT_FENCE} block was found. End your reply with one (status DONE if your part is complete).`)
        } else if (extraction.kind === 'MALFORMED') {
          silentTurns = 0
          this.recordEvidence(session, workOrderId, {
            idempotencyKey: `${epochId}:turn${String(outcome.turn)}:rejected`,
            evidenceClass: 'ANALYTICAL_EVIDENCE',
            subject: `Worker intent block rejected (${epochId} turn ${String(outcome.turn)})`,
            outcome: 'FAIL',
            body: extraction.reason,
            analyticalProvenance: { producer: principals.worker, ...(modelId === undefined ? {} : { modelId }), inputs: [epochId], producedAt: this.store.nowIso() },
            links: { codeWorkingLineIds: [codeWorkingLineId as never] },
          })
          notice(`Your ${EFFECT_INTENT_FENCE} block was REJECTED and nothing was performed: ${extraction.reason}`)
        } else {
          silentTurns = 0
          const { batch } = extraction
          if (batch.intents.length > 0) attemptTurn += 1
          for (const [index, intent] of batch.intents.entries()) {
            const result = await broker.handleIntent({
              aeraSessionId: session.sessionId,
              // The batch's own claim; the broker refuses it unless it is current.
              epochId: batch.epochId,
              workOrderId,
              codeWorkingLineId,
              currentEpochId: () => this.currentEpochId(workOrderId, session.sessionId),
              ...(modelId === undefined ? {} : { modelId }),
              attempt: { turn: attemptTurn, ordinal: index + 1 },
            }, intent)
            outcomes.push(result)
            observations.push({ kind: result.kind, text: result.observation })
          }
          if (batch.handoff !== undefined) {
            handoffEvidenceId = this.recordHandoff(session, workOrderId, codeWorkingLineId, epochId, batch.handoff, principals.worker, modelId)
          }
          if (batch.status !== 'CONTINUE') { ended = true; break }
          if (batch.intents.length === 0) notice('No intents were proposed. Propose intents, or set status HANDOFF / DONE.')
        }
        nextBlocks = buildObservationBlocks({ epochId, observations })
      }
      liveEntry.state = 'ENDING'
      terminal ??= await handle.endInput()
    } catch (error) {
      terminal = await handle.cancel(`host error: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      this.live.delete(liveKey)
      modelAttest?.stop()
    }
    this.recordEvidence(session, workOrderId, {
      idempotencyKey: `${epochId}:terminal`,
      evidenceClass: 'OBSERVATIONAL_EVIDENCE',
      subject: `${EPOCH_TERMINAL}${epochId} ${terminal.status}`,
      outcome: terminal.status === 'COMPLETED' ? 'PASS' : 'FAIL',
      body: boundObservation(JSON.stringify({
        epochId,
        aeraSessionId: session.sessionId,
        status: terminal.status,
        reason: terminal.reason,
        exitCode: terminal.exitCode,
        signal: terminal.signal,
        turns: terminal.turns,
        usage: terminal.usage,
        orphanReaped: terminal.orphanReaped,
        scratchResidue: terminal.scratchResidue,
        limitations: terminal.limitations,
        authClass: liveEntry.authClass,
        modelReported: modelId ?? liveEntry.modelReported,
        intents: outcomes.map(outcome => ({ intentId: outcome.intentId, kind: outcome.kind, performed: outcome.performed, stage: outcome.stage, code: outcome.code })),
      })),
      links: { codeWorkingLineIds: [codeWorkingLineId as never] },
    })
    return {
      epochId,
      sequence,
      aeraSessionId: session.sessionId,
      terminal,
      outcomes,
      ...(handoffEvidenceId === undefined ? {} : { handoffEvidenceId }),
      orientation,
    }
  }

  private recordTurn(session: ParticipationSession, workOrderId: string, codeWorkingLineId: string, epochId: string, sequence: number, outcome: WorkerTurnCompleted, worker: string): void {
    this.recordEvidence(session, workOrderId, {
      idempotencyKey: `${epochId}:turn${String(outcome.turn)}`,
      evidenceClass: 'ANALYTICAL_EVIDENCE',
      subject: `Worker Epoch ${String(sequence)} turn ${String(outcome.turn)} output (${epochId})`,
      body: boundObservation(JSON.stringify({
        epochId,
        turn: outcome.turn,
        text: redact(outcome.text),
        usage: outcome.usage,
        modelReported: outcome.modelReported,
        providerSessionId: outcome.providerSessionId,
        authClass: outcome.authClass,
        durationMs: outcome.durationMs,
        terminalReason: outcome.terminalReason,
        isError: outcome.isError,
      })),
      analyticalProvenance: {
        producer: worker,
        ...(outcome.modelReported === undefined ? {} : { modelId: outcome.modelReported }),
        inputs: [epochId, session.sessionId],
        producedAt: this.store.nowIso(),
      },
      links: { codeWorkingLineIds: [codeWorkingLineId as never] },
    })
  }

  private recordHandoff(session: ParticipationSession, workOrderId: string, codeWorkingLineId: string, epochId: string, handoff: WorkerHandoffV1, worker: string, modelId: string | undefined): string {
    return this.recordEvidence(session, workOrderId, {
      idempotencyKey: `${epochId}:handoff`,
      evidenceClass: 'ANALYTICAL_EVIDENCE',
      subject: `${WORKER_HANDOFF}${epochId}`,
      body: boundObservation(JSON.stringify({ epochId, summary: redact(handoff.summary), nextSteps: handoff.nextSteps.map(redact) })),
      analyticalProvenance: { producer: worker, ...(modelId === undefined ? {} : { modelId }), inputs: [epochId, session.sessionId], producedAt: this.store.nowIso() },
      links: { codeWorkingLineIds: [codeWorkingLineId as never] },
    }).evidenceId
  }

  /** Cancel the live Epoch for a Work Order (SIGINT → SIGTERM → SIGKILL). */
  async cancel(workOrderId: string, reason = 'cancelled by the owner'): Promise<WorkerEpochTerminal | undefined> {
    const entry = this.live.get(workOrderId)
    if (entry?.handle === undefined) return undefined
    return await entry.handle.cancel(reason)
  }

  /** Cancel every live Epoch (host shutdown). */
  async cancelAll(reason: string): Promise<void> {
    await Promise.all([...this.live.keys()].map(workOrderId => this.cancel(workOrderId, reason)))
  }

  /** Read-only status projection (§15). */
  status(workOrderId: string): AeraWorkerStatusView {
    const session = this.findAeraSession(workOrderId)
    const epochs = session === undefined ? [] : this.epochs(workOrderId, session.sessionId)
    const current = epochs.at(-1)?.terminal === undefined ? epochs.at(-1) : undefined
    const lastTerminal = [...epochs].reverse().find(epoch => epoch.terminal !== undefined)
    const order = this.store.listWorkOrders().find(row => row.workOrderId === workOrderId)
    const envelope = workerAuthorityEnvelope({
      decisions: this.store.listDecisions(workOrderId),
      ownerPrincipalId: order?.owner?.principalId,
      workOrderId,
    })
    const live = this.live.get(workOrderId)
    const lastTerminalBody = lastTerminal === undefined
      ? undefined
      : parseJson(this.store.listTypedEvidence(workOrderId).find(row => row.subject.startsWith(`${EPOCH_TERMINAL}${lastTerminal.epochId}`))?.body)
    const recentEffects = this.store.listTypedEvidence(workOrderId)
      .filter(row => row.subject.startsWith('Worker effect '))
      .slice(-10)
      .map(row => ({ subject: row.subject, ...(row.outcome === undefined ? {} : { outcome: row.outcome }), evidenceClass: row.evidenceClass, recordedAt: row.recordedAt }))
    const authClass = live?.authClass ?? (typeof lastTerminalBody?.authClass === 'string' ? lastTerminalBody.authClass : undefined)
    const modelReported = live?.modelReported ?? (typeof lastTerminalBody?.modelReported === 'string' ? lastTerminalBody.modelReported : undefined)
    return {
      workOrderId,
      provider: this.deps.adapter.workerType === 'CLAUDE_CODE' ? 'Claude Code (local, existing subscription login)' : this.deps.adapter.workerType,
      workerType: this.deps.adapter.workerType,
      environmentId: this.deps.config.environmentId,
      ...(session === undefined ? {} : { aeraSessionId: session.sessionId }),
      liveState: live?.state ?? 'IDLE',
      ...(current === undefined ? {} : { currentEpoch: current }),
      ...(lastTerminal === undefined ? {} : { lastTerminal }),
      epochCount: epochs.length,
      ...(this.deps.effectPlane === undefined ? {} : { authorityMode: 'CAS' as const }),
      ...(authClass === undefined ? {} : { authClass }),
      ...(modelReported === undefined ? {} : { modelReported }),
      // Governed: local grants are not authority, so none is shown as such (CD-2).
      authorityEnvelope: this.deps.effectPlane !== undefined ? [] : envelope.map(entry => ({ decisionId: entry.decisionId, grant: formatWorkerGrant(entry.grant), codeWorkingLineIds: entry.codeWorkingLineIds })),
      recentEffects,
    }
  }
}
