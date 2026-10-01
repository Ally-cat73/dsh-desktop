/**
 * The model-invocation attest heartbeat (U8 D-1,
 * WO-AERA-CODE-CLAUDE-CODE-GOVERNED-WORKER-INTEGRATION-001; V2 §8.2, V2.1 §5
 * U8, plan §4.4 with corrections C-1…C-6).
 *
 * The Worker host proves to the Router, before and while a model turn may
 * run, that the governed Connection is driven by the current CIS Worker
 * Epoch. The Router answers `200 {status:'ATTESTED', casReceiptId, notAfter}`
 * after its own Connection, binding, Epoch, delegation and CAS checks, and it
 * accepts an `issuedAt` only within ±60 s of its clock (U5 n-3).
 *
 * Boundary with D-0c (`WorkerLocalEffectSession.postSigned`):
 *   - this module builds the BODY only (schema, ids, issuedAt, nonce) and
 *     never sees the AGENT token, the sender proof or the key;
 *   - the builder is called once per D-0c attempt, so every attempt carries a
 *     fresh nonce and issuedAt;
 *   - D-0c owns every retry (409 re-nonce, restart horizon, session renewal).
 *     This module calls `postSigned` exactly once per attempt and never
 *     retries a 409 itself.
 *
 * Heartbeat: one attest every 60 s, ONLY while a turn may start (a running
 * worker Epoch, or turn activity within the last 120 s). Idle means dormant:
 * nothing is sent. A refusal (403 and other deterministic 4xx) or a fail-fast
 * D-0c state (retired / no Epoch / not configured) halts it; transient
 * unavailability backs off 5 s → 60 s. A CIS Epoch change (begin only, C-1)
 * stops the old heartbeat and voids its receipt; the new Epoch is attested at
 * once only if a turn may start. `ensureFresh` (the D-2 gate) always makes one
 * fresh attempt when it holds no fresh receipt, so a refusal recovers without
 * a restart (C-5) and nothing runs unless that attempt succeeds.
 *
 * Logs and status carry ids and codes only — never a body, nonce or token.
 */
import { randomBytes } from 'node:crypto'
import { MODEL_INVOCATION_ATTEST_ROUTE, MODEL_INVOCATION_ATTESTATION_SCHEMA } from '@aera/local-effect-admission'
import { isGatewayConnectionId } from '@aera/local-effect-authority'
import { WorkerLocalEffectError, type WorkerLocalEffectSession } from './aera-worker-le-session.ts'

/** Re-attest cadence while a turn may start (a constant, not env). */
export const MODEL_ATTEST_HEARTBEAT_MS = 60_000
/** A receipt older than this never satisfies the gate: the Router's ±60 s issuedAt window. */
export const MODEL_ATTEST_FRESH_MS = 60_000
/** "A turn may start" also covers this long after the last turn activity. */
export const MODEL_ATTEST_ACTIVITY_WINDOW_MS = 120_000
export const MODEL_ATTEST_BACKOFF_INITIAL_MS = 5_000
export const MODEL_ATTEST_BACKOFF_CAP_MS = 60_000

export type ModelAttestState = 'NOT_ATTESTED' | 'ATTESTED' | 'MODEL_AUTHORITY_REFUSED' | 'MODEL_AUTHORITY_UNAVAILABLE'
export type ModelAttestHeartbeat = 'RUNNING' | 'DORMANT' | 'HALTED'

/** Public projection (ids, codes, times) — safe for logs and the renderer. */
export interface ModelAttestStatus {
  readonly state: ModelAttestState
  readonly code?: string
  readonly heartbeat: ModelAttestHeartbeat
  readonly workerEpochId?: string
  readonly casReceiptId?: string
  readonly notAfter?: string
  readonly attestedAt?: string
}

export type ModelAttestResult =
  | { readonly ok: true, readonly workerEpochId: string, readonly casReceiptId: string, readonly notAfter: string, readonly attestedAtMs: number }
  | { readonly ok: false, readonly state: 'MODEL_AUTHORITY_REFUSED' | 'MODEL_AUTHORITY_UNAVAILABLE', readonly code: string }

export type ModelAttestSessionPort = Pick<WorkerLocalEffectSession, 'aeraSessionId' | 'connectionId' | 'workerEpochId' | 'onEpochChanged' | 'postSigned'>

export interface ModelInvocationAttestor {
  /** The D-2 gate: a receipt for the current Epoch younger than min(maxAgeMs, 60 s), else one fresh attempt. */
  ensureFresh(maxAgeMs?: number): Promise<ModelAttestResult>
  /** One attempt now (coalesced with any attempt in flight). */
  attestNow(): Promise<ModelAttestResult>
  /** Turn start / end (keeps the heartbeat alive for 120 s). */
  noteTurnActivity(): void
  /** A worker Epoch is running, so a turn may start at any moment. */
  setTurnPossible(possible: boolean): void
  /** Worker Epoch end: the heartbeat stops (the gate still attests on demand). */
  stop(): void
  /** Host shutdown: stop and unsubscribe from Epoch changes. */
  dispose(): void
  status(): ModelAttestStatus
}

export interface ModelAttestorOptions {
  readonly session: ModelAttestSessionPort
  readonly log?: (line: string) => void
}

const CODE = /^[A-Z0-9_]{1,80}$/u
const typed = (value: unknown): string | undefined => typeof value === 'string' && CODE.test(value) ? value : undefined
/** D-0c fail-fast states: polling them cannot succeed until the owner or operator acts. */
const HALTING_THROWS: ReadonlySet<string> = new Set(['NOT_CONFIGURED', 'NOT_ENROLLED', 'KEY_ID_MISMATCH', 'NO_EPOCH', 'AWAITING_PENDING_BINDING', 'EPOCH_RETIRED', 'ROUTE_NOT_ALLOWED', 'BODY_CARRIES_CREDENTIALS'])
/** Non-200 statuses that are transient (back off) rather than a refusal (halt). */
const TRANSIENT_STATUS = (status: number): boolean => status === 408 || status === 409 || status === 429 || status >= 500 || status < 400

type Outcome = { result: ModelAttestResult, halt: boolean }

export function createModelInvocationAttestor(options: ModelAttestorOptions): ModelInvocationAttestor {
  const { session } = options
  const log = options.log ?? (() => {})
  let last: ModelAttestResult | undefined
  let state: ModelAttestState = 'NOT_ATTESTED'
  let code: string | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let halted = false
  let failures = 0
  let turnPossible = false
  let lastActivityMs = Number.NEGATIVE_INFINITY
  let inFlight: Promise<ModelAttestResult> | undefined
  /** Bumped on Epoch change / stop so a late answer cannot re-arm a stopped heartbeat. */
  let generation = 0

  const mayStart = (): boolean => turnPossible || Date.now() - lastActivityMs < MODEL_ATTEST_ACTIVITY_WINDOW_MS
  const clear = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  const arm = (delayMs: number): void => {
    clear()
    if (halted || !mayStart()) return
    timer = setTimeout(() => {
      timer = undefined
      if (!halted && mayStart()) void attestNow()
    }, Math.max(0, delayMs))
  }
  const backoff = (): number => Math.min(MODEL_ATTEST_BACKOFF_INITIAL_MS * 2 ** Math.max(0, failures - 1), MODEL_ATTEST_BACKOFF_CAP_MS)

  const build = (): Readonly<Record<string, unknown>> => ({
    schema: MODEL_INVOCATION_ATTESTATION_SCHEMA,
    aeraSessionId: session.aeraSessionId,
    workerEpochId: session.workerEpochId(),
    connectionId: session.connectionId,
    // Never truncated: the Router requires an exact toISOString() round trip (U5 D-4).
    issuedAt: new Date().toISOString(),
    nonce: randomBytes(32).toString('base64url'),
  })

  const interpret = (answer: { status: number, body: Record<string, unknown> }, epochId: string | undefined): Outcome => {
    const body = answer.body
    if (answer.status === 200) {
      const notAfterMs = typeof body.notAfter === 'string' ? Date.parse(body.notAfter) : Number.NaN
      if (body.status !== 'ATTESTED' || typeof body.casReceiptId !== 'string' || body.casReceiptId === '' || !Number.isFinite(notAfterMs) || epochId === undefined) {
        return { result: { ok: false, state: 'MODEL_AUTHORITY_UNAVAILABLE', code: 'MALFORMED_ATTEST_ANSWER' }, halt: false }
      }
      if (notAfterMs <= Date.now()) return { result: { ok: false, state: 'MODEL_AUTHORITY_UNAVAILABLE', code: 'ATTEST_RECEIPT_EXPIRED' }, halt: false }
      return { result: { ok: true, workerEpochId: epochId, casReceiptId: body.casReceiptId, notAfter: new Date(notAfterMs).toISOString(), attestedAtMs: Date.now() }, halt: false }
    }
    const refusal = typed(body.error) ?? typed(body.reason)
    if (TRANSIENT_STATUS(answer.status)) {
      return { result: { ok: false, state: 'MODEL_AUTHORITY_UNAVAILABLE', code: refusal ?? `HTTP_${String(answer.status)}` }, halt: false }
    }
    return { result: { ok: false, state: 'MODEL_AUTHORITY_REFUSED', code: refusal ?? 'UNTYPED' }, halt: true }
  }

  const attempt = async (): Promise<ModelAttestResult> => {
    const mine = generation
    let outcome: Outcome
    if (typeof session.aeraSessionId !== 'string' || session.aeraSessionId === '') {
      outcome = { result: { ok: false, state: 'MODEL_AUTHORITY_UNAVAILABLE', code: 'AERA_SESSION_ID_MISSING' }, halt: true }
    } else if (!isGatewayConnectionId(session.connectionId)) {
      outcome = { result: { ok: false, state: 'MODEL_AUTHORITY_UNAVAILABLE', code: 'CONNECTION_ID_INVALID' }, halt: true }
    } else {
      const epochId = session.workerEpochId()
      try {
        // Exactly one D-0c call per attempt: D-0c owns the 409 / horizon / session retries.
        outcome = interpret(await session.postSigned(MODEL_INVOCATION_ATTEST_ROUTE, build), epochId)
      } catch (cause) {
        const thrown = cause instanceof WorkerLocalEffectError ? typed(cause.code) ?? 'UNTYPED' : 'TRANSPORT_ERROR'
        outcome = { result: { ok: false, state: 'MODEL_AUTHORITY_UNAVAILABLE', code: thrown }, halt: HALTING_THROWS.has(thrown) }
      }
      // The Epoch moved while the answer was in flight: it proves nothing about the current one.
      if (outcome.result.ok && outcome.result.workerEpochId !== session.workerEpochId()) {
        outcome = { result: { ok: false, state: 'MODEL_AUTHORITY_UNAVAILABLE', code: 'EPOCH_CHANGED' }, halt: false }
      }
    }
    const { result } = outcome
    if (mine !== generation) return result
    if (result.ok) {
      last = result
      state = 'ATTESTED'
      code = undefined
      failures = 0
      halted = false
      log(`aera-worker-model-attest: ATTESTED epoch=${result.workerEpochId} receipt=${result.casReceiptId}`)
      arm(MODEL_ATTEST_HEARTBEAT_MS)
    } else {
      // Any failure voids the held receipt: fail closed.
      last = undefined
      state = result.state
      code = result.code
      log(`aera-worker-model-attest: ${result.state} code=${result.code}`)
      if (outcome.halt) {
        halted = true
        clear()
      } else {
        failures += 1
        arm(backoff())
      }
    }
    return result
  }

  const attestNow = (): Promise<ModelAttestResult> => {
    inFlight ??= attempt().finally(() => { inFlight = undefined })
    return inFlight
  }

  const isFresh = (maxAgeMs: number): boolean => {
    if (last === undefined || !last.ok) return false
    const now = Date.now()
    return last.workerEpochId === session.workerEpochId()
      && now - last.attestedAtMs < Math.min(maxAgeMs, MODEL_ATTEST_FRESH_MS)
      && Date.parse(last.notAfter) > now
  }

  const wake = (): void => {
    if (timer !== undefined || halted || inFlight !== undefined || !mayStart()) return
    if (last !== undefined && last.ok) arm(last.attestedAtMs + MODEL_ATTEST_HEARTBEAT_MS - Date.now())
    else if (state === 'MODEL_AUTHORITY_UNAVAILABLE') arm(backoff())
  }

  const unsubscribe = session.onEpochChanged(() => {
    generation += 1
    clear()
    last = undefined
    state = 'NOT_ATTESTED'
    code = 'EPOCH_CHANGED'
    halted = false
    failures = 0
    log('aera-worker-model-attest: EPOCH_CHANGED')
    if (mayStart()) void attestNow()
  })

  return {
    async ensureFresh(maxAgeMs = MODEL_ATTEST_FRESH_MS) {
      if (isFresh(maxAgeMs) && last !== undefined) return last
      return await attestNow()
    },
    attestNow,
    noteTurnActivity() {
      lastActivityMs = Date.now()
      wake()
    },
    setTurnPossible(possible) {
      turnPossible = possible
      if (possible) wake()
    },
    stop() {
      generation += 1
      turnPossible = false
      lastActivityMs = Number.NEGATIVE_INFINITY
      clear()
    },
    dispose() {
      this.stop()
      unsubscribe()
    },
    status() {
      const heartbeat: ModelAttestHeartbeat = halted ? 'HALTED' : timer !== undefined || inFlight !== undefined ? 'RUNNING' : 'DORMANT'
      return Object.freeze({
        state,
        ...(code === undefined ? {} : { code }),
        heartbeat,
        ...(last !== undefined && last.ok
          ? { workerEpochId: last.workerEpochId, casReceiptId: last.casReceiptId, notAfter: last.notAfter, attestedAt: new Date(last.attestedAtMs).toISOString() }
          : {}),
      })
    },
  }
}
