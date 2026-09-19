/**
 * Renderer Collab API tests — WO-AERA-CODE-COLLAB-READ-FIRST-SURFACE-001.
 *
 * The renderer holds no store path and no write capability, so everything it
 * shows arrives over the loopback boundary. A surface whose whole claim is
 * truthful attribution must refuse a row it cannot vouch for rather than
 * render it, and reads must stay reads.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  aeraCollabPaths,
  createAeraCollabApi,
  parseCollabDirectoryResult,
  parseCollabResolution,
} from '../src/client/aera-collab-api.ts'

const ROW = {
  workOrderId: 'WO-AERA-CODE-COLLAB-READ-FIRST-SURFACE-001',
  title: 'AERA CODE COLLAB READ-FIRST SURFACE V1',
  lifecycleState: 'ACTIVE',
  authorityClass: 'OWNER_SUPPLIED',
  primaryRepositoryId: 'aera-repo:aera-stack',
  repositoryIds: ['aera-repo:aera-stack'],
  matchedOn: ['ID'],
}

const RESULT = {
  query: 'read-first',
  listing: 'MATCHES',
  rows: [ROW],
  totalWorkOrders: 10,
  truncated: false,
}

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as unknown as Response
}

describe('Aera Collab renderer API', () => {
  it('reads the directory with a GET that carries only the query', async () => {
    const fetcher = vi.fn(async () => jsonResponse(RESULT))
    const api = createAeraCollabApi(fetcher as never)

    const view = await api.directory('read-first')

    expect(view.rows[0]?.workOrderId).toBe(ROW.workOrderId)
    const [path, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(path).toBe(`${aeraCollabPaths.directory}?q=read-first`)
    expect(init.method).toBe('GET')
    expect(init.cache).toBe('no-store')
    expect(init.credentials).toBe('same-origin')
  })

  it('asks for the whole ACTIVE listing with no query parameter at all', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ ...RESULT, query: '', listing: 'ACTIVE' }))
    await createAeraCollabApi(fetcher as never).directory('')

    expect((fetcher.mock.calls[0] as unknown as [string])[0]).toBe(aeraCollabPaths.directory)
  })

  it('exposes no route to the legacy native Collab window (§18, §46 review NB-6)', () => {
    /*
     * `openCollab()` POSTed `{ view: 'COLLAB' }` to the work-context window —
     * the legacy surface the §14 decision replaced. Callerless, but one edit
     * away from reachable. Deleted; this asserts the absence rather than just
     * dropping the old test.
     */
    const api = createAeraCollabApi((async () => jsonResponse({ ok: true })) as never)

    expect('openCollab' in (api as unknown as Record<string, unknown>)).toBe(false)
  })

  it('refuses a directory response it cannot vouch for', () => {
    expect(() => parseCollabDirectoryResult({ ...RESULT, listing: 'GUESSED' })).toThrow()
    expect(() => parseCollabDirectoryResult({ ...RESULT, rows: [{ ...ROW, workOrderId: '' }] })).toThrow()
    expect(() => parseCollabDirectoryResult({ ...RESULT, rows: [{ ...ROW, matchedOn: ['VIBES'] }] })).toThrow()
    expect(() => parseCollabDirectoryResult({ ...RESULT, rows: [ROW, ROW] })).toThrow()
    expect(() => parseCollabDirectoryResult({ ...RESULT, totalWorkOrders: -1 })).toThrow()
  })

  it('refuses a resolution that names a source it does not recognise', () => {
    expect(parseCollabResolution({ source: 'NONE', reason: 'nothing bound' }).workOrderId).toBeUndefined()
    expect(parseCollabResolution({ source: 'WORKSPACE_REMOTE', workOrderId: 'WO-1' }).workOrderId).toBe('WO-1')
    expect(() => parseCollabResolution({ source: 'ASSUMED' })).toThrow()
  })

  it('reports a failed read rather than rendering an empty list as fact', async () => {
    const api = createAeraCollabApi((async () => jsonResponse({}, false)) as never)
    await expect(api.directory('')).rejects.toThrow(/request failed/u)
  })
})
