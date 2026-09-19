/**
 * Aera Code Collab view model — WO-AERA-CODE-COLLAB-READ-FIRST-SURFACE-001.
 *
 * Pure mapping from the runtime's deterministic facts to what the native
 * Collab view presents. No electron import, no file IO, no git call, no model
 * call — testable in isolation, exactly like `aera-collab-view.ts`, whose four
 * honesty rules this module inherits unchanged:
 *
 * - §8  no fabricated presence — "Last active" / "Ended" / "Status unavailable";
 * - §10 a closed status vocabulary, nothing inferred from recency;
 * - §11 the authority stamp verbatim;
 * - §12 unreleased actions stay visibly unavailable, with the reason said.
 *
 * ## The Notes grammar this surface deliberately shares
 *
 * The owner-accepted Notes Collab surface answers "what state am I looking
 * at" ONCE, on the identity line; discloses the second Compare operand WHERE
 * the act began; labels FROM and TO explicitly and spells out the direction;
 * keeps a counted rail that is SHUT by default; and puts every raw id behind
 * one explicit "Technical details" request. All five are reproduced here in
 * Code's vocabulary. One Aera collaboration language, two resource-native
 * surfaces.
 *
 * ## §38 — what never appears on a default row
 *
 * Commit shas, refs, merge bases, `rev-list` counts, event ids, node ids,
 * principal ids, `WorkOrderStateRecord` internals and ParticipationSession
 * details. Every one of them is carried in a `technical` member and rendered
 * only when the reader opens Technical details.
 *
 * **This includes the participant row's principal id, which the shipping
 * Work Context panel renders inline today.** Moving it behind disclosure is a
 * deliberate §38 change to a shipping surface, recorded in BUILD_NOTES (D-4).
 */

import type {
  ActivityBlockV1,
  AttributionCorrectionNoteV1,
  CodeActivityRowV1,
  CodeCheckpointRowV1,
  CodeParticipantRowV1,
  DecisionContextV1,
  LineageTrailV1,
  ParticipantContributionV1,
  TypedEvidenceCardV1,
} from '@aera/participation-runtime'
import {
  codeCompareDirectionSentence,
  codeTextualConflictSummary,
  isTextuallyConflicting,
  type CodeCompareSummaryV1,
  type CodeFileChangeV1,
  type CodeStructuralDeltaV1,
  type CodeTopologyV1,
  type CollabMessageV1,
  type CollabThreadAnchorV1,
  type CollabThreadV1,
  type CoordinationIntent,
  type CoordinationPacketV1,
  type PacketStateAssessmentV1,
} from '@aera/participation-contracts'

/** The two views of one window. A view is a projection, never a second app. */
export const COLLAB_VIEWS = ['CONTEXT', 'COLLAB'] as const
export type CollabViewName = (typeof COLLAB_VIEWS)[number]

/** The rail. One open at a time; shut by default. */
export const COLLAB_RAIL_SECTIONS = [
  'ACTIVITY',
  'CHECKPOINTS',
  'CHANGED_FILES',
  'EVIDENCE',
  /*
   * WO-AERA-COLLAB-DURABLE-...-CHECKPOINTS-001 §44. DISCUSSION becomes
   * DISCUSSIONS_DECISIONS: a decision is unintelligible without the
   * discussion, the alternatives and the evidence that produced it, so the
   * product presents them together (§18) while the RECORDS stay distinct.
   */
  'DISCUSSIONS_DECISIONS',
  /*
   * WO-AERA-COLLAB-RELAY-COORDINATION-THREADS-AND-WORKING-LINE-HANDOFF-001
   * §35. A lightweight coordination surface, deliberately added as one more
   * rail section rather than a redesign: the order says extend the Read-First
   * surface, not replace it.
   */
  'COORDINATION',
  'ARCHIVED',
] as const
export type CollabRailSection = (typeof COLLAB_RAIL_SECTIONS)[number]

export const COLLAB_RAIL_LABELS: Readonly<Record<CollabRailSection, string>> = {
  ACTIVITY: 'Activity',
  CHECKPOINTS: 'Checkpoints',
  CHANGED_FILES: 'Changed files',
  EVIDENCE: 'Evidence',
  DISCUSSIONS_DECISIONS: 'Discussions & decisions',
  COORDINATION: 'Messages',
  ARCHIVED: 'Archived',
}

export interface CollabRailTabView {
  readonly section: CollabRailSection
  readonly label: string
  /**
   * Counts live on the rail; they never appear in a primary row.
   *
   * ABSENT means "not computed", never "none" — finding 4 of the independent
   * review. A badge reading `0` over a section that simply has not been
   * computed yet tells the reader something false, and this surface's whole
   * claim is that it does not do that. When it is absent the section states
   * why in words.
   */
  readonly count?: number
  readonly countUnavailableReason?: string
}

/**
 * One Working Line row: label, participant, ONE topology sentence, a
 * separately-labelled conflict sentence where Git says so, and the Git
 * arithmetic behind a disclosure level.
 */
export interface CollabLineRowView {
  /** Opaque durable id, or absent for a line observed from a checkout. */
  readonly codeWorkingLineId?: string
  readonly label: string
  readonly participant: string
  /** The frozen §3.3 sentence. Never a sha, never a count of commits. */
  readonly topologySentence: string
  readonly topologyState: string
  /**
   * The additive textual-conflict fact, separately labelled. Absent when Git
   * merges cleanly. NEVER folded into `topologySentence`.
   */
  readonly conflictSentence?: string
  readonly dirtyMarker?: string
  readonly checkpointCount: number
  readonly compareAvailable: boolean
  /**
   * Why this row exists. `DURABLE` is a minted Working Line record;
   * `OBSERVED` is this checkout, which has no durable line yet — stated, never
   * dressed up as one.
   */
  readonly provenance: 'DURABLE' | 'OBSERVED'
  readonly provenanceNote?: string
  /**
   * §41: a simple parent/origin trail, never a DAG. Absent for an OBSERVED
   * checkout, which by construction has no recorded lineage — an absence, not
   * an empty trail dressed up as one.
   */
  readonly lineageSentence?: string
  /** §11: where the work is GOING. A different relationship, a separate line. */
  readonly integrationTargetSentence?: string
  /** §40: the latest meaningful checkpoint, where one has been named. */
  readonly latestCheckpoint?: string
  readonly lifecycleWord?: string
  /**
   * §47: this record's stored attribution was corrected. The sentence says so;
   * `attributionOriginalClaim` discloses what the stored record still says,
   * because the correction is append-only and the original is never rewritten.
   */
  readonly attributionNote?: string
  readonly attributionOriginalClaim?: string
  /** Disclosure level 5. */
  readonly technical: readonly string[]
}

export interface CollabCompareOperandView {
  readonly side: 'FROM' | 'TO'
  readonly name: string
}

export interface CollabChangedFileRowView {
  /** The WORD, never colour alone. */
  readonly kindWord: 'Added' | 'Removed' | 'Renamed' | 'Modified'
  readonly path: string
  readonly previousPath?: string
  readonly counts?: string
  readonly bothLines: boolean
  readonly conflicted: boolean
  readonly structuralDelta: readonly string[]
  /** An accessible name repeating every fact the eye gets. */
  readonly accessibleName: string
}

export interface CollabCompareView {
  readonly heading: 'Read-only comparison of two states'
  readonly banner: string
  readonly from: CollabCompareOperandView
  readonly to: CollabCompareOperandView
  readonly directionSentence: string
  readonly headline: string
  readonly files: readonly CollabChangedFileRowView[]
  readonly unrepresentable: readonly string[]
  readonly structuralDeltaNote?: string
  readonly technical: readonly string[]
  readonly computedAt: string
}

export interface CollabLiveProviderStateView {
  /** What the historical evidence recorded, and when. Never presented as now. */
  readonly recorded?: string
  /** What the provider says right now, with the moment it was read. */
  readonly live?: string
  readonly unavailableReason?: string
}

export interface CollabCodeView {
  readonly workOrderId: string
  readonly workOrderTitle?: string
  readonly repositories: readonly string[]
  readonly authorityMode: string
  readonly authorityModeNote: string
  readonly assembledAt: string
  readonly participants: readonly CollabParticipantRowView[]
  readonly lines: readonly CollabLineRowView[]
  readonly linesEmptyReason?: string
  readonly rail: readonly CollabRailTabView[]
  readonly activity: readonly CollabActivityRowView[]
  readonly checkpoints: readonly CollabCheckpointRowView[]
  readonly checkpointsEmptyReason?: string
  /**
   * The legacy prose evidence list, kept so nothing that used to be readable
   * stops being readable (§47). `evidenceCards` below is what the surface
   * now DRAWS; this stays as the raw layer beneath it.
   */
  readonly evidence: readonly { readonly label: string; readonly status: string; readonly technical?: string }[]
  /** §46: typed cards, not a prose wall. */
  readonly evidenceCards: readonly CollabEvidenceCardView[]
  /** §43: deterministic groupings. Raw rows remain in `activity`. */
  readonly activityBlocks: readonly CollabActivityBlockView[]
  /** §44 / §45. */
  readonly decisions: readonly CollabDecisionView[]
  readonly discussions: readonly CollabDiscussionView[]
  readonly discussionsDecisionsEmptyReason?: string
  /** §35/§36: coordination threads, drawn in the rail's Messages section. */
  readonly threads: readonly CollabThreadRowView[]
  readonly threadsEmptyReason?: string
  /** §30/§55: stated on the surface, so nobody infers live delivery. */
  readonly coordinationDeliveryNote: string
  readonly liveProviderState?: CollabLiveProviderStateView
  readonly discussionNote: string
  readonly archivedCount: number
  readonly compare?: CollabCompareView
  /** Why a requested Compare was refused. Said, never silently dropped. */
  readonly compareUnavailableReason?: string
  readonly projectedAt: string
}

/**
 * §46: the CLASS is the first thing read. A model analysis says so on its face
 * and carries its producer inline, so it can never be mistaken at a glance for
 * an observation — which is the practical half of the §57 invariant.
 */
export interface CollabEvidenceCardView {
  readonly classWord: string
  readonly subject: string
  readonly outcome?: string
  readonly actor: string
  readonly when: string
  readonly analyticalNote?: string
  /** §21 made visible on the card rather than left to the reader to infer. */
  readonly factualNote?: string
  readonly body?: string
  readonly technical: readonly string[]
}

/** §43: one understandable work unit, with every underlying act kept beneath it. */
export interface CollabActivityBlockView {
  readonly title: string
  readonly from: string
  readonly to: string
  readonly participants: readonly string[]
  readonly counts: readonly string[]
  /** Present on the legacy block only, saying why it is not grouped (§38). */
  readonly legacyNote?: string
  readonly members: readonly CollabActivityRowView[]
  readonly technical: readonly string[]
}

/** §44 / §45: a decision with the context that makes it intelligible later. */
export interface CollabDecisionView {
  readonly subject: string
  readonly decidedBy: string
  readonly recordedBy: string
  readonly authorisedBy?: string
  readonly verifiedBy?: string
  readonly when: string
  readonly selectedOption: string
  readonly rationale?: string
  readonly alternatives: readonly string[]
  readonly evidence: readonly string[]
  readonly discussions: readonly string[]
  readonly authorisedEffects: readonly string[]
  readonly resultingEffects: readonly string[]
  readonly statusWord: string
  readonly supersededByNote?: string
  /** §21, on every decision, always. */
  readonly notAFactNote: string
  readonly technical: readonly string[]
}

/**
 * §38: a packet renders as a compact card, never as pasted terminal output.
 *
 * `stateNote` is the §19 movement line and is computed fresh on every read —
 * it is deliberately NOT stored on the packet, because a packet that updated
 * itself would have stopped being a snapshot.
 */
export interface CollabPacketCardView {
  readonly title: string
  readonly operands: string
  readonly facts: readonly string[]
  readonly capturedAt: string
  /** §19. Absent only when the packet carries no comparison to re-check. */
  readonly stateNote?: string
  readonly stateMoved: boolean
  readonly technical: readonly string[]
}

/**
 * §10/§40: what the reader must be able to tell at a glance is WHO is
 * speaking — a person, an agent, or a service — and whether what they are
 * reading is a deterministic packet or an agent's interpretation of one.
 */
export interface CollabMessageRowView {
  readonly who: string
  readonly principalKind: 'HUMAN' | 'AGENT' | 'SERVICE'
  /** 'Agent analysis' for AGENT senders; absent for humans (§40). */
  readonly authorshipNote?: string
  readonly body: string
  readonly when: string
  readonly intentLabel?: string
  readonly sequence: number
  readonly packets: readonly CollabPacketCardView[]
  readonly otherReferences: readonly string[]
  readonly technical: readonly string[]
}

/** §37: the thread says what it is about before it says what was said. */
export interface CollabThreadRowView {
  readonly subject: string
  readonly aboutLine: string
  readonly participants: readonly string[]
  readonly messageCount: number
  readonly lastMessageAt?: string
  readonly archived: boolean
  readonly messages: readonly CollabMessageRowView[]
  readonly decisionSubjects: readonly string[]
  readonly technical: readonly string[]
}

export interface CollabDiscussionView {
  /**
   * Amendment §3. A coordination thread IS a discussion of this Work Order and
   * must be listed as one — owner acceptance found a live thread with messages
   * while DISCUSSIONS & DECISIONS reported zero. The kind is carried so the
   * reader can tell a durable institutional Discussion from a communication
   * thread, which are different records, and so the thread can be opened.
   */
  readonly kind: 'DISCUSSION' | 'THREAD'
  readonly subject: string
  readonly entryCount: number
  readonly participants: readonly string[]
  readonly updatedAt: string
  readonly latestEntry?: string
  readonly technical: readonly string[]
}

export interface CollabParticipantRowView {
  readonly displayName: string
  readonly principalKind: 'HUMAN' | 'AGENT' | 'SERVICE'
  readonly statusLine: string
  readonly lineLabels: readonly string[]
  /**
   * §32/§33: what this participant actually contributed, counted by the
   * governance legs rather than by who typed the event. Absent where no
   * durable contribution record exists for them.
   */
  readonly contributionSentence?: string
  /** §38 (D-4): the principal id lives HERE, behind Technical details. */
  readonly technical: readonly string[]
}

export interface CollabActivityRowView {
  readonly actor: string
  readonly summary: string
  readonly when: string
  readonly detail?: string
  readonly technical?: string
}

export interface CollabCheckpointRowView {
  readonly name: string
  readonly origin: string
  readonly who: string
  readonly when: string
  /** CP-5: stated, never implied. */
  readonly verifiabilityNote?: string
  readonly summary?: string
  /** §47: corrected attribution, with the stored claim disclosed. */
  readonly attributionNote?: string
  readonly attributionOriginalClaim?: string
  readonly technical: string
}

/** The one place a topology reading becomes two sentences and a disclosure. */
export function toLineRowView(input: {
  readonly label: string
  readonly participant: string
  readonly topology?: CodeTopologyV1
  readonly topologyUnavailableReason?: string
  readonly checkpointCount: number
  readonly codeWorkingLineId?: string
  readonly provenance: 'DURABLE' | 'OBSERVED'
  readonly provenanceNote?: string
  readonly lineage?: LineageTrailV1
  readonly latestCheckpoint?: string
  readonly lifecycle?: string
  readonly correction?: AttributionCorrectionNoteV1
}): CollabLineRowView {
  const topology = input.topology
  const technical: string[] = []
  if (topology !== undefined) {
    const facts = topology.facts
    if (facts.lineRevision !== undefined) technical.push(`line ${facts.lineRevision}`)
    if (facts.targetRevision !== undefined) technical.push(`target ${facts.targetRevision}`)
    technical.push(`expected target ${facts.expectedTargetRevision}`)
    if (facts.mergeBase !== undefined) technical.push(`merge base ${facts.mergeBase}`)
    if (facts.aheadCount !== undefined) technical.push(`ahead ${String(facts.aheadCount)}`)
    if (facts.behindCount !== undefined) technical.push(`behind ${String(facts.behindCount)}`)
    if (facts.overlappingPaths.length > 0) {
      technical.push(`changed on both: ${facts.overlappingPaths.join(', ')}`)
    }
    if (topology.unresolvedCommand !== undefined) {
      technical.push(`failing command: ${topology.unresolvedCommand}`)
    }
    technical.push(`observed ${facts.observedAt}`)
  }
  if (input.codeWorkingLineId !== undefined) technical.push(input.codeWorkingLineId)

  const conflict = topology === undefined ? undefined : codeTextualConflictSummary(topology)
  /*
   * COMPARE IS OFFERED ONLY FOR THE OBSERVED LINE — finding 2 of the
   * independent review.
   *
   * Every Compare fact in this slice is derived from the observed checkout.
   * A durable Working Line row is an institutional record; this slice cannot
   * observe its checkout, so labelling a comparison with that row's name while
   * the facts came from the observed line would attach one line's name to
   * another line's diff. The Notes grammar's rule applies: never offered and
   * then refused — a durable row simply does not carry the action until the
   * slice that can observe it ships.
   */
  const compareAvailable = input.provenance === 'OBSERVED'
    && topology !== undefined
    && topology.state !== 'UNRESOLVED'
  return {
    ...(input.codeWorkingLineId === undefined ? {} : { codeWorkingLineId: input.codeWorkingLineId }),
    label: input.label,
    participant: input.participant,
    topologySentence: topology?.humanSummary
      ?? input.topologyUnavailableReason
      ?? 'This Working Line’s position could not be read.',
    topologyState: topology?.state ?? 'UNREADABLE',
    ...(conflict === undefined ? {} : { conflictSentence: conflict }),
    ...(topology?.facts.dirtyState === 'DIRTY' ? { dirtyMarker: 'Uncommitted changes in this checkout' } : {}),
    checkpointCount: input.checkpointCount,
    compareAvailable,
    provenance: input.provenance,
    ...(input.provenanceNote === undefined ? {} : { provenanceNote: input.provenanceNote }),
    ...(input.lineage === undefined
      ? {}
      : {
          lineageSentence: input.lineage.sentence,
          integrationTargetSentence: input.lineage.integrationTargetSentence,
        }),
    ...(input.latestCheckpoint === undefined ? {} : { latestCheckpoint: input.latestCheckpoint }),
    ...(input.lifecycle === undefined || input.lifecycle === 'OPEN' ? {} : { lifecycleWord: input.lifecycle }),
    ...(input.correction === undefined
      ? {}
      : {
          attributionNote: input.correction.sentence,
          attributionOriginalClaim: `${input.correction.originalClaim} ${input.correction.reason}`,
        }),
    technical,
  }
}

const KIND_WORD = {
  ADDED: 'Added', REMOVED: 'Removed', RENAMED: 'Renamed', MODIFIED: 'Modified',
} as const

export function toCompareView(input: {
  readonly summary: CodeCompareSummaryV1
  readonly fromName: string
  readonly toName: string
}): CollabCompareView {
  const { summary } = input
  const totals = summary.totals
  const fileCount = summary.files.length
  const plural = (count: number, singular: string): string =>
    `${String(count)} ${count === 1 ? singular : `${singular}s`}`

  const headlineParts = [
    plural(fileCount, 'file'),
    `+${String(totals.linesAdded)} / −${String(totals.linesRemoved)}`,
  ]
  if (totals.filesChangedOnBothLines > 0) {
    headlineParts.push(`${plural(totals.filesChangedOnBothLines, 'file')} changed on both lines`)
  }
  if (summary.topology !== undefined) {
    headlineParts.push(
      isTextuallyConflicting(summary.topology)
        ? 'Git cannot merge automatically'
        : 'clean textual merge',
    )
  }

  const files: CollabChangedFileRowView[] = summary.files.map((file: CodeFileChangeV1) => {
    const kindWord = KIND_WORD[file.kind]
    const counts = file.linesAdded === undefined
      ? undefined
      : `+${String(file.linesAdded)} −${String(file.linesRemoved ?? 0)}`
    const structural = (file.structuralDelta ?? []).map(describeStructuralDelta)
    const marks = [
      file.changedOnBothLines ? 'changed on both lines' : undefined,
      file.textuallyConflicted ? 'Git cannot merge this file automatically' : undefined,
    ].filter((mark): mark is string => mark !== undefined)
    return {
      kindWord,
      path: file.path,
      ...(file.previousPath === undefined ? {} : { previousPath: file.previousPath }),
      ...(counts === undefined ? {} : { counts }),
      bothLines: file.changedOnBothLines,
      conflicted: file.textuallyConflicted,
      structuralDelta: structural,
      accessibleName: [
        kindWord,
        file.previousPath === undefined ? file.path : `${file.previousPath} to ${file.path}`,
        counts,
        ...marks,
      ].filter((part): part is string => part !== undefined && part !== '').join(' — '),
    }
  })

  const technical = [
    `from ${summary.fromRevision}`,
    `to ${summary.toRevision}`,
    ...(summary.mergeBase === undefined ? [] : [`merge base ${summary.mergeBase}`]),
    `computed ${summary.computedAt}`,
    'This reading is not canonical authority (isCanonical: false).',
  ]

  const structuralNote = summary.structuralDeltaAvailable
    ? summary.structuralDeltaUnsupported.length === 0
      ? undefined
      : `Structural delta could not cover ${plural(summary.structuralDeltaUnsupported.length, 'file')}; the file facts above are complete.`
    : 'Structural delta is unavailable in this build; the file facts above are complete.'

  return {
    heading: 'Read-only comparison of two states',
    banner: `Compare ${input.fromName} with ${input.toName}`,
    from: { side: 'FROM', name: input.fromName },
    to: { side: 'TO', name: input.toName },
    directionSentence: codeCompareDirectionSentence(input.fromName, input.toName),
    headline: headlineParts.join(' · '),
    files,
    unrepresentable: summary.unrepresentable.map((entry: { humanSummary: string }) => entry.humanSummary),
    ...(structuralNote === undefined ? {} : { structuralDeltaNote: structuralNote }),
    technical,
    computedAt: summary.computedAt,
  }
}

function describeStructuralDelta(delta: CodeStructuralDeltaV1): string {
  const word: Record<string, string> = {
    FUNCTION_ADDED: 'Function added', FUNCTION_REMOVED: 'Function removed',
    FUNCTION_SIGNATURE_CHANGED: 'Signature changed', CLASS_ADDED: 'Class added',
    CLASS_REMOVED: 'Class removed', INTERFACE_ADDED: 'Interface added',
    INTERFACE_REMOVED: 'Interface removed', INTERFACE_CHANGED: 'Interface changed',
    METHOD_ADDED: 'Method added', METHOD_REMOVED: 'Method removed',
    IMPORT_ADDED: 'Import added', IMPORT_REMOVED: 'Import removed',
    EXPORT_ADDED: 'Export added', EXPORT_REMOVED: 'Export removed',
  }
  return `${word[delta.kind] ?? delta.kind}: ${delta.name}`
}

export function toParticipantRowView(
  row: CodeParticipantRowV1,
  lineLabelsById: ReadonlyMap<string, string>,
  contribution?: ParticipantContributionV1,
): CollabParticipantRowView {
  /*
   * §34: prefer "Last contribution <time>" to a prominent STATUS UNAVAILABLE.
   *
   * The absence of a heartbeat is a fact about our telemetry, not about the
   * person, and leading with it tells the reader nothing they can use. Where a
   * durable contribution exists we say when it was; LIVE still requires an
   * actual live signal, which this surface does not yet have and therefore
   * never claims.
   */
  const statusLine = contribution?.lastContributionAt === undefined
    ? row.statusLine
    : `Last contribution ${contribution.lastContributionAt}`
  return {
    displayName: row.displayName,
    principalKind: row.principalKind,
    statusLine,
    lineLabels: row.codeWorkingLineIds
      .map((id) => lineLabelsById.get(id))
      .filter((label): label is string => label !== undefined),
    ...(contribution === undefined || contribution.summarySentence.startsWith('No contributions')
      ? {}
      : { contributionSentence: contribution.summarySentence }),
    technical: [
      row.principalId,
      `${String(row.meaningfulActivityCount)} meaningful attributed acts`,
      ...(contribution === undefined
        ? []
        : [`${String(contribution.recordedActs)} records written by this principal`]),
    ],
  }
}

/** §46. */
export function toEvidenceCardView(card: TypedEvidenceCardV1): CollabEvidenceCardView {
  return {
    classWord: card.classWord,
    subject: card.subject,
    ...(card.outcome === undefined ? {} : { outcome: card.outcome }),
    actor: card.actor,
    when: card.at,
    ...(card.analyticalNote === undefined ? {} : { analyticalNote: card.analyticalNote }),
    ...(card.supportsFactualClaim
      ? {}
      : { factualNote: 'This records an interpretation or a choice, not an established fact.' }),
    ...(card.body === undefined ? {} : { body: card.body }),
    technical: card.technical,
  }
}

/** §43. Counts live on the block; they never crowd the member rows. */
export function toActivityBlockView(
  block: ActivityBlockV1,
  members: readonly CollabActivityRowView[],
): CollabActivityBlockView {
  const counts: string[] = []
  const plural = (count: number, singular: string): string =>
    `${singular} ${String(count)}`
  if (block.decisionIds.length > 0) counts.push(plural(block.decisionIds.length, 'Decisions'))
  if (block.evidenceIds.length > 0) counts.push(plural(block.evidenceIds.length, 'Evidence'))
  if (block.eventIds.length > 0) counts.push(plural(block.eventIds.length, 'Events'))
  return {
    title: block.title,
    from: block.from,
    to: block.to,
    participants: block.participants,
    counts,
    ...(block.legacyNote === undefined ? {} : { legacyNote: block.legacyNote }),
    members,
    technical: [
      `${block.keyKind} · ${block.blockId}`,
      ...(block.eventIds.length === 0 ? [] : [`events: ${block.eventIds.join(', ')}`]),
    ],
  }
}

const DECISION_STATUS_WORD: Record<string, string> = {
  RECORDED: 'In force',
  SUPERSEDED: 'Superseded',
  REVOKED: 'Revoked',
  REVISITED: 'Revisited',
  INVALIDATED_BY_NEW_EVIDENCE: 'Invalidated by new evidence',
}

/** §44 / §45. */
export function toDecisionView(context: DecisionContextV1): CollabDecisionView {
  return {
    subject: context.subject,
    decidedBy: context.decidedBy,
    recordedBy: context.recordedBy,
    ...(context.authorisedBy === undefined ? {} : { authorisedBy: context.authorisedBy }),
    ...(context.verifiedBy === undefined ? {} : { verifiedBy: context.verifiedBy }),
    when: context.decidedAt,
    selectedOption: context.selectedOptionLabel,
    ...(context.rationale === undefined ? {} : { rationale: context.rationale }),
    alternatives: context.alternatives.map((option) =>
      option.rationale === undefined ? option.label : `${option.label} — ${option.rationale}`),
    /*
     * The evidence line carries its CLASS, because "considered the model's
     * assessment" and "considered the provider's record" are different
     * statements about how much the decision is worth relying on.
     */
    evidence: context.evidence.map((item) =>
      `${item.subject} — ${item.evidenceClass.replace(/_EVIDENCE$/, '').toLowerCase()}${item.outcome === undefined ? '' : ` (${item.outcome})`}`),
    discussions: context.discussionSubjects,
    authorisedEffects: context.authorisedEffects,
    resultingEffects: context.resultingEffects,
    statusWord: DECISION_STATUS_WORD[context.status] ?? context.status,
    ...(context.supersededBySubject === undefined
      ? {}
      : { supersededByNote: `Superseded by: ${context.supersededBySubject}` }),
    notAFactNote: context.notAFactNote,
    technical: [context.decisionId, `status ${context.status}`],
  }
}

export function toActivityRowView(row: CodeActivityRowV1): CollabActivityRowView {
  return {
    actor: row.actor,
    summary: row.summary,
    when: row.at,
    ...(row.detail === undefined ? {} : { detail: row.detail }),
    ...(row.technical === undefined ? {} : { technical: row.technical }),
  }
}

const ORIGIN_WORD: Record<string, string> = {
  MANUAL_CHECKPOINT: 'Named checkpoint',
  LINE_CREATED: 'Working Line opened',
  CONTINUED_FROM_CHECKPOINT: 'Continued from a checkpoint',
  SUBMISSION: 'Submitted',
  ACCEPTANCE: 'Accepted',
  REBASE: 'Rebased',
  RESTORE: 'Restored',
  INTEGRATION: 'Brought changes in',
}

export function toCheckpointRowView(
  row: CodeCheckpointRowV1,
  correction?: AttributionCorrectionNoteV1,
): CollabCheckpointRowView {
  return {
    name: row.label,
    origin: ORIGIN_WORD[row.origin] ?? row.origin,
    who: row.createdBy,
    when: row.createdAt,
    // CP-5: the weakest arm says so on every row that uses it.
    ...(row.verifiable ? {} : { verifiabilityNote: 'Not digest-verifiable — a tested working state' }),
    ...(row.summary === undefined ? {} : { summary: row.summary }),
    ...(correction === undefined
      ? {}
      : {
          attributionNote: correction.sentence,
          attributionOriginalClaim: `${correction.originalClaim} ${correction.reason}`,
        }),
    technical: `${row.checkpointId} · sequence ${String(row.lineSequence)} · ${String(row.evidenceCount)} evidence`,
  }
}

/** Rail tabs with their counts. The count is the only announcement a section makes. */
export const CHANGED_FILES_NOT_COMPUTED =
  'Not computed until Compare is opened.'
export const DISCUSSION_NOT_RELEASED =
  'No discussion surface is released in this slice.'

export function buildRail(counts: {
  readonly activity: number
  readonly checkpoints: number
  /** Absent until a Compare has been computed — never defaulted to zero. */
  readonly changedFiles?: number
  readonly evidence: number
  /**
   * Discussions plus decisions. Now a real count, because durable records
   * exist and `0` finally means "none recorded" rather than "this build has no
   * surface for it" — which is why the old tab deliberately had no count.
   */
  readonly discussionsDecisions: number
  /** Coordination threads on this Work Order. `0` truthfully means none. */
  readonly coordination: number
  readonly archived: number
}): readonly CollabRailTabView[] {
  return [
    { section: 'ACTIVITY', label: COLLAB_RAIL_LABELS.ACTIVITY, count: counts.activity },
    { section: 'CHECKPOINTS', label: COLLAB_RAIL_LABELS.CHECKPOINTS, count: counts.checkpoints },
    counts.changedFiles === undefined
      ? {
          section: 'CHANGED_FILES',
          label: COLLAB_RAIL_LABELS.CHANGED_FILES,
          countUnavailableReason: CHANGED_FILES_NOT_COMPUTED,
        }
      : { section: 'CHANGED_FILES', label: COLLAB_RAIL_LABELS.CHANGED_FILES, count: counts.changedFiles },
    { section: 'EVIDENCE', label: COLLAB_RAIL_LABELS.EVIDENCE, count: counts.evidence },
    /*
     * A real count at last. The read-first slice withheld one because `0`
     * would have read as "nobody has said anything" when the truth was "this
     * build cannot show you". Durable Discussions and Decisions now exist, so
     * `0` is a true statement about the collaboration and is shown.
     */
    { section: 'DISCUSSIONS_DECISIONS', label: COLLAB_RAIL_LABELS.DISCUSSIONS_DECISIONS, count: counts.discussionsDecisions },
    { section: 'COORDINATION', label: COLLAB_RAIL_LABELS.COORDINATION, count: counts.coordination },
    { section: 'ARCHIVED', label: COLLAB_RAIL_LABELS.ARCHIVED, count: counts.archived },
  ]
}

/**
 * §18: discussion is never history authority. The entry point exists; the
 * surface says why nothing is listed rather than drawing an empty box.
 */
export const DISCUSSION_NOTE =
  'Discussion is recorded against durable resources and never advances a Work Order’s state — talking about work is not doing it. Decisions are shown beside the discussions that produced them, because a decision is hard to understand later without them.'

/** §44: shown when the section is genuinely empty, rather than an empty box. */
export const NO_DISCUSSIONS_OR_DECISIONS =
  'No discussions or decisions have been recorded against this Work Order. Records appear here when they are captured through an explicit decision act — a preference expressed in conversation never becomes one.'

// ---------------------------------------------------------------------------
// Coordination threads (§35–§40)
// ---------------------------------------------------------------------------

/**
 * §30/§55 stated on the surface, in the product's own words.
 *
 * The honest sentence, chosen over silence: a reader who is not told will
 * assume a message appears on the other side instantly, and that assumption is
 * currently false. Durability is real; live push is not built.
 */
export const COORDINATION_DELIVERY_NOTE =
  'Messages are recorded durably the moment you send them, and nothing is lost if the other person is away. They are not pushed live yet — the recipient sees them when they next open or refresh this Work Order.'

/** §35: shown when the section is genuinely empty, rather than an empty box. */
export const NO_COORDINATION_THREADS =
  'No coordination threads have been opened on this Work Order. Start one from a participant, a Working Line, or by sharing a comparison.'

/** §40: an agent's words are labelled as interpretation, never as measurement. */
export const AGENT_ANALYSIS_NOTE = 'Agent analysis — an interpretation, not deterministic state.'

const COORDINATION_INTENT_LABELS: Readonly<Record<CoordinationIntent, string | undefined>> = {
  // A general message needs no badge; every other intent is worth naming.
  GENERAL: undefined,
  REVIEW_REQUEST: 'Review requested',
  RECONCILIATION_REQUEST: 'Reconciliation requested',
  // §28: a REQUEST, and the label says so. It stops nothing.
  PAUSE_REQUEST: 'Pause requested',
  RESUME_NOTICE: 'Resume notice',
  DECISION_REQUEST: 'Decision requested',
}

/** §2/§37: one plain line saying what this conversation is about. */
export function threadAboutLine(
  anchors: readonly CollabThreadAnchorV1[],
  labels: { readonly workingLineLabels?: Readonly<Record<string, string>> } = {},
): string {
  const parts = anchors.map((anchor) => {
    switch (anchor.kind) {
      case 'WORK_ORDER': return `Work Order ${anchor.workOrderId}`
      case 'WORKING_LINE':
        return labels.workingLineLabels?.[anchor.codeWorkingLineId] === undefined
          ? 'a Working Line'
          : `the ${labels.workingLineLabels[anchor.codeWorkingLineId]} Working Line`
      case 'CHECKPOINT': return 'a checkpoint'
      case 'PACKET': return 'a shared comparison'
      case 'EVIDENCE': return 'an evidence record'
      case 'DECISION': return 'a decision'
      case 'RESOURCE': return anchor.resourceRef
    }
  })
  return `About ${parts.join(', ')}.`
}

/**
 * §38: the compact card. Counts and operands, never a pasted diff.
 *
 * `assessment` is supplied by the caller because resolving current state is a
 * repository read, and a view builder must stay pure. Where the caller could
 * not resolve it, the card says nothing about movement rather than implying
 * there was none.
 */
export function toPacketCardView(
  packet: CoordinationPacketV1,
  assessment?: PacketStateAssessmentV1,
  names: { readonly source?: string, readonly target?: string } = {},
): CollabPacketCardView {
  const comparison = packet.comparison
  const facts: string[] = []
  if (comparison !== undefined) {
    facts.push(`${String(comparison.filesChanged)} changed files`)
    facts.push(`${String(comparison.filesChangedOnBothLines)} changed on both lines`)
    facts.push(
      comparison.textualConflicts === 0
        ? 'no textual conflicts'
        : `${String(comparison.textualConflicts)} textual conflict${comparison.textualConflicts === 1 ? '' : 's'}`,
    )
  }
  const moved = assessment !== undefined
    && assessment.verdict !== 'UNCHANGED'
    && assessment.verdict !== 'UNRESOLVABLE'
  return {
    title: packet.subject === 'WORKING_LINE_COMPARE' ? 'Working-Line compare' : 'Shared reference',
    /*
     * §13/§17/§43 — round-1 review BL-1.
     *
     * This line used to fall back to the raw revision whenever a side had no
     * durable Working Line, and since Working Lines are a TRUE ZERO for this
     * Work Order, that was every packet in the live store. The face printed
     * two full 40-hex SHAs — one of them the literal string the owner used as
     * the §17 anti-example. "Truthful" was the defence, and it was true and
     * still wrong: a human surface owes the reader a readable operand, not the
     * rawest available one.
     *
     * So the ladder is: the durable Working Line name where one exists; then
     * the repository and short refs, which are readable and still exact enough
     * to recognise; and the full revisions under Technical details, where §43
     * says canonical values belong. Nothing is invented — no Working Line is
     * conjured for a side that has none.
     */
    operands: comparison === undefined
      ? packet.subject
      : [
          comparison.repositoryId === undefined ? '' : repositoryDisplayName(comparison.repositoryId),
          `${names.source ?? shortRevision(comparison.sourceRevision)} → ${names.target ?? shortRevision(comparison.targetRevision)}`,
        ].filter(part => part !== '').join(' · '),
    facts,
    capturedAt: packet.observedAt,
    ...(assessment === undefined ? {} : { stateNote: assessment.humanSummary }),
    stateMoved: moved,
    technical: [
      packet.packetId,
      packet.packetDigest,
      // §43: the full revisions live here, in full, never shortened.
      ...(comparison === undefined ? [] : [
        `source revision ${comparison.sourceRevision}`,
        `target revision ${comparison.targetRevision}`,
        ...(comparison.repositoryId === undefined ? [] : [`repository ${comparison.repositoryId}`]),
      ]),
      ...(comparison?.mergeBase === undefined ? [] : [`merge base ${comparison.mergeBase}`]),
    ],
  }
}

/**
 * A revision short enough to read, long enough to recognise. Seven characters
 * is git's own convention; anything that is not a 40-hex revision is returned
 * untouched, because shortening something that is not a SHA would misrepresent
 * it.
 */
export function shortRevision(revision: string): string {
  return /^[0-9a-f]{40}$/.test(revision) ? revision.slice(0, 7) : revision
}

/** `aera-repo:aera-stack` → `aera-stack`. The prefix is machinery, not a name. */
export function repositoryDisplayName(repositoryId: string): string {
  const separator = repositoryId.lastIndexOf(':')
  return separator === -1 ? repositoryId : repositoryId.slice(separator + 1)
}

export function toMessageRowView(
  message: CollabMessageV1,
  packets: readonly CollabPacketCardView[],
): CollabMessageRowView {
  const intentLabel = COORDINATION_INTENT_LABELS[message.intent]
  return {
    who: message.sender.displayName,
    principalKind: message.sender.principalKind,
    // §40: only an agent gets the interpretation banner. A human's message is
    // not analysis, and a service's is not either.
    ...(message.sender.principalKind === 'AGENT' ? { authorshipNote: AGENT_ANALYSIS_NOTE } : {}),
    body: message.body,
    when: message.sentAt,
    ...(intentLabel === undefined ? {} : { intentLabel }),
    sequence: message.sequence,
    packets,
    otherReferences: message.references.flatMap((reference) => {
      switch (reference.kind) {
        case 'PACKET': return []
        case 'EVIDENCE': return [`Evidence ${reference.evidenceId}`]
        case 'WORKING_LINE': return [`Working Line ${reference.codeWorkingLineId}`]
        case 'CHECKPOINT': return [`Checkpoint ${reference.checkpointId}`]
        case 'DECISION': return [`Decision ${reference.decisionId}`]
        case 'RESOURCE': return [reference.resourceRef]
      }
    }),
    technical: [message.messageId, `sequence ${String(message.sequence)}`],
  }
}

export function toThreadRowView(input: {
  readonly thread: CollabThreadV1
  readonly messages: readonly CollabMessageRowView[]
  readonly decisionSubjects: readonly string[]
  readonly workingLineLabels?: Readonly<Record<string, string>>
}): CollabThreadRowView {
  const last = input.messages.at(-1)
  return {
    subject: input.thread.subject,
    aboutLine: threadAboutLine(
      input.thread.anchors,
      input.workingLineLabels === undefined ? {} : { workingLineLabels: input.workingLineLabels },
    ),
    participants: input.thread.participants.map(
      (participant) => `${participant.displayName} (${participant.principalKind.toLowerCase()})`,
    ),
    messageCount: input.messages.length,
    ...(last === undefined ? {} : { lastMessageAt: last.when }),
    archived: input.thread.lifecycle === 'ARCHIVED',
    messages: input.messages,
    decisionSubjects: input.decisionSubjects,
    technical: [input.thread.threadId, ...input.thread.decisionIds],
  }
}
