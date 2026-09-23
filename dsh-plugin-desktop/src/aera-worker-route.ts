/**
 * Governed worker loopback routes — WO-AERA-CODE-CLAUDE-CODE-GOVERNED-WORKER-INTEGRATION-001 §15.
 *
 * The same strict same-origin loopback pattern as `aera-collab-route.ts`:
 *
 *   GET  /desktop/aera/worker/status   read-only projection of durable records + live state
 *   POST /desktop/aera/worker/action   START_EPOCH | CANCEL | GRANT | REVOKE
 *
 * The renderer is never handed a store path, a binary path or any credential.
 * START_EPOCH returns immediately (202); the Epoch runs in the main process
 * and its progress is read back through GET status. GRANT / REVOKE are the
 * owner's own acts, recorded as the configured human principal exactly as the
 * existing RECORD_DECISION coordination action is.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { isSameOriginLoopbackRequest } from './desktop-settings-route.ts'
import { WORKER_EFFECT_CLASSES, type WorkerEffectClass } from './aera-worker-effect-intent.ts'

export const AERA_WORKER_STATUS_PATH = '/desktop/aera/worker/status'
export const AERA_WORKER_ACTION_PATH = '/desktop/aera/worker/action'

const MAX_ACTION_BODY_BYTES = 16_384
const MAX_ID = 200
const MAX_TASK = 8_000

export type AeraWorkerActionRequest =
  | { readonly action: 'START_EPOCH', readonly workOrderId: string, readonly codeWorkingLineId: string, readonly task: string }
  | { readonly action: 'CANCEL', readonly workOrderId: string }
  | { readonly action: 'GRANT', readonly workOrderId: string, readonly codeWorkingLineId: string, readonly classes: readonly WorkerEffectClass[] }
  | { readonly action: 'REVOKE', readonly workOrderId: string, readonly decisionId: string }

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(JSON.stringify(body))
}

const id = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' && value.length <= MAX_ID && !/[\s\0]/u.test(value) ? value : undefined

/** Strictly parse an action body; anything unexpected is refused, never coerced. */
export function parseWorkerAction(value: unknown): AeraWorkerActionRequest | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const body = value as Record<string, unknown>
  const workOrderId = id(body.workOrderId)
  if (workOrderId === undefined) return undefined
  const only = (keys: readonly string[]): boolean => Object.keys(body).every(key => keys.includes(key))
  switch (body.action) {
    case 'START_EPOCH': {
      const codeWorkingLineId = id(body.codeWorkingLineId)
      const task = typeof body.task === 'string' ? body.task.trim() : ''
      if (!only(['action', 'workOrderId', 'codeWorkingLineId', 'task']) || codeWorkingLineId === undefined || task === '' || task.length > MAX_TASK) return undefined
      return { action: 'START_EPOCH', workOrderId, codeWorkingLineId, task }
    }
    case 'CANCEL':
      return only(['action', 'workOrderId']) ? { action: 'CANCEL', workOrderId } : undefined
    case 'GRANT': {
      const codeWorkingLineId = id(body.codeWorkingLineId)
      const classes = body.classes
      if (!only(['action', 'workOrderId', 'codeWorkingLineId', 'classes']) || codeWorkingLineId === undefined) return undefined
      if (!Array.isArray(classes) || classes.length === 0 || classes.length > WORKER_EFFECT_CLASSES.length) return undefined
      if (!classes.every(entry => typeof entry === 'string' && (WORKER_EFFECT_CLASSES as readonly string[]).includes(entry))) return undefined
      return { action: 'GRANT', workOrderId, codeWorkingLineId, classes: [...new Set(classes as WorkerEffectClass[])] }
    }
    case 'REVOKE': {
      const decisionId = id(body.decisionId)
      return only(['action', 'workOrderId', 'decisionId']) && decisionId !== undefined ? { action: 'REVOKE', workOrderId, decisionId } : undefined
    }
    default:
      return undefined
  }
}

async function readBoundedJson(req: IncomingMessage): Promise<unknown> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += buffer.byteLength
    if (size > MAX_ACTION_BODY_BYTES) throw new SyntaxError('body too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

/** GET status. */
export function handleAeraWorkerStatusRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  status: (workOrderId: string) => unknown,
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
  const workOrderId = id(new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('workOrderId') ?? undefined)
  if (workOrderId === undefined) {
    writeJson(res, 400, { error: 'workOrderId is required' })
    return
  }
  try {
    writeJson(res, 200, status(workOrderId))
  } catch (cause) {
    reportError('read worker status', cause)
    writeJson(res, 200, { workOrderId, unavailableReason: cause instanceof Error ? cause.message : String(cause) })
  }
}

/** POST action. */
export async function handleAeraWorkerActionRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  perform: (request: AeraWorkerActionRequest) => Promise<unknown>,
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
  let request: AeraWorkerActionRequest | undefined
  try {
    request = parseWorkerAction(await readBoundedJson(req))
  } catch {
    request = undefined
  }
  if (request === undefined) {
    writeJson(res, 400, { error: 'invalid worker action' })
    return
  }
  try {
    const result = await perform(request)
    writeJson(res, request.action === 'START_EPOCH' ? 202 : 200, result ?? { ok: true })
  } catch (cause) {
    reportError(`perform worker action ${request.action}`, cause)
    const code = cause !== null && typeof cause === 'object' && 'code' in cause ? String((cause as { code: unknown }).code) : 'WORKER_ACTION_REFUSED'
    writeJson(res, 409, { error: code, message: cause instanceof Error ? cause.message : String(cause) })
  }
}
