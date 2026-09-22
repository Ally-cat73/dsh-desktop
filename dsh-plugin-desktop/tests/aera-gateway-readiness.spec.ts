import { describe, expect, it, vi } from 'vitest'
import {
  AERA_GATEWAY_READINESS_PATH,
  AeraGatewayReadinessService,
  handleAeraGatewayReadinessRequest,
  type AeraGatewayReadinessFetch,
} from '../src/aera-gateway-readiness.ts'
import type { IncomingMessage, ServerResponse } from 'node:http'

const SESSION = 'session-fresh-product-001'

describe('Aera Gateway real-session readiness', () => {
  it('bootstraps the exact native Session before declaring it executable', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = []
    const fetch: AeraGatewayReadinessFetch = vi.fn(async (url, init) => {
      requests.push({ url: String(url), init: init ?? {} })
      return new Response(JSON.stringify({
        status: 'ok',
        provider_effect: 'NONE',
        current_authority: 'PASS',
        route_assignment: 'VALID',
        policy_enforcement_mode: 'OBSERVATION',
        environment_id: 'AERA_DEV',
        identity: {
          connection_id: 'relay-messages-dogfood-canonical-connection',
          runtime_instance_id: 'relay-messages-dogfood-canonical-runtime',
          session_id: 'session-gateway-created',
          provider_id: 'openai',
          channel_id: 'wo030c-channel-b-openai',
          model_id: 'gpt-5.6-terra',
          assignment_revision: 1,
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const service = new AeraGatewayReadinessService({
      credential: 'synthetic-test-credential',
      fetch,
    })

    expect(service.status(SESSION)).toEqual({ state: 'CHECKING' })
    await service.prepare(SESSION)

    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe('http://127.0.0.1:4646/v1/provider-execution/preflight')
    expect(requests[0]?.init).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        authorization: 'Bearer synthetic-test-credential',
        session_id: SESSION,
        'x-aera-environment-id': 'AERA_DEV',
        'x-aera-connection-id': 'relay-messages-dogfood-canonical-connection',
        'x-aera-runtime-instance-id': 'relay-messages-dogfood-canonical-runtime',
      }),
    })
    expect(service.status(SESSION)).toEqual({
      state: 'READY',
      providerEffect: 'NONE',
      currentAuthority: 'PASS',
      connectionId: 'relay-messages-dogfood-canonical-connection',
      runtimeInstanceId: 'relay-messages-dogfood-canonical-runtime',
      gatewaySessionId: 'session-gateway-created',
      providerId: 'openai',
      channelId: 'wo030c-channel-b-openai',
      modelId: 'gpt-5.6-terra',
      assignmentRevision: 1,
      policyEnforcementMode: 'OBSERVATION',
      environmentId: 'AERA_DEV',
      routerOrigin: 'http://127.0.0.1:4646',
    })
  })

  it('uses the configured Canary loopback while retaining exact readiness assertions', async () => {
    const requests: string[] = []
    const service = new AeraGatewayReadinessService({
      credential: 'synthetic-canary-credential',
      routerOrigin: 'http://127.0.0.1:14646',
      environmentId: 'CANARY',
      fetch: async (url) => {
        requests.push(String(url))
        return new Response(JSON.stringify({
          status: 'ok', provider_effect: 'NONE', current_authority: 'PASS',
          route_assignment: 'VALID', policy_enforcement_mode: 'OBSERVATION', environment_id: 'CANARY',
          identity: {
            connection_id: 'relay-messages-dogfood-canonical-connection',
            runtime_instance_id: 'relay-messages-dogfood-canonical-runtime',
            session_id: 'session-canary-created', provider_id: 'openai',
            channel_id: 'wo030c-channel-b-openai', model_id: 'gpt-5.6-terra', assignment_revision: 1,
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      },
    })

    await expect(service.prepare('session-fresh-product-canary-001')).resolves.toMatchObject({
      state: 'READY', environmentId: 'CANARY', routerOrigin: 'http://127.0.0.1:14646',
    })
    expect(requests).toEqual(['http://127.0.0.1:14646/v1/provider-execution/preflight'])
  })

  it('retains an expired-authority denial as a non-executable Session', async () => {
    const service = new AeraGatewayReadinessService({
      credential: 'synthetic-test-credential',
      fetch: async () => new Response(JSON.stringify({
        status: 'denied',
        error: { code: 'PROVIDER_EXECUTION_FORBIDDEN', message: 'withheld' },
      }), { status: 403, headers: { 'content-type': 'application/json' } }),
    })

    const expiredSession = 'session-fresh-product-expired-001'
    await expect(service.prepare(expiredSession)).resolves.toEqual({
      state: 'BLOCKED',
      code: 'PROVIDER_EXECUTION_FORBIDDEN',
      message: 'Aera Gateway authority is not current for this Session.',
      environmentId: 'AERA_DEV',
      routerOrigin: 'http://127.0.0.1:4646',
    })
    expect(service.status(expiredSession)).toEqual({
      state: 'BLOCKED',
      code: 'PROVIDER_EXECUTION_FORBIDDEN',
      message: 'Aera Gateway authority is not current for this Session.',
      environmentId: 'AERA_DEV',
      routerOrigin: 'http://127.0.0.1:4646',
    })
  })

  it('coalesces title and main readiness checks for the same native Session', async () => {
    let calls = 0
    let release: (() => void) | undefined
    const response = new Promise<Response>((resolve) => {
      release = () => resolve(new Response(JSON.stringify({
        status: 'ok', provider_effect: 'NONE', current_authority: 'PASS',
        route_assignment: 'VALID', policy_enforcement_mode: 'OBSERVATION', environment_id: 'AERA_DEV',
        identity: {
          connection_id: 'relay-messages-dogfood-canonical-connection',
          runtime_instance_id: 'relay-messages-dogfood-canonical-runtime',
          session_id: 'session-gateway-created', provider_id: 'openai',
          channel_id: 'wo030c-channel-b-openai', model_id: 'gpt-5.6-terra', assignment_revision: 1,
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
    })
    const service = new AeraGatewayReadinessService({
      credential: 'synthetic-test-credential',
      fetch: async () => { calls += 1; return response },
    })

    const title = service.prepare('session-fresh-product-coalesced-001')
    const main = service.prepare('session-fresh-product-coalesced-001')
    expect(calls).toBe(1)
    release?.()
    await expect(Promise.all([title, main])).resolves.toHaveLength(2)
    expect(calls).toBe(1)
  })

  it('exposes only the safe per-Session readiness projection to the same-origin renderer', () => {
    const service = new AeraGatewayReadinessService({
      credential: 'synthetic-test-credential',
      fetch: async () => { throw new Error('unused') },
    })
    const chunks: string[] = []
    const headers = new Map<string, string>()
    const req = {
      method: 'GET',
      url: `${AERA_GATEWAY_READINESS_PATH}?session_id=${SESSION}`,
      headers: { origin: 'http://127.0.0.1:43120', host: '127.0.0.1:43120' },
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as IncomingMessage
    const res = {
      statusCode: 0,
      setHeader: (name: string, value: string) => { headers.set(name, value) },
      end: (value?: string) => { if (value) chunks.push(value) },
    } as unknown as ServerResponse

    handleAeraGatewayReadinessRequest(req, res, 'http://127.0.0.1:43120', service)

    expect(res.statusCode).toBe(200)
    expect(headers.get('cache-control')).toBe('no-store')
    expect(JSON.parse(chunks.join(''))).toEqual({ state: 'CHECKING' })
    expect(chunks.join('')).not.toContain('synthetic-test-credential')
  })

  it('accepts the normal same-origin browser GET without an Origin header', () => {
    const service = new AeraGatewayReadinessService({
      credential: 'synthetic-test-credential',
      fetch: async () => { throw new Error('unused') },
    })
    const chunks: string[] = []
    const req = {
      method: 'GET',
      url: `${AERA_GATEWAY_READINESS_PATH}?session_id=session-browser-get-001`,
      headers: {
        host: '127.0.0.1:43120',
        referer: 'http://127.0.0.1:43120/',
        'sec-fetch-site': 'same-origin',
      },
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as IncomingMessage
    const res = {
      statusCode: 0,
      setHeader: () => undefined,
      end: (value?: string) => { if (value) chunks.push(value) },
    } as unknown as ServerResponse

    handleAeraGatewayReadinessRequest(req, res, 'http://127.0.0.1:43120', service)

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(chunks.join(''))).toEqual({ state: 'CHECKING' })
  })
})
