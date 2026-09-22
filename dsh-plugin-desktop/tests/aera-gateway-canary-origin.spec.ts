/**
 * WO-AERA-CANARY-CURRENT-GENERATION-BANK-AND-SYDNEY-PROMOTION-001 §22–§23 —
 * the environment-aware EXACT-origin contract for the product-hosted governed
 * Aera Code Gateway route.
 *
 * Owner-authorised semantics:
 *   AERA_DEV      → exactly { http://127.0.0.1:4646 }
 *   CANARY        → exactly { http://127.0.0.1:14646, http://100.90.140.5:14646 }
 *   AERA_CANARY   → the same CANARY environment, defaulting to Sydney
 *
 * No wildcard, no hostname class, no "private address is trusted" rule, no
 * user-entered URL, no public-internet HTTP. Every case below is deterministic
 * and performs no network I/O.
 */

import { describe, expect, it } from 'vitest'
import {
  AGC_CANARY_LAB_ROUTER_ORIGIN,
  AGC_CANARY_SYDNEY_ROUTER_ORIGIN,
  AGC_CONNECTION_HEADER,
  AGC_ENVIRONMENT_HEADER,
  AGC_GATEWAY_CREDENTIAL_ENV,
  AGC_GOVERNED_CONNECTION_ID,
  AGC_GOVERNED_MODEL_ID,
  AGC_GOVERNED_ROUTER_ORIGIN,
  AGC_GOVERNED_RUNTIME_INSTANCE_ID,
  AGC_RUNTIME_INSTANCE_HEADER,
  agcAllowedRouterOrigins,
  bindAgcGatewaySessionEnvironment,
  buildAgcGovernedGatewayProviderProfile,
  resolveAgcGovernedGatewayRuntime,
} from '../src/aera-gateway-agc-binding.ts'

const CANARY_CREDENTIAL = 'AERA_GATEWAY_DSH_EVAL_KEY'

/** Arbitrary origins that must never be admissible in ANY environment. */
const REFUSED_ORIGINS: ReadonlyArray<readonly [string, string]> = [
  ['arbitrary 100.x Tailscale peer', 'http://100.90.140.6:14646'],
  ['arbitrary 100.x Tailscale peer (other octet)', 'http://100.64.0.1:14646'],
  ['arbitrary RFC1918 10/8', 'http://10.0.0.5:14646'],
  ['arbitrary RFC1918 192.168/16 (the Lab host itself)', 'http://192.168.4.98:14646'],
  ['arbitrary RFC1918 172.16/12', 'http://172.16.3.9:14646'],
  ['arbitrary localhost port', 'http://127.0.0.1:8080'],
  ['arbitrary loopback alias', 'http://localhost:14646'],
  ['public HTTP origin', 'http://chatgpt.com'],
  ['public HTTPS origin', 'https://chatgpt.com'],
  ['public HTTP origin on the Canary port', 'http://example.com:14646'],
  ['Sydney origin with a path', 'http://100.90.140.5:14646/v1'],
]

describe('AERA_DEV exact-origin set', () => {
  it('declares exactly one allowed origin', () => {
    expect(agcAllowedRouterOrigins('AERA_DEV')).toEqual([AGC_GOVERNED_ROUTER_ORIGIN])
    expect(AGC_GOVERNED_ROUTER_ORIGIN).toBe('http://127.0.0.1:4646')
  })

  it('accepts http://127.0.0.1:4646 (default and explicit) with the frozen tuple', () => {
    for (const env of [
      {},
      { AERA_GATEWAY_AGC_ENVIRONMENT_ID: 'AERA_DEV' },
      { AERA_GATEWAY_AGC_ENVIRONMENT_ID: 'AERA_DEV', AERA_GATEWAY_AGC_ROUTER_ORIGIN: 'http://127.0.0.1:4646' },
    ]) {
      expect(resolveAgcGovernedGatewayRuntime(env)).toEqual({
        routerOrigin: 'http://127.0.0.1:4646',
        credentialEnvironmentName: AGC_GATEWAY_CREDENTIAL_ENV,
        environmentId: 'AERA_DEV',
      })
    }
  })

  it('refuses the Lab Canary origin (no cross-environment fallback)', () => {
    expect(() => resolveAgcGovernedGatewayRuntime({
      AERA_GATEWAY_AGC_ENVIRONMENT_ID: 'AERA_DEV',
      AERA_GATEWAY_AGC_ROUTER_ORIGIN: AGC_CANARY_LAB_ROUTER_ORIGIN,
    })).toThrow(/runtime tuple is inconsistent/i)
  })

  it('refuses the Sydney Canary origin (no cross-environment fallback)', () => {
    expect(() => resolveAgcGovernedGatewayRuntime({
      AERA_GATEWAY_AGC_ENVIRONMENT_ID: 'AERA_DEV',
      AERA_GATEWAY_AGC_ROUTER_ORIGIN: AGC_CANARY_SYDNEY_ROUTER_ORIGIN,
    })).toThrow(/runtime tuple is inconsistent/i)
  })

  it('refuses the Canary credential reference under AERA_DEV', () => {
    expect(() => resolveAgcGovernedGatewayRuntime({
      AERA_GATEWAY_AGC_ENVIRONMENT_ID: 'AERA_DEV',
      AERA_GATEWAY_AGC_CREDENTIAL_ENV_NAME: CANARY_CREDENTIAL,
    })).toThrow(/runtime tuple is inconsistent/i)
  })
})

describe('CANARY exact-origin set', () => {
  it('declares exactly the Lab and Sydney origins and nothing else', () => {
    expect(agcAllowedRouterOrigins('CANARY')).toEqual([
      'http://127.0.0.1:14646',
      'http://100.90.140.5:14646',
    ])
  })

  it('accepts http://127.0.0.1:14646 (Lab rollback target)', () => {
    expect(resolveAgcGovernedGatewayRuntime({
      AERA_GATEWAY_AGC_ENVIRONMENT_ID: 'CANARY',
      AERA_GATEWAY_AGC_ROUTER_ORIGIN: AGC_CANARY_LAB_ROUTER_ORIGIN,
    })).toEqual({
      routerOrigin: 'http://127.0.0.1:14646',
      credentialEnvironmentName: CANARY_CREDENTIAL,
      environmentId: 'CANARY',
    })
  })

  it('accepts http://100.90.140.5:14646 (Sydney daily Canary)', () => {
    expect(resolveAgcGovernedGatewayRuntime({
      AERA_GATEWAY_AGC_ENVIRONMENT_ID: 'CANARY',
      AERA_GATEWAY_AGC_ROUTER_ORIGIN: AGC_CANARY_SYDNEY_ROUTER_ORIGIN,
    })).toEqual({
      routerOrigin: 'http://100.90.140.5:14646',
      credentialEnvironmentName: CANARY_CREDENTIAL,
      environmentId: 'CANARY',
    })
  })

  it('refuses the AERA_DEV origin under CANARY (no cross-environment fallback)', () => {
    expect(() => resolveAgcGovernedGatewayRuntime({
      AERA_GATEWAY_AGC_ENVIRONMENT_ID: 'CANARY',
      AERA_GATEWAY_AGC_ROUTER_ORIGIN: AGC_GOVERNED_ROUTER_ORIGIN,
    })).toThrow(/runtime tuple is inconsistent/i)
  })

  it('refuses the AERA_DEV credential reference under CANARY', () => {
    expect(() => resolveAgcGovernedGatewayRuntime({
      AERA_GATEWAY_AGC_ENVIRONMENT_ID: 'CANARY',
      AERA_GATEWAY_AGC_ROUTER_ORIGIN: AGC_CANARY_SYDNEY_ROUTER_ORIGIN,
      AERA_GATEWAY_AGC_CREDENTIAL_ENV_NAME: AGC_GATEWAY_CREDENTIAL_ENV,
    })).toThrow(/runtime tuple is inconsistent/i)
  })
})

describe('origins outside the frozen sets are refused in every environment', () => {
  for (const [label, origin] of REFUSED_ORIGINS) {
    it(`refuses ${label} (${origin}) under AERA_DEV, CANARY and AERA_CANARY`, () => {
      for (const selector of ['AERA_DEV', 'CANARY', 'AERA_CANARY']) {
        expect(() => resolveAgcGovernedGatewayRuntime({
          AERA_GATEWAY_AGC_ENVIRONMENT_ID: selector,
          AERA_GATEWAY_AGC_ROUTER_ORIGIN: origin,
        })).toThrow(/aera-gateway-agc-binding/)
      }
    })
  }

  it('refuses an unparseable origin', () => {
    expect(() => resolveAgcGovernedGatewayRuntime({
      AERA_GATEWAY_AGC_ENVIRONMENT_ID: 'AERA_CANARY',
      AERA_GATEWAY_AGC_ROUTER_ORIGIN: 'not-a-url',
    })).toThrow(/is not a URL/)
  })

  it('refuses an unknown environment selector', () => {
    for (const selector of ['SYDNEY', 'LAB', 'canary', 'CANARY_SYDNEY']) {
      expect(() => resolveAgcGovernedGatewayRuntime({
        AERA_GATEWAY_AGC_ENVIRONMENT_ID: selector,
      })).toThrow(/environment identity is invalid/i)
    }
  })
})

describe('AERA_CANARY profile selector (§22 daily-use Sydney)', () => {
  it('defaults to the Sydney origin on the CANARY wire environment', () => {
    expect(resolveAgcGovernedGatewayRuntime({
      AERA_GATEWAY_AGC_ENVIRONMENT_ID: 'AERA_CANARY',
    })).toEqual({
      routerOrigin: 'http://100.90.140.5:14646',
      credentialEnvironmentName: CANARY_CREDENTIAL,
      environmentId: 'CANARY',
    })
  })

  it('still permits the Lab loopback rollback target by explicit configuration', () => {
    expect(resolveAgcGovernedGatewayRuntime({
      AERA_GATEWAY_AGC_ENVIRONMENT_ID: 'AERA_CANARY',
      AERA_GATEWAY_AGC_ROUTER_ORIGIN: AGC_CANARY_LAB_ROUTER_ORIGIN,
    }).routerOrigin).toBe('http://127.0.0.1:14646')
  })

  it('leaves the plain CANARY selector on the accepted Lab loopback default (rollback property)', () => {
    expect(resolveAgcGovernedGatewayRuntime({
      AERA_GATEWAY_AGC_ENVIRONMENT_ID: 'CANARY',
    }).routerOrigin).toBe('http://127.0.0.1:14646')
  })

  it('leaves an unconfigured launch on AERA_DEV (Dev remains the default and stays selectable)', () => {
    expect(resolveAgcGovernedGatewayRuntime({}).environmentId).toBe('AERA_DEV')
  })
})

describe('the Sydney provider profile keeps every frozen identity', () => {
  const env = { AERA_GATEWAY_AGC_ENVIRONMENT_ID: 'AERA_CANARY' }

  it('routes to Sydney with the frozen Connection, runtime, model and credential reference', () => {
    const profile = buildAgcGovernedGatewayProviderProfile(env)

    expect(profile.baseURL).toBe('http://100.90.140.5:14646/v1')
    expect(profile.apiKeyEnv).toBe(CANARY_CREDENTIAL)
    expect(profile.api).toBe('openai-responses')
    expect(profile.transport).toBe('sse')
    expect(profile.models.map(model => model.id)).toEqual([AGC_GOVERNED_MODEL_ID])
    expect(profile.headers).toEqual({
      [AGC_CONNECTION_HEADER]: AGC_GOVERNED_CONNECTION_ID,
      [AGC_RUNTIME_INSTANCE_HEADER]: AGC_GOVERNED_RUNTIME_INSTANCE_ID,
      [AGC_ENVIRONMENT_HEADER]: 'CANARY',
    })
  })

  it('carries no secret material and never names another environment credential', () => {
    const serialized = JSON.stringify(buildAgcGovernedGatewayProviderProfile(env))

    expect(serialized).not.toMatch(/Bearer /)
    expect(serialized).not.toContain(AGC_GATEWAY_CREDENTIAL_ENV)
    expect(serialized).not.toContain('AERA_GATEWAY_DEV_EXECUTION_KEY')
  })
})

describe('environment/profile switching cannot retain a prior-environment provider', () => {
  it('rebuilds the provider profile from the supplied environment on every call', () => {
    const dev = buildAgcGovernedGatewayProviderProfile({})
    const sydney = buildAgcGovernedGatewayProviderProfile({ AERA_GATEWAY_AGC_ENVIRONMENT_ID: 'AERA_CANARY' })
    const lab = buildAgcGovernedGatewayProviderProfile({ AERA_GATEWAY_AGC_ENVIRONMENT_ID: 'CANARY' })
    const devAgain = buildAgcGovernedGatewayProviderProfile({})

    expect(dev.baseURL).toBe('http://127.0.0.1:4646/v1')
    expect(sydney.baseURL).toBe('http://100.90.140.5:14646/v1')
    expect(lab.baseURL).toBe('http://127.0.0.1:14646/v1')
    expect(devAgain.baseURL).toBe('http://127.0.0.1:4646/v1')
    expect(sydney).not.toBe(lab)
    expect(dev).not.toBe(devAgain)
    expect(dev.apiKeyEnv).not.toBe(sydney.apiKeyEnv)
  })

  it('refuses to re-bind a Session from AERA_DEV to a Canary runtime', () => {
    const sessionId = 'session-switch-dev-to-canary'
    bindAgcGatewaySessionEnvironment(sessionId, resolveAgcGovernedGatewayRuntime({}))

    expect(() => bindAgcGatewaySessionEnvironment(
      sessionId,
      resolveAgcGovernedGatewayRuntime({ AERA_GATEWAY_AGC_ENVIRONMENT_ID: 'AERA_CANARY' }),
    )).toThrow('AERA_GATEWAY_SESSION_ENVIRONMENT_MISMATCH')
  })

  it('refuses to re-bind a Session from the Lab Canary origin to the Sydney Canary origin', () => {
    const sessionId = 'session-switch-lab-to-sydney'
    bindAgcGatewaySessionEnvironment(
      sessionId,
      resolveAgcGovernedGatewayRuntime({ AERA_GATEWAY_AGC_ENVIRONMENT_ID: 'CANARY' }),
    )

    expect(() => bindAgcGatewaySessionEnvironment(
      sessionId,
      resolveAgcGovernedGatewayRuntime({ AERA_GATEWAY_AGC_ENVIRONMENT_ID: 'AERA_CANARY' }),
    )).toThrow('AERA_GATEWAY_SESSION_ENVIRONMENT_MISMATCH')
  })

  it('refuses to re-bind a Session from Sydney back to the Lab Canary origin', () => {
    const sessionId = 'session-switch-sydney-to-lab'
    bindAgcGatewaySessionEnvironment(
      sessionId,
      resolveAgcGovernedGatewayRuntime({ AERA_GATEWAY_AGC_ENVIRONMENT_ID: 'AERA_CANARY' }),
    )

    expect(() => bindAgcGatewaySessionEnvironment(
      sessionId,
      resolveAgcGovernedGatewayRuntime({ AERA_GATEWAY_AGC_ENVIRONMENT_ID: 'CANARY' }),
    )).toThrow('AERA_GATEWAY_SESSION_ENVIRONMENT_MISMATCH')
  })

  it('is idempotent for a Session re-bound to the identical runtime', () => {
    const sessionId = 'session-switch-idempotent'
    const runtime = resolveAgcGovernedGatewayRuntime({ AERA_GATEWAY_AGC_ENVIRONMENT_ID: 'AERA_CANARY' })
    bindAgcGatewaySessionEnvironment(sessionId, runtime)

    expect(() => bindAgcGatewaySessionEnvironment(sessionId, runtime)).not.toThrow()
  })
})
