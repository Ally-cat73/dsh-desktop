/**
 * WO-AGC-002 REMIT H — binding-construction spec. Validates the consumer
 * profile against the REAL `@deepseek-ai/dsh-llm-pi-ai` resolution path
 * (`resolveProfiles` + provider construction), so the artifact this remit
 * registers is exactly what the adapter would serve. No secret values.
 */

import { describe, expect, it } from 'vitest'
import { Config, supportedProtocols } from '@deepseek-ai/dsh-llm-pi-ai'
import {
  AERA_GATEWAY_ROUTE,
  AGC_GATEWAY_CREDENTIAL_ENV,
  AGC_GATEWAY_MODEL_ID,
  buildAgcIsolatedGatewayProviderProfile,
  buildAgcIsolatedGatewayProviderSection,
  AGC_CONNECTION_HEADER,
  AGC_ENVIRONMENT_HEADER,
  AGC_GOVERNED_CONNECTION_ID,
  AGC_GOVERNED_GATEWAY_ROUTE,
  AGC_GOVERNED_MODEL_ID,
  AGC_GOVERNED_ROUTER_ORIGIN,
  AGC_GOVERNED_RUNTIME_INSTANCE_ID,
  AGC_RUNTIME_INSTANCE_HEADER,
  AGC_SESSION_HEADER,
  buildAgcGovernedGatewayProviderProfile,
  buildAgcGovernedGatewayProviderSection,
  resolveAgcGovernedGatewayRuntime,
} from '../src/aera-gateway-agc-binding.ts'

const INPUT = {
  routerOrigin: 'http://127.0.0.1:4646',
  connectionId: 'connection-f8863205-168d-46aa-8e45-4067805b1d2b',
  gatewaySessionId: 'session-e8a73a0c-2a06-44e0-a3dc-8dd3918a8f0a',
}

describe('aera-gateway-agc-binding', () => {
  it('validates against the REAL llm-pi-ai configuration schema (the settings validator)', () => {
    const section = buildAgcIsolatedGatewayProviderSection(INPUT)
    // schemastery schema: throws on an unserviceable shape; returns the
    // normalised section the settings namespace would store.
    const validated = (Config as unknown as (value: unknown) => {
      providers: Record<string, { apiKeyEnv?: string, api?: string, baseURL?: string, models?: Array<{ id: string }> }>
    })(section)
    const profile = validated.providers[AERA_GATEWAY_ROUTE]
    expect(profile).toBeDefined()
    expect(profile!.apiKeyEnv).toBe(AGC_GATEWAY_CREDENTIAL_ENV)
    expect(profile!.api).toBe('openai-responses')
    expect(supportedProtocols()).toContain('openai-responses')
    expect(profile!.baseURL).toBe('http://127.0.0.1:4646/v1')
    expect(profile!.models!.map((model) => model.id)).toEqual([AGC_GATEWAY_MODEL_ID])
  })

  it('binds only the governed loopback router', () => {
    expect(() => buildAgcIsolatedGatewayProviderProfile({
      ...INPUT,
      routerOrigin: 'https://chatgpt.com',
    })).toThrow(/LOOPBACK/)
    expect(() => buildAgcIsolatedGatewayProviderProfile({
      ...INPUT,
      routerOrigin: 'http://127.0.0.1:4646/backend-api',
    })).toThrow(/without a path/)
  })

  // WO-R10-001 REMIT D: optional DR-018 claim-reference headers (lookup
  // keys only — the router verifies them against its own trusted records).
  it('carries the optional DR-018 claim references as plain static headers', () => {
    const section = buildAgcIsolatedGatewayProviderSection({
      ...INPUT,
      workOrderId: 'WO-AERA-AGC-DOGFOOD-OFFICE-PACKAGING-FRESHNESS-GUARD-001',
      participationSessionId: 'psession-0025-0cd94ca8',
    })
    const validated = (Config as unknown as (value: unknown) => {
      providers: Record<string, { headers?: Record<string, string> }>
    })(section)
    const headers = validated.providers[AERA_GATEWAY_ROUTE]!.headers!
    expect(headers['x-aera-work-order-id']).toBe('WO-AERA-AGC-DOGFOOD-OFFICE-PACKAGING-FRESHNESS-GUARD-001')
    expect(headers['x-aera-participation-session-id']).toBe('psession-0025-0cd94ca8')
    // Omitted references add no headers at all.
    const bare = buildAgcIsolatedGatewayProviderProfile(INPUT)
    expect(bare.headers['x-aera-work-order-id']).toBeUndefined()
    expect(bare.headers['x-aera-participation-session-id']).toBeUndefined()
  })

  it('refuses malformed claim-reference identifiers', () => {
    expect(() => buildAgcIsolatedGatewayProviderProfile({
      ...INPUT,
      workOrderId: 'bad value with spaces',
    })).toThrow(/routing identifier/)
  })

  it('refuses malformed routing identifiers', () => {
    expect(() => buildAgcIsolatedGatewayProviderProfile({
      ...INPUT,
      gatewaySessionId: 'bad value with spaces',
    })).toThrow(/routing identifier/)
  })

  it('contains no secret material: credential is an environment REFERENCE only', () => {
    const serialized = JSON.stringify(buildAgcIsolatedGatewayProviderSection(INPUT))
    // The only credential-shaped content is the reference name itself.
    expect(serialized).toContain(AGC_GATEWAY_CREDENTIAL_ENV)
    expect(serialized).not.toMatch(/Bearer /)
    expect(serialized).not.toMatch(/x-aera-gateway-key/)
    // The isolated profile must not name the real profile's Keychain-backed refs.
    expect(serialized).not.toContain('AERA_GATEWAY_DSH_EVAL_KEY')
    expect(serialized).not.toContain('AERA_GATEWAY_DEV_EXECUTION_KEY')
  })
})

/**
 * WO-AGC-004 §§19-20 — the PRODUCT-HOSTED governed route. Everything here is
 * a frozen owner-ruling identifier or an environment reference; no secret,
 * no host contact.
 */
describe('aera-gateway-agc-binding: product-hosted governed profile', () => {
  it('resolves the frozen route through the REAL llm-pi-ai schema', () => {
    const section = buildAgcGovernedGatewayProviderSection()
    const validated = (Config as unknown as (value: unknown) => {
      providers: Record<string, {
        apiKeyEnv?: string
        api?: string
        baseURL?: string
        headers?: Record<string, string>
        models?: Array<{ id: string }>
      }>
    })(section)
    const profile = validated.providers[AGC_GOVERNED_GATEWAY_ROUTE]

    expect(profile).toBeDefined()
    expect(profile!.api).toBe('openai-responses')
    expect(supportedProtocols()).toContain('openai-responses')
    expect(profile!.baseURL).toBe('http://127.0.0.1:4646/v1')
    expect(profile!.apiKeyEnv).toBe(AGC_GATEWAY_CREDENTIAL_ENV)
    expect(profile!.headers).toMatchObject({
      [AGC_CONNECTION_HEADER]: 'relay-messages-dogfood-canonical-connection',
      [AGC_RUNTIME_INSTANCE_HEADER]: 'relay-messages-dogfood-canonical-runtime',
      [AGC_ENVIRONMENT_HEADER]: 'AERA_DEV',
    })
    expect(profile!.headers).not.toHaveProperty(AGC_SESSION_HEADER)
    expect(profile!.models!.map(model => model.id)).toEqual([AGC_GOVERNED_MODEL_ID])
  })

  // The Router refuses any model outside its `aera/*` alias catalogue with
  // 400 `unknown_model` before routing runs, and `aera/active` is not in it.
  it('serves an alias the Router actually declares, never aera/active', () => {
    expect(AGC_GOVERNED_MODEL_ID).toBe('aera/auto')
    expect(JSON.stringify(buildAgcGovernedGatewayProviderSection())).not.toContain('aera/active')
  })

  it('keeps the frozen Connection/runtime identifiers exactly as the owner ruling froze them', () => {
    expect(AGC_GOVERNED_CONNECTION_ID).toBe('relay-messages-dogfood-canonical-connection')
    expect(AGC_GOVERNED_RUNTIME_INSTANCE_ID).toBe('relay-messages-dogfood-canonical-runtime')
  })

  // §20: the loopback boundary is not weakened for the dogfood. The governed
  // origin is exactly what the unmodified guard already accepts.
  it('passes the unmodified loopback guard on the AERA_DEV forward', () => {
    expect(AGC_GOVERNED_ROUTER_ORIGIN).toBe('http://127.0.0.1:4646')
    expect(() => buildAgcGovernedGatewayProviderProfile()).not.toThrow()
    expect(() => buildAgcIsolatedGatewayProviderProfile({
      ...INPUT,
      routerOrigin: AGC_GOVERNED_ROUTER_ORIGIN,
    })).not.toThrow()
  })

  it('adds only its own route, preserving any provider already composed', () => {
    const section = buildAgcGovernedGatewayProviderSection({ openai: { apiKeyEnv: 'OPENAI_API_KEY' } })

    expect(Object.keys(section.providers).sort()).toEqual(['aera-gateway-agc', 'openai'])
  })

  it('accepts an explicit Canary loopback and credential reference without changing frozen routing identity', () => {
    const env = {
      AERA_GATEWAY_AGC_ROUTER_ORIGIN: 'http://127.0.0.1:14646',
      AERA_GATEWAY_AGC_CREDENTIAL_ENV_NAME: 'AERA_GATEWAY_DSH_EVAL_KEY',
      AERA_GATEWAY_AGC_ENVIRONMENT_ID: 'CANARY',
    }
    const runtime = resolveAgcGovernedGatewayRuntime(env)
    const profile = buildAgcGovernedGatewayProviderProfile(env)

    expect(runtime).toEqual({
      routerOrigin: 'http://127.0.0.1:14646',
      credentialEnvironmentName: 'AERA_GATEWAY_DSH_EVAL_KEY',
      environmentId: 'CANARY',
    })
    expect(profile.baseURL).toBe('http://127.0.0.1:14646/v1')
    expect(profile.apiKeyEnv).toBe('AERA_GATEWAY_DSH_EVAL_KEY')
    expect(profile.displayName).toBe('AERA Gateway (governed / CANARY)')
    expect(profile.models[0]?.name).toBe('Aera governed route / CANARY')
    expect(profile.headers).toMatchObject({
      [AGC_CONNECTION_HEADER]: AGC_GOVERNED_CONNECTION_ID,
      [AGC_RUNTIME_INSTANCE_HEADER]: AGC_GOVERNED_RUNTIME_INSTANCE_ID,
      [AGC_ENVIRONMENT_HEADER]: 'CANARY',
    })
  })

  it('refuses a non-loopback governed override and malformed credential environment name', () => {
    // AERA_DEV's allowed set is the single loopback forward; the Sydney
    // Canary origin is refused *as an AERA_DEV origin* (no cross-environment
    // fallback), now via the environment-aware exact-origin validator.
    expect(() => resolveAgcGovernedGatewayRuntime({
      AERA_GATEWAY_AGC_ROUTER_ORIGIN: 'http://100.90.140.5:14646',
    })).toThrow(/runtime tuple/i)
    expect(() => resolveAgcGovernedGatewayRuntime({
      AERA_GATEWAY_AGC_CREDENTIAL_ENV_NAME: 'bad-name',
    })).toThrow(/credential environment/i)
    expect(() => resolveAgcGovernedGatewayRuntime({
      AERA_GATEWAY_AGC_ENVIRONMENT_ID: 'SYDNEY',
    })).toThrow(/environment identity/i)
    expect(() => resolveAgcGovernedGatewayRuntime({
      AERA_GATEWAY_AGC_ENVIRONMENT_ID: 'CANARY',
      AERA_GATEWAY_AGC_ROUTER_ORIGIN: 'http://127.0.0.1:4646',
      AERA_GATEWAY_AGC_CREDENTIAL_ENV_NAME: 'AERA_GATEWAY_DSH_EVAL_KEY',
    })).toThrow(/runtime tuple/i)
    expect(() => resolveAgcGovernedGatewayRuntime({
      AERA_GATEWAY_AGC_ENVIRONMENT_ID: 'CANARY',
      AERA_GATEWAY_AGC_ROUTER_ORIGIN: 'http://127.0.0.1:14646',
      AERA_GATEWAY_AGC_CREDENTIAL_ENV_NAME: 'AERA_GATEWAY_AGC_EXECUTION_KEY',
    })).toThrow(/runtime tuple/i)
  })

  it('carries no secret material and never names another profile credential', () => {
    const serialized = JSON.stringify(buildAgcGovernedGatewayProviderSection())

    expect(serialized).toContain(AGC_GATEWAY_CREDENTIAL_ENV)
    expect(serialized).not.toMatch(/Bearer /)
    expect(serialized).not.toContain('AERA_GATEWAY_DSH_EVAL_KEY')
    expect(serialized).not.toContain('AERA_GATEWAY_DEV_EXECUTION_KEY')
  })
})
