/**
 * Collab directory — the read-only projection behind the Collab picker.
 *
 * WO-AERA-CODE-COLLAB-READ-FIRST-SURFACE-001, owner entry-point direction.
 *
 * A person entering Collab should not have to know a WorkOrderId. This
 * projection lets them find one by typing part of a title, part of an id, or a
 * repository name — and, typing nothing, see the work that is actually live.
 *
 * Deterministic by construction: case-insensitive substring matching over
 * facts already recorded in the durable store, ordered by recorded activity
 * with the WorkOrderId as a stable tiebreak. No model call, no ranking model,
 * no network. The same query always returns the same rows in the same order.
 *
 * Every row says WHY it matched, so a result the reader did not expect can be
 * understood rather than guessed at. Nothing here writes, and the projection
 * deliberately carries no `exactPayload`: a picker row is a way in, not a
 * place to read the order.
 */

/** Ceiling on returned rows, so a picker can never be handed an unbounded list. */
export const COLLAB_DIRECTORY_MAX_ROWS = 50

/** Longest query accepted; anything longer is a mistake, not a search. */
export const COLLAB_DIRECTORY_MAX_QUERY_LENGTH = 200

/** Why one row is in the result. Reported, never inferred by the reader. */
export type CollabDirectoryMatch = 'ID' | 'TITLE' | 'REPOSITORY'

/** One findable Work Order, reduced to what a picker row can honestly show. */
export interface CollabDirectoryRow {
  readonly workOrderId: string
  readonly title: string
  readonly lifecycleState: string
  readonly authorityClass: string
  /** The PRIMARY binding when there is one; a picker never invents a primary. */
  readonly primaryRepositoryId?: string
  readonly repositoryIds: readonly string[]
  readonly lastActivityAt?: string
  readonly matchedOn: readonly CollabDirectoryMatch[]
}

/** The complete picker projection. */
export interface CollabDirectoryView {
  readonly query: string
  /** `ACTIVE` when nothing was typed; `MATCHES` when the query selected rows. */
  readonly listing: 'ACTIVE' | 'MATCHES'
  readonly rows: readonly CollabDirectoryRow[]
  readonly totalWorkOrders: number
  /** True when the ceiling cut the list, so the reader is told rather than misled. */
  readonly truncated: boolean
  /** Said in words when the result is empty, so a blank list never means "broken". */
  readonly emptyReason?: string
}

/**
 * The narrow store face this projection needs.
 *
 * Declared structurally rather than importing the store class, so the
 * projection is pure, unit-testable against recorded facts, and cannot reach
 * anything that writes. `ParticipationStore` satisfies it as-is.
 */
export interface CollabDirectorySource {
  listWorkOrders(): readonly { readonly workOrderId: string, readonly title?: string }[]
  effectiveWorkOrderState(workOrderId: string): {
    readonly lifecycleState: string
    readonly authorityClass: string
  } | undefined
  listRepositoryBindings(workOrderId?: string): readonly {
    readonly workOrderId: string
    readonly repositoryId: string
    readonly role: string
  }[]
  lastMeaningfulActivityAt(workOrderId: string): string | undefined
}

/** Lifecycle states a person would call "live work". */
const ACTIVE_STATES = new Set(['ACTIVE'])

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * Order rows by recorded activity, newest first, with the WorkOrderId as a
 * stable tiebreak so a row with no recorded activity still has one fixed place.
 */
function byActivityThenId(left: CollabDirectoryRow, right: CollabDirectoryRow): number {
  const leftAt = left.lastActivityAt ?? ''
  const rightAt = right.lastActivityAt ?? ''
  if (leftAt !== rightAt) return leftAt < rightAt ? 1 : -1
  return left.workOrderId < right.workOrderId ? -1 : left.workOrderId > right.workOrderId ? 1 : 0
}

/**
 * Project the durable store into a findable list of Work Orders.
 *
 * @param source - the durable store, read-only.
 * @param input - the typed query; empty or absent lists ACTIVE work.
 */
export function projectCollabDirectory(
  source: CollabDirectorySource,
  input: { readonly query?: string } = {},
): CollabDirectoryView {
  const raw = (input.query ?? '').slice(0, COLLAB_DIRECTORY_MAX_QUERY_LENGTH)
  const query = raw.trim()
  const needle = normalize(query)
  const workOrders = source.listWorkOrders()
  const bindings = source.listRepositoryBindings()

  const repositoriesFor = new Map<string, string[]>()
  const primaryFor = new Map<string, string>()
  for (const binding of bindings) {
    const list = repositoriesFor.get(binding.workOrderId) ?? []
    if (!list.includes(binding.repositoryId)) list.push(binding.repositoryId)
    repositoriesFor.set(binding.workOrderId, list)
    if (binding.role === 'PRIMARY' && !primaryFor.has(binding.workOrderId)) {
      primaryFor.set(binding.workOrderId, binding.repositoryId)
    }
  }

  const candidates: CollabDirectoryRow[] = []
  for (const record of workOrders) {
    const { workOrderId } = record
    const title = record.title ?? ''
    const state = source.effectiveWorkOrderState(workOrderId)
    const lifecycleState = state?.lifecycleState ?? 'UNRECORDED'
    const authorityClass = state?.authorityClass ?? 'UNRECORDED'
    const repositoryIds = repositoriesFor.get(workOrderId) ?? []
    const primaryRepositoryId = primaryFor.get(workOrderId)
    const lastActivityAt = source.lastMeaningfulActivityAt(workOrderId)

    const matchedOn: CollabDirectoryMatch[] = []
    if (needle !== '') {
      if (normalize(workOrderId).includes(needle)) matchedOn.push('ID')
      if (title !== '' && normalize(title).includes(needle)) matchedOn.push('TITLE')
      if (repositoryIds.some(id => normalize(id).includes(needle))) matchedOn.push('REPOSITORY')
      if (matchedOn.length === 0) continue
    } else if (!ACTIVE_STATES.has(lifecycleState)) {
      continue
    }

    candidates.push({
      workOrderId,
      title,
      lifecycleState,
      authorityClass,
      ...(primaryRepositoryId === undefined ? {} : { primaryRepositoryId }),
      repositoryIds: Object.freeze([...repositoryIds]),
      ...(lastActivityAt === undefined ? {} : { lastActivityAt }),
      matchedOn: Object.freeze(matchedOn),
    })
  }

  candidates.sort(byActivityThenId)
  const truncated = candidates.length > COLLAB_DIRECTORY_MAX_ROWS
  const rows = truncated ? candidates.slice(0, COLLAB_DIRECTORY_MAX_ROWS) : candidates
  const listing = needle === '' ? 'ACTIVE' : 'MATCHES'

  return Object.freeze({
    query,
    listing,
    rows: Object.freeze(rows),
    totalWorkOrders: workOrders.length,
    truncated,
    ...(rows.length > 0
      ? {}
      : {
          emptyReason: needle === ''
            ? `No Work Order is currently ACTIVE. ${String(workOrders.length)} are recorded; type to search all of them.`
            : `Nothing matches "${query}". ${String(workOrders.length)} Work Orders are recorded; matching is on WorkOrderId, title and repository.`,
        }),
  })
}
