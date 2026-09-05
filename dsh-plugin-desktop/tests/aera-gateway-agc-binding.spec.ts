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
