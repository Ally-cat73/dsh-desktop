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
const WORK_CONTEXT_OPEN_PATH = '/desktop/aera/work-context/open'

const MAX_ROWS = 50
const MAX_TEXT = 4_096
const MAX_REPOSITORIES = 16

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

/** Read-only Collab operations plus the one explicit act that joins. */
export interface AeraCollabApi {
  directory(query: string): Promise<CollabDirectoryResultView>
  resolve(): Promise<CollabResolutionView>
  openCollab(workOrderId?: string): Promise<void>
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > MAX_TEXT) {
    throw new Error(`dsh-plugin-desktop: invalid ${label} in Aera Collab response`)
  }
  return value
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
  open: WORK_CONTEXT_OPEN_PATH,
})
