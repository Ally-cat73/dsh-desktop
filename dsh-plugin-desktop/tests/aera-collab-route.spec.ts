/**
 * Aera Work Context loopback route tests — WO-AGC-002 Remit C.
 * The reveal route must enforce the same strict same-origin loopback rules as
 * the private Desktop settings API for mutating requests.
 */
import { describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  AERA_WORK_CONTEXT_OPEN_PATH,
  handleAeraWorkContextOpenRequest,
} from '../src/aera-collab-route.ts'

const ORIGIN = 'http://127.0.0.1:4680'

function request(over: {
  method?: string
  origin?: string
  host?: string
  remoteAddress?: string
  body?: string
}): IncomingMessage {
  return {
    method: over.method ?? 'POST',
    headers: {
      ...(over.origin === undefined ? {} : { origin: over.origin }),
      host: over.host ?? '127.0.0.1:4680',
    },
    socket: { remoteAddress: over.remoteAddress ?? '127.0.0.1' },
    // The open route now carries an optional {workOrderId, view} selection, so
    // the stub must be async-iterable like a real request body.
    async *[Symbol.asyncIterator]() {
      if (over.body !== undefined) yield Buffer.from(over.body)
    },
  } as unknown as IncomingMessage
}

function response(): ServerResponse & { statusCode: number } {
  return {
    statusCode: 0,
    setHeader: vi.fn(),
    end: vi.fn(),
  } as unknown as ServerResponse & { statusCode: number }
}

describe('handleAeraWorkContextOpenRequest', () => {
  it('exposes a stable private path', async () => {
    expect(AERA_WORK_CONTEXT_OPEN_PATH).toBe('/desktop/aera/work-context/open')
  })

  it('opens the window for an exact same-origin loopback POST', async () => {
    const open = vi.fn()
    const res = response()
    await handleAeraWorkContextOpenRequest(request({ origin: ORIGIN }), res, ORIGIN, open, vi.fn())
    expect(open).toHaveBeenCalledOnce()
    // An empty body still means "open the window as it is".
    expect(open).toHaveBeenCalledWith({})
    expect(res.statusCode).toBe(200)
  })

  it('opens a chosen Work Order on the Collab view', async () => {
    const open = vi.fn()
    const res = response()
    await handleAeraWorkContextOpenRequest(
      request({ origin: ORIGIN, body: JSON.stringify({ workOrderId: ' WO-TEST-001 ', view: 'COLLAB' }) }),
      res,
      ORIGIN,
      open,
      vi.fn(),
    )
    expect(open).toHaveBeenCalledWith({ workOrderId: 'WO-TEST-001', view: 'COLLAB' })
    expect(res.statusCode).toBe(200)
  })

  it('refuses a selection it cannot vouch for rather than coercing it', async () => {
    for (const body of [
      JSON.stringify({ view: 'MERGE' }),
      JSON.stringify({ workOrderId: '' }),
      JSON.stringify({ workOrderId: 'WO-TEST-001', unexpected: true }),
      JSON.stringify(['WO-TEST-001']),
      '{ not json',
    ]) {
      const open = vi.fn()
      const res = response()
      await handleAeraWorkContextOpenRequest(request({ origin: ORIGIN, body }), res, ORIGIN, open, vi.fn())
      expect(open).not.toHaveBeenCalled()
      expect(res.statusCode).toBe(400)
    }
  })

  it('refuses non-POST methods', async () => {
    const open = vi.fn()
    const res = response()
    await handleAeraWorkContextOpenRequest(request({ method: 'GET', origin: ORIGIN }), res, ORIGIN, open, vi.fn())
    expect(open).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(405)
  })

  it('refuses a missing or foreign Origin on the mutating request', async () => {
    for (const origin of [undefined, 'http://evil.example', 'http://127.0.0.1:9999']) {
      const open = vi.fn()
      const res = response()
      await handleAeraWorkContextOpenRequest(
        request(origin === undefined ? {} : { origin }),
        res,
        ORIGIN,
        open,
        vi.fn(),
      )
      expect(open).not.toHaveBeenCalled()
      expect(res.statusCode).toBe(403)
    }
  })

  it('refuses a non-loopback socket address', async () => {
    const open = vi.fn()
    const res = response()
    await handleAeraWorkContextOpenRequest(
      request({ origin: ORIGIN, remoteAddress: '192.168.1.20' }),
      res,
      ORIGIN,
      open,
      vi.fn(),
    )
    expect(open).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(403)
  })

  it('reports and hides failures from the opener', async () => {
    const reportError = vi.fn()
    const res = response()
    await handleAeraWorkContextOpenRequest(
      request({ origin: ORIGIN }),
      res,
      ORIGIN,
      () => { throw new Error('boom') },
      reportError,
    )
    expect(reportError).toHaveBeenCalledOnce()
    expect(res.statusCode).toBe(500)
  })
})
