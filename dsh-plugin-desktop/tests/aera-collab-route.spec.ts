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
}): IncomingMessage {
  return {
    method: over.method ?? 'POST',
    headers: {
      ...(over.origin === undefined ? {} : { origin: over.origin }),
      host: over.host ?? '127.0.0.1:4680',
    },
    socket: { remoteAddress: over.remoteAddress ?? '127.0.0.1' },
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
  it('exposes a stable private path', () => {
    expect(AERA_WORK_CONTEXT_OPEN_PATH).toBe('/desktop/aera/work-context/open')
  })

  it('opens the window for an exact same-origin loopback POST', () => {
    const open = vi.fn()
    const res = response()
    handleAeraWorkContextOpenRequest(request({ origin: ORIGIN }), res, ORIGIN, open, vi.fn())
    expect(open).toHaveBeenCalledOnce()
    expect(res.statusCode).toBe(200)
  })

  it('refuses non-POST methods', () => {
    const open = vi.fn()
    const res = response()
    handleAeraWorkContextOpenRequest(request({ method: 'GET', origin: ORIGIN }), res, ORIGIN, open, vi.fn())
    expect(open).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(405)
  })

  it('refuses a missing or foreign Origin on the mutating request', () => {
    for (const origin of [undefined, 'http://evil.example', 'http://127.0.0.1:9999']) {
      const open = vi.fn()
      const res = response()
      handleAeraWorkContextOpenRequest(
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

  it('refuses a non-loopback socket address', () => {
    const open = vi.fn()
    const res = response()
    handleAeraWorkContextOpenRequest(
      request({ origin: ORIGIN, remoteAddress: '192.168.1.20' }),
      res,
      ORIGIN,
      open,
      vi.fn(),
    )
    expect(open).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(403)
  })

  it('reports and hides failures from the opener', () => {
    const reportError = vi.fn()
    const res = response()
    handleAeraWorkContextOpenRequest(
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
