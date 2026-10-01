/**
 * The Worker host's local-effect session core (D-0c,
 * WO-AERA-CODE-CLAUDE-CODE-GOVERNED-WORKER-INTEGRATION-001): the CIS Worker
 * Epoch (begin / continue through the Router relay), the AGENT session token
 * (main-process memory only), and the pinned Router transport.
 *
 * Transport. Every route goes over `createPinnedRouterTransport` with the
 * route as its `routes` override (C-2: the relay client refuses the attest
 * path, and it hides the channel). That is the same pinned post (CA trust,
 * URI-SAN pin, TLS 1.3, no proxy, channel-binding echo, clock skew), and in
 * addition this module re-checks the CA fingerprint at composition and the
 * returned channel identity on EVERY answer (review §1.1 / m-7).
 *
 * Epoch lifecycle (C-7: two operator DP-9 writes per delegation window; CD-4:
 * one Epoch per window; C-1: the id changes only on begin):
 *
 *   NO_EPOCH ──begin (explicit only)──▶ BEGUN_AWAITING_BINDING ──continue/attest 200──▶ READY
 *      │  challenge refused AGENT_NOT_BOUND                 ▲  (registry still pending:   │
 *      ▼                                                    │   probes stay allowed, M-1) │ registry no longer
 *   AWAITING_PENDING_BINDING ──begin (explicit)─────────────┘                             ▼ names this Epoch
 *   EPOCH_RETIRED (CIS: NOT_ACTIVE / NOT_FOUND) ◀──continue── any          BINDING_NOT_CURRENT (probes; never re-begins)
 *
 * NO_EPOCH, AWAITING_PENDING_BINDING and EPOCH_RETIRED fail fast with no
 * network call; begin happens only through `beginEpoch()` (the owner's
 * BEGIN_AGENT_EPOCH action) and is refused while a non-retired Epoch is known
 * — including one recovered from the public hand-over after user-data loss —
 * so nothing ever silently supersedes a live Epoch. Transient refusals are
 * `lastRefusal`, never a state: the next call probes again.
 *
 * Nothing here logs, throws or returns a token, proof, signature or key:
 * errors carry a typed code only.
 */
import { randomBytes } from 'node:crypto'
import { chmodSync, closeSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { isAeraWorkerEpochId, type AgentCredentialProofPayload, type AeraPrincipalId, type AeraWorkerEpochId } from '@aera/cis-contracts'
import { caFingerprintSha256, createPinnedRouterTransport, RouterTransportError } from '@aera/effect-broker'
import { publishPublicHandOverFile, type WorkerInstallationKeyCustody } from './aera-worker-installation-key.ts'
import type { WorkerLocalEffectConfig, WorkerLocalEffectConfigResult } from './aera-worker-le-config.ts'

export const WORKER_EPOCH_PUBLIC_FILENAME = 'worker-epoch.public.json'
export const WORKER_EPOCH_STATE_FILENAME = 'aera-claude-worker-epoch.json'
/** The Router relay of the CIS Epoch routes (`localEffectAgentRelay.ts` LOCAL_EFFECT_AGENT_RELAY_ROUTES). */
export const WORKER_LE_RELAY_ROUTES = Object.freeze({
  challenge: '/v1/local-effects/agents/challenges',
  begin: '/v1/local-effects/agents/epochs',
  continue: '/v1/local-effects/agents/epochs/continue',
})
/** Renew the AGENT session when less than this remains (plan §4.3). */
export const WORKER_SESSION_RENEW_MARGIN_MS = 120_000

export type WorkerLocalEffectState =
  | 'NOT_CONFIGURED' | 'NOT_ENROLLED' | 'KEY_ID_MISMATCH'
  | 'NO_EPOCH' | 'AWAITING_PENDING_BINDING' | 'BEGUN_AWAITING_BINDING' | 'READY' | 'BINDING_NOT_CURRENT' | 'EPOCH_RETIRED'

/** Public projection only (ids, codes, expiry) — safe for logs and the renderer. */
export interface WorkerLocalEffectStatus {
  readonly state: WorkerLocalEffectState
  readonly reason?: string
  readonly lastRefusal?: string
  readonly agentPrincipalId?: string
  readonly aeraSessionId?: string
  readonly connectionId?: string
  readonly workerEpochId?: string
  readonly sessionExpiresAt?: string
  readonly publicEpochPath?: string
}

export class WorkerLocalEffectError extends Error {
  constructor(readonly code: string) {
    super(`Worker local-effect session: ${code}`)
    this.name = 'WorkerLocalEffectError'
  }
}

export type WorkerLocalEffectCustodyPort = Pick<WorkerInstallationKeyCustody, 'view' | 'assertInstallationKeyId' | 'senderProof' | 'signAgentCredentialProof'>

export interface WorkerLocalEffectSessionOptions {
  readonly config: WorkerLocalEffectConfigResult
  readonly custody: WorkerLocalEffectCustodyPort
  /** The Profile's private app-data dir: the 0600 Epoch state file (ids only). */
  readonly stateDir: string
  /** The custody scope's ONE public hand-over location (M-6). */
  readonly handOverDir: string
  readonly log?: (line: string) => void
  readonly clock?: () => number
  readonly sleep?: (ms: number) => Promise<void>
  readonly timeoutMs?: number
}

export interface WorkerLocalEffectSession {
  readonly aeraSessionId: string | undefined
  readonly connectionId: string | undefined
  /** The current CIS Worker Epoch. Changes ONLY on begin (C-1). */
  workerEpochId(): string | undefined
  onEpochChanged(listener: () => void): () => void
  status(): WorkerLocalEffectStatus
  /** The owner's explicit BEGIN_AGENT_EPOCH (CD-4): refused while a non-retired Epoch is known. */
  beginEpoch(): Promise<{ readonly workerEpochId: string, readonly publicEpochPath?: string }>
  /** Hold a session with ≥ 120 s left, continuing the known Epoch if needed. Never begins. */
  ensureSession(): Promise<WorkerLocalEffectStatus>
}

interface EpochRecord { readonly workerEpochId: AeraWorkerEpochId, readonly agentPrincipalId: string, readonly aeraSessionId: string, readonly beganAt: string, readonly bindingConfirmedAt?: string }
interface AgentSession { readonly token: string, readonly sessionId: string, readonly expiresAtMs: number }

const CODE = /^[A-Z0-9_]{1,80}$/u
const typedCode = (value: unknown): string => typeof value === 'string' && CODE.test(value) ? value : 'UNTYPED'
const FAIL_FAST: ReadonlySet<WorkerLocalEffectState> = new Set(['NOT_CONFIGURED', 'NOT_ENROLLED', 'KEY_ID_MISMATCH', 'NO_EPOCH', 'AWAITING_PENDING_BINDING', 'EPOCH_RETIRED'])
const EPOCH_KEYS = 'aeraSessionId,agentPrincipalId,beganAt,workerEpochId'

function readEpochFile(path: string, config: WorkerLocalEffectConfig, allowConfirmed: boolean): EpochRecord | undefined {
  try {
    if (!lstatSync(path).isFile()) return undefined
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    const { version, bindingConfirmedAt, ...rest } = parsed
    if (allowConfirmed ? version !== 1 : version !== undefined) return undefined
    if (Object.keys(rest).sort().join(',') !== EPOCH_KEYS) return undefined
    if (!isAeraWorkerEpochId(rest.workerEpochId) || rest.agentPrincipalId !== config.agentPrincipalId || rest.aeraSessionId !== config.aeraSessionId) return undefined
    if (typeof rest.beganAt !== 'string' || !Number.isFinite(Date.parse(rest.beganAt))) return undefined
    if (bindingConfirmedAt !== undefined && (!allowConfirmed || typeof bindingConfirmedAt !== 'string')) return undefined
    return { workerEpochId: rest.workerEpochId, agentPrincipalId: rest.agentPrincipalId, aeraSessionId: rest.aeraSessionId, beganAt: rest.beganAt, ...(typeof bindingConfirmedAt === 'string' ? { bindingConfirmedAt } : {}) }
  } catch {
    return undefined
  }
}

function writePrivate(dir: string, filename: string, content: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const temp = join(dir, `.${filename}.${randomBytes(6).toString('hex')}.tmp`)
  const fd = openSync(temp, 'wx', 0o600)
  try {
    writeSync(fd, content)
  } finally {
    closeSync(fd)
  }
  chmodSync(temp, 0o600)
  renameSync(temp, join(dir, filename))
}

export function createWorkerLocalEffectSession(options: WorkerLocalEffectSessionOptions): WorkerLocalEffectSession {
  const log = options.log ?? (() => {})
  const clock = options.clock ?? (() => Date.now())
  const custody = options.custody
  const listeners = new Set<() => void>()

  let configRefusal: string | undefined = options.config.status === 'loaded' ? undefined : options.config.reason
  const config = options.config.status === 'loaded' ? options.config.config : undefined
  if (config !== undefined) {
    try {
      if (caFingerprintSha256(config.caPem) !== config.caFingerprintSha256) configRefusal = 'LE_CA_PIN_MISMATCH'
    } catch {
      configRefusal = 'LE_CA_PIN_MISMATCH'
    }
  }

  // Only the routes this module sends; each its own pinned transport (only requestRelease is ever used).
  const posts = new Map<string, (body: Record<string, unknown>) => Promise<{ channel: { tlsAuthorized: boolean, caFingerprintSha256: string, uriSans: readonly string[] }, status: number, body: unknown }>>()
  if (config !== undefined && configRefusal === undefined) {
    for (const route of Object.values(WORKER_LE_RELAY_ROUTES)) {
      const transport = createPinnedRouterTransport({
        url: config.routerUrl,
        caPem: config.caPem,
        pinned: { caFingerprintSha256: config.caFingerprintSha256, routerUriSan: config.routerUriSan },
        routes: { attempt: route, outcome: route },
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      })
      posts.set(route, transport.requestRelease)
    }
  }

  const statePath = join(options.stateDir, WORKER_EPOCH_STATE_FILENAME)
  const publicPath = join(options.handOverDir, WORKER_EPOCH_PUBLIC_FILENAME)
  let epoch: EpochRecord | undefined = config === undefined ? undefined : (readEpochFile(statePath, config, true) ?? readEpochFile(publicPath, config, false))
  let lifecycle: WorkerLocalEffectState = epoch === undefined ? 'NO_EPOCH' : epoch.bindingConfirmedAt === undefined ? 'BEGUN_AWAITING_BINDING' : 'READY'
  let session: AgentSession | undefined
  let lastRefusal: string | undefined
  let publishedPath: string | undefined
  let inFlight: Promise<unknown> | undefined

  const precondition = (): { state: WorkerLocalEffectState, reason?: string } | undefined => {
    if (config === undefined || configRefusal !== undefined) return { state: 'NOT_CONFIGURED', reason: configRefusal ?? 'CONFIG_MISSING' }
    if (custody.view().status !== 'ENROLLED') return { state: 'NOT_ENROLLED' }
    try {
      custody.assertInstallationKeyId(config.installationKeyId)
    } catch (cause) {
      return (cause as { code?: unknown }).code === 'NOT_ENROLLED' ? { state: 'NOT_ENROLLED' } : { state: 'KEY_ID_MISMATCH' }
    }
    return undefined
  }

  const status = (): WorkerLocalEffectStatus => {
    const pre = precondition()
    return Object.freeze({
      state: pre?.state ?? lifecycle,
      ...(pre?.reason === undefined ? {} : { reason: pre.reason }),
      ...(lastRefusal === undefined ? {} : { lastRefusal }),
      ...(config === undefined ? {} : { agentPrincipalId: config.agentPrincipalId, aeraSessionId: config.aeraSessionId, connectionId: config.connectionId }),
      ...(epoch === undefined ? {} : { workerEpochId: epoch.workerEpochId }),
      ...(session === undefined ? {} : { sessionExpiresAt: new Date(session.expiresAtMs).toISOString() }),
      ...(publishedPath === undefined ? {} : { publicEpochPath: publishedPath }),
    })
  }

  const refuse = (code: string, transient = false): never => {
    if (transient) lastRefusal = code
    log(`aera-worker-le-session: REFUSED ${code} state=${lifecycle}`)
    throw new WorkerLocalEffectError(code)
  }

  /** One pinned post; the channel identity is checked on every answer (never trusted from the transport alone). */
  const send = async (route: string, body: Record<string, unknown>): Promise<{ status: number, body: Record<string, unknown> }> => {
    const post = posts.get(route)
    if (post === undefined || config === undefined) return refuse('ROUTE_NOT_ALLOWED')
    let answer
    try {
      answer = await post(body)
    } catch (cause) {
      return refuse(cause instanceof RouterTransportError ? cause.code : 'ROUTER_UNAVAILABLE', true)
    }
    const channel = answer.channel
    if (channel.tlsAuthorized !== true || channel.caFingerprintSha256 !== config.caFingerprintSha256
      || channel.uriSans.length !== 1 || channel.uriSans[0] !== config.routerUriSan) {
      return refuse('CHANNEL_IDENTITY_MISMATCH', true)
    }
    const parsed = answer.body !== null && typeof answer.body === 'object' && !Array.isArray(answer.body) ? answer.body as Record<string, unknown> : {}
    return { status: answer.status, body: parsed }
  }

  const persist = (record: EpochRecord): void => {
    writePrivate(options.stateDir, WORKER_EPOCH_STATE_FILENAME, `${JSON.stringify({ version: 1, ...record })}\n`)
  }

  /** challenge → installation-key signature (inside custody) → begin | continue, all through the relay. */
  const epochCall = async (kind: 'begin' | 'continue'): Promise<void> => {
    const c = config!
    const challenge = await send(WORKER_LE_RELAY_ROUTES.challenge, { aeraSessionId: c.aeraSessionId, principalId: c.agentPrincipalId })
    if (challenge.status !== 200) relayRefusal(kind, challenge)
    const { challengeId, nonce, audience } = challenge.body
    if (typeof challengeId !== 'string' || typeof nonce !== 'string') return refuse('CIS_ANSWER_MALFORMED', true)
    if (audience !== undefined && audience !== c.cisIssuer) return refuse('CIS_AUDIENCE_MISMATCH', true)
    const continuing = kind === 'continue'
    const payload: AgentCredentialProofPayload = {
      purpose: continuing ? 'aera.cis.agent.epoch.continue.v1' : 'aera.cis.agent.epoch.begin.v1',
      audience: c.cisIssuer,
      principalId: c.agentPrincipalId as AeraPrincipalId,
      installationKeyId: c.installationKeyId,
      challengeId,
      nonce,
      ...(continuing ? { workerEpochId: epoch!.workerEpochId } : {}),
    }
    const answer = await send(continuing ? WORKER_LE_RELAY_ROUTES.continue : WORKER_LE_RELAY_ROUTES.begin, {
      aeraSessionId: c.aeraSessionId,
      principalId: c.agentPrincipalId,
      installationKeyId: c.installationKeyId,
      challengeId,
      signature: custody.signAgentCredentialProof(payload),
      ...(continuing ? { workerEpochId: epoch!.workerEpochId } : {}),
    })
    if (answer.status !== 200) relayRefusal(kind, answer)
    const workerEpoch = answer.body.workerEpoch as { workerEpochId?: unknown } | undefined
    const minted = answer.body.session as { token?: unknown, sessionId?: unknown, expiresAt?: unknown } | undefined
    const expiresAtMs = typeof minted?.expiresAt === 'string' ? Date.parse(minted.expiresAt) : Number.NaN
    if (!isAeraWorkerEpochId(workerEpoch?.workerEpochId) || typeof minted?.token !== 'string' || minted.token === ''
      || typeof minted.sessionId !== 'string' || !Number.isFinite(expiresAtMs)) {
      return refuse('CIS_ANSWER_MALFORMED', true)
    }
    if (continuing && workerEpoch.workerEpochId !== epoch!.workerEpochId) return refuse('EPOCH_CHANGED_ON_CONTINUE', true)
    session = { token: minted.token, sessionId: minted.sessionId, expiresAtMs }
    lastRefusal = undefined
    if (continuing) {
      // The relay admits continue only when the registry names THIS Epoch: the Epoch write has landed.
      bindingConfirmed()
      return
    }
    epoch = { workerEpochId: workerEpoch.workerEpochId, agentPrincipalId: c.agentPrincipalId, aeraSessionId: c.aeraSessionId, beganAt: new Date(clock()).toISOString() }
    lifecycle = 'BEGUN_AWAITING_BINDING'
    persist(epoch)
    try {
      const { bindingConfirmedAt: _private, ...publicRecord } = epoch
      publishedPath = publishPublicHandOverFile(options.handOverDir, WORKER_EPOCH_PUBLIC_FILENAME, `${JSON.stringify(publicRecord)}\n`)
    } catch {
      publishedPath = undefined
      lastRefusal = 'PUBLIC_EPOCH_HANDOVER_FAILED'
    }
    log(`aera-worker-le-session: BEGUN workerEpochId=${epoch.workerEpochId}`)
    for (const listener of listeners) listener()
  }

  /** `{refusal}` from the relay / CIS, mapped to the lifecycle (review m-2). Always throws. */
  const relayRefusal = (kind: 'begin' | 'continue', answer: { status: number, body: Record<string, unknown> }): never => {
    const code = typedCode(answer.body.refusal ?? answer.body.error)
    if (code === 'AGENT_NOT_BOUND_TO_SESSION') {
      if (kind === 'begin') lifecycle = 'AWAITING_PENDING_BINDING'
      else if (epoch?.bindingConfirmedAt !== undefined) lifecycle = 'BINDING_NOT_CURRENT'
      else lifecycle = 'BEGUN_AWAITING_BINDING'
      session = undefined
      return refuse(code)
    }
    if (kind === 'continue' && (code === 'EPOCH_NOT_ACTIVE' || code === 'EPOCH_NOT_FOUND' || code === 'EPOCH_PRINCIPAL_MISMATCH')) {
      lifecycle = 'EPOCH_RETIRED'
      session = undefined
      return refuse(code)
    }
    return refuse(code === 'UNTYPED' ? `RELAY_REFUSED_${String(answer.status)}` : code, true)
  }

  const bindingConfirmed = (): void => {
    if (epoch !== undefined && epoch.bindingConfirmedAt === undefined) {
      epoch = { ...epoch, bindingConfirmedAt: new Date(clock()).toISOString() }
      persist(epoch)
    }
    lifecycle = 'READY'
    lastRefusal = undefined
  }

  /** Serialise Epoch calls: never two challenges in flight. */
  const exclusive = async <T>(run: () => Promise<T>): Promise<T> => {
    while (inFlight !== undefined) await inFlight.catch(() => undefined)
    const promise = run()
    inFlight = promise
    try {
      return await promise
    } finally {
      inFlight = undefined
    }
  }

  const gate = (): void => {
    const pre = precondition()
    if (pre !== undefined) refuse(pre.state)
    if (FAIL_FAST.has(lifecycle)) refuse(lifecycle)
  }

  const ensureSession = async (): Promise<WorkerLocalEffectStatus> => {
    gate()
    await exclusive(async () => {
      if (session !== undefined && session.expiresAtMs - clock() >= WORKER_SESSION_RENEW_MARGIN_MS) return
      session = undefined
      await epochCall('continue')
    })
    return status()
  }

  return {
    aeraSessionId: config?.aeraSessionId,
    connectionId: config?.connectionId,
    workerEpochId: () => epoch?.workerEpochId,
    onEpochChanged(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    status,
    async beginEpoch() {
      const pre = precondition()
      if (pre !== undefined) refuse(pre.state)
      return await exclusive(async () => {
        if (lifecycle !== 'NO_EPOCH' && lifecycle !== 'AWAITING_PENDING_BINDING' && lifecycle !== 'EPOCH_RETIRED') refuse('EPOCH_ALREADY_BEGUN')
        session = undefined
        await epochCall('begin')
        return Object.freeze({ workerEpochId: epoch!.workerEpochId, ...(publishedPath === undefined ? {} : { publicEpochPath: publishedPath }) })
      })
    },
    ensureSession,
  }
}
