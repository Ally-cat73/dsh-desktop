/**
 * U8 (D-1…D-4) — the model-invocation attest heartbeat and the turn gate —
 * WO-AERA-CODE-CLAUDE-CODE-GOVERNED-WORKER-INTEGRATION-001.
 *
 * D-1 `ModelInvocationAttestor` (fake timers over a fake D-0c session port):
 * the exact attestation body, a fresh builder per attempt (D-0c owns the 409
 * re-nonce, so U8 calls `postSigned` exactly ONCE per attempt), the 60 s
 * heartbeat only while a turn may start, 403 → typed refusal and the
 * heartbeat halts, 503 / throw → typed unavailability with 5 s → 60 s
 * back-off, a retired Epoch halts, an Epoch change stops the old heartbeat.
 * D-2 the gate before the CLI spawn and before every turn (no spawn, no turn
 * unless fresh). D-3 composition: the governed Connection id grammar, no
 * fallback. Plus the real D-0c session against the D-0c fake Router (the
 * builder's body is accepted; 409 handled inside D-0c; M-1 recovery).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { issueAeraPrincipalId } from '@aera/cis-contracts'
import { caFingerprintSha256 } from '@aera/effect-broker'
import {
  isModelInvocationAttestation,
  MODEL_INVOCATION_ATTEST_ROUTE,
  MODEL_INVOCATION_ATTESTATION_KEYS,
  MODEL_INVOCATION_ATTESTATION_SCHEMA,
  modelInvocationEffectDigest,
} from '@aera/local-effect-admission'
import {
  CIS_ISSUER, ROUTER_SAN, generatePki, operatorWriteEpoch, operatorWritePending, startFakeRouter, testCustody, testEffectCatalogEnv,
  type FakeRouter, type Pki, type TestCustody,
} from './aera-worker-le-fixtures.ts'
import { makeFakeClaude, makeWorkerWorld } from './aera-worker-fixtures.ts'
import type { WorkerAdapter, WorkerEpochHandle, WorkerEpochTerminal } from '../src/aera-worker-adapter.ts'

const {
  createModelInvocationAttestor,
  MODEL_ATTEST_HEARTBEAT_MS,
  MODEL_ATTEST_FRESH_MS,
  MODEL_ATTEST_ACTIVITY_WINDOW_MS,
  MODEL_ATTEST_BACKOFF_INITIAL_MS,
  MODEL_ATTEST_BACKOFF_CAP_MS,
} = await import('../src/aera-worker-model-attest.ts')
const { WorkerLocalEffectError, createWorkerLocalEffectSession } = await import('../src/aera-worker-le-session.ts')
const { AERA_CLAUDE_WORKER_CONFIG_FILENAME, loadWorkerLocalEffectConfig } = await import('../src/aera-worker-le-config.ts')
const { AeraWorkerSessionManager } = await import('../src/aera-worker-session.ts')
const { LocalExecutionPolicyGate } = await import('../src/aera-worker-effect-broker.ts')
const { composeAeraWorker, aeraWorkerStatus, performAeraWorkerAction } = await import('../src/aera-worker-composition.ts')
const { parseWorkerStatus } = await import('../src/client/aera-worker-api.ts')
const { AeraWorkerStatus } = await import('../src/client/AeraWorkerStatus.tsx')
const { en } = await import('../src/client/aera-collab-locales.ts')

const SESSION = 'aera:session:w2-execution-u8'
const CONNECTION = 'claude-worker-u8'
const EPOCH_A = 'aera:worker_epoch:u8-a'
const EPOCH_B = 'aera:worker_epoch:u8-b'
const T0 = Date.parse('2026-10-01T03:04:05.678Z')

/* ------------------------------------------------------------ fake D-0c port */

type Reply = { status: number, body: Record<string, unknown> } | Error
interface FakePort {
  readonly aeraSessionId: string | undefined
  readonly connectionId: string | undefined
  workerEpochId(): string | undefined
  onEpochChanged(listener: () => void): () => void
  postSigned(route: string, build: () => Readonly<Record<string, unknown>>): Promise<{ status: number, body: Record<string, unknown> }>
  /** U8 → D-0c calls (one per U8 attempt). */
  readonly posts: { route: string, at: number, bodies: Record<string, unknown>[] }[]
  replies: Reply[]
  /** Simulate D-0c's own internal 409 re-nonce: build twice inside ONE postSigned. */
  internalRebuild: boolean
  setEpoch(id: string | undefined): void
  listenerCount(): number
}

const ok = (): Reply => ({ status: 200, body: { status: 'ATTESTED', casReceiptId: `cas-receipt-${String(Date.now())}`, notAfter: new Date(Date.now() + 120_000).toISOString() } })

function fakePort(options: { connectionId?: string | undefined, aeraSessionId?: string | undefined, defaultReply?: () => Reply } = {}): FakePort {
  let epoch: string | undefined = EPOCH_A
  const listeners = new Set<() => void>()
  const port: FakePort = {
    aeraSessionId: 'aeraSessionId' in options ? options.aeraSessionId : SESSION,
    connectionId: 'connectionId' in options ? options.connectionId : CONNECTION,
    workerEpochId: () => epoch,
    onEpochChanged(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    posts: [],
    replies: [],
    internalRebuild: false,
    async postSigned(route, build) {
      const entry = { route, at: Date.now(), bodies: [] as Record<string, unknown>[] }
      port.posts.push(entry)
      entry.bodies.push({ ...build() })
      if (port.internalRebuild) {
        vi.advanceTimersByTime(1)
        entry.bodies.push({ ...build() })
      }
      const reply = port.replies.shift() ?? (options.defaultReply ?? ok)()
      if (reply instanceof Error) throw reply
      return reply
    },
    setEpoch(id) { epoch = id; for (const listener of [...listeners]) listener() },
    listenerCount: () => listeners.size,
  }
  return port
}

const logs: string[] = []
function attestor(port: FakePort) {
  return createModelInvocationAttestor({ session: port as never, log: (line: string) => { logs.push(line) } })
}

describe('U8 D-1: the attestation body (V2.1 §5 U8, C-6, U1 D-6)', () => {
  afterEach(() => { vi.useRealTimers() })

  it('sends exactly the six attestation fields to the attest route, issuedAt with milliseconds, a 43-char nonce, no credentials', async () => {
    vi.useFakeTimers({ now: T0 })
    const port = fakePort()
    const a = attestor(port)
    const result = await a.ensureFresh()
    expect(result.ok).toBe(true)
    expect(port.posts).toHaveLength(1)
    expect(port.posts[0]!.route).toBe(MODEL_INVOCATION_ATTEST_ROUTE)
    const body = port.posts[0]!.bodies[0]!
    expect(Object.keys(body)).toEqual(['schema', 'aeraSessionId', 'workerEpochId', 'connectionId', 'issuedAt', 'nonce'])
    expect(body).toMatchObject({ schema: MODEL_INVOCATION_ATTESTATION_SCHEMA, aeraSessionId: SESSION, workerEpochId: EPOCH_A, connectionId: CONNECTION })
    expect(body.issuedAt).toBe('2026-10-01T03:04:05.678Z')
    expect(body.issuedAt).toMatch(/\.\d{3}Z$/u)
    expect(new Date(String(body.issuedAt)).toISOString()).toBe(body.issuedAt)
    expect(body.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect('agentSessionToken' in body || 'senderProof' in body).toBe(false)
    // The Router's own closed guard accepts it once D-0c adds the two credential fields.
    expect(isModelInvocationAttestation({ ...body, agentSessionToken: 'tok', senderProof: 'a.b.c' })).toBe(true)
    a.dispose()
  })

  it('the builder is fresh per attempt (D-0c rebuilds on its own 409): new nonce and issuedAt, still ONE postSigned', async () => {
    vi.useFakeTimers({ now: T0 })
    const port = fakePort()
    port.internalRebuild = true
    const a = attestor(port)
    await a.attestNow()
    expect(port.posts).toHaveLength(1)
    const [first, second] = port.posts[0]!.bodies
    expect(first!.nonce).not.toBe(second!.nonce)
    expect(first!.issuedAt).not.toBe(second!.issuedAt)
    expect(second!.issuedAt).toBe(new Date(T0 + 1).toISOString())
    a.dispose()
  })

  it('parity vector: the vendored attestation keys and effect digest equal a pinned literal copy', () => {
    expect([...MODEL_INVOCATION_ATTESTATION_KEYS]).toEqual(['schema', 'aeraSessionId', 'workerEpochId', 'connectionId', 'issuedAt', 'nonce', 'agentSessionToken', 'senderProof'])
    expect(MODEL_INVOCATION_ATTESTATION_SCHEMA).toBe('aera.gateway.model-invocation-attestation.v1')
    expect(MODEL_INVOCATION_ATTEST_ROUTE).toBe('/v1/local-effects/model-invocations/attest')
    const vector = {
      schema: MODEL_INVOCATION_ATTESTATION_SCHEMA,
      aeraSessionId: 'aera:session:w2-execution-parity',
      connectionId: 'claude-worker-parity',
      workerEpochId: 'aera:worker_epoch:parity',
      issuedAt: '2026-10-01T03:04:05.678Z',
      nonce: 'A'.repeat(43),
    } as const
    const canonical = '{"aeraSessionId":"aera:session:w2-execution-parity","connectionId":"claude-worker-parity","issuedAt":"2026-10-01T03:04:05.678Z","nonce":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","schema":"aera.gateway.model-invocation-attestation.v1","workerEpochId":"aera:worker_epoch:parity"}'
    expect(createHash('sha256').update(canonical).digest('hex')).toBe('e420052eb872457e3ac5516bc941d5b93f366b9f78258f52a9365ec92381f8a5')
    expect(modelInvocationEffectDigest(vector)).toBe('sha256:e420052eb872457e3ac5516bc941d5b93f366b9f78258f52a9365ec92381f8a5')
  })

  it('refuses without a network call when the governed Connection id fails the Gateway grammar', async () => {
    for (const connectionId of ['aera:connection:claude-worker', 'a/b', '-lead', undefined]) {
      const port = fakePort({ connectionId })
      const a = attestor(port)
      expect(await a.ensureFresh()).toEqual({ ok: false, state: 'MODEL_AUTHORITY_UNAVAILABLE', code: 'CONNECTION_ID_INVALID' })
      expect(port.posts).toHaveLength(0)
      a.dispose()
    }
    const noSession = fakePort({ aeraSessionId: undefined })
    const b = attestor(noSession)
    expect(await b.ensureFresh()).toMatchObject({ ok: false, code: 'AERA_SESSION_ID_MISSING' })
    expect(noSession.posts).toHaveLength(0)
    b.dispose()
  })

  it('the attestor goes only through D-0c postSigned (no transport of its own, no interval, no 409 handling of its own)', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../src/aera-worker-model-attest.ts'), 'utf8')
    expect(source).not.toMatch(/createPinned|node:https?|fetch\(|setInterval|MODEL_ATTESTATION_REPLAYED/u)
    expect(source).toContain('.postSigned(MODEL_INVOCATION_ATTEST_ROUTE')
  })
})

describe('U8 D-1: replies and the heartbeat (fake timers)', () => {
  afterEach(() => { vi.useRealTimers() })

  it('200 ATTESTED records the receipt; re-attests every 60 s while a turn may start, ONE postSigned per tick', async () => {
    vi.useFakeTimers({ now: T0 })
    const port = fakePort()
    const a = attestor(port)
    a.setTurnPossible(true)
    const result = await a.ensureFresh()
    expect(result).toMatchObject({ ok: true, workerEpochId: EPOCH_A, casReceiptId: expect.stringMatching(/^cas-receipt-/u), attestedAtMs: T0 })
    expect(a.status()).toMatchObject({ state: 'ATTESTED', heartbeat: 'RUNNING', workerEpochId: EPOCH_A, attestedAt: new Date(T0).toISOString() })
    await vi.advanceTimersByTimeAsync(MODEL_ATTEST_HEARTBEAT_MS - 1)
    expect(port.posts).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(port.posts).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(MODEL_ATTEST_HEARTBEAT_MS)
    expect(port.posts).toHaveLength(3)
    expect(port.posts.map(post => post.at - T0)).toEqual([0, 60_000, 120_000])
    expect(port.posts.every(post => post.bodies.length === 1)).toBe(true)
    a.dispose()
  })

  it('does not attest while idle: the heartbeat runs only within 120 s of turn activity, then goes dormant', async () => {
    vi.useFakeTimers({ now: T0 })
    expect(MODEL_ATTEST_ACTIVITY_WINDOW_MS).toBe(120_000)
    const port = fakePort()
    const a = attestor(port)
    await a.ensureFresh()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(port.posts).toHaveLength(1)
    expect(a.status().heartbeat).toBe('DORMANT')

    const t1 = Date.now()
    a.noteTurnActivity()
    await a.ensureFresh()
    expect(port.posts).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    // tick at +60 s (activity 60 s ago) attests; tick at +120 s (activity 120 s ago) does not.
    expect(port.posts.slice(1).map(post => post.at - t1)).toEqual([0, 60_000])
    expect(a.status().heartbeat).toBe('DORMANT')

    // A turn becoming possible wakes it.
    a.setTurnPossible(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(port.posts).toHaveLength(4)
    expect(a.status().heartbeat).toBe('RUNNING')
    a.dispose()
  })

  it('403 → MODEL_AUTHORITY_REFUSED:<error> and the heartbeat halts; ensureFresh still makes one fresh attempt (C-5)', async () => {
    vi.useFakeTimers({ now: T0 })
    const port = fakePort()
    const a = attestor(port)
    a.setTurnPossible(true)
    await a.ensureFresh()
    port.replies.push({ status: 403, body: { error: 'WORKER_EPOCH_MISMATCH' } })
    await vi.advanceTimersByTimeAsync(MODEL_ATTEST_HEARTBEAT_MS)
    expect(port.posts).toHaveLength(2)
    expect(a.status()).toMatchObject({ state: 'MODEL_AUTHORITY_REFUSED', code: 'WORKER_EPOCH_MISMATCH', heartbeat: 'HALTED' })
    expect(a.status().casReceiptId).toBeUndefined()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(port.posts).toHaveLength(2)
    // The refusal is not fresh: the gate attempts once more, and success resumes the heartbeat.
    expect(await a.ensureFresh()).toMatchObject({ ok: true })
    expect(port.posts).toHaveLength(3)
    expect(a.status().heartbeat).toBe('RUNNING')
    await vi.advanceTimersByTimeAsync(MODEL_ATTEST_HEARTBEAT_MS)
    expect(port.posts).toHaveLength(4)
    a.dispose()
  })

  it('parses the refusal from error, then reason, else UNTYPED', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ error: 'CONNECTION_NOT_GOVERNED', reason: 'OTHER' }, 'CONNECTION_NOT_GOVERNED'],
      [{ error: 'not typed', reason: 'EXECUTION_BINDING_NOT_ACTIVE' }, 'EXECUTION_BINDING_NOT_ACTIVE'],
      [{ error: 'A'.repeat(81) }, 'UNTYPED'],
      [{ refusal: 'X' }, 'UNTYPED'],
    ]
    for (const [body, code] of cases) {
      const port = fakePort()
      port.replies.push({ status: 403, body })
      const a = attestor(port)
      expect(await a.ensureFresh()).toEqual({ ok: false, state: 'MODEL_AUTHORITY_REFUSED', code })
      a.dispose()
    }
  })

  it('503 or a transport throw → MODEL_AUTHORITY_UNAVAILABLE with 5 s → 60 s back-off (only while a turn may start)', async () => {
    vi.useFakeTimers({ now: T0 })
    expect([MODEL_ATTEST_BACKOFF_INITIAL_MS, MODEL_ATTEST_BACKOFF_CAP_MS]).toEqual([5_000, 60_000])
    const port = fakePort({ defaultReply: () => ({ status: 503, body: { error: 'SENTINEL_UNAVAILABLE' } }) })
    const a = attestor(port)
    a.setTurnPossible(true)
    expect(await a.ensureFresh()).toEqual({ ok: false, state: 'MODEL_AUTHORITY_UNAVAILABLE', code: 'SENTINEL_UNAVAILABLE' })
    await vi.advanceTimersByTimeAsync(5_000 + 10_000 + 20_000 + 40_000 + 60_000 + 60_000)
    expect(port.posts.map(post => post.at - T0)).toEqual([0, 5_000, 15_000, 35_000, 75_000, 135_000, 195_000])
    expect(a.status()).toMatchObject({ state: 'MODEL_AUTHORITY_UNAVAILABLE', code: 'SENTINEL_UNAVAILABLE', heartbeat: 'RUNNING' })
    // Success resets the back-off to the 60 s cadence.
    port.replies.push(ok())
    await vi.advanceTimersByTimeAsync(60_000)
    expect(a.status().state).toBe('ATTESTED')
    port.replies.push(ok())
    await vi.advanceTimersByTimeAsync(60_000)
    expect(port.posts.at(-1)!.at - port.posts.at(-2)!.at).toBe(60_000)
    a.dispose()
  })

  it('a typed transport throw keeps its code; an untyped throw is TRANSPORT_ERROR and its message is never logged', async () => {
    const port = fakePort()
    port.replies.push(new WorkerLocalEffectError('CHANNEL_IDENTITY_MISMATCH'), new Error('tok.SECRET-LIKE-VALUE leaked in a message'))
    const a = attestor(port)
    expect(await a.attestNow()).toEqual({ ok: false, state: 'MODEL_AUTHORITY_UNAVAILABLE', code: 'CHANNEL_IDENTITY_MISMATCH' })
    expect(await a.attestNow()).toEqual({ ok: false, state: 'MODEL_AUTHORITY_UNAVAILABLE', code: 'TRANSPORT_ERROR' })
    expect(logs.join('\n')).not.toContain('SECRET-LIKE-VALUE')
    a.dispose()
  })

  it('a retired / fail-fast Epoch halts the heartbeat (no polling a dead Epoch)', async () => {
    vi.useFakeTimers({ now: T0 })
    const port = fakePort()
    const a = attestor(port)
    a.setTurnPossible(true)
    await a.ensureFresh()
    port.replies.push(new WorkerLocalEffectError('EPOCH_RETIRED'))
    await vi.advanceTimersByTimeAsync(MODEL_ATTEST_HEARTBEAT_MS)
    expect(a.status()).toMatchObject({ state: 'MODEL_AUTHORITY_UNAVAILABLE', code: 'EPOCH_RETIRED', heartbeat: 'HALTED' })
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(port.posts).toHaveLength(2)
    a.dispose()
  })

  it('a final 409 from D-0c is not retried by U8: one postSigned, then only the back-off', async () => {
    vi.useFakeTimers({ now: T0 })
    const port = fakePort()
    port.replies.push({ status: 409, body: { error: 'MODEL_ATTESTATION_REPLAYED' } })
    const a = attestor(port)
    a.setTurnPossible(true)
    expect(await a.ensureFresh()).toEqual({ ok: false, state: 'MODEL_AUTHORITY_UNAVAILABLE', code: 'MODEL_ATTESTATION_REPLAYED' })
    expect(port.posts).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(MODEL_ATTEST_BACKOFF_INITIAL_MS - 1)
    expect(port.posts).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(port.posts).toHaveLength(2)
    a.dispose()
  })

  it('a malformed or already-expired 200 is not an attestation', async () => {
    const port = fakePort()
    port.replies.push(
      { status: 200, body: { status: 'ATTESTED', notAfter: new Date(Date.now() + 60_000).toISOString() } },
      { status: 200, body: { status: 'ATTESTED', casReceiptId: 'r', notAfter: new Date(Date.now() - 1).toISOString() } },
    )
    const a = attestor(port)
    expect(await a.attestNow()).toMatchObject({ ok: false, state: 'MODEL_AUTHORITY_UNAVAILABLE', code: 'MALFORMED_ATTEST_ANSWER' })
    expect(await a.attestNow()).toMatchObject({ ok: false, state: 'MODEL_AUTHORITY_UNAVAILABLE', code: 'ATTEST_RECEIPT_EXPIRED' })
    a.dispose()
  })

  it('an Epoch change stops the old heartbeat and voids its receipt; nothing is attested while idle', async () => {
    vi.useFakeTimers({ now: T0 })
    const port = fakePort()
    const a = attestor(port)
    await a.ensureFresh()
    port.setEpoch(EPOCH_B)
    expect(a.status()).toMatchObject({ state: 'NOT_ATTESTED', code: 'EPOCH_CHANGED', heartbeat: 'DORMANT' })
    expect(a.status().casReceiptId).toBeUndefined()
    expect(a.status().workerEpochId).toBeUndefined()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(port.posts).toHaveLength(1)
    // The old receipt never satisfies the gate for the new Epoch.
    await a.ensureFresh()
    expect(port.posts).toHaveLength(2)
    expect(port.posts[1]!.bodies[0]!.workerEpochId).toBe(EPOCH_B)
    a.dispose()
  })

  it('defence in depth: a receipt for another Epoch is never fresh, even if no change was signalled', async () => {
    vi.useFakeTimers({ now: T0 })
    let epoch = EPOCH_A
    const port = fakePort()
    const silent = Object.assign(Object.create(port) as FakePort, { workerEpochId: () => epoch })
    const a = createModelInvocationAttestor({ session: silent as never })
    expect(await a.ensureFresh()).toMatchObject({ ok: true, workerEpochId: EPOCH_A })
    epoch = EPOCH_B
    expect(await a.ensureFresh()).toMatchObject({ ok: true, workerEpochId: EPOCH_B })
    expect(port.posts).toHaveLength(2)
    a.dispose()
  })

  it('an Epoch change while a turn may start attests the new Epoch at once (C-1), and no later post names the old one', async () => {
    vi.useFakeTimers({ now: T0 })
    const port = fakePort()
    const a = attestor(port)
    a.setTurnPossible(true)
    await a.ensureFresh()
    await vi.advanceTimersByTimeAsync(30_000)
    port.setEpoch(EPOCH_B)
    await vi.advanceTimersByTimeAsync(0)
    expect(port.posts).toHaveLength(2)
    expect(port.posts[1]!.at - T0).toBe(30_000)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    const after = port.posts.slice(1)
    expect(after.every(post => post.bodies[0]!.workerEpochId === EPOCH_B)).toBe(true)
    expect(after.map(post => post.at - T0)).toEqual([30_000, 90_000, 150_000, 210_000, 270_000, 330_000])
    a.dispose()
    expect(port.listenerCount()).toBe(0)
  })

  it('stop() (Epoch end) halts the heartbeat; ensureFresh freshness is age-, Epoch- and receipt-bounded; concurrent calls coalesce', async () => {
    vi.useFakeTimers({ now: T0 })
    expect(MODEL_ATTEST_FRESH_MS).toBe(60_000)
    const port = fakePort()
    const a = attestor(port)
    a.setTurnPossible(true)
    const [x, y] = await Promise.all([a.ensureFresh(), a.ensureFresh()])
    expect(x).toEqual(y)
    expect(port.posts).toHaveLength(1)
    a.stop()
    expect(a.status().heartbeat).toBe('DORMANT')
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(port.posts).toHaveLength(1)

    const t1 = Date.now()
    await a.ensureFresh()
    expect(port.posts).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(59_999)
    await a.ensureFresh()
    expect(port.posts).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    // Never older than the Router's 60 s window, whatever the caller asks.
    await a.ensureFresh(10 * 60_000)
    expect(port.posts).toHaveLength(3)
    expect(port.posts[2]!.at - t1).toBe(60_000)
    a.dispose()
  })

  it('logs and status carry ids and codes only — never the nonce or the body', async () => {
    vi.useFakeTimers({ now: T0 })
    logs.length = 0
    const port = fakePort()
    port.replies.push(ok(), { status: 403, body: { error: 'SUBJECT_NOT_BOUND_WORKER' } })
    const a = attestor(port)
    await a.attestNow()
    await a.attestNow()
    const nonces = port.posts.map(post => String(post.bodies[0]!.nonce))
    const surface = `${logs.join('\n')}\n${JSON.stringify(a.status())}`
    for (const nonce of nonces) expect(surface).not.toContain(nonce)
    expect(Object.keys(a.status()).every(key => ['state', 'code', 'heartbeat', 'workerEpochId', 'casReceiptId', 'notAfter', 'attestedAt'].includes(key))).toBe(true)
    a.dispose()
  })
})

/* ------------------------------------------------------- D-2: the turn gate */

interface GateStub {
  readonly results: ({ ok: true, workerEpochId: string, casReceiptId: string, notAfter: string, attestedAtMs: number } | { ok: false, state: 'MODEL_AUTHORITY_REFUSED' | 'MODEL_AUTHORITY_UNAVAILABLE', code: string })[]
  readonly order: string[]
  ensureFresh(maxAgeMs?: number): Promise<GateStub['results'][number]>
  noteTurnActivity(): void
  setTurnPossible(possible: boolean): void
  stop(): void
  status(): Record<string, unknown>
}
const fresh = { ok: true as const, workerEpochId: EPOCH_A, casReceiptId: 'cas-1', notAfter: '2099-01-01T00:00:00.000Z', attestedAtMs: 0 }

function gateStub(results: GateStub['results'], order: string[]): GateStub {
  return {
    results,
    order,
    async ensureFresh() { order.push('gate'); return results.shift() ?? fresh },
    noteTurnActivity() { order.push('activity') },
    setTurnPossible(possible) { order.push(`possible:${String(possible)}`) },
    stop() { order.push('stop') },
    status: () => ({ state: 'ATTESTED', heartbeat: 'RUNNING' }),
  }
}

const TERMINAL: WorkerEpochTerminal = { status: 'CANCELLED', reason: 'cancelled', exitCode: null, signal: 'SIGINT', turns: 0, usage: { reported: false }, orphanReaped: false, limitations: [], scratchResidue: [] }

function stubAdapter(order: string[]): WorkerAdapter & { spawns: number, inputs: string[], cancels: string[] } {
  const adapter = {
    adapterId: 'stub-adapter',
    workerType: 'CLAUDE_CODE',
    spawns: 0,
    inputs: [] as string[],
    cancels: [] as string[],
    async preflight() { return { workerType: 'CLAUDE_CODE', adapterId: 'stub-adapter' } },
    async startEpoch(spec: { epochId: string, onEvent?: (event: { kind: 'PROCESS_STARTED', pid: number }) => void }): Promise<WorkerEpochHandle> {
      adapter.spawns += 1
      order.push('spawn')
      spec.onEvent?.({ kind: 'PROCESS_STARTED', pid: 4242 })
      let turn = 0
      return {
        epochId: spec.epochId,
        runtime: { workerType: 'CLAUDE_CODE', adapterId: 'stub-adapter' },
        pid: undefined,
        scratchDir: undefined,
        async runTurn(input: string) {
          // Bounded like the real adapter's maxTurns: never loops forever.
          if (turn >= 6) return { kind: 'EPOCH_TERMINATED' as const, terminal: { ...TERMINAL, status: 'COMPLETED' as const, reason: 'stub turn bound', turns: turn } }
          turn += 1
          adapter.inputs.push(input)
          order.push('turn')
          // A rejected (malformed) block keeps the Epoch going without any effect.
          return { kind: 'TURN_COMPLETED' as const, turn, text: `turn ${String(turn)}\n\`\`\`aera-effect-intents\nnot json\n\`\`\``, usage: { reported: false }, authClass: 'SUBSCRIPTION_OAUTH' as const, isError: false }
        },
        async endInput() { order.push('end'); return { ...TERMINAL, status: 'COMPLETED' as const, reason: 'done', turns: turn } },
        async cancel(reason: string) { adapter.cancels.push(reason); order.push('cancel'); return { ...TERMINAL, reason, turns: turn } },
        async terminal() { return TERMINAL },
      }
    },
  }
  return adapter as never
}

function manager(world: ReturnType<typeof makeWorkerWorld>, adapter: WorkerAdapter, modelAttest: unknown) {
  return new AeraWorkerSessionManager({
    store: world.store,
    adapter,
    gate: new LocalExecutionPolicyGate(),
    config: { humanPrincipalId: world.owner, delegationId: world.delegationId, environmentId: 'AERA_DEV' },
    modelAttest: modelAttest as never,
  })
}

describe('U8 D-2: no spawn and no turn without a fresh attestation (C-4)', () => {
  it('refuses before the spawn: typed MODEL_AUTHORITY_UNAVAILABLE, no process, no Epoch evidence', async () => {
    const world = makeWorkerWorld()
    const order: string[] = []
    const adapter = stubAdapter(order)
    const gate = gateStub([{ ok: false, state: 'MODEL_AUTHORITY_REFUSED', code: 'SUBJECT_NOT_BOUND_WORKER' }], order)
    const m = manager(world, adapter, gate)
    await expect(m.runEpoch({ workOrderId: world.workOrderId, codeWorkingLineId: world.line.codeWorkingLineId, task: 'do it' }))
      .rejects.toMatchObject({ code: 'MODEL_AUTHORITY_UNAVAILABLE', message: expect.stringContaining('MODEL_AUTHORITY_REFUSED:SUBJECT_NOT_BOUND_WORKER') })
    expect(adapter.spawns).toBe(0)
    expect(order).toEqual(['gate'])
    expect(world.store.listTypedEvidence(world.workOrderId).filter(row => row.subject.startsWith('Worker Epoch'))).toHaveLength(0)
  })

  it('gates the spawn and EVERY turn; a refusal mid-Epoch writes no further turn and ends the Epoch typed', async () => {
    const world = makeWorkerWorld()
    const order: string[] = []
    const adapter = stubAdapter(order)
    const gate = gateStub([fresh, fresh, fresh, { ok: false, state: 'MODEL_AUTHORITY_UNAVAILABLE', code: 'SENTINEL_UNAVAILABLE' }], order)
    const m = manager(world, adapter, gate)
    // Turns 1 and 2 carry a rejected block (no effect); the gate before turn 3 refuses.
    const result = await m.runEpoch({ workOrderId: world.workOrderId, codeWorkingLineId: world.line.codeWorkingLineId, task: 'do it', limits: { maxTurns: 5 } })
    expect(adapter.spawns).toBe(1)
    expect(order.filter(step => ['gate', 'spawn', 'turn'].includes(step))).toEqual(['gate', 'spawn', 'gate', 'turn', 'gate', 'turn', 'gate'])
    expect(adapter.inputs).toHaveLength(2)
    expect(result.terminal.status).toBe('MODEL_AUTHORITY_UNAVAILABLE')
    expect(result.terminal.reason).toContain('MODEL_AUTHORITY_UNAVAILABLE:SENTINEL_UNAVAILABLE')
    expect(adapter.cancels).toHaveLength(1)
    expect(order).toContain('possible:true')
    expect(order.at(-1)).toBe('stop')
    expect(order.filter(step => step === 'activity')).toHaveLength(4)
    const terminal = world.store.listTypedEvidence(world.workOrderId).find(row => row.subject.startsWith('Worker Epoch terminal: '))
    expect(terminal?.subject).toContain('MODEL_AUTHORITY_UNAVAILABLE')
  })

  it('with the real attestor: a 403 before the spawn starts nothing, and the card shows the typed state', async () => {
    const world = makeWorkerWorld()
    const order: string[] = []
    const adapter = stubAdapter(order)
    const port = fakePort()
    port.replies.push({ status: 403, body: { error: 'DELEGATION_REVOKED' } })
    const a = attestor(port)
    const m = manager(world, adapter, a)
    await expect(m.runEpoch({ workOrderId: world.workOrderId, codeWorkingLineId: world.line.codeWorkingLineId, task: 'do it' }))
      .rejects.toMatchObject({ code: 'MODEL_AUTHORITY_UNAVAILABLE' })
    expect(adapter.spawns).toBe(0)
    expect(port.posts).toHaveLength(1)
    a.dispose()
  })
})

/* -------------------------------------------------- D-3: composition and card */

describe('U8 D-3: composed only with D-0c and a grammar-valid governed Connection; no fallback', () => {
  async function env() {
    const world = makeWorkerWorld()
    const { pin } = await makeFakeClaude({ turns: [{ text: 'never spawned' }] })
    return {
      world,
      env: {
        AERA_COLLAB_STORE_DIR: world.storeDir,
        AERA_COLLAB_PRINCIPAL_ID: world.owner,
        AERA_COLLAB_DELEGATION_ID: world.delegationId,
        AERA_CLAUDE_WORKER_BINARY: pin.binaryPath,
        AERA_CLAUDE_WORKER_SHA256: pin.sha256,
        AERA_CLAUDE_WORKER_VERSION: pin.version,
        AERA_CLAUDE_WORKER_MODEL: pin.model,
      },
    }
  }
  const leStatus = { state: 'READY' as const }
  const le = (port: FakePort) => Object.assign(port, { status: () => leStatus, beginEpoch: async () => ({ workerEpochId: EPOCH_A }), ensureSession: async () => leStatus, credentials: () => ({}) })

  it('a D-0c session whose Connection id fails the grammar (or is absent) makes the worker UNAVAILABLE', async () => {
    const { env: e } = await env()
    for (const connectionId of ['aera:connection:claude-worker-2', undefined]) {
      const runtime = composeAeraWorker(e, { localEffect: le(fakePort({ connectionId })) as never })
      expect(runtime.kind).toBe('UNAVAILABLE')
      expect(runtime).toMatchObject({ reason: expect.stringContaining('AERA_CLAUDE_WORKER_CONNECTION_ID') })
      expect('modelAttest' in runtime).toBe(false)
    }
  })

  it('a grammar-valid Connection composes the attestor; START_EPOCH refused typed with no spawn; status and card show the attest state', async () => {
    const { world, env: e } = await env()
    const port = fakePort()
    port.replies.push(new WorkerLocalEffectError('NO_EPOCH'))
    // D-0d2 (M-3): a worker composes only with the governed effect plane too; the attest gate refuses before it is opened.
    const effectPlane = { openEpoch: () => Promise.reject(new Error('never opened')) }
    const runtime = composeAeraWorker(e, { localEffect: le(port) as never, effectPlane })
    expect(runtime.kind).toBe('AVAILABLE')
    const before = parseWorkerStatus(aeraWorkerStatus(runtime, world.workOrderId))
    expect(before.modelAttest).toMatchObject({ state: 'NOT_ATTESTED', heartbeat: 'DORMANT' })
    await expect(performAeraWorkerAction(runtime, { action: 'START_EPOCH', workOrderId: world.workOrderId, codeWorkingLineId: world.line.codeWorkingLineId, task: 'go' }, () => {}))
      .rejects.toMatchObject({ code: 'MODEL_AUTHORITY_UNAVAILABLE' })
    expect(port.posts).toHaveLength(1)
    expect(world.store.listTypedEvidence(world.workOrderId).filter(row => row.subject.startsWith('Worker Epoch'))).toHaveLength(0)
    const after = parseWorkerStatus(aeraWorkerStatus(runtime, world.workOrderId))
    expect(after.modelAttest).toMatchObject({ state: 'MODEL_AUTHORITY_UNAVAILABLE', code: 'NO_EPOCH', heartbeat: 'HALTED' })
    const t = (key: keyof typeof en): string => en[key]
    const api = { status: async () => after, action: async () => ({}) }
    const markup = renderToStaticMarkup(createElement(AeraWorkerStatus, { api, workOrderId: world.workOrderId, lines: [], t, initialStatus: after }))
    expect(markup).toContain(en.workerAttest)
    expect(markup).toContain('MODEL_AUTHORITY_UNAVAILABLE')
    expect(markup).toContain('NO_EPOCH')
    if (runtime.kind === 'AVAILABLE') runtime.modelAttest?.dispose()
  })

  it('the renderer refuses an attest projection carrying any extra field', () => {
    expect(() => parseWorkerStatus({ workOrderId: 'wo', unavailableReason: 'x', modelAttest: { state: 'ATTESTED', heartbeat: 'RUNNING', nonce: 'n' } })).toThrow()
    expect(() => parseWorkerStatus({ workOrderId: 'wo', unavailableReason: 'x', modelAttest: { state: 'attested', heartbeat: 'RUNNING' } })).toThrow()
    expect(parseWorkerStatus({ workOrderId: 'wo', unavailableReason: 'x', modelAttest: { state: 'ATTESTED', heartbeat: 'RUNNING', casReceiptId: 'cas-1', notAfter: '2026-10-01T00:00:00.000Z' } }).modelAttest)
      .toEqual({ state: 'ATTESTED', heartbeat: 'RUNNING', casReceiptId: 'cas-1', notAfter: '2026-10-01T00:00:00.000Z' })
  })
})

/* ------------------------- the real D-0c session against the D-0c fake Router */

describe('U8 over the real D-0c session and the fake Router (builder accepted; 409 inside D-0c; M-1 recovery)', () => {
  const PRINCIPAL = issueAeraPrincipalId()
  let pki: Pki
  let custody: TestCustody
  let router: FakeRouter
  beforeAll(async () => {
    pki = generatePki()
    custody = testCustody()
    router = await startFakeRouter(pki.leafA, { principalId: PRINCIPAL, custody })
  }, 60_000)
  afterAll(() => { router.close() })

  function session(leLogs: string[]) {
    const stateDir = mkdtempSync(join(tmpdir(), 'u8-profile-'))
    writeFileSync(join(stateDir, AERA_CLAUDE_WORKER_CONFIG_FILENAME), JSON.stringify({
      version: 1,
      environment: {
        AERA_CLAUDE_WORKER_LE_ROUTER_URL: router.url,
        AERA_CLAUDE_WORKER_LE_CA_FILE: pki.caA,
        AERA_CLAUDE_WORKER_LE_CA_SHA256: caFingerprintSha256(readFileSync(pki.caA)),
        AERA_CLAUDE_WORKER_LE_ROUTER_URI_SAN: ROUTER_SAN,
        AERA_CLAUDE_WORKER_CIS_ISSUER: CIS_ISSUER,
        AERA_CLAUDE_WORKER_AGENT_PRINCIPAL_ID: PRINCIPAL,
        AERA_CLAUDE_WORKER_INSTALLATION_KEY_ID: custody.installationKeyId,
        AERA_CLAUDE_WORKER_AERA_SESSION_ID: SESSION,
        AERA_CLAUDE_WORKER_CONNECTION_ID: CONNECTION,
        AERA_CLAUDE_WORKER_ORGANISATION_ID: 'aera:org:aera-studios',
        AERA_CLAUDE_WORKER_REPOSITORY_ID: 'aera-repo:aera-stack',
        AERA_CLAUDE_WORKER_WORKING_LINE_ID: 'aera:code_working_line:dogfood-u8',
        ...testEffectCatalogEnv(),
      },
    }))
    return createWorkerLocalEffectSession({
      config: loadWorkerLocalEffectConfig(stateDir),
      custody: custody.port,
      stateDir,
      handOverDir: join(stateDir, 'aera-worker-public-dev'),
      log: (line) => { leLogs.push(line) },
      sleep: async () => {},
    })
  }

  it('begin → 403 until the operator names the Epoch → ensureFresh → 200; a replayed nonce is re-minted inside D-0c with ONE U8 call', async () => {
    const leLogs: string[] = []
    operatorWritePending(router.state, PRINCIPAL)
    const s = session(leLogs)
    const calls: number[] = []
    const counted = new Proxy(s, {
      get(target, key, receiver) {
        if (key === 'postSigned') return (route: never, build: never) => { calls.push(1); return target.postSigned(route, build) }
        return Reflect.get(target, key, receiver) as unknown
      },
    })
    const a = createModelInvocationAttestor({ session: counted, log: (line: string) => { leLogs.push(line) } })
    const { workerEpochId } = await s.beginEpoch()
    expect(await a.ensureFresh()).toEqual({ ok: false, state: 'MODEL_AUTHORITY_REFUSED', code: 'WORKER_EPOCH_MISMATCH' })
    expect(a.status().heartbeat).toBe('HALTED')
    operatorWriteEpoch(router.state, PRINCIPAL, workerEpochId)
    const attested = await a.ensureFresh()
    expect(attested).toMatchObject({ ok: true, workerEpochId, casReceiptId: expect.stringMatching(/^cas-receipt-/u) })
    expect(s.status().state).toBe('READY')
    expect(calls).toHaveLength(2)

    router.state.attestBodies.length = 0
    router.state.forceConflict = 1
    expect(await a.attestNow()).toMatchObject({ ok: true })
    expect(calls).toHaveLength(3)
    const [first, second] = router.state.attestBodies
    expect(router.state.attestBodies).toHaveLength(2)
    expect(first!.nonce).not.toBe(second!.nonce)
    for (const body of router.state.attestBodies) {
      expect(isModelInvocationAttestation(body)).toBe(true)
      expect(String(body.issuedAt)).toMatch(/\.\d{3}Z$/u)
    }
    a.dispose()
    const tokens = [...router.state.sessions.keys()]
    const surface = `${leLogs.join('\n')}\n${JSON.stringify(a.status())}`
    for (const token of tokens) expect(surface).not.toContain(token)
  })
})
