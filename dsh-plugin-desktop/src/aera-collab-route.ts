/**
 * Aera Collab loopback routes — WO-AGC-002 Remit C, extended by
 * WO-AERA-CODE-COLLAB-READ-FIRST-SURFACE-001 (owner entry-point direction).
 *
 * Strict same-origin loopback endpoints following the established private
 * Desktop settings API pattern (`desktop-settings-route.ts`). They exist so the
 * desktop's own renderer can offer a Collab entry point in the ordinary product
 * shell without ever being handed a store path or a write capability (§14).
 *
 * The verb boundary here is load-bearing and was established by measurement,
 * not assumption: joining a WorkContext writes `sessions.json`, so it can never
 * sit behind a GET.
 *
 *   GET  /desktop/aera/collab/directory  find Work Orders   — read-only
 *   GET  /desktop/aera/collab/resolve    this workspace's   — read-only
 *   POST /desktop/aera/work-context/open open the surface   — joins, mutating
 *
 * The read routes carry no `exactPayload`, no store path and no principal
 * secrets: a picker row is a way in, not a place to read the order.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { isSameOriginLoopbackRequest } from './desktop-settings-route.ts'
import { COLLAB_DIRECTORY_MAX_QUERY_LENGTH } from './aera-collab-directory.ts'

/** Private loopback path revealing the native Work Context window. */
export const AERA_WORK_CONTEXT_OPEN_PATH = '/desktop/aera/work-context/open'

/** Private loopback path listing findable Work Orders. */
export const AERA_COLLAB_DIRECTORY_PATH = '/desktop/aera/collab/directory'

/** Private loopback path naming the Work Order this workspace is about. */
export const AERA_COLLAB_RESOLVE_PATH = '/desktop/aera/collab/resolve'

/** The two views the native window can be opened onto. */
export type AeraWorkContextView = 'CONTEXT' | 'COLLAB'

/** Bound on a request body: an open request carries an id and a view, nothing more. */
const MAX_OPEN_BODY_BYTES = 4_096

/** Longest WorkOrderId accepted from the renderer. */
const MAX_WORK_ORDER_ID_LENGTH = 200

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(JSON.stringify(body))
}

/** Read the bounded JSON body of an open request. */
async function readBoundedJson(req: IncomingMessage): Promise<unknown> {
  const declared = req.headers['content-length']
  if (declared !== undefined) {
    if (!/^\d+$/.test(declared)) throw new SyntaxError('invalid content length')
    if (Number(declared) > MAX_OPEN_BODY_BYTES) throw new SyntaxError('body too large')
  }
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += buffer.byteLength
    if (size > MAX_OPEN_BODY_BYTES) throw new SyntaxError('body too large')
    chunks.push(buffer)
  }
  if (size === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

/**
 * Parse the optional selection carried by an open request.
 *
 * An absent selection means "open the window as it is" — the original
 * behaviour, unchanged. A malformed one is refused rather than coerced.
 */
export function parseWorkContextOpenBody(value: unknown): {
  readonly workOrderId?: string
  readonly view?: AeraWorkContextView
} | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const body = value as Record<string, unknown>
  const keys = Object.keys(body).sort()
  for (const key of keys) if (key !== 'workOrderId' && key !== 'view') return undefined
  const parsed: { workOrderId?: string, view?: AeraWorkContextView } = {}
  if (body.workOrderId !== undefined) {
    if (typeof body.workOrderId !== 'string') return undefined
    const workOrderId = body.workOrderId.trim()
    if (workOrderId === '' || workOrderId.length > MAX_WORK_ORDER_ID_LENGTH) return undefined
    parsed.workOrderId = workOrderId
  }
  if (body.view !== undefined) {
    if (body.view !== 'CONTEXT' && body.view !== 'COLLAB') return undefined
    parsed.view = body.view
  }
  return parsed
}

/** Handle one POST that reveals the Work Context window, optionally on a chosen order. */
export async function handleAeraWorkContextOpenRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  openWindow: (selection: { readonly workOrderId?: string, readonly view?: AeraWorkContextView }) => void,
  reportError: (operation: string, cause: unknown) => void,
): Promise<void> {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.setHeader('allow', 'POST')
    res.end()
    return
  }
  if (!isSameOriginLoopbackRequest(req, expectedOrigin, true)) {
    res.statusCode = 403
    res.end()
    return
  }
  let selection: { readonly workOrderId?: string, readonly view?: AeraWorkContextView } | undefined
  try {
    selection = parseWorkContextOpenBody(await readBoundedJson(req))
  } catch {
    selection = undefined
  }
  if (selection === undefined) {
    writeJson(res, 400, { error: 'An open request carries an optional WorkOrderId and view; nothing else is accepted.' })
    return
  }
  try {
    openWindow(selection)
    writeJson(res, 200, { ok: true })
  } catch (cause) {
    reportError('open the Aera Work Context window', cause)
    res.statusCode = 500
    res.end()
  }
}

/** Extract the bounded `q` parameter from a read request. */
export function parseDirectoryQuery(url: string | undefined): string {
  if (url === undefined) return ''
  let parsed: URL
  try {
    parsed = new URL(url, 'http://127.0.0.1')
  } catch {
    return ''
  }
  const keys = [...parsed.searchParams.keys()]
  if (keys.some(key => key !== 'q')) return ''
  return (parsed.searchParams.get('q') ?? '').slice(0, COLLAB_DIRECTORY_MAX_QUERY_LENGTH)
}

/**
 * Handle one GET listing findable Work Orders.
 *
 * Read-only in the strict sense: `readDirectory` projects the durable store and
 * opens nothing, so this route cannot change a byte of it.
 */
export function handleAeraCollabDirectoryRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  readDirectory: (query: string) => unknown,
  reportError: (operation: string, cause: unknown) => void,
): void {
  if (req.method !== 'GET') {
    res.statusCode = 405
    res.setHeader('allow', 'GET')
    res.end()
    return
  }
  if (!isSameOriginLoopbackRequest(req, expectedOrigin, false)) {
    res.statusCode = 403
    res.end()
    return
  }
  try {
    writeJson(res, 200, readDirectory(parseDirectoryQuery(req.url)))
  } catch (cause) {
    // An unconfigured or unavailable store is an honest answer, not a crash:
    // the picker says what is missing instead of showing an empty list.
    reportError('read the Aera Collab directory', cause)
    writeJson(res, 200, {
      query: '',
      listing: 'MATCHES',
      rows: [],
      totalWorkOrders: 0,
      truncated: false,
      emptyReason: cause instanceof Error ? cause.message : 'The durable participation store is unavailable.',
    })
  }
}

/** Handle one GET naming the Work Order this workspace is about. Read-only. */
export function handleAeraCollabResolveRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  resolveDefault: () => unknown,
  reportError: (operation: string, cause: unknown) => void,
): void {
  if (req.method !== 'GET') {
    res.statusCode = 405
    res.setHeader('allow', 'GET')
    res.end()
    return
  }
  if (!isSameOriginLoopbackRequest(req, expectedOrigin, false)) {
    res.statusCode = 403
    res.end()
    return
  }
  try {
    writeJson(res, 200, resolveDefault())
  } catch (cause) {
    reportError('resolve the workspace Work Order', cause)
    writeJson(res, 200, {
      source: 'NONE',
      reason: cause instanceof Error ? cause.message : 'The workspace Work Order could not be resolved.',
    })
  }
}
