/**
 * WO-AGC-002 REMIT H — the ONE named consumer binding (owner adjudication
 * DR-018 §9): a governed `ctx.llm` provider route for the ISOLATED Aera Code
 * acceptance profile.
 *
 * This module is consumer-owned CONFIGURATION CONSTRUCTION only. It builds
 * the `llm-pi-ai` provider profile that binds the pinned default route
 * (`aera-gateway`) to the governed loopback AERA router — the router's own
 * OpenAI-compatible provider surface (`/v1/responses`), which runs canonical
 * admission, ParticipationSession/GatewaySession routing, PPS privacy and the
 * inline Sentinel gate before any provider effect. The REAL, unmodified
 * `@deepseek-ai/dsh-llm-pi-ai` adapter serves the route; no adapter is
 * replaced and no DSH runtime seam is altered.
 *
 * Credential discipline (§9):
 * - `apiKeyEnv` is a REFERENCE. The gateway execution credential is resolved
 *   at request time from the launch environment / credentials service. Its
 *   value lives ONLY in the AGC-local runtime directory and the launch
 *   process environment — never in Keychain for this profile, never in this
 *   file, never in settings, never in evidence.
 * - No OAuth material is involved anywhere in this binding. The route is
 *   authenticated by the Gateway's own execution key; provider-side
 *   authentication stays entirely router-side.
 * - No API-key dependency on any external provider is created.
 *
 * The identifiers carried in `headers` (connection id, session id) are
 * routing identifiers for the canonical GatewaySession — not secrets.
 */

/** The pinned default provider route of the Aera Code overlay. */
export const AERA_GATEWAY_ROUTE = 'aera-gateway'

/**
 * Credential REFERENCE for the isolated acceptance profile. Distinct from
 * both real-profile Keychain-backed names (`AERA_GATEWAY_DSH_EVAL_KEY`,
 * `AERA_GATEWAY_DEV_EXECUTION_KEY`) so the untouchable real profile and this
 * binding can never resolve each other's credentials.
 */
export const AGC_GATEWAY_CREDENTIAL_ENV = 'AERA_GATEWAY_AGC_EXECUTION_KEY'

/**
 * The governed router model alias this binding serves. NOTE (recorded
 * incompatibility detail): the overlay pins `aera/active` as the default
 * model id, but the router's `/v1/responses` alias catalogue does not serve
 * `aera/active`; `aera/auto` is the served alias. The binding therefore
 * declares the servable alias explicitly rather than inheriting the pin.
 */
export const AGC_GATEWAY_MODEL_ID = 'aera/auto'

export interface AgcIsolatedGatewayBindingInput {
  /** Governed loopback router origin, e.g. `http://127.0.0.1:4646`. */
  readonly routerOrigin: string
  /** Registered Gateway connection id for the isolated acceptance runtime. */
  readonly connectionId: string
  /** Registered canonical GatewaySession id for this participation run. */
  readonly gatewaySessionId: string
  /**
   * WO-R10-001 REMIT D — OPTIONAL DR-018 claim REFERENCES for the governed
   * `/v1/responses` route. Both are plain routing/lookup identifiers (the
   * canonical WorkOrder id and ParticipationSession id of this run), carried
   * as static headers because the unmodified pi-ai adapter supports only
   * static profile headers. They are NEVER self-authenticating: the router
   * treats them purely as a lookup key, resolves them against its own
   * trusted records, and digest-verifies the actual transmitted instruction
   * bytes before any provenance exists. Omitting them simply leaves DR-018
   * ineligible (the ordinary Sentinel result stands).
   */
  readonly workOrderId?: string
  readonly participationSessionId?: string
}

/**
 * Structural shape of an `llm-pi-ai` provider profile as its configuration
 * schema accepts it (`PiAiProviderProfile`). Declared structurally so this
 * consumer module does not add a package dependency; the spec validates the
 * built value against the REAL `resolveProfiles` from
 * `@deepseek-ai/dsh-llm-pi-ai`.
 */
export interface AgcGatewayProviderProfile {
  readonly displayName: string
  readonly api: 'openai-responses'
  readonly baseURL: string
  readonly apiKeyEnv: string
  readonly headers: Readonly<Record<string, string>>
  readonly transport: 'sse'
  readonly models: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly contextWindow: number
    readonly maxTokens: number
  }>
}

function assertLoopbackOrigin(origin: string): void {
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    throw new Error(`aera-gateway-agc-binding: routerOrigin "${origin}" is not a URL`)
  }
  if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
    throw new Error(
      'aera-gateway-agc-binding: the isolated acceptance binding only serves the governed LOOPBACK router;'
      + ` refusing non-loopback origin "${origin}"`,
    )
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new Error(`aera-gateway-agc-binding: routerOrigin must be an origin without a path, got "${origin}"`)
  }
}

function assertIdentifier(name: string, value: string): void {
  if (!/^[a-zA-Z0-9_.:-]{1,160}$/.test(value)) {
    throw new Error(`aera-gateway-agc-binding: ${name} "${value}" is not a plain routing identifier`)
  }
}

/**
 * Build the provider profile for the `aera-gateway` route of the ISOLATED
 * acceptance profile. The returned object contains NO secret: the credential
 * is referenced by environment name only, and the two header values are
 * canonical routing identifiers.
 */
export function buildAgcIsolatedGatewayProviderProfile(
  input: AgcIsolatedGatewayBindingInput,
): AgcGatewayProviderProfile {
  assertLoopbackOrigin(input.routerOrigin)
  assertIdentifier('connectionId', input.connectionId)
  assertIdentifier('gatewaySessionId', input.gatewaySessionId)
  if (input.workOrderId !== undefined) assertIdentifier('workOrderId', input.workOrderId)
  if (input.participationSessionId !== undefined) assertIdentifier('participationSessionId', input.participationSessionId)
  const origin = new URL(input.routerOrigin).origin
  return {
    displayName: 'AERA Gateway (AGC isolated acceptance)',
    api: 'openai-responses',
    baseURL: `${origin}/v1`,
    apiKeyEnv: AGC_GATEWAY_CREDENTIAL_ENV,
    headers: {
      'x-aera-connection-id': input.connectionId,
      'x-aera-session-id': input.gatewaySessionId,
      ...(input.workOrderId !== undefined ? { 'x-aera-work-order-id': input.workOrderId } : {}),
      ...(input.participationSessionId !== undefined
        ? { 'x-aera-participation-session-id': input.participationSessionId }
        : {}),
    },
    transport: 'sse',
    models: [
      {
        id: AGC_GATEWAY_MODEL_ID,
        name: 'Aera governed route (auto)',
        contextWindow: 262_144,
        maxTokens: 32_768,
      },
    ],
  }
}

/**
 * The full `llm-pi-ai` plugin/settings section carrying the single route:
 * `{ providers: { 'aera-gateway': <profile> } }`.
 */
export function buildAgcIsolatedGatewayProviderSection(
  input: AgcIsolatedGatewayBindingInput,
): { providers: Record<string, AgcGatewayProviderProfile> } {
  return { providers: { [AERA_GATEWAY_ROUTE]: buildAgcIsolatedGatewayProviderProfile(input) } }
}
