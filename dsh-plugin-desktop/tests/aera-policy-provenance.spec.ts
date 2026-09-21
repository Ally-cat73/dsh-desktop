import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// This is an AERA-owned patch module inside the pinned provider package. Its
// explicit path makes the source-custody seam visible and directly testable.
// @ts-expect-error the patch-private module intentionally does not widen the upstream public API
import { aeraPolicyProvenanceHeader, ensureAeraGatewaySessionReady, withAeraExecutionSession } from '../node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/aera-policy-provenance.js'
import { AeraGatewayReadinessService } from '../src/aera-gateway-readiness.ts'

describe('Aera Code policy provenance', () => {
  it('projects immutable message source into a content-free correlation header', () => {
    const texts = ['owner prompt', 'runtime plugin context', 'runtime skill catalogue']
    const raw = aeraPolicyProvenanceHeader([
      { id: 'owner-1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: texts[0] }] },
      { id: 'plugin-1', role: 'user', source: { kind: 'plugin' }, content: [{ type: 'text', text: texts[1] }] },
      { id: 'skills-1', role: 'user', source: { kind: 'skill-catalog' }, content: [{ type: 'text', text: texts[2] }] },
    ])
    const envelope = JSON.parse(raw)

    expect(envelope).toEqual({
      version: 1,
      segments: [
        {
          correlation_id: 'owner-1', source_type: 'HUMAN_USER', trust_class: 'UNTRUSTED',
          semantic_role: 'USER_INTENT', temporal_role: 'CURRENT_USER_TURN', retained_ordinal: 0,
          content_sha256: createHash('sha256').update(texts[0]!).digest('hex'),
        },
        {
          correlation_id: 'plugin-1', source_type: 'RUNTIME_PLUGIN_CONTEXT', trust_class: 'RUNTIME_SUPPLIED',
          semantic_role: 'CONTEXT_INTEGRITY', temporal_role: 'RUNTIME_CONTEXT', retained_ordinal: 1,
          content_sha256: createHash('sha256').update(texts[1]!).digest('hex'),
        },
        {
          correlation_id: 'skills-1', source_type: 'RUNTIME_SKILL_CATALOGUE', trust_class: 'RUNTIME_SUPPLIED',
          semantic_role: 'CONTEXT_INTEGRITY', temporal_role: 'RUNTIME_CONTEXT', retained_ordinal: 2,
          content_sha256: createHash('sha256').update(texts[2]!).digest('hex'),
        },
      ],
    })
    expect(raw).not.toContain(texts[0])
    expect(raw).not.toContain(texts[1])
    expect(raw).not.toContain(texts[2])
  })

  it('marks only the latest human message as the current user turn', () => {
    const messages = [
      { id: 'prior-owner', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Explicitly inspect the earlier state.' }] },
      { id: 'assistant-history', role: 'assistant', source: { kind: 'assistant' }, content: [{ type: 'text', text: 'Earlier answer.' }] },
      { id: 'current-owner', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Summarise the architecture.' }] },
      { id: 'skills', role: 'user', source: { kind: 'skill-catalog' }, content: [{ type: 'text', text: 'Runtime catalogue.' }] },
    ]
    const envelope = JSON.parse(aeraPolicyProvenanceHeader(messages))

    expect(envelope.segments.map((segment: { correlation_id: string; temporal_role: string }) => ({
      id: segment.correlation_id,
      temporal: segment.temporal_role,
    }))).toEqual([
      { id: 'prior-owner', temporal: 'CONVERSATION_HISTORY' },
      { id: 'current-owner', temporal: 'CURRENT_USER_TURN' },
      { id: 'skills', temporal: 'RUNTIME_CONTEXT' },
    ])
  })

  it('marks the source-bound title request as auxiliary work in the same native Turn', () => {
    const raw = aeraPolicyProvenanceHeader([{
      id: 'owner-turn-1', role: 'user',
      source: { kind: 'plugin', plugin: 'dsh-session-title-llm' },
      content: [{ type: 'text', text: 'Generate a title from the governed source message.' }],
    }])
    expect(JSON.parse(raw).segments).toEqual([
      expect.objectContaining({
        correlation_id: 'owner-turn-1',
        source_type: 'RUNTIME_PLUGIN_CONTEXT',
        temporal_role: 'RUNTIME_CONTEXT',
        native_turn_correlation: true,
      }),
    ])
  })

  it('binds subagent reports and settlement notices to their durable source user Turn', () => {
    for (const kind of ['subagent-report', 'subagent-settled']) {
      const text = `runtime ${kind} notice`
      const raw = aeraPolicyProvenanceHeader([{
        id: `notice-${kind}`, role: 'user',
        source: {
          kind, form: kind === 'subagent-report' ? 'relay' : 'notice',
          senderSessionId: 'child-session-1', nativeTurnMessageId: 'owner-source-turn-1',
          nativeTurnTerminal: kind === 'subagent-settled',
        },
        content: [{ type: 'text', text }],
      }])
      expect(JSON.parse(raw).segments).toEqual([expect.objectContaining({
        correlation_id: 'owner-source-turn-1',
        source_type: 'RUNTIME_PLUGIN_CONTEXT',
        temporal_role: 'RUNTIME_CONTEXT',
        native_turn_correlation: true,
        native_turn_terminal: kind === 'subagent-settled',
        content_sha256: createHash('sha256').update(text).digest('hex'),
      })])
    }
  })

  it('uses provider retained ordinals rather than raw Harness message indexes', () => {
    const raw = aeraPolicyProvenanceHeader([
      { id: 'owner-source-turn-1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'owner task' }] },
      { id: 'assistant-text-1', role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text: 'working' }] },
      { id: 'tool-result-1', role: 'user', source: { kind: 'tool', callId: 'call-1' }, content: [{ type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: 'result' }] }] },
      {
        id: 'settlement-1', role: 'user',
        source: { kind: 'subagent-settled', form: 'notice', senderSessionId: 'child-1', nativeTurnMessageId: 'owner-source-turn-1' },
        content: [{ type: 'text', text: 'child settled' }],
      },
    ])
    expect(JSON.parse(raw).segments.map((segment: { correlation_id: string; retained_ordinal: number }) => ({
      correlation: segment.correlation_id, ordinal: segment.retained_ordinal,
    }))).toEqual([
      { correlation: 'owner-source-turn-1', ordinal: 0 },
      { correlation: 'owner-source-turn-1', ordinal: 2 },
    ])
  })

  it('patches title generation to reuse the exact source user message identity', () => {
    const source = readFileSync(
      new URL('../node_modules/@deepseek-ai/dsh-session-title-llm/lib/index.js', import.meta.url),
      'utf8',
    )
    expect(source).toContain('source user message identity is unavailable')
    expect(source).toContain('id: sourceMessageId')
    expect(source).toContain('plugin: "dsh-session-title-llm"')
  })

  it('wires the patch helper into the exact provider request header path', () => {
    const source = readFileSync(
      new URL('../node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js', import.meta.url),
      'utf8',
    )
    expect(source).toContain('withAeraExecutionSession(withAeraPolicyProvenance(profile.headers, options.messages), options.sessionId)')
    expect(source.indexOf('await ensureAeraGatewaySessionReady(profile, options.sessionId, apiKey)'))
      .toBeLessThan(source.indexOf('snapshot.models.streamSimple(model, context'))
  })

  it('uses the live Aera Code Session and rejects profile-level identity collisions', () => {
    expect(withAeraExecutionSession({
      Session_ID: 'stale-profile-session',
      'X-Client-Request-Id': 'stale-request-id',
      'x-aera-connection-id': 'connection-a',
    }, 'session-live-a')).toEqual({
      session_id: 'session-live-a',
      'x-client-request-id': 'session-live-a',
      'x-aera-connection-id': 'connection-a',
    })

    expect(() => withAeraExecutionSession({}, 'invalid session id')).toThrow('AERA_CODE_SESSION_ID_INVALID')
    expect(withAeraExecutionSession({}, `s${'a'.repeat(127)}`)).toMatchObject({
      session_id: `s${'a'.repeat(127)}`,
    })
    expect(() => withAeraExecutionSession({}, `s${'a'.repeat(128)}`))
      .toThrow('AERA_CODE_SESSION_ID_INVALID')
  })

  it('preflights the governed native Session before the provider request', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = []
    await ensureAeraGatewaySessionReady({
      baseURL: 'http://127.0.0.1:4646/v1',
      headers: {
        'x-aera-environment-id': 'AERA_DEV',
        'x-aera-connection-id': 'relay-messages-dogfood-canonical-connection',
        'x-aera-runtime-instance-id': 'relay-messages-dogfood-canonical-runtime',
      },
    }, 'session-real-provider-1', 'synthetic-test-key', async (url: string, init?: RequestInit) => {
      requests.push({ url, init: init ?? {} })
      return new Response(JSON.stringify({
        status: 'ok', provider_effect: 'NONE', current_authority: 'PASS',
        route_assignment: 'VALID', policy_enforcement_mode: 'OBSERVATION', environment_id: 'AERA_DEV',
      }), { status: 200 })
    })

    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe('http://127.0.0.1:4646/v1/provider-execution/preflight')
    expect(requests[0]?.init.headers).toMatchObject({
      authorization: 'Bearer synthetic-test-key',
      session_id: 'session-real-provider-1',
      'x-aera-connection-id': 'relay-messages-dogfood-canonical-connection',
    })
  })

  it('stops before Provider dispatch when current authority is denied', async () => {
    await expect(ensureAeraGatewaySessionReady({
      baseURL: 'http://127.0.0.1:4646/v1',
      headers: {
        'x-aera-environment-id': 'AERA_DEV',
        'x-aera-connection-id': 'relay-messages-dogfood-canonical-connection',
        'x-aera-runtime-instance-id': 'relay-messages-dogfood-canonical-runtime',
      },
    }, 'session-real-provider-denied', 'synthetic-test-key', async () => new Response(JSON.stringify({
      status: 'denied', error: { code: 'PROVIDER_EXECUTION_FORBIDDEN' },
    }), { status: 403 }))).rejects.toThrow(
      'AERA_GATEWAY_PREFLIGHT_DENIED:PROVIDER_EXECUTION_FORBIDDEN',
    )
  })

  it('never lets a Canary-bound Session fall through to Dev after Canary readiness denial', async () => {
    const hits = { canary: 0, dev: 0 }
    const sessionId = 'session-canary-denied-no-dev-fallback'
    const devProfile = {
      baseURL: 'http://127.0.0.1:4646/v1',
      headers: {
        'x-aera-environment-id': 'AERA_DEV',
        'x-aera-connection-id': 'relay-messages-dogfood-canonical-connection',
        'x-aera-runtime-instance-id': 'relay-messages-dogfood-canonical-runtime',
      },
    }
    const readiness = new AeraGatewayReadinessService({
      credential: 'synthetic-canary-key',
      routerOrigin: 'http://127.0.0.1:14646',
      environmentId: 'CANARY',
      fetch: async () => {
        hits.canary += 1
        return new Response(JSON.stringify({
          status: 'denied', error: { code: 'PROVIDER_EXECUTION_FORBIDDEN' },
        }), { status: 403 })
      },
    })
    await expect(readiness.prepare(sessionId)).resolves.toMatchObject({
      state: 'BLOCKED', environmentId: 'CANARY', routerOrigin: 'http://127.0.0.1:14646',
    })
    await expect(ensureAeraGatewaySessionReady(
      devProfile,
      sessionId,
      'synthetic-dev-key',
      async () => {
        hits.dev += 1
        return new Response(JSON.stringify({
          status: 'ok', provider_effect: 'NONE', current_authority: 'PASS',
          route_assignment: 'VALID', policy_enforcement_mode: 'OBSERVATION', environment_id: 'AERA_DEV',
        }), { status: 200 })
      },
    )).rejects.toThrow('AERA_GATEWAY_SESSION_ENVIRONMENT_MISMATCH')
    expect(hits).toEqual({ canary: 1, dev: 0 })
  })

  it('fails closed on a stale governed provider profile with no environment identity', async () => {
    let preflightHits = 0
    await expect(ensureAeraGatewaySessionReady({
      baseURL: 'http://127.0.0.1:4646/v1',
      headers: {
        'x-aera-connection-id': 'relay-messages-dogfood-canonical-connection',
        'x-aera-runtime-instance-id': 'relay-messages-dogfood-canonical-runtime',
      },
    }, 'session-stale-profile-no-environment', 'synthetic-dev-key', async () => {
      preflightHits += 1
      return new Response('{}', { status: 200 })
    })).rejects.toThrow('AERA_GATEWAY_ENVIRONMENT_ID_REQUIRED')
    expect(preflightHits).toBe(0)
  })
})
