/**
 * D-0c2 — signed sends over the pinned transport: the model-invocation attest
 * (`postSigned`, consumed by U8), the AGENT credentials port (consumed by
 * D-0d2), bounded retries (409 re-nonce, restart-horizon REPLAYED, session
 * renewal), M-1 recovery without reset, the owner's BEGIN_AGENT_EPOCH route
 * and card, and the custody hygiene of the token —
 * WO-AERA-CODE-CLAUDE-CODE-GOVERNED-WORKER-INTEGRATION-001.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { verify } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { issueAeraPrincipalId } from '@aera/cis-contracts'
import { caFingerprintSha256 } from '@aera/effect-broker'
import { attemptBodyDigest, MODEL_INVOCATION_ATTEST_ROUTE } from '@aera/local-effect-admission'
import {
  CIS_ISSUER, ROUTER_SAN, RELAY, generatePki, operatorWriteEpoch, operatorWritePending, startFakeRouter, testCustody, testEffectCatalogEnv,
  type FakeRouter, type Pki, type TestCustody,
} from './aera-worker-le-fixtures.ts'

const { AERA_CLAUDE_WORKER_CONFIG_FILENAME, loadWorkerLocalEffectConfig } = await import('../src/aera-worker-le-config.ts')
const { createWorkerLocalEffectSession } = await import('../src/aera-worker-le-session.ts')
const { parseWorkerAction } = await import('../src/aera-worker-route.ts')
const { aeraWorkerStatus, performAeraWorkerAction } = await import('../src/aera-worker-composition.ts')
const { parseWorkerStatus } = await import('../src/client/aera-worker-api.ts')
const { AeraWorkerStatus } = await import('../src/client/AeraWorkerStatus.tsx')
const { en } = await import('../src/client/aera-collab-locales.ts')

const PRINCIPAL = issueAeraPrincipalId()
const SESSION = 'aera:session:w2-execution-2'
const CONNECTION = 'aera:connection:claude-worker-2'
let pki: Pki
let custody: TestCustody
let router: FakeRouter
const logs: string[] = []
const surfaces: string[] = []
const dirs: string[] = []

beforeAll(async () => {
  pki = generatePki()
  custody = testCustody()
  router = await startFakeRouter(pki.leafA, { principalId: PRINCIPAL, custody })
}, 60_000)

afterAll(() => {
  router.close()
  // Custody hygiene across the whole file: no AGENT session token anywhere it could leak.
  const tokens = [...router.state.sessions.keys()]
  expect(tokens.length).toBeGreaterThan(5)
  const files = dirs.flatMap(dir => readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => readFileSync(join(entry.parentPath, entry.name), 'utf8')))
  const haystacks = [logs.join('\n'), surfaces.join('\n'), files.join('\n'), Object.values(process.env).join('\n')]
  for (const token of tokens) for (const haystack of haystacks) expect(haystack.includes(token)).toBe(false)
})

function reset(): void {
  const s = router.state
  s.registry = undefined
  s.registryUnavailable = false
  s.epochs.clear()
  s.calls.length = 0
  s.sessionTtlMs = 600_000
  s.replayHorizon = 0
  s.forceConflict = 0
  s.forceSessionInvalid = 0
  s.attestBodies.length = 0
  s.attestClaims.length = 0
}

function makeSession(sleeps: number[] = []) {
  const stateDir = mkdtempSync(join(tmpdir(), 'd0c2-profile-'))
  dirs.push(stateDir)
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
      AERA_CLAUDE_WORKER_WORKING_LINE_ID: 'aera:code_working_line:dogfood-2',
      ...testEffectCatalogEnv(),
    },
  }))
  return createWorkerLocalEffectSession({
    config: loadWorkerLocalEffectConfig(stateDir),
    custody: custody.port,
    stateDir,
    handOverDir: join(stateDir, 'aera-worker-public-dev'),
    log: (line) => { logs.push(line) },
    sleep: async (ms) => { sleeps.push(ms) },
  })
}

/** U8's side: a fresh attest body per attempt (new nonce, fresh issuedAt). */
function attestBuilder(session: { workerEpochId(): string | undefined }, counter: { n: number }, epochOverride?: string) {
  return () => {
    counter.n += 1
    return {
      schema: 'aera.gateway.model-invocation-attestation.v1',
      aeraSessionId: SESSION,
      workerEpochId: epochOverride ?? session.workerEpochId(),
      connectionId: CONNECTION,
      issuedAt: new Date().toISOString(),
      nonce: Buffer.from(`${String(counter.n)}-${String(Date.now())}`.padEnd(32, '.')).toString('base64url').slice(0, 43),
    }
  }
}

async function readySession(sleeps: number[] = []) {
  reset()
  operatorWritePending(router.state, PRINCIPAL)
  const session = makeSession(sleeps)
  const { workerEpochId } = await session.beginEpoch()
  operatorWriteEpoch(router.state, PRINCIPAL, workerEpochId)
  router.state.calls.length = 0
  return { session, workerEpochId }
}

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise
  } catch (cause) {
    surfaces.push(String(cause), (cause as Error).stack ?? '', JSON.stringify(cause))
    return String((cause as { code?: unknown }).code)
  }
  return 'RESOLVED'
}
const attestCalls = (): number => router.state.calls.filter(path => path === MODEL_INVOCATION_ATTEST_ROUTE).length

describe('D-0c2 postSigned: the attest over the pinned transport (C-2, F-3)', () => {
  it('sends the attest only through createPinnedRouterTransport with the routes override; other routes are refused', async () => {
    const source = readFileSync(resolve(__dirname, '..', 'src', 'aera-worker-le-session.ts'), 'utf8')
    expect(source).toContain('createPinnedRouterTransport(')
    expect(source).toContain('routes: { attempt: route, outcome: route }')
    expect(source).not.toMatch(/createPinnedRouterRelayClient|from 'node:https'|from 'node:http'|fetch\(/u)
    const { session } = await readySession()
    const counter = { n: 0 }
    const answer = await session.postSigned(MODEL_INVOCATION_ATTEST_ROUTE, attestBuilder(session, counter))
    expect(answer).toMatchObject({ status: 200, body: { status: 'ATTESTED' } })
    // F-3: the vendored `routes` option really addresses the attest path.
    expect(router.state.calls).toEqual([MODEL_INVOCATION_ATTEST_ROUTE]) // begin's session is fresh: no continue
    router.state.calls.length = 0
    // Neither a route outside the transports nor a relay route the session itself uses may be signed-posted.
    for (const other of ['/v1/local-effects/attempts', RELAY.begin, RELAY.continue, RELAY.challenge]) {
      expect(await codeOf(session.postSigned(other as typeof MODEL_INVOCATION_ATTEST_ROUTE, attestBuilder(session, counter)))).toBe('ROUTE_NOT_ALLOWED')
    }
    expect(await codeOf(session.postSigned(MODEL_INVOCATION_ATTEST_ROUTE, attestBuilder(session, counter, 'aera:worker_epoch:00000000-0000-4000-8000-000000000000')))).toBe('STALE_EPOCH')
    expect(router.state.calls).toEqual([])
  })

  it('sender-proof claims and the sent body match the rehearsal field by field (world.ts:1076-1100)', async () => {
    const { session, workerEpochId } = await readySession()
    const counter = { n: 0 }
    const before = Math.floor(Date.now() / 1000)
    await session.postSigned(MODEL_INVOCATION_ATTEST_ROUTE, attestBuilder(session, counter))
    const sent = router.state.attestBodies.at(-1)!
    expect(Object.keys(sent).sort()).toEqual(['aeraSessionId', 'agentSessionToken', 'connectionId', 'issuedAt', 'nonce', 'schema', 'senderProof', 'workerEpochId'])
    const claims = router.state.attestClaims.at(-1)!
    expect(Object.keys(claims).sort()).toEqual(['audience', 'bodyDigest', 'installationKeyId', 'issuedAt', 'method', 'nonce', 'purpose', 'route', 'sessionId', 'sessionTokenDigest', 'workerEpochId'])
    expect(claims).toMatchObject({
      purpose: 'aera.local-effect.sender-proof.v1', audience: ROUTER_SAN, method: 'POST', route: MODEL_INVOCATION_ATTEST_ROUTE,
      bodyDigest: attemptBodyDigest(sent), workerEpochId, installationKeyId: custody.installationKeyId,
    })
    expect(claims.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(claims.issuedAt).toBeGreaterThanOrEqual(before - 1)
    expect(claims.issuedAt).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 1)
  })
})

describe('D-0c2 M-1: awaiting the operator write is sendable and recovers without reset', () => {
  it('begin → attest 403 (registry still pending) → Epoch write lands → next attest 200, READY', async () => {
    reset()
    operatorWritePending(router.state, PRINCIPAL)
    const session = makeSession()
    const fresh = makeSession()
    expect(await codeOf(fresh.postSigned(MODEL_INVOCATION_ATTEST_ROUTE, attestBuilder(fresh, { n: 0 })))).toBe('NO_EPOCH')
    expect(router.state.calls).toEqual([])
    const { workerEpochId } = await session.beginEpoch()
    const counter = { n: 0 }
    const refused = await session.postSigned(MODEL_INVOCATION_ATTEST_ROUTE, attestBuilder(session, counter))
    expect(refused).toEqual({ status: 403, body: { error: 'WORKER_EPOCH_MISMATCH' } })
    expect(session.status().state).toBe('BEGUN_AWAITING_BINDING')
    operatorWriteEpoch(router.state, PRINCIPAL, workerEpochId)
    const ok = await session.postSigned(MODEL_INVOCATION_ATTEST_ROUTE, attestBuilder(session, counter))
    expect(ok.status).toBe(200)
    expect(session.status()).toMatchObject({ state: 'READY', workerEpochId })
    expect(session.workerEpochId()).toBe(workerEpochId)
    // A READY Epoch the registry stops naming: the attest refusal moves it to BINDING_NOT_CURRENT (no re-begin).
    operatorWriteEpoch(router.state, PRINCIPAL, 'aera:worker_epoch:someone-else')
    expect((await session.postSigned(MODEL_INVOCATION_ATTEST_ROUTE, attestBuilder(session, counter))).status).toBe(403)
    expect(session.status().state).toBe('BINDING_NOT_CURRENT')
    expect(router.state.calls.filter(path => path === RELAY.begin).length).toBe(1)
    surfaces.push(JSON.stringify(refused), JSON.stringify(ok), JSON.stringify(session.status()))
  })
})

describe('D-0c2 bounded retries (review m-1, C-3)', () => {
  it('409 MODEL_ATTESTATION_REPLAYED: rebuild (new nonce) and retry once; a second 409 is returned', async () => {
    const { session } = await readySession()
    router.state.forceConflict = 1
    const counter = { n: 0 }
    expect((await session.postSigned(MODEL_INVOCATION_ATTEST_ROUTE, attestBuilder(session, counter))).status).toBe(200)
    expect(counter.n).toBe(2)
    const [first, second] = router.state.attestBodies.slice(-2)
    expect(first!.nonce).not.toBe(second!.nonce)
    router.state.attestBodies.length = 0
    router.state.forceConflict = 5
    expect(await session.postSigned(MODEL_INVOCATION_ATTEST_ROUTE, attestBuilder(session, counter))).toEqual({ status: 409, body: { error: 'MODEL_ATTESTATION_REPLAYED' } })
    expect(router.state.attestBodies.length).toBe(2)
  })

  it('a restarted Router (SENDER_PROOF_REPLAYED): wait ≥ 4 s, retry once with a fresh proof nonce; then stop', async () => {
    const sleeps: number[] = []
    const { session } = await readySession(sleeps)
    router.state.replayHorizon = 1
    expect((await session.postSigned(MODEL_INVOCATION_ATTEST_ROUTE, attestBuilder(session, { n: 0 }))).status).toBe(200)
    expect(sleeps.length).toBe(1)
    expect(sleeps[0]).toBeGreaterThanOrEqual(4_000)
    const nonces = router.state.attestClaims.map(c => c.nonce)
    expect(new Set(nonces).size).toBe(nonces.length)
    router.state.attestClaims.length = 0
    router.state.calls.length = 0
    router.state.replayHorizon = 5
    expect(await session.postSigned(MODEL_INVOCATION_ATTEST_ROUTE, attestBuilder(session, { n: 0 }))).toEqual({ status: 403, body: { error: 'SENDER_PROOF_REPLAYED' } })
    expect(attestCalls()).toBe(2)
    expect(sleeps.length).toBe(2)
  })

  it('SUBJECT_SESSION_INVALID renews by continue (same Epoch) and retries once; the total is capped at 3 attempts', async () => {
    const sleeps: number[] = []
    const { session, workerEpochId } = await readySession(sleeps)
    router.state.forceSessionInvalid = 1
    expect((await session.postSigned(MODEL_INVOCATION_ATTEST_ROUTE, attestBuilder(session, { n: 0 }))).status).toBe(200)
    expect(router.state.calls).toEqual([MODEL_INVOCATION_ATTEST_ROUTE, RELAY.challenge, RELAY.continue, MODEL_INVOCATION_ATTEST_ROUTE])
    expect(session.workerEpochId()).toBe(workerEpochId)
    router.state.calls.length = 0
    router.state.forceSessionInvalid = 1
    router.state.replayHorizon = 1
    router.state.forceConflict = 1
    const counter = { n: 0 }
    expect(await session.postSigned(MODEL_INVOCATION_ATTEST_ROUTE, attestBuilder(session, counter))).toEqual({ status: 409, body: { error: 'MODEL_ATTESTATION_REPLAYED' } })
    expect(attestCalls()).toBe(3)
    expect(counter.n).toBe(3)
  })
})

describe('D-0c2 credentials port (consumed by D-0d2)', () => {
  it('hands the broker the in-memory token and proofs over {method, route, body}; refuses before an Epoch', async () => {
    reset()
    const none = makeSession()
    expect(await codeOf(none.credentials().sessionToken())).toBe('NO_EPOCH')
    const { session, workerEpochId } = await readySession()
    const credentials = session.credentials()
    const token = await credentials.sessionToken()
    expect(router.state.sessions.has(token)).toBe(true)
    const body = { capability: 'aera.repo.read', agentSessionToken: token, workerEpochId }
    const proof = await credentials.senderProof({ method: 'POST', route: '/v1/local-effects/attempts', body })
    const [h, p, s] = proof.split('.')
    expect(verify(null, Buffer.from(`${h!}.${p!}`, 'ascii'), custody.publicKey, Buffer.from(s!, 'base64url'))).toBe(true)
    expect(JSON.parse(Buffer.from(p!, 'base64url').toString('utf8'))).toMatchObject({
      route: '/v1/local-effects/attempts', method: 'POST', bodyDigest: attemptBodyDigest(body), workerEpochId, audience: ROUTER_SAN,
    })
  })
})

describe('D-0c2 BEGIN_AGENT_EPOCH: route, composition, status and the owner card', () => {
  it('parses strictly, begins only on the action, projects public status, and shows Begin only while no live Epoch', async () => {
    expect(parseWorkerAction({ action: 'BEGIN_AGENT_EPOCH', workOrderId: 'wo-1' })).toEqual({ action: 'BEGIN_AGENT_EPOCH', workOrderId: 'wo-1' })
    expect(parseWorkerAction({ action: 'BEGIN_AGENT_EPOCH', workOrderId: 'wo-1', supersede: true })).toBeUndefined()
    reset()
    operatorWritePending(router.state, PRINCIPAL)
    const session = makeSession()
    const runtime = { kind: 'UNAVAILABLE' as const, reason: 'not yet composed', localEffect: session }
    const before = parseWorkerStatus(aeraWorkerStatus(runtime, 'wo-1'))
    expect(before.localEffect).toMatchObject({ state: 'NO_EPOCH' })
    const api = { status: async () => before, action: async () => ({}) }
    const t = (key: keyof typeof en): string => en[key]
    const markup = renderToStaticMarkup(createElement(AeraWorkerStatus, { api, workOrderId: 'wo-1', lines: [], t, initialStatus: before }))
    expect(markup).toContain(en.workerLeBegin)
    const begun = await performAeraWorkerAction(runtime, { action: 'BEGIN_AGENT_EPOCH', workOrderId: 'wo-1' }, () => {}) as { workerEpochId: string, publicEpochPath: string }
    expect(begun.workerEpochId).toBe(session.workerEpochId())
    expect(begun.publicEpochPath).toMatch(/worker-epoch\.public\.json$/u)
    expect(await codeOf(performAeraWorkerAction(runtime, { action: 'BEGIN_AGENT_EPOCH', workOrderId: 'wo-1' }, () => {}))).toBe('EPOCH_ALREADY_BEGUN')
    expect(await codeOf(performAeraWorkerAction({ kind: 'UNAVAILABLE', reason: 'x' }, { action: 'BEGIN_AGENT_EPOCH', workOrderId: 'wo-1' }, () => {}))).toBe('WORKER_LOCAL_EFFECT_UNAVAILABLE')
    const after = parseWorkerStatus(aeraWorkerStatus(runtime, 'wo-1'))
    expect(after.localEffect).toMatchObject({ state: 'BEGUN_AWAITING_BINDING', workerEpochId: begun.workerEpochId })
    const afterMarkup = renderToStaticMarkup(createElement(AeraWorkerStatus, { api, workOrderId: 'wo-1', lines: [], t, initialStatus: after }))
    expect(afterMarkup).toContain(begun.workerEpochId)
    expect(afterMarkup).not.toContain(en.workerLeBegin)
    expect(() => parseWorkerStatus({ workOrderId: 'wo-1', unavailableReason: 'x', localEffect: { state: 'READY', agentSessionToken: 'leak' } })).toThrow()
    surfaces.push(JSON.stringify(aeraWorkerStatus(runtime, 'wo-1')), JSON.stringify(begun), markup, afterMarkup)
  })
})
