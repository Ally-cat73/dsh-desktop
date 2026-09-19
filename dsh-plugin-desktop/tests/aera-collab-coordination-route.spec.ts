/**
 * Coordination route tests —
 * WO-AERA-COLLAB-RELAY-COORDINATION-THREADS-AND-WORKING-LINE-HANDOFF-001 §35.
 *
 * These are the first WRITE routes this surface has, so the tests concentrate
 * on the two things a write route must never do: accept a request it does not
 * fully understand, and let a cross-origin caller through.
 */
import { describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  AERA_COLLAB_COORDINATION_PATH,
  AERA_COLLAB_PACKET_STATE_PATH,
  COORDINATION_ACTIONS,
  handleAeraCollabCoordinationRequest,
  handleAeraCollabPacketStateRequest,
  parseCoordinationBody,
  parsePacketStateQuery,
} from '../src/aera-collab-coordination-route.ts'

const ORIGIN = 'http://127.0.0.1:4680'

function request(over: {
  method?: string
  origin?: string
  host?: string
  remoteAddress?: string
  body?: string
  url?: string
}): IncomingMessage {
  return {
    method: over.method ?? 'POST',
    url: over.url ?? AERA_COLLAB_COORDINATION_PATH,
    headers: {
      ...(over.origin === undefined ? {} : { origin: over.origin }),
      host: over.host ?? '127.0.0.1:4680',
    },
    socket: { remoteAddress: over.remoteAddress ?? '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      if (over.body !== undefined) yield Buffer.from(over.body)
    },
  } as unknown as IncomingMessage
}

function response(): ServerResponse & { statusCode: number, body: () => unknown } {
  const chunks: string[] = []
  const res = {
    statusCode: 0,
    setHeader: vi.fn(),
    end: vi.fn((chunk?: string) => { if (chunk !== undefined) chunks.push(chunk) }),
    body: () => (chunks.length === 0 ? undefined : JSON.parse(chunks.join('')) as unknown),
  }
  return res as unknown as ServerResponse & { statusCode: number, body: () => unknown }
}

describe('parseCoordinationBody', () => {
  it('accepts each declared action in its minimal valid form', () => {
    const valid: Record<string, unknown>[] = [
      { action: 'OPEN_THREAD', subject: 'Authentication overlap' },
      { action: 'POST_MESSAGE', threadId: 'aera:collab-thread:a', body: 'hello', requestId: 'r1' },
      { action: 'SHARE_COMPARE' },
      { action: 'SHARE_COMPARE_TO_THREAD', threadId: 'aera:collab-thread:a' },
      { action: 'ACKNOWLEDGE', threadId: 'aera:collab-thread:a', messageId: 'aera:collab-message:b', kind: 'READ' },
      { action: 'SET_LIFECYCLE', threadId: 'aera:collab-thread:a', lifecycle: 'ARCHIVED' },
      {
        action: 'RECORD_DECISION',
        threadId: 'aera:collab-thread:a',
        subject: 'Contract change',
        options: [{ optionId: 'A', label: 'Leave it' }],
        selectedOptionId: 'A',
      },
    ]
    for (const body of valid) {
      expect(parseCoordinationBody(body), JSON.stringify(body)).toBeDefined()
    }
    // Every declared action is covered above — no action ships untested.
    expect(new Set(valid.map(body => body.action))).toEqual(new Set(COORDINATION_ACTIONS))
  })

  it('refuses an unknown member rather than silently dropping it', () => {
    /*
     * A renderer sending a field this route does not understand is a version
     * mismatch. Ignoring it would let the caller believe the write carried
     * something it did not.
     */
    expect(parseCoordinationBody({
      action: 'OPEN_THREAD', subject: 'x', participants: ['someone'],
    })).toBeUndefined()
  })

  it('refuses malformed and out-of-range requests', () => {
    expect(parseCoordinationBody(undefined)).toBeUndefined()
    expect(parseCoordinationBody({ action: 'NOT_AN_ACTION' })).toBeUndefined()
    expect(parseCoordinationBody({ action: 'OPEN_THREAD', subject: '   ' })).toBeUndefined()
    expect(parseCoordinationBody({ action: 'OPEN_THREAD', subject: 'x'.repeat(401) })).toBeUndefined()
    expect(parseCoordinationBody({ action: 'POST_MESSAGE', threadId: 't', body: 'hi' })).toBeUndefined()
    expect(parseCoordinationBody({
      action: 'POST_MESSAGE', threadId: 't', body: 'hi', requestId: 'r', intent: 'SHOUT',
    })).toBeUndefined()
    expect(parseCoordinationBody({ action: 'ACKNOWLEDGE', threadId: 't', messageId: 'm', kind: 'SEEN' })).toBeUndefined()
    expect(parseCoordinationBody({ action: 'SHARE_COMPARE', compareLineIndex: -1 })).toBeUndefined()
    expect(parseCoordinationBody({ action: 'SHARE_COMPARE', compareLineIndex: 1.5 })).toBeUndefined()
  })

  it('§20 — a selection that names no option on the record is not a decision', () => {
    expect(parseCoordinationBody({
      action: 'RECORD_DECISION',
      threadId: 'aera:collab-thread:a',
      subject: 'Contract change',
      options: [{ optionId: 'A', label: 'Leave it' }],
      selectedOptionId: 'B',
    })).toBeUndefined()
  })

  it('refuses a decision with no alternatives at all', () => {
    expect(parseCoordinationBody({
      action: 'RECORD_DECISION',
      threadId: 'aera:collab-thread:a',
      subject: 'Contract change',
      options: [],
      selectedOptionId: 'A',
    })).toBeUndefined()
  })

  it('trims prose and preserves the caller’s idempotency key verbatim', () => {
    const parsed = parseCoordinationBody({
      action: 'POST_MESSAGE', threadId: 'aera:collab-thread:a', body: '  hello  ', requestId: ' r1 ',
    })
    expect(parsed?.body).toBe('hello')
    expect(parsed?.requestId).toBe('r1')
  })
})

describe('handleAeraCollabCoordinationRequest', () => {
  it('refuses a non-POST', async () => {
    const res = response()
    await handleAeraCollabCoordinationRequest(
      request({ method: 'GET' }), res, ORIGIN, async () => ({}), () => {},
    )
    expect(res.statusCode).toBe(405)
  })

  it('refuses a cross-origin caller', async () => {
    const res = response()
    const perform = vi.fn(async () => ({}))
    await handleAeraCollabCoordinationRequest(
      request({ origin: 'http://evil.example', body: '{"action":"SHARE_COMPARE"}' }),
      res, ORIGIN, perform, () => {},
    )
    expect(res.statusCode).toBe(403)
    expect(perform).not.toHaveBeenCalled()
  })

  it('refuses a body it does not understand, and performs nothing', async () => {
    const res = response()
    const perform = vi.fn(async () => ({}))
    await handleAeraCollabCoordinationRequest(
      request({ origin: ORIGIN, body: '{"action":"OPEN_THREAD"}' }), res, ORIGIN, perform, () => {},
    )
    expect(res.statusCode).toBe(400)
    expect(perform).not.toHaveBeenCalled()
  })

  it('performs a well-formed action and returns its result', async () => {
    const res = response()
    const perform = vi.fn(async () => ({ threadId: 'aera:collab-thread:x', outcome: 'RECORDED' }))
    await handleAeraCollabCoordinationRequest(
      request({ origin: ORIGIN, body: '{"action":"OPEN_THREAD","subject":"Overlap"}' }),
      res, ORIGIN, perform, () => {},
    )
    expect(res.statusCode).toBe(200)
    expect(perform).toHaveBeenCalledWith(expect.objectContaining({ action: 'OPEN_THREAD', subject: 'Overlap' }))
    expect(res.body()).toEqual({ ok: true, result: { threadId: 'aera:collab-thread:x', outcome: 'RECORDED' } })
  })

  it('relays the service’s own refusal sentence, because that is what the reader needs', async () => {
    const res = response()
    await handleAeraCollabCoordinationRequest(
      request({ origin: ORIGIN, body: '{"action":"SHARE_COMPARE"}' }),
      res,
      ORIGIN,
      async () => { throw new Error('There is no computed comparison to share.') },
      () => {},
    )
    expect(res.statusCode).toBe(409)
    expect(res.body()).toEqual({ error: 'There is no computed comparison to share.' })
  })
})

describe('packet state read (§20)', () => {
  it('parses exactly one packetId and nothing else', () => {
    expect(parsePacketStateQuery(`${AERA_COLLAB_PACKET_STATE_PATH}?packetId=aera:coordination-packet:a`))
      .toBe('aera:coordination-packet:a')
    expect(parsePacketStateQuery(`${AERA_COLLAB_PACKET_STATE_PATH}?packetId=a&extra=1`)).toBeUndefined()
    expect(parsePacketStateQuery(AERA_COLLAB_PACKET_STATE_PATH)).toBeUndefined()
  })

  it('is a GET, and a POST to it is refused', () => {
    const res = response()
    const assess = vi.fn(() => ({}))
    handleAeraCollabPacketStateRequest(
      request({ method: 'POST', origin: ORIGIN, url: `${AERA_COLLAB_PACKET_STATE_PATH}?packetId=a` }),
      res, ORIGIN, assess, () => {},
    )
    expect(res.statusCode).toBe(405)
    expect(assess).not.toHaveBeenCalled()
  })

  it('answers with the assessment', () => {
    const res = response()
    handleAeraCollabPacketStateRequest(
      request({ method: 'GET', origin: ORIGIN, url: `${AERA_COLLAB_PACKET_STATE_PATH}?packetId=p1` }),
      res,
      ORIGIN,
      () => ({ verdict: 'BOTH_MOVED', humanSummary: 'Both Working Lines have changed since this was sent.' }),
      () => {},
    )
    expect(res.statusCode).toBe(200)
    expect(res.body()).toEqual({
      verdict: 'BOTH_MOVED',
      humanSummary: 'Both Working Lines have changed since this was sent.',
    })
  })

  it('an unresolvable assessment is an honest sentence, not a crash', () => {
    const res = response()
    handleAeraCollabPacketStateRequest(
      request({ method: 'GET', origin: ORIGIN, url: `${AERA_COLLAB_PACKET_STATE_PATH}?packetId=p1` }),
      res,
      ORIGIN,
      () => { throw new Error('No packet p1 exists in the durable store.') },
      () => {},
    )
    expect(res.statusCode).toBe(200)
    expect(res.body()).toEqual({ unavailableReason: 'No packet p1 exists in the durable store.' })
  })
})

/**
 * WO-AERA-COLLAB-RELAY-COORDINATION-THREADS-AND-WORKING-LINE-HANDOFF-001 §21.
 *
 * Mechanical acceptance caught a share that went nowhere: the button created a
 * deterministic packet and had no thread to put it in, so a real snapshot was
 * written that no reader could ever see. A share with no recipient is not a
 * share.
 *
 * The share is now two requests — create the packet, then post it into a named
 * thread — so the route must accept both halves with a Work Order scope.
 */
describe('§21 — sharing a comparison is a two-step that lands in a thread', () => {
  it('accepts a scoped SHARE_COMPARE', () => {
    const parsed = parseCoordinationBody({
      action: 'SHARE_COMPARE',
      workOrderId: 'WO-TEST-SHARE-001',
      compareLineIndex: 0,
    })
    expect(parsed?.action).toBe('SHARE_COMPARE')
    expect(parsed?.workOrderId).toBe('WO-TEST-SHARE-001')
    expect(parsed?.compareLineIndex).toBe(0)
  })

  it('accepts the follow-up POST_MESSAGE carrying the packet into a thread', () => {
    const parsed = parseCoordinationBody({
      action: 'POST_MESSAGE',
      workOrderId: 'WO-TEST-SHARE-001',
      threadId: 'aera:collab-thread:abc',
      body: 'Sharing the comparison I am looking at.',
      intent: 'REVIEW_REQUEST',
      packetId: 'aera:coordination-packet:def',
      requestId: 'share-1',
    })
    expect(parsed?.packetId).toBe('aera:coordination-packet:def')
    expect(parsed?.threadId).toBe('aera:collab-thread:abc')
    expect(parsed?.intent).toBe('REVIEW_REQUEST')
  })

  it('still refuses a packet reference that is not a bounded id', () => {
    expect(parseCoordinationBody({
      action: 'POST_MESSAGE', threadId: 'aera:collab-thread:abc', body: 'x',
      requestId: 'r', packetId: '   ',
    })).toBeUndefined()
  })
})

/**
 * §21 / §35 — the Compare share must resolve a RECIPIENT, and must write
 * nothing until it has one.
 *
 * `aera:coordination-packet:a02ba81a` is in the live store, referenced by
 * nothing, because the first version of this button wrote the packet first and
 * looked for somewhere to put it afterwards. These tests exist so that cannot
 * recur through the wire boundary.
 */
describe('§21 — SHARE_COMPARE_TO_THREAD demands exactly one recipient', () => {
  it('accepts an existing thread as the recipient', () => {
    const parsed = parseCoordinationBody({
      action: 'SHARE_COMPARE_TO_THREAD',
      workOrderId: 'WO-TEST-SHARE-002',
      threadId: 'aera:collab-thread:abc',
      compareLineIndex: 0,
      note: 'Three of these touch the authentication contract.',
    })
    expect(parsed?.action).toBe('SHARE_COMPARE_TO_THREAD')
    expect(parsed?.threadId).toBe('aera:collab-thread:abc')
    expect(parsed?.newThreadSubject).toBeUndefined()
    expect(parsed?.note).toBe('Three of these touch the authentication contract.')
  })

  it('accepts a new thread subject as the recipient', () => {
    const parsed = parseCoordinationBody({
      action: 'SHARE_COMPARE_TO_THREAD',
      newThreadSubject: 'Authentication overlap',
    })
    expect(parsed?.newThreadSubject).toBe('Authentication overlap')
    expect(parsed?.threadId).toBeUndefined()
  })

  it('REFUSES a share with no recipient — this is the orphan-packet guard', () => {
    // Neither a thread nor a subject: a share with nobody to share with.
    expect(parseCoordinationBody({ action: 'SHARE_COMPARE_TO_THREAD' })).toBeUndefined()
    expect(parseCoordinationBody({
      action: 'SHARE_COMPARE_TO_THREAD', note: 'look at this',
    })).toBeUndefined()
  })

  it('REFUSES an ambiguous share naming both a thread and a new subject', () => {
    expect(parseCoordinationBody({
      action: 'SHARE_COMPARE_TO_THREAD',
      threadId: 'aera:collab-thread:abc',
      newThreadSubject: 'Somewhere else',
    })).toBeUndefined()
  })

  it('refuses malformed recipients and notes rather than coercing them', () => {
    expect(parseCoordinationBody({ action: 'SHARE_COMPARE_TO_THREAD', threadId: '   ' })).toBeUndefined()
    expect(parseCoordinationBody({ action: 'SHARE_COMPARE_TO_THREAD', newThreadSubject: '  ' })).toBeUndefined()
    expect(parseCoordinationBody({
      action: 'SHARE_COMPARE_TO_THREAD', threadId: 'aera:collab-thread:abc', note: '   ',
    })).toBeUndefined()
    expect(parseCoordinationBody({
      action: 'SHARE_COMPARE_TO_THREAD', threadId: 'aera:collab-thread:abc', compareLineIndex: -1,
    })).toBeUndefined()
  })

  it('refuses an unknown member, so a stale renderer cannot half-share', () => {
    expect(parseCoordinationBody({
      action: 'SHARE_COMPARE_TO_THREAD', threadId: 'aera:collab-thread:abc', recipient: 'jordan',
    })).toBeUndefined()
  })
})
