/**
 * Aera collaboration view model — WO-AGC-002 Remit C (desktop retarget).
 *
 * Pure mapping from the resolved WorkContextV1 packet (plus navigator-sourced
 * node detail) to what the native Work Context surface presents. Reused from
 * the remit A consumer (`collabViewModel.ts`, host-agnostic by design): no
 * electron import, no file IO, no model call — testable in isolation.
 *
 * Honesty rules implemented here, verbatim from the order:
 * - §8: an open session record alone must not imply a live process. Statuses
 *   are "Last active", "Ended" or "Status unavailable" — never fabricated
 *   Online/Editing presence.
 * - §10: status vocabulary is the closed set below; nothing is inferred from
 *   recency; every material row carries its source locator where recorded.
 * - §11: the authority stamp (e.g. RECORDED_NOT_ENFORCED) is shown verbatim,
 *   with the explanatory suffix applied ONLY to that recorded mode.
 * - §12: execution actions that are not released stay visibly unavailable.
 */

import type {
  WorkContextParticipantV1,
  WorkContextV1,
} from '@aera/participation-contracts'
import type { ParticipationSession } from '@aera/evidentiary-work-graph-contracts'

/** §10 closed status vocabulary. Nothing outside this set is displayed. */
export const COLLAB_STATUS_VOCABULARY = [
  'implemented',
  'tested',
  'owner accepted',
  'merged',
  'historical',
  'blocked',
  'unknown',
] as const
export type CollabStatus = (typeof COLLAB_STATUS_VOCABULARY)[number]

/** A displayable node reference: id, label, and its recorded source locator. */
export interface CollabNodeRefView {
  readonly nodeId: string
  readonly label: string
  /** Corpus-relative source path recorded by the projection, where known. */
  readonly sourcePath?: string
  readonly status: CollabStatus
}

export interface CollabParticipantView {
  readonly principalId: string
  readonly principalKind: 'HUMAN' | 'AGENT' | 'SERVICE'
  readonly displayName: string
  /** Honest local status line — see deriveParticipantStatus. */
  readonly statusLine: string
  readonly openSessionIds: readonly string[]
}

/** An observation of mutable working state — never an immutable object. */
export interface CollabWorkingStateView {
  readonly repositoryId: string
  readonly localPath: string
  readonly branchRef: string
  readonly headRevision: string
  readonly dirtyState: 'CLEAN' | 'DIRTY'
  /** When this observation was taken. Mandatory: it is mutable state. */
  readonly observedAt: string
  readonly note: 'Observed mutable working state at observation time — not an immutable historical object'
}

export interface CollabExecutionActionView {
  readonly action: string
  readonly state: 'UNAVAILABLE'
  readonly reason: string
}

export interface CollabContextView {
  readonly workOrderId: string
  readonly workOrderLabel?: string
  readonly participants: readonly CollabParticipantView[]
  readonly workingState?: CollabWorkingStateView
  readonly workingStateUnavailableReason?: string
  readonly currentCanonicalState: readonly CollabNodeRefView[]
  readonly governingDecisions: readonly CollabNodeRefView[]
  readonly evidence: readonly CollabNodeRefView[]
  readonly knownResiduals: readonly CollabNodeRefView[]
  /** Shown verbatim; never presented as enforcement. */
  readonly authorityMode: string
  /**
   * Explanatory suffix for the authority stamp. Non-empty ONLY when the
   * recorded mode is RECORDED_NOT_ENFORCED (remit B finding F2: an enforcing
   * mode must not inherit a false "not enforced" disclaimer).
   */
  readonly authorityModeNote: string
  readonly executionActions: readonly CollabExecutionActionView[]
  readonly assembledAt: string
}

/**
 * §8 honest participant status. Inputs are the durable session records for one
 * principal within the bound WorkOrder — never a runtime guess.
 *
 * - all sessions ended → `Ended <latest endedAt>`
 * - any open session → `Status unavailable — last active <latest activity ts>;
 *   open session record does not prove a live process`
 * - no sessions at all → `Status unavailable`
 */
export function deriveParticipantStatus(
  sessions: readonly ParticipationSession[],
): string {
  if (sessions.length === 0) return 'Status unavailable'
  const open = sessions.filter(s => s.endedAt === undefined)
  if (open.length === 0) {
    const latest = [...sessions]
      .map(s => s.endedAt as string)
      .sort()
      .at(-1)
    return `Ended ${latest ?? '(time unrecorded)'}`
  }
  const latestStart = [...open].map(s => s.startedAt).sort().at(-1)
  return `Status unavailable — last active ${latestStart ?? '(time unrecorded)'}; an open session record alone does not prove a live process`
}

/** Node detail supplied by the host from navigator/projection lookups. */
export interface CollabNodeDetail {
  readonly sourcePath?: string
  /**
   * A recorded capability status where the node is a CAPABILITY row; the
   * mapping to the §10 vocabulary is fixed here and never inferred.
   */
  readonly capabilityStatus?: string
}

const CAPABILITY_TO_VOCAB: Readonly<Record<string, CollabStatus>> = {
  IMPLEMENTED: 'implemented',
  PROVEN: 'tested',
  OWNER_ACCEPTED: 'owner accepted',
  DESIGNED: 'unknown',
  DEFERRED: 'blocked',
}

export function toNodeRefView(
  ref: { readonly nodeId: string; readonly label?: string },
  detail: CollabNodeDetail | undefined,
): CollabNodeRefView {
  const status: CollabStatus
    = detail?.capabilityStatus !== undefined
      ? (CAPABILITY_TO_VOCAB[detail.capabilityStatus] ?? 'unknown')
      : 'unknown'
  return {
    nodeId: ref.nodeId,
    label: ref.label ?? ref.nodeId,
    ...(detail?.sourcePath === undefined ? {} : { sourcePath: detail.sourcePath }),
    status,
  }
}

export interface BuildContextViewInput {
  readonly packet: WorkContextV1
  /** Durable session records per principalId, from the participation store. */
  readonly sessionsByPrincipal: ReadonlyMap<string, readonly ParticipationSession[]>
  /** Node detail per nodeId, from the projection (assertedBy.sourcePath etc.). */
  readonly nodeDetail: ReadonlyMap<string, CollabNodeDetail>
  readonly workingState?: CollabWorkingStateView
  readonly workingStateUnavailableReason?: string
  readonly workOrderLabel?: string
}

/** §12: the only execution surface this slice ships is an honest refusal. */
export const EXECUTION_NOT_RELEASED: readonly CollabExecutionActionView[] = [
  {
    action: 'Run work in this context',
    state: 'UNAVAILABLE',
    reason:
      'Execution actions are not released in this consumer slice; no product provider call is available here',
  },
]

export function buildContextView(input: BuildContextViewInput): CollabContextView {
  const { packet } = input
  const toView = (ref: { readonly nodeId: string; readonly label?: string }): CollabNodeRefView =>
    toNodeRefView(ref, input.nodeDetail.get(ref.nodeId))

  const participants: CollabParticipantView[] = packet.participants.map(
    (participant: WorkContextParticipantV1) => ({
      principalId: participant.principalId,
      principalKind: participant.principalKind,
      displayName: participant.displayName,
      statusLine: deriveParticipantStatus(
        input.sessionsByPrincipal.get(participant.principalId) ?? [],
      ),
      openSessionIds: participant.activeSessionIds,
    }),
  )

  return {
    workOrderId: packet.workOrderId,
    ...(input.workOrderLabel === undefined ? {} : { workOrderLabel: input.workOrderLabel }),
    participants,
    ...(input.workingState === undefined ? {} : { workingState: input.workingState }),
    ...(input.workingStateUnavailableReason === undefined
      ? {}
      : { workingStateUnavailableReason: input.workingStateUnavailableReason }),
    currentCanonicalState: packet.currentCanonicalState.map(toView),
    governingDecisions: packet.governingDecisions.map(toView),
    evidence: packet.evidence.map(toView),
    knownResiduals: packet.knownResiduals.map(toView),
    authorityMode: packet.authority.mode,
    authorityModeNote:
      packet.authority.mode === 'RECORDED_NOT_ENFORCED' ? '(recorded, not enforced)' : '',
    executionActions: EXECUTION_NOT_RELEASED,
    assembledAt: packet.assembledAt,
  }
}
