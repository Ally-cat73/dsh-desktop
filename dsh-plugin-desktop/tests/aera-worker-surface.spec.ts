/**
 * §15 minimal UI + loopback routes + product composition —
 * WO-AERA-CODE-CLAUDE-CODE-GOVERNED-WORKER-INTEGRATION-001.
 */
import { describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  AERA_WORKER_ACTION_PATH,
  AERA_WORKER_STATUS_PATH,
  handleAeraWorkerActionRequest,
  handleAeraWorkerStatusRequest,
  parseWorkerAction,
} from '../src/aera-worker-route.ts'
import { composeAeraWorker, aeraWorkerStatus, performAeraWorkerAction } from '../src/aera-worker-composition.ts'
import { AeraWorkerStatus } from '../src/client/AeraWorkerStatus.tsx'
import { parseWorkerStatus, type AeraWorkerApi } from '../src/client/aera-worker-api.ts'
import { en } from '../src/client/aera-collab-locales.ts'

const ORIGIN = 'http://127.0.0.1:4680'

function request(over: { method?: string, origin?: string, url?: string, body?: string, fetchSite?: string, referer?: string }): IncomingMessage {
  return {
    method: over.method ?? 'POST',
    url: over.url ?? '/',
    headers: {
      ...(over.origin === undefined ? {} : { origin: over.origin }),
      ...(over.fetchSite === undefined ? {} : { 'sec-fetch-site': over.fetchSite }),
      ...(over.referer === undefined ? {} : { referer: over.referer }),
      host: '127.0.0.1:4680',
    },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      if (over.body !== undefined) yield Buffer.from(over.body)
    },
  } as unknown as IncomingMessage
}

function response(): ServerResponse & { statusCode: number, body: () => unknown } {
  let written = ''
  return {
    statusCode: 0,
    setHeader: vi.fn(),
    end: vi.fn((chunk?: string) => { written = chunk ?? '' }),
    body: () => (written === '' ? undefined : JSON.parse(written) as unknown),
  } as unknown as ServerResponse & { statusCode: number, body: () => unknown }
}

describe('worker loopback routes', () => {
  it('exposes stable private paths', () => {
    expect(AERA_WORKER_STATUS_PATH).toBe('/desktop/aera/worker/status')
    expect(AERA_WORKER_ACTION_PATH).toBe('/desktop/aera/worker/action')
  })

  it('parses actions strictly and refuses anything it cannot vouch for', () => {
    expect(parseWorkerAction({ action: 'START_EPOCH', workOrderId: 'WO-1', codeWorkingLineId: 'L', task: ' do it ' }))
      .toEqual({ action: 'START_EPOCH', workOrderId: 'WO-1', codeWorkingLineId: 'L', task: 'do it' })
    expect(parseWorkerAction({ action: 'GRANT', workOrderId: 'WO-1', codeWorkingLineId: 'L', classes: ['fs.read', 'fs.read'] }))
      .toEqual({ action: 'GRANT', workOrderId: 'WO-1', codeWorkingLineId: 'L', classes: ['fs.read'] })
    for (const bad of [
      { action: 'START_EPOCH', workOrderId: 'WO-1', codeWorkingLineId: 'L', task: '' },
      { action: 'START_EPOCH', workOrderId: 'WO-1', codeWorkingLineId: 'L', task: 'x', binary: '/bin/sh' },
      { action: 'GRANT', workOrderId: 'WO-1', codeWorkingLineId: 'L', classes: ['root'] },
      { action: 'GRANT', workOrderId: 'WO-1', codeWorkingLineId: 'L', classes: [] },
      { action: 'REVOKE', workOrderId: 'WO-1' },
      { action: 'EXEC', workOrderId: 'WO-1' },
      { action: 'CANCEL', workOrderId: 'has space' },
      ['CANCEL'],
    ]) expect(parseWorkerAction(bad)).toBeUndefined()
  })

  it('refuses a cross-origin mutation and a non-POST', async () => {
    const perform = vi.fn()
    const crossOrigin = response()
    await handleAeraWorkerActionRequest(request({ origin: 'http://evil.example', body: '{}' }), crossOrigin, ORIGIN, perform, vi.fn())
    expect(crossOrigin.statusCode).toBe(403)
    const get = response()
    await handleAeraWorkerActionRequest(request({ method: 'GET', origin: ORIGIN }), get, ORIGIN, perform, vi.fn())
    expect(get.statusCode).toBe(405)
    expect(perform).not.toHaveBeenCalled()
  })

  it('START_EPOCH is accepted with 202; a typed refusal is 409 with its code', async () => {
    const accepted = response()
    await handleAeraWorkerActionRequest(request({ origin: ORIGIN, body: JSON.stringify({ action: 'START_EPOCH', workOrderId: 'WO-1', codeWorkingLineId: 'L', task: 'go' }) }), accepted, ORIGIN, async () => ({ accepted: true }), vi.fn())
    expect(accepted.statusCode).toBe(202)
    const refused = response()
    await handleAeraWorkerActionRequest(request({ origin: ORIGIN, body: JSON.stringify({ action: 'CANCEL', workOrderId: 'WO-1' }) }), refused, ORIGIN, async () => { throw Object.assign(new Error('nope'), { code: 'WORKER_UNAVAILABLE' }) }, vi.fn())
    expect(refused.statusCode).toBe(409)
    expect(refused.body()).toMatchObject({ error: 'WORKER_UNAVAILABLE' })
  })

  it('status is a same-origin GET that needs a workOrderId', () => {
    const ok = response()
    handleAeraWorkerStatusRequest(request({ method: 'GET', origin: ORIGIN, url: '/desktop/aera/worker/status?workOrderId=WO-1' }), ok, ORIGIN, id => ({ workOrderId: id, epochCount: 0 }), vi.fn())
    expect(ok.statusCode).toBe(200)
    expect(ok.body()).toMatchObject({ workOrderId: 'WO-1' })
    const missing = response()
    handleAeraWorkerStatusRequest(request({ method: 'GET', origin: ORIGIN, url: '/desktop/aera/worker/status' }), missing, ORIGIN, vi.fn(), vi.fn())
    expect(missing.statusCode).toBe(400)
  })
})

describe('product composition is honest when unconfigured', () => {
  it('reports UNAVAILABLE without a store, principal, delegation or pin — and never spawns anything', async () => {
    expect(composeAeraWorker({})).toMatchObject({ kind: 'UNAVAILABLE', reason: expect.stringMatching(/AERA_COLLAB_STORE_DIR/u) })
    const unpinned = composeAeraWorker({
      AERA_COLLAB_STORE_DIR: '/tmp/none',
      AERA_COLLAB_PRINCIPAL_ID: 'aera:participant:00000000-0000-4000-8000-000000000001',
      AERA_COLLAB_DELEGATION_ID: 'delegation-1',
      PATH: '/usr/local/bin:/usr/bin',
    })
    expect(unpinned).toMatchObject({ kind: 'UNAVAILABLE', reason: expect.stringMatching(/never resolves `claude` from PATH/u) })
    expect(aeraWorkerStatus(unpinned, 'WO-1')).toMatchObject({ workOrderId: 'WO-1', unavailableReason: expect.any(String) })
    await expect(performAeraWorkerAction(unpinned, { action: 'CANCEL', workOrderId: 'WO-1' }, vi.fn())).rejects.toMatchObject({ code: 'WORKER_UNAVAILABLE' })
  })

  it('refuses an invalid bound environment', () => {
    const runtime = composeAeraWorker({
      AERA_COLLAB_STORE_DIR: '/tmp/none',
      AERA_COLLAB_PRINCIPAL_ID: 'aera:participant:00000000-0000-4000-8000-000000000001',
      AERA_COLLAB_DELEGATION_ID: 'delegation-1',
      AERA_GATEWAY_AGC_ENVIRONMENT_ID: 'PRODUCTION',
    })
    expect(runtime).toMatchObject({ kind: 'UNAVAILABLE', reason: expect.stringMatching(/environment/u) })
  })
})

const t = (key: keyof typeof en): string => en[key]
const api: AeraWorkerApi = { status: vi.fn(), action: vi.fn() }

describe('§15 minimal worker card', () => {
  it('shows provider, subscription auth, model, state, Epoch, authority and governed effect states', () => {
    const status = parseWorkerStatus({
      workOrderId: 'WO-1',
      provider: 'Claude Code (local, existing subscription login)',
      environmentId: 'CANARY',
      liveState: 'WAITING_FOR_AERA',
      authClass: 'SUBSCRIPTION_OAUTH',
      modelReported: 'claude-haiku-4-5-20251001',
      epochCount: 2,
      currentEpoch: { epochId: 'aera:worker-epoch:abc', sequence: 2, runtime: { cliVersion: '2.1.280' } },
      authorityEnvelope: [{ decisionId: 'aera:decision:d1', grant: 'aera-worker/v1:fs.read', codeWorkingLineIds: ['L'] }],
      recentEffects: [
        { subject: 'Worker effect performed: fs.read (r1)', outcome: 'PASS', evidenceClass: 'EXECUTION_EVIDENCE', recordedAt: 'x' },
        { subject: 'Worker effect denied: fs.write (w1) at AUTHORITY: READ_ONLY_AUTHORITY', outcome: 'FAIL', evidenceClass: 'DECISION_EVIDENCE', recordedAt: 'x' },
      ],
    })
    const markup = renderToStaticMarkup(createElement(AeraWorkerStatus, { api, workOrderId: 'WO-1', lines: [{ codeWorkingLineId: 'L', label: 'Line L' }], t, initialStatus: status }))
    for (const expected of ['Governed worker (Claude Code)', 'existing subscription login', 'SUBSCRIPTION_OAUTH', 'claude-haiku-4-5-20251001', 'CANARY', 'WAITING_FOR_AERA', '#2 aera:worker-epoch:abc', 'aera-worker/v1:fs.read', 'READ_ONLY_AUTHORITY', 'Cancel']) {
      expect(markup).toContain(expected)
    }
    // Only the governed classes are grantable from the card; shell/package/network are not offered.
    expect(markup).not.toMatch(/exec\.shell|>package<|>network</u)
  })

  it('shows the unavailable reason instead of controls when the worker is not configured', () => {
    const markup = renderToStaticMarkup(createElement(AeraWorkerStatus, { api, workOrderId: 'WO-1', lines: [], t, initialStatus: parseWorkerStatus({ workOrderId: 'WO-1', unavailableReason: 'Claude Code worker is not pinned' }) }))
    expect(markup).toContain('Claude Code worker is not pinned')
    expect(markup).not.toContain('Start Worker Epoch')
  })

  it('refuses a malformed status response', () => {
    expect(() => parseWorkerStatus({ workOrderId: 7 })).toThrow()
    expect(() => parseWorkerStatus({ workOrderId: 'WO', authorityEnvelope: [{ decisionId: 1 }] })).toThrow()
  })
})
