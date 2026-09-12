import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { processResponsesStream } from '../node_modules/@earendil-works/pi-ai/dist/api/openai-responses-shared.js'
import { migrateAeraCodeUserData } from '../src/aera-code-state-migration.ts'
import { bootstrapAeraGatewayCredential } from '../src/aera-gateway-keychain.ts'
import { aeraGatewayAuthFailureMessage } from '../src/aera-gateway-failure.ts'
import { AERA_CODE_PRODUCT } from '../src/product-brand.ts'
import { AGC_GATEWAY_CREDENTIAL_ENV } from '../src/aera-gateway-agc-binding.ts'

describe('Aera Code native identity', () => {
  it('centralizes the owner-facing product profile', () => {
    expect(AERA_CODE_PRODUCT).toMatchObject({
      productName: 'Aera Code',
      bundleIdentifier: 'dev.aerastudios.code',
      userDataDirectoryName: 'Aera Code',
      legacyUserDataDirectoryName: 'DSH Desktop',
      gatewayProfileName: 'aera-gateway-eval',
    })
  })

  // WO-AGC-004 §21 — the governed dogfood credential resolves from Keychain
  // on an ordinary Finder launch, by NAME. No value is present anywhere.
  it('resolves the governed AGC Gateway credential profile from Keychain', () => {
    const profile = AERA_CODE_PRODUCT.gatewayProfiles['aera-gateway-agc']

    expect(profile).toEqual({
      credentialEnvironmentName: 'AERA_GATEWAY_AGC_EXECUTION_KEY',
      keychainService: 'com.aera.gateway.agc.execution',
      keychainAccount: 'agc-relay-dogfood-canonical-2026-09-10',
    })
    expect(profile.credentialEnvironmentName).toBe(AGC_GATEWAY_CREDENTIAL_ENV)

    const environment: NodeJS.ProcessEnv = {}
    const readPassword = vi.fn((service: string, account: string) => {
      expect(service).toBe(profile.keychainService)
      expect(account).toBe(profile.keychainAccount)
      return 'TEST-ONLY-NOT-A-CREDENTIAL'
    })

    expect(bootstrapAeraGatewayCredential({
      platform: 'darwin',
      environment,
      activeProfile: 'aera-gateway-agc',
      readPassword,
    })).toBe('loaded-from-keychain')
    expect(readPassword).toHaveBeenCalledOnce()
    expect(environment['AERA_GATEWAY_AGC_EXECUTION_KEY']).toBe('TEST-ONLY-NOT-A-CREDENTIAL')
  })

  it('keeps the untouched real profiles resolving their own credentials', () => {
    for (const [name, expected] of [
      ['aera-gateway-eval', 'AERA_GATEWAY_DSH_EVAL_KEY'],
      ['aera-gateway-dev-eval', 'AERA_GATEWAY_DEV_EXECUTION_KEY'],
    ] as const) {
      const environment: NodeJS.ProcessEnv = {}
      bootstrapAeraGatewayCredential({
        platform: 'darwin',
        environment,
        activeProfile: name,
        readPassword: () => 'TEST-ONLY-NOT-A-CREDENTIAL',
      })
      expect(Object.keys(environment)).toEqual([expected])
    }
  })

  it('makes Gateway standard and removes upstream model branding from the projection', () => {
    const overlay = readFileSync(join(process.cwd(), 'cordis.patch.yml'), 'utf8')
    const conversationPatch = readFileSync(join(
      process.cwd(),
      '..',
      '.yarn',
      'patches',
      '@deepseek-ai-dsh-client-ui-conversation-npm-0.1.1-rc.2-941ef6a7f5.patch',
    ), 'utf8')

    // WO-AGC-004 §19: the pinned route is the product-hosted governed
    // profile, on an alias the Router's catalogue actually serves.
    expect(overlay).toContain('provider: aera-gateway-agc')
    expect(overlay).toContain('model: aera/auto')
    expect(overlay).not.toContain('aera/active')
    expect(overlay).toMatch(/id: llm-deepseek[\s\S]*disabled: true/)
    expect(conversationPatch).toContain('Aera Code system context')
  })

  it('migrates only allowlisted non-secret launcher state', () => {
    const root = mkdtempSync(join(tmpdir(), 'aera-code-migration-'))
    const legacy = join(root, 'DSH Desktop')
    const target = join(root, 'Aera Code')
    mkdirSync(join(legacy, 'profile-selection'), { recursive: true })
    mkdirSync(join(legacy, 'Local Storage'), { recursive: true })
    writeFileSync(join(legacy, 'profile-selection', 'state.json'), '{"version":1,"active":"aera-gateway-eval","lastKnownGood":"aera-gateway-eval"}')
    writeFileSync(join(legacy, 'Cookies'), 'must-not-migrate')
    writeFileSync(join(legacy, 'Local Storage', 'credential.json'), 'must-not-migrate')

    const result = migrateAeraCodeUserData(legacy, target)

    expect(result).toEqual({ status: 'migrated', migrated: ['profile-selection/state.json'] })
    expect(readFileSync(join(target, 'profile-selection', 'state.json'), 'utf8')).toContain('aera-gateway-eval')
    expect(existsSync(join(target, 'Cookies'))).toBe(false)
    expect(existsSync(join(target, 'Local Storage'))).toBe(false)
  })

  it('never overwrites already-established Aera Code state', () => {
    const root = mkdtempSync(join(tmpdir(), 'aera-code-existing-'))
    const legacy = join(root, 'DSH Desktop')
    const target = join(root, 'Aera Code')
    for (const base of [legacy, target]) mkdirSync(join(base, 'profile-selection'), { recursive: true })
    writeFileSync(join(legacy, 'profile-selection', 'state.json'), 'legacy')
    writeFileSync(join(target, 'profile-selection', 'state.json'), 'current')

    expect(migrateAeraCodeUserData(legacy, target)).toEqual({ status: 'not-needed', migrated: [] })
    expect(readFileSync(join(target, 'profile-selection', 'state.json'), 'utf8')).toBe('current')
  })

  it('loads the existing Gateway credential only into the process environment', () => {
    const environment: NodeJS.ProcessEnv = {}
    const readPassword = vi.fn(() => 'process-only-value')

    expect(bootstrapAeraGatewayCredential({
      platform: 'darwin',
      environment,
      activeProfile: 'aera-gateway-eval',
      readPassword,
    })).toBe('loaded-from-keychain')
    expect(readPassword).toHaveBeenCalledWith('com.aera.gateway.canary.execution', 'Allyd')
    expect(environment.AERA_GATEWAY_DSH_EVAL_KEY).toBe('process-only-value')
  })

  it('loads the governed Dev credential only for the explicit Dev profile', () => {
    const environment: NodeJS.ProcessEnv = {}
    const readPassword = vi.fn(() => 'dev-process-only-value')

    expect(bootstrapAeraGatewayCredential({
      platform: 'darwin',
      environment,
      activeProfile: 'aera-gateway-dev-eval',
      readPassword,
    })).toBe('loaded-from-keychain')
    expect(readPassword).toHaveBeenCalledWith('com.aera.gateway.dev.execution', 'Alyshia Daley')
    expect(environment.AERA_GATEWAY_DEV_EXECUTION_KEY).toBe('dev-process-only-value')
    expect(environment.AERA_GATEWAY_DSH_EVAL_KEY).toBeUndefined()
  })

  it('does not read Keychain for another profile or replace an inherited credential', () => {
    const readPassword = vi.fn(() => 'unexpected')
    expect(bootstrapAeraGatewayCredential({
      platform: 'darwin',
      environment: {},
      activeProfile: 'desktop',
      readPassword,
    })).toBe('not-required')
    expect(bootstrapAeraGatewayCredential({
      platform: 'darwin',
      environment: { AERA_GATEWAY_DSH_EVAL_KEY: 'already-present' },
      activeProfile: 'aera-gateway-eval',
      readPassword,
    })).toBe('already-present')
    expect(readPassword).not.toHaveBeenCalled()
  })

  it('ships a finite Aera Gateway failure projection without exposing arbitrary AUTH text', () => {
    const rootManifest = JSON.parse(
      readFileSync(join(process.cwd(), '..', 'package.json'), 'utf8'),
    ) as { resolutions?: Record<string, string> }
    const runtimePatchLocator = rootManifest.resolutions?.['@deepseek-ai/dsh-client-runtime@npm:0.1.1-rc.2']
    const runtimePatchPath = runtimePatchLocator?.split('#./')[1]
    if (runtimePatchPath === undefined) throw new Error('Aera Gateway client-runtime patch is not registered')
    const patch = readFileSync(join(process.cwd(), '..', runtimePatchPath), 'utf8')

    expect(runtimePatchLocator).toContain('@deepseek-ai/dsh-client-runtime@npm%3A0.1.1-rc.2')
    expect(patch).toContain('Aera Gateway authentication is required.')
    expect(patch).toContain('Aera Gateway execution is not authorised for this runtime Session.')
    expect(patch).toContain('Aera Gateway provider execution is disabled.')
    expect(patch).toContain('Aera Gateway governance is temporarily unavailable.')
    expect(patch).toContain('Aera Gateway governance policy denied this request.')
    expect(patch).toContain('return "API key is invalid"')
    expect(patch).not.toContain('return record.message')

    expect(aeraGatewayAuthFailureMessage(
      'OpenAI API error (401): {"code":"provider_execution_unauthorized"}',
    )).toBe('Aera Gateway authentication is required.')
    expect(aeraGatewayAuthFailureMessage(
      'OpenAI API error (403): 403 "PROVIDER_EXECUTION_FORBIDDEN"',
    )).toBe('Aera Gateway execution is not authorised for this runtime Session.')
    expect(aeraGatewayAuthFailureMessage(
      'OpenAI API error (403): 403 "SENTINEL_DENIED"',
    )).toBe('Aera Gateway governance policy denied this request.')
    expect(aeraGatewayAuthFailureMessage(
      'OpenAI API error: SENTINEL_OUTPUT_DENIED',
    )).toBe('Aera Gateway governance policy denied this request.')
    expect(aeraGatewayAuthFailureMessage('credential=must-not-render')).toBeNull()
  })

  it('classifies Gateway governance, authority, and provider state separately from credentials', () => {
    const adapterSource = readFileSync(join(
      process.cwd(),
      'node_modules',
      '@deepseek-ai',
      'dsh-llm-pi-ai',
      'lib',
      'index.js',
    ), 'utf8')
    const start = adapterSource.indexOf('function classifyPiAiError(message)')
    const end = adapterSource.indexOf('/**\n* Map a terminal pi-ai event', start)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const classify = new Function(
      'isQuotaExceededError',
      `${adapterSource.slice(start, end)}; return classifyPiAiError`,
    )(() => false) as (message: string) => string

    expect(classify('OpenAI API error (403): 403 "SENTINEL_DENIED"')).toBe('GOVERNANCE_POLICY')
    expect(classify('OpenAI API error: SENTINEL_OUTPUT_DENIED')).toBe('GOVERNANCE_POLICY')
    expect(classify('OpenAI API error (503): 503 "SENTINEL_POLICY_UNAVAILABLE"')).toBe('GOVERNANCE_UNAVAILABLE')
    expect(classify('OpenAI API error (503): 503 "GOVERNANCE_EVALUATION_UNAVAILABLE"')).toBe('GOVERNANCE_UNAVAILABLE')
    expect(classify('OpenAI API error: EXECUTION_LINEAGE_RECONCILIATION_REQUIRED')).toBe('GOVERNANCE_UNAVAILABLE')
    expect(classify('OpenAI API error (403): 403 "CURRENT_AUTHORITY_UNAVAILABLE"')).toBe('AUTHORITY')
    expect(classify('OpenAI API error (423): 423 "PROVIDER_LOCKED"')).toBe('PROVIDER_STATE')
    expect(classify('OpenAI API error (401): 401 "provider_execution_unauthorized"')).toBe('AUTH')
  })

  it('carries the Router policy terminal through the installed parser without a retryable transport code', async () => {
    const wire = {
      async *[Symbol.asyncIterator]() {
        yield {
          type: 'response.failed',
          response: {
            status: 'failed',
            error: {
              type: 'policy_error',
              code: 'SENTINEL_OUTPUT_DENIED',
              message: 'Sentinel blocked the provider output.',
            },
          },
        }
      },
    }

    let parsedMessage = ''
    try {
      await processResponsesStream(
        wire as never,
        {} as never,
        { push: vi.fn() } as never,
        {} as never,
      )
    } catch (error) {
      parsedMessage = error instanceof Error ? error.message : String(error)
    }
    expect(parsedMessage).toBe('SENTINEL_OUTPUT_DENIED: Sentinel blocked the provider output.')

    const adapterSource = readFileSync(join(
      process.cwd(),
      'node_modules',
      '@deepseek-ai',
      'dsh-llm-pi-ai',
      'lib',
      'index.js',
    ), 'utf8')
    const start = adapterSource.indexOf('function classifyPiAiError(message)')
    const end = adapterSource.indexOf('/**\n* Map a terminal pi-ai event', start)
    const classify = new Function(
      'isQuotaExceededError',
      `${adapterSource.slice(start, end)}; return classifyPiAiError`,
    )(() => false) as (message: string) => string
    const code = classify(parsedMessage)

    expect(code).toBe('GOVERNANCE_POLICY')
    expect(['EMPTY_RESPONSE', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT']).not.toContain(code)
    expect(aeraGatewayAuthFailureMessage(parsedMessage))
      .toBe('Aera Gateway governance policy denied this request.')
  })

  it('renders finite owner-safe copy for the distinct Gateway failure taxonomy', () => {
    const clientSource = readFileSync(join(
      process.cwd(),
      'node_modules',
      '@deepseek-ai',
      'dsh-client-runtime',
      'lib',
      'client.js',
    ), 'utf8')
    const start = clientSource.indexOf('function displayFailureMessage(failure)')
    const end = clientSource.indexOf('//#endregion', start)
    const display = new Function(
      `${clientSource.slice(start, end)}; return displayFailureMessage`,
    )() as (failure: Record<string, unknown>) => string

    expect(display({ code: 'GOVERNANCE_POLICY', message: 'protected raw denial' }))
      .toBe('Aera Gateway governance policy denied this request.')
    expect(display({ code: 'GOVERNANCE_UNAVAILABLE', message: 'protected raw failure' }))
      .toBe('Aera Gateway governance is temporarily unavailable.')
    expect(display({ code: 'AUTHORITY', message: 'protected raw authority state' }))
      .toBe('Aera Gateway execution is not authorised for this runtime Session.')
    expect(display({ code: 'PROVIDER_STATE', message: 'protected raw provider state' }))
      .toBe('Aera Gateway provider execution is disabled.')
    expect(display({ code: 'AUTH', message: 'protected raw credential failure' }))
      .toBe('API key is invalid')
  })

  it('ships English-only system labels in the reachable primitive renderer bundle', () => {
    const primitiveSource = readFileSync(join(
      process.cwd(),
      'node_modules',
      '@deepseek-ai',
      'dsh-client-ui-primitives',
      'lib',
      'index.js',
    ), 'utf8')

    expect(primitiveSource).not.toMatch(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u)
    expect(primitiveSource).toContain('Connection lost. Reconnecting…')
    expect(primitiveSource).toContain('Showing ${lines.length} of ${totalLines} lines')
    expect(primitiveSource).toContain('children: copied ? "Copied" : "Copy"')
    expect(primitiveSource).toContain('children: "No results"')
    expect(primitiveSource).toContain('children: "Source list truncated"')
    expect(primitiveSource).toContain('children: "Content truncated"')
  })
})
