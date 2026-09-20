/**
 * Same-origin browser client for the read-only Aera Collab surfaces.
 *
 * WO-AERA-CODE-COLLAB-READ-FIRST-SURFACE-001, owner entry-point direction.
 *
 * Mirrors `desktop-settings-api.ts`: the renderer holds no store path and no
 * write capability, and every response is validated into a bounded shape
 * before it can reach React state. A malformed response is refused rather than
 * rendered — a Collab surface whose entire claim is truthful attribution must
 * not display a row it cannot vouch for.
 */

const DIRECTORY_PATH = '/desktop/aera/collab/directory'
const RESOLVE_PATH = '/desktop/aera/collab/resolve'
const VIEW_PATH = '/desktop/aera/collab/view'
const WORK_CONTEXT_OPEN_PATH = '/desktop/aera/work-context/open'
const COORDINATION_PATH = '/desktop/aera/collab/coordination'
const PACKET_STATE_PATH = '/desktop/aera/collab/packet-state'

const MAX_ROWS = 50
const MAX_TEXT = 4_096
/*
 * A technical-disclosure line is allowed to be long. "changed on both" names
 * every file that moved on two Working Lines, and on a real Work Order that is
 * a list of a hundred-odd paths. Truncating it would be the surface quietly
 * telling the reader less than it knows, so the bound is generous and the
 * content is left intact.
 */
const MAX_TECHNICAL_TEXT = 262_144
const MAX_REPOSITORIES = 16
/** Ceilings on the surface projection, so a renderer is never handed an unbounded list. */
const MAX_LIST = 2_000
/** Changed files are rendered in bounded pages; the reader is told when one is cut. */
export const MAX_RENDERED_FILES = 200

/** Why one picker row is in the result. */
export type CollabDirectoryMatch = 'ID' | 'TITLE' | 'REPOSITORY'

/** One findable Work Order as the picker shows it. */
export interface CollabDirectoryRowView {
  readonly workOrderId: string
  readonly title: string
  readonly lifecycleState: string
  readonly authorityClass: string
  readonly primaryRepositoryId?: string
  readonly repositoryIds: readonly string[]
  readonly lastActivityAt?: string
  readonly matchedOn: readonly CollabDirectoryMatch[]
}

/** The complete picker projection. */
export interface CollabDirectoryResultView {
  readonly query: string
  readonly listing: 'ACTIVE' | 'MATCHES'
  readonly rows: readonly CollabDirectoryRowView[]
  readonly totalWorkOrders: number
  readonly truncated: boolean
  readonly emptyReason?: string
}

/** What this workspace is about, when that can be said honestly. */
export interface CollabResolutionView {
  readonly workOrderId?: string
  readonly repositoryId?: string
  readonly source: 'ENVIRONMENT' | 'WORKSPACE_REMOTE' | 'VERIFIED_CHECKOUT' | 'NONE'
  readonly reason?: string
}


/** One Working Line as the surface shows it. */
export interface CollabLineRow {
  readonly codeWorkingLineId?: string
  readonly label: string
  readonly participant: string
  readonly topologySentence: string
  readonly topologyState: string
  readonly conflictSentence?: string
  readonly dirtyMarker?: string
  readonly checkpointCount: number
  readonly compareAvailable: boolean
  readonly provenance: string
  readonly provenanceNote?: string
  /** §41: the parent/origin trail, one sentence. */
  readonly lineageSentence?: string
  /** §11: where the line is going — a separate relationship. */
  readonly integrationTargetSentence?: string
  readonly latestCheckpoint?: string
  readonly lifecycleWord?: string
  /** §47: attribution corrected, with the stored claim disclosed. */
  readonly attributionNote?: string
  readonly attributionOriginalClaim?: string
  readonly technical: readonly string[]
}

/** One changed file in a Compare. */
export interface CollabChangedFileRow {
  readonly kindWord: string
  readonly path: string
  readonly previousPath?: string
  readonly counts?: string
  readonly bothLines: boolean
  readonly conflicted: boolean
  readonly structuralDelta: readonly string[]
  readonly accessibleName: string
}

/** A deterministic comparison of two states. */
export interface CollabCompare {
  readonly heading: string
  readonly banner: string
  readonly from: { readonly side: string, readonly name: string }
  readonly to: { readonly side: string, readonly name: string }
  readonly directionSentence: string
  readonly headline: string
  readonly files: readonly CollabChangedFileRow[]
  /**
   * Why the file list is absent even though the comparison succeeded.
   *
   * A comparison of more than `MAX_LIST` files used to throw out of the shared
   * `list()` helper, which aborted `parseCollabSurface` and blanked the ENTIRE
   * Collab panel — threads, messages, evidence and all — over one oversized
   * section. A surface whose whole job is to be readable must degrade the part
   * it cannot draw and say why, not delete itself.
   */
  readonly filesUnavailableReason?: string
  readonly unrepresentable: readonly string[]
  readonly structuralDeltaNote?: string
  readonly technical: readonly string[]
  readonly computedAt: string
}

/** §30 — the five counts Record displays, derived once by the service. */
export interface CollabRecordCounts {
  readonly workingLines: number
  readonly checkpoints: number
  readonly activity: number
  readonly discussionsDecisions: number
  readonly evidence: number
}

/**
 * §30 — one displayed zero, classified against the store.
 *
 * TRUE_ZERO / PROJECTION_DEFECT / RECORDING_GAP. Rendered under Technical
 * details: the reader wants the sentence, an auditor wants the classification.
 */
export interface CollabZeroClassification {
  readonly category: string
  readonly classification: 'TRUE_ZERO' | 'PROJECTION_DEFECT' | 'RECORDING_GAP'
  readonly storeRecords: number
  readonly gapEvidence: readonly string[]
  readonly sentence: string
}

/** One rail section and its count, where a count has actually been computed. */
export interface CollabRailTab {
  readonly section: string
  readonly label: string
  readonly count?: number
  readonly countUnavailableReason?: string
}

/** One participant. */
export interface CollabParticipantRow {
  readonly displayName: string
  readonly principalKind: string
  readonly statusLine: string
  readonly lineLabels: readonly string[]
  /** §32: contribution counted by governance leg, not by who typed the event. */
  readonly contributionSentence?: string
  readonly technical: readonly string[]
}

/** One recorded act. */
export interface CollabActivityRow {
  readonly actor: string
  readonly summary: string
  readonly when: string
  readonly detail?: string
  readonly technical?: string
}

/**
 * One checkpoint card.
 *
 * This mirrors `CollabCheckpointRowView` member for member. It previously
 * declared `{ label, when, detail }`, which no producer ever sent: the service
 * emits `name` / `origin` / `who` / `when`. The mismatch was invisible because
 * the read-first slice could never have a checkpoint to draw, and would have
 * thrown on the first real one — durable checkpoints now exist, so the wire
 * shape is corrected to the one actually sent.
 */
export interface CollabCheckpointRow {
  readonly name: string
  readonly origin: string
  readonly who: string
  readonly when: string
  /** CP-5: stated, never implied. */
  readonly verifiabilityNote?: string
  readonly summary?: string
  readonly attributionNote?: string
  readonly attributionOriginalClaim?: string
  readonly technical: string
}

/** §46: one typed evidence card. */
export interface CollabEvidenceCard {
  readonly classWord: string
  readonly subject: string
  readonly outcome?: string
  readonly actor: string
  readonly when: string
  readonly analyticalNote?: string
  readonly factualNote?: string
  readonly body?: string
  readonly technical: readonly string[]
}

/** §43: one deterministic grouping of acts. */
export interface CollabActivityBlock {
  readonly title: string
  readonly from: string
  readonly to: string
  readonly participants: readonly string[]
  readonly counts: readonly string[]
  readonly legacyNote?: string
  readonly members: readonly CollabActivityRow[]
  readonly technical: readonly string[]
}

/** §44 / §45: a decision with the context that explains it. */
export interface CollabDecision {
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
  readonly notAFactNote: string
  readonly technical: readonly string[]
}

export interface CollabDiscussion {
  /** §3: a coordination thread listed as a discussion, or a durable one. */
  readonly kind: 'DISCUSSION' | 'THREAD'
  readonly subject: string
  readonly entryCount: number
  readonly participants: readonly string[]
  readonly updatedAt: string
  readonly latestEntry?: string
  readonly technical: readonly string[]
}

/**
 * WO-AERA-COLLAB-RELAY-COORDINATION-THREADS-AND-WORKING-LINE-HANDOFF-001 §38.
 * A packet as a compact card. Counts, never a pasted diff.
 */
export interface CollabPacketCard {
  readonly title: string
  readonly operands: string
  readonly facts: readonly string[]
  readonly capturedAt: string
  readonly stateNote?: string
  readonly stateMoved: boolean
  readonly technical: readonly string[]
}

/** §10/§40: who spoke, and whether it is measurement or interpretation. */
export interface CollabMessageRow {
  readonly who: string
  readonly principalKind: 'HUMAN' | 'AGENT' | 'SERVICE'
  readonly authorshipNote?: string
  readonly body: string
  readonly when: string
  readonly intentLabel?: string
  readonly sequence: number
  readonly packets: readonly CollabPacketCard[]
  readonly otherReferences: readonly string[]
  readonly technical: readonly string[]
}

/** §37: what the conversation is about, before what was said in it. */
export interface CollabThreadRow {
  readonly subject: string
  readonly aboutLine: string
  readonly participants: readonly string[]
  readonly messageCount: number
  readonly lastMessageAt?: string
  readonly archived: boolean
  readonly messages: readonly CollabMessageRow[]
  readonly decisionSubjects: readonly string[]
  readonly technical: readonly string[]
}

/** §20: the freshly resolved answer to "has this moved since it was sent?". */
export interface CollabPacketState {
  readonly verdict: string
  readonly humanSummary: string
  readonly snapshotSourceRevision?: string
  readonly snapshotTargetRevision?: string
  readonly currentSourceRevision?: string
  readonly currentTargetRevision?: string
  readonly unavailableReason?: string
}

/** One referenced node in the Work Context packet. */
export interface CollabNodeRef {
  readonly nodeId: string
  readonly label: string
  readonly sourcePath?: string
  readonly status: string
}

/** The Work Context packet, shown as the CONTEXT section. */
export interface CollabContextBlock {
  readonly currentCanonicalState: readonly CollabNodeRef[]
  readonly governingDecisions: readonly CollabNodeRef[]
  readonly knownResiduals: readonly CollabNodeRef[]
}

/** The complete read-first Collab surface for one Work Order. */
export interface CollabSurfaceView {
  readonly workOrderId: string
  readonly workOrderTitle?: string
  readonly repositories: readonly string[]
  readonly authorityMode: string
  readonly authorityModeNote: string
  readonly assembledAt: string
  readonly participants: readonly CollabParticipantRow[]
  readonly lines: readonly CollabLineRow[]
  readonly linesEmptyReason?: string
  /**
   * §30 — the counts Record renders. Single source, shared with the classifier.
   *
   * Optional so an older service cannot blank the surface; Record falls back to
   * computing them the same way, from the same fields.
   */
  readonly recordCounts?: CollabRecordCounts
  /** §30 — every displayed zero, mechanically classified against the store. */
  readonly zeroClassifications: readonly CollabZeroClassification[]
  readonly rail: readonly CollabRailTab[]
  readonly activity: readonly CollabActivityRow[]
  readonly checkpoints: readonly CollabCheckpointRow[]
  readonly checkpointsEmptyReason?: string
  readonly evidence: readonly { readonly label: string, readonly status: string, readonly technical?: string }[]
  readonly liveProviderState?: {
    readonly recorded?: string
    readonly live?: string
    readonly unavailableReason?: string
  }
  readonly evidenceCards: readonly CollabEvidenceCard[]
  readonly activityBlocks: readonly CollabActivityBlock[]
  readonly decisions: readonly CollabDecision[]
  readonly discussions: readonly CollabDiscussion[]
  readonly discussionsDecisionsEmptyReason?: string
  readonly threads: readonly CollabThreadRow[]
  readonly threadsEmptyReason?: string
  readonly coordinationDeliveryNote: string
  readonly discussionNote: string
  readonly archivedCount: number
  readonly compare?: CollabCompare
  readonly compareUnavailableReason?: string
  readonly context?: CollabContextBlock
  readonly projectedAt: string
}

/** An honest unavailable answer the panel can draw, instead of a blank. */
export interface CollabSurfaceUnavailable {
  readonly unavailableReason: string
}

/** Either the surface, or a stated reason there is none. */
export type CollabSurfaceResult = CollabSurfaceView | CollabSurfaceUnavailable

/** Narrow a surface result to the unavailable case. */
export function isCollabSurfaceUnavailable(
  value: CollabSurfaceResult,
): value is CollabSurfaceUnavailable {
  return 'unavailableReason' in value && !('workOrderId' in value)
}

/** Read-only Collab operations plus the one explicit act that joins. */
export interface AeraCollabApi {
  directory(query: string): Promise<CollabDirectoryResultView>
  resolve(): Promise<CollabResolutionView>
  /** Project one Work Order's surface WITHOUT joining it. */
  view(input: { workOrderId?: string, compareLineIndex?: number }): Promise<CollabSurfaceResult>
  /** §35 coordination writes. Each one changes durable records; none is a read. */
  coordinate(request: Record<string, unknown>): Promise<unknown>
  /** §20 "view current state". A read: it resolves, it never records. */
  packetState(packetId: string): Promise<CollabPacketState>
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown, label: string, max: number = MAX_TEXT): string {
  if (typeof value !== 'string' || value.length > max) {
    throw new Error(`dsh-plugin-desktop: invalid ${label} in Aera Collab response`)
  }
  return value
}

/** A disclosure line, which may legitimately enumerate many paths. */
function technicalText(value: unknown, label: string): string {
  return text(value, label, MAX_TECHNICAL_TEXT)
}

function optionalText(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : text(value, label)
}

function isMatch(value: unknown): value is CollabDirectoryMatch {
  return value === 'ID' || value === 'TITLE' || value === 'REPOSITORY'
}

function parseRow(value: unknown): CollabDirectoryRowView {
  if (!isObject(value)
    || !Array.isArray(value.repositoryIds)
    || value.repositoryIds.length > MAX_REPOSITORIES
    || !Array.isArray(value.matchedOn)
    || !value.matchedOn.every(isMatch)) {
    throw new Error('dsh-plugin-desktop: invalid Aera Collab directory row')
  }
  const workOrderId = text(value.workOrderId, 'WorkOrderId')
  if (workOrderId.trim() === '') throw new Error('dsh-plugin-desktop: empty WorkOrderId in Aera Collab response')
  const primaryRepositoryId = optionalText(value.primaryRepositoryId, 'repository id')
  const lastActivityAt = optionalText(value.lastActivityAt, 'activity timestamp')
  return Object.freeze({
    workOrderId,
    title: text(value.title, 'title'),
    lifecycleState: text(value.lifecycleState, 'lifecycle state'),
    authorityClass: text(value.authorityClass, 'authority class'),
    ...(primaryRepositoryId === undefined ? {} : { primaryRepositoryId }),
    repositoryIds: Object.freeze(value.repositoryIds.map(id => text(id, 'repository id'))),
    ...(lastActivityAt === undefined ? {} : { lastActivityAt }),
    matchedOn: Object.freeze([...value.matchedOn]),
  })
}

/** Validate the bounded picker projection before it reaches React state. */
export function parseCollabDirectoryResult(value: unknown): CollabDirectoryResultView {
  if (!isObject(value)
    || (value.listing !== 'ACTIVE' && value.listing !== 'MATCHES')
    || !Array.isArray(value.rows)
    || value.rows.length > MAX_ROWS
    || typeof value.totalWorkOrders !== 'number'
    || !Number.isInteger(value.totalWorkOrders)
    || value.totalWorkOrders < 0
    || typeof value.truncated !== 'boolean') {
    throw new Error('dsh-plugin-desktop: invalid Aera Collab directory response')
  }
  const rows = value.rows.map(parseRow)
  if (new Set(rows.map(row => row.workOrderId)).size !== rows.length) {
    throw new Error('dsh-plugin-desktop: duplicate Work Order in Aera Collab directory response')
  }
  const emptyReason = optionalText(value.emptyReason, 'reason')
  return Object.freeze({
    query: text(value.query, 'query'),
    listing: value.listing,
    rows: Object.freeze(rows),
    totalWorkOrders: value.totalWorkOrders,
    truncated: value.truncated,
    ...(emptyReason === undefined ? {} : { emptyReason }),
  })
}

/** Validate the workspace resolution before it reaches React state. */
export function parseCollabResolution(value: unknown): CollabResolutionView {
  if (!isObject(value)
    || (value.source !== 'ENVIRONMENT'
      && value.source !== 'WORKSPACE_REMOTE'
      && value.source !== 'VERIFIED_CHECKOUT'
      && value.source !== 'NONE')) {
    throw new Error('dsh-plugin-desktop: invalid Aera Collab resolution response')
  }
  const workOrderId = optionalText(value.workOrderId, 'WorkOrderId')
  const repositoryId = optionalText(value.repositoryId, 'repository id')
  const reason = optionalText(value.reason, 'reason')
  return Object.freeze({
    ...(workOrderId === undefined ? {} : { workOrderId }),
    ...(repositoryId === undefined ? {} : { repositoryId }),
    source: value.source,
    ...(reason === undefined ? {} : { reason }),
  })
}


function list(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > MAX_LIST) {
    throw new Error(`dsh-plugin-desktop: invalid ${label} in Aera Collab surface`)
  }
  return value
}

function textList(value: unknown, label: string): readonly string[] {
  return Object.freeze(list(value, label).map(entry => text(entry, label)))
}

/** A list of disclosure lines, under the generous technical bound. */
function technicalList(value: unknown, label: string): readonly string[] {
  return Object.freeze(list(value, label).map(entry => technicalText(entry, label)))
}

/** Validate one CONTEXT node reference. */
function parseNodeRef(value: unknown): CollabNodeRef {
  if (!isObject(value)) throw new Error('dsh-plugin-desktop: invalid context node')
  const sourcePath = optionalText(value.sourcePath, 'source path')
  return Object.freeze({
    nodeId: text(value.nodeId, 'node id'),
    label: text(value.label, 'label'),
    ...(sourcePath === undefined ? {} : { sourcePath }),
    status: text(value.status, 'status'),
  })
}

/** Validate the Work Context packet shown as the CONTEXT section. */
function parseContextBlock(value: Record<string, unknown>): CollabContextBlock {
  const rows = (key: string): readonly CollabNodeRef[] =>
    Object.freeze(list(value[key] ?? [], key).map(parseNodeRef))
  return Object.freeze({
    currentCanonicalState: rows('currentCanonicalState'),
    governingDecisions: rows('governingDecisions'),
    knownResiduals: rows('knownResiduals'),
  })
}

/**
 * Validate the Collab surface before it reaches React state.
 *
 * Bounded and structural: a surface whose whole claim is truthful attribution
 * must refuse a projection it cannot vouch for rather than draw it.
 */
export function parseCollabSurface(value: unknown): CollabSurfaceResult {
  if (!isObject(value)) throw new Error('dsh-plugin-desktop: invalid Aera Collab surface response')
  if (value.workOrderId === undefined) {
    return Object.freeze({ unavailableReason: text(value.unavailableReason, 'reason') })
  }
  const compare = value.compare === undefined
    ? undefined
    : (() => {
        const raw = value.compare
        if (!isObject(raw)) throw new Error('dsh-plugin-desktop: invalid Compare in Aera Collab surface')
        /*
         * A comparison larger than `MAX_LIST` is a real comparison, not a
         * malformed one. Throwing here aborted the whole surface parse and
         * blanked the panel; it is now reported per-section instead.
         */
        /*
         * The service may have withheld the rows itself (§36 wire budget), in
         * which case it sends the true total and its own reason — use those
         * rather than inferring from a list that was never sent.
         */
        const serviceWithheld = optionalText(raw.filesUnavailableReason, 'reason')
        const oversizedFileList = serviceWithheld ?? (
          Array.isArray(raw.files) && raw.files.length > MAX_LIST
            ? `This comparison changed ${String(raw.files.length)} files, more than this surface lists (${String(MAX_LIST)}). The counts above are complete; the per-file list is not shown.`
            : undefined
        )
        const renderableFiles = oversizedFileList === undefined
          ? list(raw.files, 'changed files')
          : []
        const operand = (side: unknown): { side: string, name: string } => {
          if (!isObject(side)) throw new Error('dsh-plugin-desktop: invalid Compare operand')
          return Object.freeze({ side: text(side.side, 'side'), name: text(side.name, 'name') })
        }
        return Object.freeze({
          heading: text(raw.heading, 'heading'),
          banner: text(raw.banner, 'banner'),
          from: operand(raw.from),
          to: operand(raw.to),
          directionSentence: text(raw.directionSentence, 'direction'),
          headline: text(raw.headline, 'headline'),
          /*
           * BOUNDED, NOT FATAL. The counts in `headline` are complete and stay
           * readable even when the file rows cannot be, which is the more
           * useful half of a large comparison anyway.
           */
          ...(oversizedFileList === undefined ? {} : { filesUnavailableReason: oversizedFileList }),
          files: Object.freeze(renderableFiles.map((file): CollabChangedFileRow => {
            if (!isObject(file)) throw new Error('dsh-plugin-desktop: invalid changed file row')
            const previousPath = optionalText(file.previousPath, 'previous path')
            const counts = optionalText(file.counts, 'counts')
            return Object.freeze({
              kindWord: text(file.kindWord, 'kind'),
              path: text(file.path, 'path'),
              ...(previousPath === undefined ? {} : { previousPath }),
              ...(counts === undefined ? {} : { counts }),
              bothLines: file.bothLines === true,
              conflicted: file.conflicted === true,
              structuralDelta: technicalList(file.structuralDelta ?? [], 'structural delta'),
              accessibleName: text(file.accessibleName, 'accessible name'),
            })
          })),
          unrepresentable: technicalList(raw.unrepresentable ?? [], 'unrepresentable'),
          ...(optionalText(raw.structuralDeltaNote, 'note') === undefined
            ? {}
            : { structuralDeltaNote: text(raw.structuralDeltaNote, 'note') }),
          technical: technicalList(raw.technical ?? [], 'technical'),
          computedAt: text(raw.computedAt, 'computedAt'),
        })
      })()

  const workOrderTitle = optionalText(value.workOrderTitle, 'title')
  const linesEmptyReason = optionalText(value.linesEmptyReason, 'reason')
  const checkpointsEmptyReason = optionalText(value.checkpointsEmptyReason, 'reason')
  const compareUnavailableReason = optionalText(value.compareUnavailableReason, 'reason')

  return Object.freeze({
    workOrderId: text(value.workOrderId, 'WorkOrderId'),
    ...(workOrderTitle === undefined ? {} : { workOrderTitle }),
    repositories: textList(value.repositories ?? [], 'repositories'),
    authorityMode: text(value.authorityMode, 'authority mode'),
    authorityModeNote: text(value.authorityModeNote, 'authority note'),
    assembledAt: text(value.assembledAt, 'assembledAt'),
    participants: Object.freeze(list(value.participants ?? [], 'participants').map((row): CollabParticipantRow => {
      if (!isObject(row)) throw new Error('dsh-plugin-desktop: invalid participant row')
      return Object.freeze({
        displayName: text(row.displayName, 'name'),
        principalKind: text(row.principalKind, 'kind'),
        statusLine: text(row.statusLine, 'status'),
        lineLabels: textList(row.lineLabels ?? [], 'line labels'),
        ...(optionalText(row.contributionSentence, 'contribution') === undefined
          ? {} : { contributionSentence: text(row.contributionSentence, 'contribution') }),
        technical: technicalList(row.technical ?? [], 'technical'),
      })
    })),
    lines: Object.freeze(list(value.lines ?? [], 'Working Lines').map((row): CollabLineRow => {
      if (!isObject(row)) throw new Error('dsh-plugin-desktop: invalid Working Line row')
      const id = optionalText(row.codeWorkingLineId, 'line id')
      const conflictSentence = optionalText(row.conflictSentence, 'conflict')
      const dirtyMarker = optionalText(row.dirtyMarker, 'dirty marker')
      const provenanceNote = optionalText(row.provenanceNote, 'provenance note')
      return Object.freeze({
        ...(id === undefined ? {} : { codeWorkingLineId: id }),
        label: text(row.label, 'label'),
        participant: text(row.participant, 'participant'),
        topologySentence: text(row.topologySentence, 'topology'),
        topologyState: text(row.topologyState, 'topology state'),
        ...(conflictSentence === undefined ? {} : { conflictSentence }),
        ...(dirtyMarker === undefined ? {} : { dirtyMarker }),
        checkpointCount: typeof row.checkpointCount === 'number' ? row.checkpointCount : 0,
        compareAvailable: row.compareAvailable === true,
        provenance: text(row.provenance, 'provenance'),
        ...(provenanceNote === undefined ? {} : { provenanceNote }),
        ...(optionalText(row.lineageSentence, 'lineage') === undefined
          ? {} : { lineageSentence: text(row.lineageSentence, 'lineage') }),
        ...(optionalText(row.integrationTargetSentence, 'target') === undefined
          ? {} : { integrationTargetSentence: text(row.integrationTargetSentence, 'target') }),
        ...(optionalText(row.latestCheckpoint, 'checkpoint') === undefined
          ? {} : { latestCheckpoint: text(row.latestCheckpoint, 'checkpoint') }),
        ...(optionalText(row.lifecycleWord, 'lifecycle') === undefined
          ? {} : { lifecycleWord: text(row.lifecycleWord, 'lifecycle') }),
        ...(optionalText(row.attributionNote, 'attribution') === undefined
          ? {} : { attributionNote: technicalText(row.attributionNote, 'attribution') }),
        ...(optionalText(row.attributionOriginalClaim, 'attribution') === undefined
          ? {} : { attributionOriginalClaim: technicalText(row.attributionOriginalClaim, 'attribution') }),
        technical: technicalList(row.technical ?? [], 'technical'),
      })
    })),
    ...(linesEmptyReason === undefined ? {} : { linesEmptyReason }),
    ...(isObject(value.recordCounts)
      ? {
          recordCounts: Object.freeze({
            workingLines: Number(value.recordCounts.workingLines ?? 0),
            checkpoints: Number(value.recordCounts.checkpoints ?? 0),
            activity: Number(value.recordCounts.activity ?? 0),
            discussionsDecisions: Number(value.recordCounts.discussionsDecisions ?? 0),
            evidence: Number(value.recordCounts.evidence ?? 0),
          }),
        }
      : {}),
    /*
     * §30. Absent is tolerated so an older service does not blank the surface,
     * but a malformed entry is rejected: a classification the reader cannot
     * trust is worse than none.
     */
    zeroClassifications: Object.freeze(
      list(value.zeroClassifications ?? [], 'zero classifications').map((row): CollabZeroClassification => {
        if (!isObject(row)) throw new Error('dsh-plugin-desktop: invalid zero classification')
        const classification = text(row.classification, 'classification')
        if (classification !== 'TRUE_ZERO' && classification !== 'PROJECTION_DEFECT' && classification !== 'RECORDING_GAP') {
          throw new Error('dsh-plugin-desktop: unknown zero classification')
        }
        return Object.freeze({
          category: text(row.category, 'category'),
          classification,
          storeRecords: typeof row.storeRecords === 'number' ? row.storeRecords : 0,
          gapEvidence: Object.freeze(
            (Array.isArray(row.gapEvidence) ? row.gapEvidence : []).map(entry => String(entry)),
          ),
          sentence: text(row.sentence, 'sentence'),
        })
      }),
    ),
    rail: Object.freeze(list(value.rail ?? [], 'rail').map((tab): CollabRailTab => {
      if (!isObject(tab)) throw new Error('dsh-plugin-desktop: invalid rail tab')
      const reason = optionalText(tab.countUnavailableReason, 'reason')
      return Object.freeze({
        section: text(tab.section, 'section'),
        label: text(tab.label, 'label'),
        // ABSENT means "not computed", never "none".
        ...(typeof tab.count === 'number' ? { count: tab.count } : {}),
        ...(reason === undefined ? {} : { countUnavailableReason: reason }),
      })
    })),
    activity: Object.freeze(list(value.activity ?? [], 'activity').map((row): CollabActivityRow => {
      if (!isObject(row)) throw new Error('dsh-plugin-desktop: invalid activity row')
      const detail = optionalText(row.detail, 'detail')
      const technical = row.technical === undefined ? undefined : technicalText(row.technical, 'technical')
      return Object.freeze({
        actor: text(row.actor, 'actor'),
        summary: text(row.summary, 'summary'),
        when: text(row.when, 'when'),
        ...(detail === undefined ? {} : { detail }),
        ...(technical === undefined ? {} : { technical }),
      })
    })),
    checkpoints: Object.freeze(list(value.checkpoints ?? [], 'checkpoints').map((row): CollabCheckpointRow => {
      if (!isObject(row)) throw new Error('dsh-plugin-desktop: invalid checkpoint row')
      return Object.freeze({
        name: text(row.name, 'name'),
        origin: text(row.origin, 'origin'),
        who: text(row.who, 'who'),
        when: text(row.when, 'when'),
        ...(optionalText(row.verifiabilityNote, 'note') === undefined
          ? {} : { verifiabilityNote: technicalText(row.verifiabilityNote, 'note') }),
        ...(optionalText(row.summary, 'summary') === undefined
          ? {} : { summary: technicalText(row.summary, 'summary') }),
        ...(optionalText(row.attributionNote, 'attribution') === undefined
          ? {} : { attributionNote: technicalText(row.attributionNote, 'attribution') }),
        ...(optionalText(row.attributionOriginalClaim, 'attribution') === undefined
          ? {} : { attributionOriginalClaim: technicalText(row.attributionOriginalClaim, 'attribution') }),
        technical: technicalText(row.technical, 'technical'),
      })
    })),
    ...(checkpointsEmptyReason === undefined ? {} : { checkpointsEmptyReason }),
    evidence: Object.freeze(list(value.evidence ?? [], 'evidence').map(row => {
      if (!isObject(row)) throw new Error('dsh-plugin-desktop: invalid evidence row')
      const technical = row.technical === undefined ? undefined : technicalText(row.technical, 'technical')
      return Object.freeze({
        label: text(row.label, 'label'),
        status: text(row.status, 'status'),
        ...(technical === undefined ? {} : { technical }),
      })
    })),
    evidenceCards: Object.freeze(list(value.evidenceCards ?? [], 'evidence cards').map((row): CollabEvidenceCard => {
      if (!isObject(row)) throw new Error('dsh-plugin-desktop: invalid evidence card')
      return Object.freeze({
        classWord: text(row.classWord, 'class'),
        subject: text(row.subject, 'subject'),
        ...(optionalText(row.outcome, 'outcome') === undefined ? {} : { outcome: text(row.outcome, 'outcome') }),
        actor: text(row.actor, 'actor'),
        when: text(row.when, 'when'),
        ...(optionalText(row.analyticalNote, 'note') === undefined
          ? {} : { analyticalNote: text(row.analyticalNote, 'note') }),
        ...(optionalText(row.factualNote, 'note') === undefined
          ? {} : { factualNote: text(row.factualNote, 'note') }),
        ...(optionalText(row.body, 'body') === undefined ? {} : { body: technicalText(row.body, 'body') }),
        technical: technicalList(row.technical ?? [], 'technical'),
      })
    })),
    activityBlocks: Object.freeze(list(value.activityBlocks ?? [], 'activity blocks').map((row): CollabActivityBlock => {
      if (!isObject(row)) throw new Error('dsh-plugin-desktop: invalid activity block')
      return Object.freeze({
        title: text(row.title, 'title'),
        from: text(row.from, 'from'),
        to: text(row.to, 'to'),
        participants: textList(row.participants ?? [], 'participants'),
        counts: textList(row.counts ?? [], 'counts'),
        ...(optionalText(row.legacyNote, 'note') === undefined
          ? {} : { legacyNote: technicalText(row.legacyNote, 'note') }),
        members: Object.freeze(list(row.members ?? [], 'members').map((member): CollabActivityRow => {
          if (!isObject(member)) throw new Error('dsh-plugin-desktop: invalid block member')
          const detail = optionalText(member.detail, 'detail')
          const memberTechnical = member.technical === undefined
            ? undefined : technicalText(member.technical, 'technical')
          return Object.freeze({
            actor: text(member.actor, 'actor'),
            summary: technicalText(member.summary, 'summary'),
            when: text(member.when, 'when'),
            ...(detail === undefined ? {} : { detail }),
            ...(memberTechnical === undefined ? {} : { technical: memberTechnical }),
          })
        })),
        technical: technicalList(row.technical ?? [], 'technical'),
      })
    })),
    decisions: Object.freeze(list(value.decisions ?? [], 'decisions').map((row): CollabDecision => {
      if (!isObject(row)) throw new Error('dsh-plugin-desktop: invalid decision')
      return Object.freeze({
        subject: text(row.subject, 'subject'),
        decidedBy: text(row.decidedBy, 'decided by'),
        recordedBy: text(row.recordedBy, 'recorded by'),
        ...(optionalText(row.authorisedBy, 'authorised by') === undefined
          ? {} : { authorisedBy: text(row.authorisedBy, 'authorised by') }),
        ...(optionalText(row.verifiedBy, 'verified by') === undefined
          ? {} : { verifiedBy: text(row.verifiedBy, 'verified by') }),
        when: text(row.when, 'when'),
        selectedOption: text(row.selectedOption, 'selected'),
        ...(optionalText(row.rationale, 'rationale') === undefined
          ? {} : { rationale: technicalText(row.rationale, 'rationale') }),
        alternatives: textList(row.alternatives ?? [], 'alternatives'),
        evidence: textList(row.evidence ?? [], 'evidence'),
        discussions: textList(row.discussions ?? [], 'discussions'),
        authorisedEffects: textList(row.authorisedEffects ?? [], 'authorised effects'),
        resultingEffects: textList(row.resultingEffects ?? [], 'resulting effects'),
        statusWord: text(row.statusWord, 'status'),
        ...(optionalText(row.supersededByNote, 'note') === undefined
          ? {} : { supersededByNote: text(row.supersededByNote, 'note') }),
        notAFactNote: technicalText(row.notAFactNote, 'note'),
        technical: technicalList(row.technical ?? [], 'technical'),
      })
    })),
    discussions: Object.freeze(list(value.discussions ?? [], 'discussions').map((row): CollabDiscussion => {
      if (!isObject(row)) throw new Error('dsh-plugin-desktop: invalid discussion')
      return Object.freeze({
        kind: row.kind === 'THREAD' ? 'THREAD' as const : 'DISCUSSION' as const,
        subject: text(row.subject, 'subject'),
        entryCount: typeof row.entryCount === 'number' ? row.entryCount : 0,
        participants: textList(row.participants ?? [], 'participants'),
        updatedAt: optionalText(row.updatedAt, 'updatedAt') === undefined
          ? ''
          : text(row.updatedAt, 'updatedAt'),
        ...(optionalText(row.latestEntry, 'entry') === undefined
          ? {} : { latestEntry: technicalText(row.latestEntry, 'entry') }),
        technical: technicalList(row.technical ?? [], 'technical'),
      })
    })),
    ...(optionalText(value.discussionsDecisionsEmptyReason, 'reason') === undefined
      ? {} : { discussionsDecisionsEmptyReason: technicalText(value.discussionsDecisionsEmptyReason, 'reason') }),
    threads: Object.freeze(list(value.threads ?? [], 'threads').map(parseThreadRow)),
    ...(optionalText(value.threadsEmptyReason, 'reason') === undefined
      ? {} : { threadsEmptyReason: technicalText(value.threadsEmptyReason, 'reason') }),
    coordinationDeliveryNote: technicalText(value.coordinationDeliveryNote, 'delivery note'),
    ...(isObject(value.liveProviderState)
      ? {
          liveProviderState: Object.freeze({
            ...(optionalText(value.liveProviderState.recorded, 'recorded') === undefined
              ? {} : { recorded: text(value.liveProviderState.recorded, 'recorded') }),
            ...(optionalText(value.liveProviderState.live, 'live') === undefined
              ? {} : { live: text(value.liveProviderState.live, 'live') }),
            ...(optionalText(value.liveProviderState.unavailableReason, 'reason') === undefined
              ? {} : { unavailableReason: text(value.liveProviderState.unavailableReason, 'reason') }),
          }),
        }
      : {}),
    ...(isObject(value.context) ? { context: parseContextBlock(value.context) } : {}),
    discussionNote: text(value.discussionNote, 'discussion note'),
    archivedCount: typeof value.archivedCount === 'number' ? value.archivedCount : 0,
    ...(compare === undefined ? {} : { compare }),
    ...(compareUnavailableReason === undefined ? {} : { compareUnavailableReason }),
    projectedAt: text(value.projectedAt, 'projectedAt'),
  })
}


/** §38: parse one packet card. Unknown shapes are refused, never half-drawn. */
function parsePacketCard(value: unknown): CollabPacketCard {
  if (!isObject(value)) throw new Error('dsh-plugin-desktop: invalid packet card')
  return Object.freeze({
    title: text(value.title, 'title'),
    operands: text(value.operands, 'operands'),
    facts: textList(value.facts ?? [], 'facts'),
    capturedAt: text(value.capturedAt, 'capturedAt'),
    ...(optionalText(value.stateNote, 'state note') === undefined
      ? {} : { stateNote: text(value.stateNote, 'state note') }),
    stateMoved: value.stateMoved === true,
    technical: technicalList(value.technical ?? [], 'technical'),
  })
}

function parseMessageRow(value: unknown): CollabMessageRow {
  if (!isObject(value)) throw new Error('dsh-plugin-desktop: invalid coordination message')
  const kind = value.principalKind
  if (kind !== 'HUMAN' && kind !== 'AGENT' && kind !== 'SERVICE') {
    /*
     * §10 is not negotiable at the wire boundary either. A message whose
     * sender kind cannot be read is refused rather than defaulted to HUMAN,
     * because defaulting it is exactly how an agent ends up presented as a
     * person.
     */
    throw new Error('dsh-plugin-desktop: coordination message has no readable sender kind')
  }
  return Object.freeze({
    who: text(value.who, 'who'),
    principalKind: kind,
    ...(optionalText(value.authorshipNote, 'note') === undefined
      ? {} : { authorshipNote: text(value.authorshipNote, 'note') }),
    body: technicalText(value.body, 'body'),
    when: text(value.when, 'when'),
    ...(optionalText(value.intentLabel, 'intent') === undefined
      ? {} : { intentLabel: text(value.intentLabel, 'intent') }),
    sequence: typeof value.sequence === 'number' ? value.sequence : 0,
    packets: Object.freeze(list(value.packets ?? [], 'packets').map(parsePacketCard)),
    otherReferences: textList(value.otherReferences ?? [], 'references'),
    technical: technicalList(value.technical ?? [], 'technical'),
  })
}

function parseThreadRow(value: unknown): CollabThreadRow {
  if (!isObject(value)) throw new Error('dsh-plugin-desktop: invalid coordination thread')
  return Object.freeze({
    subject: text(value.subject, 'subject'),
    aboutLine: text(value.aboutLine, 'about'),
    participants: textList(value.participants ?? [], 'participants'),
    messageCount: typeof value.messageCount === 'number' ? value.messageCount : 0,
    ...(optionalText(value.lastMessageAt, 'when') === undefined
      ? {} : { lastMessageAt: text(value.lastMessageAt, 'when') }),
    archived: value.archived === true,
    messages: Object.freeze(list(value.messages ?? [], 'messages').map(parseMessageRow)),
    decisionSubjects: textList(value.decisionSubjects ?? [], 'decisions'),
    technical: technicalList(value.technical ?? [], 'technical'),
  })
}

export function parseCollabPacketState(value: unknown): CollabPacketState {
  if (!isObject(value)) throw new Error('dsh-plugin-desktop: invalid packet state')
  if (optionalText(value.unavailableReason, 'reason') !== undefined) {
    return Object.freeze({
      verdict: 'UNRESOLVABLE',
      humanSummary: technicalText(value.unavailableReason, 'reason'),
      unavailableReason: technicalText(value.unavailableReason, 'reason'),
    })
  }
  return Object.freeze({
    verdict: text(value.verdict, 'verdict'),
    humanSummary: technicalText(value.humanSummary, 'summary'),
    ...(optionalText(value.snapshotSourceRevision, 'rev') === undefined
      ? {} : { snapshotSourceRevision: text(value.snapshotSourceRevision, 'rev') }),
    ...(optionalText(value.snapshotTargetRevision, 'rev') === undefined
      ? {} : { snapshotTargetRevision: text(value.snapshotTargetRevision, 'rev') }),
    ...(optionalText(value.currentSourceRevision, 'rev') === undefined
      ? {} : { currentSourceRevision: text(value.currentSourceRevision, 'rev') }),
    ...(optionalText(value.currentTargetRevision, 'rev') === undefined
      ? {} : { currentTargetRevision: text(value.currentTargetRevision, 'rev') }),
  })
}

async function readResponse(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`dsh-plugin-desktop: Aera Collab request failed (${String(response.status)})`)
  }
  try {
    return await response.json() as unknown
  } catch {
    throw new Error('dsh-plugin-desktop: Aera Collab response was not JSON')
  }
}

/** Construct the default same-origin API, with a fetch seam for focused tests. */
export function createAeraCollabApi(
  fetcher: FetchLike = globalThis.fetch.bind(globalThis),
): AeraCollabApi {
  return Object.freeze({
    async directory(query: string) {
      const path = query === '' ? DIRECTORY_PATH : `${DIRECTORY_PATH}?q=${encodeURIComponent(query)}`
      const response = await fetcher(path, {
        method: 'GET',
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
        headers: { 'Accept': 'application/json' },
      })
      return parseCollabDirectoryResult(await readResponse(response))
    },
    async resolve() {
      const response = await fetcher(RESOLVE_PATH, {
        method: 'GET',
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
        headers: { 'Accept': 'application/json' },
      })
      return parseCollabResolution(await readResponse(response))
    },
    async view(input: { workOrderId?: string, compareLineIndex?: number }) {
      const params = new URLSearchParams()
      if (input.workOrderId !== undefined) params.set('workOrderId', input.workOrderId)
      if (input.compareLineIndex !== undefined) params.set('compareLineIndex', String(input.compareLineIndex))
      const query = params.toString()
      const response = await fetcher(query === '' ? VIEW_PATH : `${VIEW_PATH}?${query}`, {
        method: 'GET',
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
        headers: { 'Accept': 'application/json' },
      })
      return parseCollabSurface(await readResponse(response))
    },
    async coordinate(request: Record<string, unknown>) {
      const response = await fetcher(COORDINATION_PATH, {
        method: 'POST',
        credentials: 'same-origin',
        redirect: 'error',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
      /*
       * A refusal carries the service's own sentence, and that sentence is
       * what the person needs to read. Replacing it with a status code would
       * throw away the only explanation they are going to get.
       */
      if (!response.ok) {
        let stated: string | undefined
        try {
          const failure = await response.json() as unknown
          if (isObject(failure) && typeof failure.error === 'string') stated = failure.error
        } catch {
          stated = undefined
        }
        throw new Error(stated ?? `dsh-plugin-desktop: the coordination action was refused (${String(response.status)})`)
      }
      const body = await readResponse(response)
      if (!isObject(body) || body.ok !== true) {
        throw new Error('dsh-plugin-desktop: invalid Aera Collab coordination response')
      }
      return body.result
    },
    async packetState(packetId: string) {
      const response = await fetcher(
        `${PACKET_STATE_PATH}?packetId=${encodeURIComponent(packetId)}`,
        {
          method: 'GET',
          credentials: 'same-origin',
          redirect: 'error',
          cache: 'no-store',
          headers: { 'Accept': 'application/json' },
        },
      )
      return parseCollabPacketState(await readResponse(response))
    },
  })
}

export const aeraCollabPaths = Object.freeze({
  directory: DIRECTORY_PATH,
  resolve: RESOLVE_PATH,
  view: VIEW_PATH,
  open: WORK_CONTEXT_OPEN_PATH,
  coordination: COORDINATION_PATH,
  packetState: PACKET_STATE_PATH,
})
