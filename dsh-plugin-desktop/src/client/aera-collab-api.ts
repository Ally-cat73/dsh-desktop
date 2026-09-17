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
  readonly unrepresentable: readonly string[]
  readonly structuralDeltaNote?: string
  readonly technical: readonly string[]
  readonly computedAt: string
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
  readonly rail: readonly CollabRailTab[]
  readonly activity: readonly CollabActivityRow[]
  readonly checkpoints: readonly { readonly label: string, readonly when?: string, readonly detail?: string }[]
  readonly checkpointsEmptyReason?: string
  readonly evidence: readonly { readonly label: string, readonly status: string, readonly technical?: string }[]
  readonly liveProviderState?: {
    readonly recorded?: string
    readonly live?: string
    readonly unavailableReason?: string
  }
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
  openCollab(workOrderId?: string): Promise<void>
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
          files: Object.freeze(list(raw.files, 'changed files').map((file): CollabChangedFileRow => {
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
        technical: technicalList(row.technical ?? [], 'technical'),
      })
    })),
    ...(linesEmptyReason === undefined ? {} : { linesEmptyReason }),
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
    checkpoints: Object.freeze(list(value.checkpoints ?? [], 'checkpoints').map(row => {
      if (!isObject(row)) throw new Error('dsh-plugin-desktop: invalid checkpoint row')
      const when = optionalText(row.when, 'when')
      const detail = optionalText(row.detail, 'detail')
      return Object.freeze({
        label: text(row.label, 'label'),
        ...(when === undefined ? {} : { when }),
        ...(detail === undefined ? {} : { detail }),
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
    async openCollab(workOrderId?: string) {
      const response = await fetcher(WORK_CONTEXT_OPEN_PATH, {
        method: 'POST',
        credentials: 'same-origin',
        redirect: 'error',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ view: 'COLLAB', ...(workOrderId === undefined ? {} : { workOrderId }) }),
      })
      const body = await readResponse(response)
      if (!isObject(body) || body.ok !== true) {
        throw new Error('dsh-plugin-desktop: invalid Aera Collab open response')
      }
    },
  })
}

export const aeraCollabPaths = Object.freeze({
  directory: DIRECTORY_PATH,
  resolve: RESOLVE_PATH,
  view: VIEW_PATH,
  open: WORK_CONTEXT_OPEN_PATH,
})
