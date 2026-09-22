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
 * The governed router model alias this binding serves. It is declared
 * explicitly rather than inherited from the overlay pin, because the
 * router's `/v1/responses` alias catalogue serves a fixed set and rejects
 * everything else before routing runs. The overlay's original pin was
 * outside that set; WO-AGC-004 corrected the overlay to this alias.
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

/* ------------------------------------------------------------------------ *
 * WO-AGC-004 — the PRODUCT-HOSTED governed Gateway profile.
 *
 * The block above builds the WO-AGC-002 ISOLATED acceptance binding and is
 * left exactly as adjudicated. What follows is the profile Aera Code itself
 * hosts: one provider route, registered by the desktop's own composition
 * (`prepareDesktopProfile`), so the governed route exists in the RUNNING
 * application rather than in a driver script.
 *
 * Every value below is a frozen, non-secret routing identifier taken from
 * the owner ruling; the credential is referenced by environment NAME only.
 * ------------------------------------------------------------------------ */

/** Product-hosted governed provider route. Distinct from the acceptance route. */
export const AGC_GOVERNED_GATEWAY_ROUTE = 'aera-gateway-agc'

/**
 * The loopback AERA_DEV Gateway origin. The SSH LocalForward publishes the
 * AERA_DEV Router here. The AERA_DEV allowed-origin set contains this origin
 * and nothing else, so the AERA_DEV boundary is exactly as it was adjudicated.
 */
export const AGC_GOVERNED_ROUTER_ORIGIN = 'http://127.0.0.1:4646'

/**
 * WO-AERA-CANARY…-001 §22/§23 — the Lab Canary Router origin, published by
 * the Lab LocalForward. Retained as a member of the CANARY allowed set so the
 * accepted rollback target stays reachable by configuration alone.
 */
export const AGC_CANARY_LAB_ROUTER_ORIGIN = 'http://127.0.0.1:14646'

/**
 * WO-AERA-CANARY…-001 §22/§23 — the Sydney Canary Router origin, reached
 * DIRECTLY over the Tailscale interface (no SSH forward in the product path).
 * `100.90.140.5` is the owner-verified Tailscale address of `aera-canary-v1`;
 * it is a frozen constant here, never a hostname class, never user-entered.
 */
export const AGC_CANARY_SYDNEY_ROUTER_ORIGIN = 'http://100.90.140.5:14646'

/** Frozen canonical Connection id (owner ruling §4). */
export const AGC_GOVERNED_CONNECTION_ID = 'relay-messages-dogfood-canonical-connection'

/** Frozen canonical runtime instance id (owner ruling §4). */
export const AGC_GOVERNED_RUNTIME_INSTANCE_ID = 'relay-messages-dogfood-canonical-runtime'

/**
 * The Router alias catalogue admits a fixed set of `aera/*` aliases and
 * rejects everything else with 400 `unknown_model` before any routing runs.
 * This alias is in that set; the one the overlay used to pin was not. The
 * live Aera Code Session is resolved through the frozen Connection's
 * bootstrap policy, so each conversation receives its own immutable pinned
 * assignment rather than being collapsed into one static GatewaySession.
 */
export const AGC_GOVERNED_MODEL_ID = 'aera/auto'

/** Routing header used by the isolated acceptance profile's fixed Session. */
export const AGC_SESSION_HEADER = 'x-aera-session-id'

/** Routing header carrying the frozen Connection id. */
export const AGC_CONNECTION_HEADER = 'x-aera-connection-id'

/**
 * Routing header carrying the frozen runtime instance id. The Router treats
 * it as a HINT that must agree with the runtime instance already bound to
 * the execution credential; presenting the frozen value keeps the request
 * self-describing without widening anything.
 */
export const AGC_RUNTIME_INSTANCE_HEADER = 'x-aera-runtime-instance-id'

/** Explicit environment identity; never inferred from a port or profile name. */
export const AGC_ENVIRONMENT_HEADER = 'x-aera-environment-id'

/**
 * The WIRE environment identity. Frozen: these are the only two values the
 * Router, the readiness preflight and the `x-aera-environment-id` header ever
 * carry. Selecting the Sydney Canary Router does NOT introduce a third
 * environment — Sydney and Lab are two publications of the SAME `CANARY`
 * environment.
 */
export type AgcGatewayEnvironmentId = 'AERA_DEV' | 'CANARY'

/**
 * The value `AERA_GATEWAY_AGC_ENVIRONMENT_ID` may carry. `AERA_CANARY` is the
 * §22 clearly-named Canary PROFILE selector: it resolves to the `CANARY`
 * environment with the Sydney origin as its default, while the pre-existing
 * `CANARY` selector keeps the accepted Lab loopback default unchanged. Both
 * draw from the same finite CANARY allowed-origin set, so Lab↔Sydney is
 * configuration state within a closed set and the accepted rollback target is
 * never lost.
 */
export type AgcGatewayProfileSelector = 'AERA_DEV' | 'CANARY' | 'AERA_CANARY'

/**
 * The EXACT, finite set of router origins each environment may serve, with the
 * frozen credential REFERENCE for that environment. There is no wildcard, no
 * hostname class, no "private address is trusted" rule and no user-entered
 * URL: an origin is admissible only by being character-identical to a member
 * of its own environment's set.
 */
const AGC_ENVIRONMENT_RUNTIMES: Readonly<Record<AgcGatewayEnvironmentId, {
  readonly allowedRouterOrigins: readonly string[]
  readonly credentialEnvironmentName: string
}>> = Object.freeze({
  AERA_DEV: Object.freeze({
    allowedRouterOrigins: Object.freeze([AGC_GOVERNED_ROUTER_ORIGIN]),
    credentialEnvironmentName: AGC_GATEWAY_CREDENTIAL_ENV,
  }),
  CANARY: Object.freeze({
    allowedRouterOrigins: Object.freeze([
      AGC_CANARY_LAB_ROUTER_ORIGIN,
      AGC_CANARY_SYDNEY_ROUTER_ORIGIN,
    ]),
    credentialEnvironmentName: 'AERA_GATEWAY_DSH_EVAL_KEY',
  }),
})

/**
 * Which member of the environment's allowed set a profile selector chooses
 * when `AERA_GATEWAY_AGC_ROUTER_ORIGIN` is not set. `CANARY` keeps the
 * accepted Lab loopback (rollback property); `AERA_CANARY` is the owner's
 * daily-use Sydney selection of §22.
 */
const AGC_PROFILE_SELECTORS: Readonly<Record<AgcGatewayProfileSelector, {
  readonly environmentId: AgcGatewayEnvironmentId
  readonly defaultRouterOrigin: string
}>> = Object.freeze({
  AERA_DEV: Object.freeze({
    environmentId: 'AERA_DEV' as const,
    defaultRouterOrigin: AGC_GOVERNED_ROUTER_ORIGIN,
  }),
  CANARY: Object.freeze({
    environmentId: 'CANARY' as const,
    defaultRouterOrigin: AGC_CANARY_LAB_ROUTER_ORIGIN,
  }),
  AERA_CANARY: Object.freeze({
    environmentId: 'CANARY' as const,
    defaultRouterOrigin: AGC_CANARY_SYDNEY_ROUTER_ORIGIN,
  }),
})

/** Read-only projection of the allowed set, for specs and diagnostics. */
export function agcAllowedRouterOrigins(
  environmentId: AgcGatewayEnvironmentId,
): readonly string[] {
  return AGC_ENVIRONMENT_RUNTIMES[environmentId].allowedRouterOrigins
}

/**
 * Environment-aware EXACT-origin validator. It replaces `assertLoopbackOrigin`
 * for the product-hosted governed route only; the WO-AGC-002 isolated
 * acceptance binding above keeps its unmodified loopback guard.
 */
function assertAllowedEnvironmentOrigin(
  environmentId: AgcGatewayEnvironmentId,
  origin: string,
): string {
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    throw new Error(`aera-gateway-agc-binding: routerOrigin "${origin}" is not a URL`)
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new Error(`aera-gateway-agc-binding: routerOrigin must be an origin without a path, got "${origin}"`)
  }
  const allowed = AGC_ENVIRONMENT_RUNTIMES[environmentId].allowedRouterOrigins
  if (!allowed.includes(parsed.origin)) {
    throw new Error(
      'aera-gateway-agc-binding: environment runtime tuple is inconsistent;'
      + ` environment ${environmentId} serves only [${allowed.join(', ')}],`
      + ` refusing router origin "${origin}"`,
    )
  }
  return parsed.origin
}

const SESSION_ENVIRONMENT_BINDINGS = Symbol.for('aera.gateway.session-environment.v1')

interface AgcSessionEnvironmentBinding {
  readonly environmentId: AgcGatewayEnvironmentId
  readonly origin: string
}

function sessionEnvironmentBindings(): Map<string, AgcSessionEnvironmentBinding> {
  const global = globalThis as typeof globalThis & { [SESSION_ENVIRONMENT_BINDINGS]?: unknown }
  const existing = global[SESSION_ENVIRONMENT_BINDINGS]
  if (existing instanceof Map) return existing as Map<string, AgcSessionEnvironmentBinding>
  const created = new Map<string, AgcSessionEnvironmentBinding>()
  global[SESSION_ENVIRONMENT_BINDINGS] = created
  return created
}

export interface AgcGovernedGatewayRuntime {
  readonly routerOrigin: string
  readonly credentialEnvironmentName: string
  readonly environmentId: AgcGatewayEnvironmentId
}

/**
 * Resolve the environment-specific publication of the SAME governed Aera Code
 * Connection. The default selector remains the accepted AERA_DEV binding. A
 * promotion candidate may select another environment and one of that
 * environment's EXACT declared router origins, but may not change
 * Connection/runtime identity, the Channel, the model alias, the credential
 * reference, or reach any origin outside the frozen finite set.
 *
 * Selection (established configuration mechanism, unchanged):
 * - `AERA_GATEWAY_AGC_ENVIRONMENT_ID`: `AERA_DEV` | `CANARY` | `AERA_CANARY`
 * - `AERA_GATEWAY_AGC_ROUTER_ORIGIN`: optional; must be character-identical to
 *   a member of the resolved environment's allowed set, else the tuple is
 *   rejected as inconsistent.
 */
export function resolveAgcGovernedGatewayRuntime(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AgcGovernedGatewayRuntime {
  const selector = env.AERA_GATEWAY_AGC_ENVIRONMENT_ID?.trim() || 'AERA_DEV'
  if (selector !== 'AERA_DEV' && selector !== 'CANARY' && selector !== 'AERA_CANARY') {
    throw new Error('aera-gateway-agc-binding: environment identity is invalid')
  }
  const selected = AGC_PROFILE_SELECTORS[selector]
  const environmentId = selected.environmentId
  const expected = AGC_ENVIRONMENT_RUNTIMES[environmentId]
  const routerOrigin = env.AERA_GATEWAY_AGC_ROUTER_ORIGIN?.trim() || selected.defaultRouterOrigin
  const credentialEnvironmentName = env.AERA_GATEWAY_AGC_CREDENTIAL_ENV_NAME?.trim()
    || expected.credentialEnvironmentName
  if (!/^[A-Z][A-Z0-9_]{2,127}$/u.test(credentialEnvironmentName)) {
    throw new Error('aera-gateway-agc-binding: credential environment name is invalid')
  }
  const resolvedOrigin = assertAllowedEnvironmentOrigin(environmentId, routerOrigin)
  if (credentialEnvironmentName !== expected.credentialEnvironmentName) {
    throw new Error('aera-gateway-agc-binding: environment runtime tuple is inconsistent')
  }
  return Object.freeze({
    routerOrigin: resolvedOrigin,
    credentialEnvironmentName,
    environmentId,
  })
}

/** Bind one native Session to one explicit environment for this Host generation. */
export function bindAgcGatewaySessionEnvironment(
  sessionId: string,
  runtime: AgcGovernedGatewayRuntime,
): void {
  assertIdentifier('sessionId', sessionId)
  const bindings = sessionEnvironmentBindings()
  const current = bindings.get(sessionId)
  if (current !== undefined
    && (current.environmentId !== runtime.environmentId || current.origin !== runtime.routerOrigin)) {
    throw new Error('AERA_GATEWAY_SESSION_ENVIRONMENT_MISMATCH')
  }
  if (current === undefined) bindings.set(sessionId, Object.freeze({
    environmentId: runtime.environmentId,
    origin: runtime.routerOrigin,
  }))
}

/**
 * Build the product-hosted governed provider profile. No argument is taken:
 * every field is frozen by the owner ruling, and a configurable origin is
 * exactly the thing §20 refuses.
 */
export function buildAgcGovernedGatewayProviderProfile(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AgcGatewayProviderProfile {
  const runtime = resolveAgcGovernedGatewayRuntime(env)
  assertIdentifier('connectionId', AGC_GOVERNED_CONNECTION_ID)
  assertIdentifier('runtimeInstanceId', AGC_GOVERNED_RUNTIME_INSTANCE_ID)
  return {
    displayName: `AERA Gateway (governed / ${runtime.environmentId})`,
    api: 'openai-responses',
    baseURL: `${runtime.routerOrigin}/v1`,
    apiKeyEnv: runtime.credentialEnvironmentName,
    headers: {
      [AGC_CONNECTION_HEADER]: AGC_GOVERNED_CONNECTION_ID,
      [AGC_RUNTIME_INSTANCE_HEADER]: AGC_GOVERNED_RUNTIME_INSTANCE_ID,
      [AGC_ENVIRONMENT_HEADER]: runtime.environmentId,
    },
    transport: 'sse',
    models: [
      {
        id: AGC_GOVERNED_MODEL_ID,
        name: `Aera governed route / ${runtime.environmentId}`,
        contextWindow: 262_144,
        maxTokens: 32_768,
      },
    ],
  }
}

/**
 * The `llm-pi-ai` configuration section carrying the governed route, merged
 * over whatever provider routes the composition already declares so this
 * binding only ever ADDS its own key.
 */
export function buildAgcGovernedGatewayProviderSection(
  existing: Readonly<Record<string, unknown>> = {},
  env: Readonly<Record<string, string | undefined>> = process.env,
): { providers: Record<string, unknown> } {
  return {
    providers: {
      ...existing,
      [AGC_GOVERNED_GATEWAY_ROUTE]: buildAgcGovernedGatewayProviderProfile(env),
    },
  }
}
