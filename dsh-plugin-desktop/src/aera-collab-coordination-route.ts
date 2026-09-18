/**
 * Aera Collab coordination routes —
 * WO-AERA-COLLAB-RELAY-COORDINATION-THREADS-AND-WORKING-LINE-HANDOFF-001 §35.
 *
 * These are the FIRST write routes this surface has ever had. Everything the
 * Read-First slice exposed was a GET over a projection; sending a message is
 * not a projection, so the verb boundary the predecessor order established
 * applies in full:
 *
 *   POST /desktop/aera/collab/coordination  every coordination write
 *   GET  /desktop/aera/collab/packet-state  §20 "view current state" — read-only
 *
 * The renderer is still never handed a store path or a write capability. It
 * names an action and its operands; the service resolves authority from the
 * joined session and the configured principal, and refuses honestly when
 * either is missing. A malformed body is REFUSED, never coerced — coercing a
 * half-understood write into a durable, append-only store is how records that
 * nobody meant to write get written.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { isSameOriginLoopbackRequest } from './desktop-settings-route.ts'

/** Private loopback path carrying every coordination write. */
export const AERA_COLLAB_COORDINATION_PATH = '/desktop/aera/collab/coordination'

/** Private loopback path resolving a packet's current-state assessment. */
export const AERA_COLLAB_PACKET_STATE_PATH = '/desktop/aera/collab/packet-state'

/**
 * Bound on a coordination request body.
 *
 * Larger than the 4 KB an open request gets, because a message body is prose a
 * person typed and a rationale can legitimately be a few paragraphs. Small
 * enough that this route can never become a file transport.
 */
const MAX_COORDINATION_BODY_BYTES = 64 * 1024

const MAX_ID_LENGTH = 300
const MAX_SUBJECT_LENGTH = 400
const MAX_MESSAGE_BODY_LENGTH = 16_000
const MAX_OPTIONS = 12

export const COORDINATION_ACTIONS = [
  'OPEN_THREAD',
  'POST_MESSAGE',
  'SHARE_COMPARE',
  'ACKNOWLEDGE',
  'SET_LIFECYCLE',
  'RECORD_DECISION',
] as const
export type CoordinationAction = (typeof COORDINATION_ACTIONS)[number]

const INTENTS = [
  'GENERAL', 'REVIEW_REQUEST', 'RECONCILIATION_REQUEST',
  'PAUSE_REQUEST', 'RESUME_NOTICE', 'DECISION_REQUEST',
] as const

export interface CoordinationRequest {
  readonly action: CoordinationAction
  /**
   * The Work Order the surface is looking at. Carried on every action because
   * the renderer may be reading an order other than this workspace's default,
   * and a message must land on the order the sender was actually reading.
   */
  readonly workOrderId?: string
  readonly threadId?: string
  readonly messageId?: string
  readonly subject?: string
  readonly body?: string
  readonly intent?: (typeof INTENTS)[number]
  readonly packetId?: string
  readonly parentMessageId?: string
  readonly requestId?: string
  readonly kind?: 'READ' | 'ACKNOWLEDGED'
  readonly lifecycle?: 'ACTIVE' | 'ARCHIVED'
  readonly compareLineIndex?: number
  readonly options?: readonly { readonly optionId: string, readonly label: string }[]
  readonly selectedOptionId?: string
  readonly rationale?: string
  readonly messageIds?: readonly string[]
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(JSON.stringify(body))
}

async function readBoundedJson(req: IncomingMessage): Promise<unknown> {
  const declared = req.headers['content-length']
  if (declared !== undefined) {
    if (!/^\d+$/.test(declared)) throw new SyntaxError('invalid content length')
    if (Number(declared) > MAX_COORDINATION_BODY_BYTES) throw new SyntaxError('body too large')
  }
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += buffer.byteLength
    if (size > MAX_COORDINATION_BODY_BYTES) throw new SyntaxError('body too large')
    chunks.push(buffer)
  }
  if (size === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function boundedId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length > MAX_ID_LENGTH) return undefined
  return trimmed
}

/**
 * Parse one coordination request, strictly.
 *
 * Every branch names exactly which members it accepts. An unknown member is a
 * refusal rather than something silently dropped: a renderer sending a field
 * this route does not understand is a version mismatch, and quietly ignoring
 * it would let the caller believe a write carried something it did not.
 */
export function parseCoordinationBody(value: unknown): CoordinationRequest | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const body = value as Record<string, unknown>
  const action = body['action']
  if (typeof action !== 'string' || !(COORDINATION_ACTIONS as readonly string[]).includes(action)) {
    return undefined
  }

  const allowed: Readonly<Record<CoordinationAction, readonly string[]>> = {
    OPEN_THREAD: ['action', 'subject'],
    POST_MESSAGE: ['action', 'threadId', 'body', 'intent', 'packetId', 'parentMessageId', 'requestId'],
    SHARE_COMPARE: ['action', 'compareLineIndex'],
    ACKNOWLEDGE: ['action', 'threadId', 'messageId', 'kind'],
    SET_LIFECYCLE: ['action', 'threadId', 'lifecycle'],
    RECORD_DECISION: ['action', 'threadId', 'subject', 'options', 'selectedOptionId', 'rationale', 'messageIds'],
  }
  // `workOrderId` is accepted on every action, so it is permitted alongside
  // each action's own members rather than repeated in six lists.
  const permitted = [...allowed[action as CoordinationAction], 'workOrderId']
  for (const key of Object.keys(body)) if (!permitted.includes(key)) return undefined
  let scopedWorkOrderId: string | undefined
  if (body['workOrderId'] !== undefined) {
    scopedWorkOrderId = boundedId(body['workOrderId'])
    if (scopedWorkOrderId === undefined) return undefined
  }
  const scope = scopedWorkOrderId === undefined ? {} : { workOrderId: scopedWorkOrderId }

  switch (action) {
    case 'OPEN_THREAD': {
      const subject = body['subject']
      if (typeof subject !== 'string') return undefined
      const trimmed = subject.trim()
      if (trimmed === '' || trimmed.length > MAX_SUBJECT_LENGTH) return undefined
      return { action, subject: trimmed, ...scope }
    }
    case 'POST_MESSAGE': {
      const threadId = boundedId(body['threadId'])
      const requestId = boundedId(body['requestId'])
      if (threadId === undefined || requestId === undefined) return undefined
      if (typeof body['body'] !== 'string') return undefined
      const messageBody = body['body'].trim()
      if (messageBody === '' || messageBody.length > MAX_MESSAGE_BODY_LENGTH) return undefined
      let intent: (typeof INTENTS)[number] | undefined
      if (body['intent'] !== undefined) {
        if (typeof body['intent'] !== 'string'
          || !(INTENTS as readonly string[]).includes(body['intent'])) return undefined
        intent = body['intent'] as (typeof INTENTS)[number]
      }
      let packetId: string | undefined
      if (body['packetId'] !== undefined) {
        packetId = boundedId(body['packetId'])
        if (packetId === undefined) return undefined
      }
      let parentMessageId: string | undefined
      if (body['parentMessageId'] !== undefined) {
        parentMessageId = boundedId(body['parentMessageId'])
        if (parentMessageId === undefined) return undefined
      }
      return {
        action, threadId, body: messageBody, requestId, ...scope,
        ...(intent === undefined ? {} : { intent }),
        ...(packetId === undefined ? {} : { packetId }),
        ...(parentMessageId === undefined ? {} : { parentMessageId }),
      }
    }
    case 'SHARE_COMPARE': {
      if (body['compareLineIndex'] === undefined) return { action, ...scope }
      const index = body['compareLineIndex']
      if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index > 999) {
        return undefined
      }
      return { action, compareLineIndex: index, ...scope }
    }
    case 'ACKNOWLEDGE': {
      const threadId = boundedId(body['threadId'])
      const messageId = boundedId(body['messageId'])
      if (threadId === undefined || messageId === undefined) return undefined
      if (body['kind'] !== 'READ' && body['kind'] !== 'ACKNOWLEDGED') return undefined
      return { action, threadId, messageId, kind: body['kind'], ...scope }
    }
    case 'SET_LIFECYCLE': {
      const threadId = boundedId(body['threadId'])
      if (threadId === undefined) return undefined
      if (body['lifecycle'] !== 'ACTIVE' && body['lifecycle'] !== 'ARCHIVED') return undefined
      return { action, threadId, lifecycle: body['lifecycle'], ...scope }
    }
    case 'RECORD_DECISION': {
      const threadId = boundedId(body['threadId'])
      const selectedOptionId = boundedId(body['selectedOptionId'])
      if (threadId === undefined || selectedOptionId === undefined) return undefined
      if (typeof body['subject'] !== 'string') return undefined
      const subject = body['subject'].trim()
      if (subject === '' || subject.length > MAX_SUBJECT_LENGTH) return undefined
      if (!Array.isArray(body['options']) || body['options'].length === 0
        || body['options'].length > MAX_OPTIONS) return undefined
      const options: { optionId: string, label: string }[] = []
      for (const candidate of body['options'] as unknown[]) {
        if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined
        const option = candidate as Record<string, unknown>
        if (Object.keys(option).some(key => key !== 'optionId' && key !== 'label')) return undefined
        const optionId = boundedId(option['optionId'])
        if (optionId === undefined || typeof option['label'] !== 'string') return undefined
        const label = option['label'].trim()
        if (label === '' || label.length > MAX_SUBJECT_LENGTH) return undefined
        options.push({ optionId, label })
      }
      // §20: a selection that names no option on the record is not a decision.
      if (!options.some(option => option.optionId === selectedOptionId)) return undefined
      let rationale: string | undefined
      if (body['rationale'] !== undefined) {
        if (typeof body['rationale'] !== 'string') return undefined
        const trimmed = body['rationale'].trim()
        if (trimmed === '' || trimmed.length > MAX_MESSAGE_BODY_LENGTH) return undefined
        rationale = trimmed
      }
      let messageIds: string[] | undefined
      if (body['messageIds'] !== undefined) {
        if (!Array.isArray(body['messageIds']) || body['messageIds'].length > 200) return undefined
        messageIds = []
        for (const candidate of body['messageIds'] as unknown[]) {
          const id = boundedId(candidate)
          if (id === undefined) return undefined
          messageIds.push(id)
        }
      }
      return {
        action, threadId, subject, options, selectedOptionId, ...scope,
        ...(rationale === undefined ? {} : { rationale }),
        ...(messageIds === undefined ? {} : { messageIds }),
      }
    }
  }
}

/**
 * Handle one coordination write.
 *
 * A refusal from the service is relayed as a 4xx with the service's own
 * sentence, because the service refusals are written to be read by a person
 * ("a human sender is never invented"), and replacing them with a generic
 * error would throw away the only explanation the user is going to get.
 */
export async function handleAeraCollabCoordinationRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  perform: (request: CoordinationRequest) => Promise<unknown>,
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
  let request: CoordinationRequest | undefined
  try {
    request = parseCoordinationBody(await readBoundedJson(req))
  } catch {
    request = undefined
  }
  if (request === undefined) {
    writeJson(res, 400, {
      error: 'That coordination request was not understood, so nothing was written. Durable records are never written from a half-understood request.',
    })
    return
  }
  try {
    writeJson(res, 200, { ok: true, result: await perform(request) })
  } catch (cause) {
    reportError(`perform the Aera Collab coordination action ${request.action}`, cause)
    writeJson(res, 409, {
      error: cause instanceof Error
        ? cause.message
        : 'The coordination action could not be completed, and nothing was written.',
    })
  }
}

/** Extract the bounded `packetId` from a packet-state read. */
export function parsePacketStateQuery(url: string | undefined): string | undefined {
  if (url === undefined) return undefined
  let parsed: URL
  try {
    parsed = new URL(url, 'http://127.0.0.1')
  } catch {
    return undefined
  }
  const keys = [...parsed.searchParams.keys()]
  if (keys.some(key => key !== 'packetId')) return undefined
  return boundedId(parsed.searchParams.get('packetId'))
}

/**
 * Handle one §20 "view current state" read.
 *
 * Read-only in the strict sense. It resolves where the Working Lines are NOW
 * and compares that against the packet's frozen snapshot; it does not, and
 * must never, write the answer back into the packet.
 */
export function handleAeraCollabPacketStateRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  assess: (packetId: string) => unknown,
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
  const packetId = parsePacketStateQuery(req.url)
  if (packetId === undefined) {
    writeJson(res, 400, { error: 'A packet-state read carries exactly one packetId; nothing else is accepted.' })
    return
  }
  try {
    writeJson(res, 200, assess(packetId))
  } catch (cause) {
    reportError('assess the coordination packet state', cause)
    writeJson(res, 200, {
      unavailableReason: cause instanceof Error
        ? cause.message
        : 'The current state of this packet could not be resolved.',
    })
  }
}
