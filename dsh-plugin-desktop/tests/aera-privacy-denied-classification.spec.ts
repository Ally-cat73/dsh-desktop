import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// WO-AGC-004 remit AC2 / owner ruling §8 (J-3). `classifyPiAiError` and
// `displayFailureMessage` are module-private inside the pinned provider
// bundles, so each is read verbatim from the installed lib source and
// evaluated in isolation — the branch ORDER under test is the bundle's own.
function extractFunction(file: string, name: string): string {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
  const start = source.indexOf(`function ${name}(`)
  if (start < 0) throw new Error(`${name} not found in ${file}`)
  let depth = 0
  for (let index = source.indexOf('{', start); index < source.length; index++) {
    if (source[index] === '{') depth++
    else if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1)
  }
  throw new Error(`unterminated ${name}`)
}

// Neither closed-over import is on any path exercised here.
const classify = new Function(
  'const isQuotaExceededError = () => false;'
  + '\nconst QUOTA_EXCEEDED_CODE = "QUOTA_EXCEEDED";'
  + `\n${extractFunction('../node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js', 'classifyPiAiError')}`
  + '\nreturn classifyPiAiError;')() as (message: string) => string

const display = new Function(
  `${extractFunction('../node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js', 'displayFailureMessage')}`
  + '\nreturn displayFailureMessage;')() as (failure: unknown) => string

/** The EXACT failure string the owner's Stage-A attempt two produced. */
const PRIVACY_403 = 'OpenAI API error (403): {"message":"Provider privacy policy denied execution.",'
  + '"type":"policy_error","code":"PRIVACY_DENIED","request_id":"f2cccf9f-be69-4e61-b37d-8a941bfb8ca5"}'

describe('Aera privacy-denial classification', () => {
  it('maps a Router 403 PRIVACY_DENIED to its own code and truthful copy', () => {
    const code = classify(PRIVACY_403)
    expect(code).toBe('PRIVACY_POLICY')
    expect(display({ code, message: PRIVACY_403 })).toBe('Request blocked by Aera privacy policy.')
    // The false message the owner actually saw must never appear for this failure.
    expect(display({ code, message: PRIVACY_403 })).not.toBe('API key is invalid')
  })

  it('keeps the typed reason the Router now attaches without changing the classification', () => {
    const withDetails = PRIVACY_403.replace('}', ',"details":{"reason_category":"secret_detected",'
      + '"detector_family":"raw_scan.risk_secrets_present"}}')
    expect(classify(withDetails)).toBe('PRIVACY_POLICY')
  })

  it('still calls a REAL authentication failure an authentication failure', () => {
    const unauthorized = 'OpenAI API error (401): {"message":"Incorrect API key provided.",'
      + '"type":"invalid_request_error","code":"invalid_api_key"}'
    expect(classify(unauthorized)).toBe('AUTH')
    expect(display({ code: 'AUTH', message: unauthorized })).toBe('API key is invalid')
  })

  it('still calls a non-privacy 403 an authentication failure', () => {
    const forbidden = 'OpenAI API error (403): {"message":"Forbidden.","type":"invalid_request_error","code":"forbidden"}'
    expect(classify(forbidden)).toBe('AUTH')
  })

  it('leaves the pre-existing governance branches exactly as they were', () => {
    expect(classify('SENTINEL_DENIED')).toBe('GOVERNANCE_POLICY')
    expect(classify('SENTINEL_POLICY_UNAVAILABLE')).toBe('GOVERNANCE_UNAVAILABLE')
    expect(classify('PROVIDER_EXECUTION_FORBIDDEN')).toBe('AUTHORITY')
    expect(classify('PROVIDER_DISABLED')).toBe('PROVIDER_STATE')
    expect(display({ code: 'GOVERNANCE_POLICY' })).toBe('Sentinel governance policy denied this request.')
  })
})
