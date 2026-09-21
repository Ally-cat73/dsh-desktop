/** Zero-Provider readiness/bootstrap for the governed Aera Code profile. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-session'
import {
  AGC_GOVERNED_CONNECTION_ID,
  AGC_GOVERNED_MODEL_ID,
  AGC_GOVERNED_ROUTER_ORIGIN,
  AGC_GOVERNED_RUNTIME_INSTANCE_ID,
  resolveAgcGovernedGatewayRuntime,
} from './aera-gateway-agc-binding.ts'
import { isSameOriginLoopbackRequest } from './desktop-settings-route.ts'
import { AERA_GATEWAY_READINESS_PATH } from './aera-gateway-readiness-contract.ts'

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const EXPECTED_PROVIDER = 'openai'
const EXPECTED_CHANNEL = 'wo030c-channel-b-openai'
const EXPECTED_MODEL = 'gpt-5.6-terra'

export { AERA_GATEWAY_READINESS_PATH } from './aera-gateway-readiness-contract.ts'

export const name = 'aera-gateway-readiness'
export const inject = ['webServer', 'sessions']

export type AeraGatewayReadinessFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export type AeraGatewayReadinessStatus =
  | { readonly state: 'CHECKING' }
  | {
      readonly state: 'BLOCKED'
      readonly code: string
      readonly message: string
    }
  | {
      readonly state: 'READY'
      readonly providerEffect: 'NONE'
      readonly currentAuthority: 'PASS'
      readonly connectionId: typeof AGC_GOVERNED_CONNECTION_ID
      readonly runtimeInstanceId: typeof AGC_GOVERNED_RUNTIME_INSTANCE_ID
      readonly gatewaySessionId: string
      readonly providerId: typeof EXPECTED_PROVIDER
      readonly channelId: typeof EXPECTED_CHANNEL
      readonly modelId: typeof EXPECTED_MODEL
      readonly assignmentRevision: number
      readonly policyEnforcementMode: 'OBSERVATION'
    }

interface ReadinessOptions {
  readonly credential: string
  readonly fetch?: AeraGatewayReadinessFetch
  readonly routerOrigin?: string
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function blocked(code: string): AeraGatewayReadinessStatus {
  return Object.freeze({
    state: 'BLOCKED' as const,
    code,
    message: code === 'PROVIDER_EXECUTION_FORBIDDEN'
      ? 'Aera Gateway authority is not current for this Session.'
      : 'Aera Gateway execution is unavailable for this Session.',
  })
}

/**
 * Owns one in-process readiness result per real native DSH Session. A READY
 * result means the Router created/resolved the canonical Gateway Session and
 * proved current authority, route assignment and zero Provider effect.
 */
export class AeraGatewayReadinessService {
  private readonly statuses = new Map<string, AeraGatewayReadinessStatus>()
  private readonly inFlight = new Map<string, Promise<AeraGatewayReadinessStatus>>()
  private readonly fetch: AeraGatewayReadinessFetch
  private readonly routerOrigin: string

  constructor(private readonly options: ReadinessOptions) {
    this.fetch = options.fetch ?? fetch
    this.routerOrigin = new URL(options.routerOrigin ?? AGC_GOVERNED_ROUTER_ORIGIN).origin
  }

  status(sessionId: string): AeraGatewayReadinessStatus {
    return this.statuses.get(sessionId) ?? Object.freeze({ state: 'CHECKING' as const })
  }

  prepare(sessionId: string): Promise<AeraGatewayReadinessStatus> {
    if (!SESSION_ID.test(sessionId)) return Promise.resolve(blocked('AERA_CODE_SESSION_ID_INVALID'))
    const current = this.statuses.get(sessionId)
    if (current?.state === 'READY') return Promise.resolve(current)
    const pending = this.inFlight.get(sessionId)
    if (pending) return pending
    this.statuses.set(sessionId, Object.freeze({ state: 'CHECKING' as const }))
    const operation = this.perform(sessionId).then((status) => {
      this.statuses.set(sessionId, status)
      return status
    }).finally(() => {
      this.inFlight.delete(sessionId)
    })
    this.inFlight.set(sessionId, operation)
    return operation
  }

  forget(sessionId: string): void {
    this.statuses.delete(sessionId)
    this.inFlight.delete(sessionId)
  }

  private async perform(sessionId: string): Promise<AeraGatewayReadinessStatus> {
    if (this.options.credential.length === 0) return blocked('AERA_GATEWAY_CREDENTIAL_UNAVAILABLE')
    try {
      const response = await this.fetch(`${this.routerOrigin}/v1/provider-execution/preflight`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.credential}`,
          'content-type': 'application/json',
          session_id: sessionId,
          'x-client-request-id': sessionId,
          'x-aera-connection-id': AGC_GOVERNED_CONNECTION_ID,
          'x-aera-runtime-instance-id': AGC_GOVERNED_RUNTIME_INSTANCE_ID,
        },
        body: JSON.stringify({ model: AGC_GOVERNED_MODEL_ID }),
        signal: AbortSignal.timeout(5_000),
      })
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        const error = record(payload) && record(payload.error) ? payload.error : null
        return blocked(error && typeof error.code === 'string' ? error.code : `HTTP_${response.status}`)
      }
      if (!record(payload) || payload.status !== 'ok' || payload.provider_effect !== 'NONE'
        || payload.current_authority !== 'PASS' || payload.route_assignment !== 'VALID'
        || payload.policy_enforcement_mode !== 'OBSERVATION' || !record(payload.identity)) {
        return blocked('AERA_GATEWAY_PREFLIGHT_RESPONSE_INVALID')
      }
      const identity = payload.identity
      if (identity.connection_id !== AGC_GOVERNED_CONNECTION_ID
        || identity.runtime_instance_id !== AGC_GOVERNED_RUNTIME_INSTANCE_ID
        || typeof identity.session_id !== 'string' || !SESSION_ID.test(identity.session_id)
        || identity.provider_id !== EXPECTED_PROVIDER || identity.channel_id !== EXPECTED_CHANNEL
        || identity.model_id !== EXPECTED_MODEL || !Number.isSafeInteger(identity.assignment_revision)) {
        return blocked('AERA_GATEWAY_PREFLIGHT_IDENTITY_MISMATCH')
      }
      return Object.freeze({
        state: 'READY' as const,
        providerEffect: 'NONE' as const,
        currentAuthority: 'PASS' as const,
        connectionId: AGC_GOVERNED_CONNECTION_ID,
        runtimeInstanceId: AGC_GOVERNED_RUNTIME_INSTANCE_ID,
        gatewaySessionId: identity.session_id,
        providerId: EXPECTED_PROVIDER,
        channelId: EXPECTED_CHANNEL,
        modelId: EXPECTED_MODEL,
        assignmentRevision: Number(identity.assignment_revision),
        policyEnforcementMode: 'OBSERVATION' as const,
      })
    } catch {
      return blocked('AERA_GATEWAY_PREFLIGHT_UNAVAILABLE')
    }
  }
}

/** Expose one credential-free readiness projection to the owning renderer. */
export function handleAeraGatewayReadinessRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  service: AeraGatewayReadinessService,
): void {
  if (req.method !== 'GET') {
    res.statusCode = 405
    res.setHeader('allow', 'GET')
    res.end()
    return
  }
  if (!isSameOriginLoopbackRequest(req, expectedOrigin, true)) {
    res.statusCode = 403
    res.end()
    return
  }
  const requestUrl = new URL(req.url ?? '', expectedOrigin)
  const sessionId = requestUrl.searchParams.get('session_id') ?? ''
  if (requestUrl.pathname !== AERA_GATEWAY_READINESS_PATH || !SESSION_ID.test(sessionId)) {
    res.statusCode = 400
    res.end()
    return
  }
  res.statusCode = 200
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(JSON.stringify(service.status(sessionId)))
}

/** Bind the real DSH Session lifecycle to zero-Provider Gateway bootstrap. */
export function apply(ctx: Context): void {
  const runtime = resolveAgcGovernedGatewayRuntime(process.env)
  const service = new AeraGatewayReadinessService({
    credential: process.env[runtime.credentialEnvironmentName] ?? '',
    routerOrigin: runtime.routerOrigin,
  })
  const rendererOrigin = `http://127.0.0.1:${String(ctx.webServer.port)}`
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: AERA_GATEWAY_READINESS_PATH,
      handler: (req, res) => handleAeraGatewayReadinessRequest(
        req, res, rendererOrigin, service,
      ),
    }),
    'aera-gateway-readiness: renderer status route',
  )
  ctx.effect(() => {
    for (const session of ctx.sessions.list()) void service.prepare(String(session.header.id))
    const stopCreated = ctx.on('session/created', (session) => {
      void service.prepare(String(session.header.id))
    })
    const stopDisposed = ctx.on('session/disposed', (session) => {
      service.forget(String(session.header.id))
    })
    return () => {
      stopDisposed()
      stopCreated()
    }
  }, 'aera-gateway-readiness: native Session bootstrap')
}
