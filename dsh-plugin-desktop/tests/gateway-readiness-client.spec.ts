import { describe, expect, it, vi } from 'vitest'
import { installAeraGatewayReadinessClient } from '../src/client/gateway-readiness.ts'

function current(sessionId: string) {
  return {
    getSnapshot: () => ({ sessionId }),
    subscribe: () => () => {},
  }
}

describe('Aera Gateway composer readiness', () => {
  it('blocks a fresh Session until the Host proves it READY', async () => {
    const set = vi.fn()
    const dispose = installAeraGatewayReadinessClient({
      current: current('session-fresh-ui'),
      blocks: { set },
      fetch: async () => new Response(JSON.stringify({ state: 'READY' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      origin: 'http://127.0.0.1:43120',
    })

    expect(set).toHaveBeenCalledWith('session-fresh-ui', {
      reason: 'Checking Aera Gateway authority for this Session…',
    })
    await vi.waitFor(() => {
      expect(set).toHaveBeenCalledWith('session-fresh-ui', undefined)
    })
    dispose()
  })

  it('keeps Send unavailable with the truthful authority reason after denial', async () => {
    const set = vi.fn()
    const dispose = installAeraGatewayReadinessClient({
      current: current('session-expired-ui'),
      blocks: { set },
      fetch: async () => new Response(JSON.stringify({
        state: 'BLOCKED', code: 'PROVIDER_EXECUTION_FORBIDDEN',
        message: 'Aera Gateway authority is not current for this Session.',
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
      origin: 'http://127.0.0.1:43120',
    })

    await vi.waitFor(() => {
      expect(set).toHaveBeenCalledWith('session-expired-ui', {
        reason: 'Aera Gateway authority is not current for this Session.',
      })
    })
    dispose()
  })
})
