/**
 * D-0c1 — Worker-host local-effect session core: strict config, CA pin at
 * load, channel identity on every answer, and the Worker Epoch state machine
 * (C-7 two DP-9 writes, CD-4 one Epoch per window / no auto-begin, C-1 the id
 * changes only on begin, M-6 public Epoch hand-over) —
 * WO-AERA-CODE-CLAUDE-CODE-GOVERNED-WORKER-INTEGRATION-001.
 *
 * Everything runs against an in-process TLS 1.3 fake of the Router relay/CIS
 * Epoch routes with PKI generated here; the key is a generated test custody.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { issueAeraPrincipalId } from '@aera/cis-contracts'
import { caFingerprintSha256 } from '@aera/effect-broker'
import {
  CIS_ISSUER, ROUTER_SAN, RELAY, generatePki, operatorWriteEpoch, operatorWritePending, startFakeRouter, testCustody, testEffectCatalogEnv,
  type FakeRouter, type Pki, type TestCustody,
} from './aera-worker-le-fixtures.ts'

const { AERA_CLAUDE_WORKER_CONFIG_FILENAME, loadWorkerLocalEffectConfig } = await import('../src/aera-worker-le-config.ts')
const { createWorkerLocalEffectSession, WORKER_EPOCH_PUBLIC_FILENAME, WORKER_EPOCH_STATE_FILENAME } = await import('../src/aera-worker-le-session.ts')

const PRINCIPAL = issueAeraPrincipalId()
const SESSION = 'aera:session:w2-execution-1'
let pki: Pki
let custody: TestCustody
let routerA: FakeRouter
let routerB: FakeRouter
const routers: FakeRouter[] = []

beforeAll(async () => {
  pki = generatePki()
  custody = testCustody()
  routerA = await startFakeRouter(pki.leafA, { principalId: PRINCIPAL, custody })
  routerB = await startFakeRouter(pki.leafB, { principalId: PRINCIPAL, custody })
  routers.push(routerA, routerB)
}, 60_000)
afterAll(() => { for (const router of routers) router.close() })

function resetRouter(router: FakeRouter): void {
  const s = router.state
  s.registry = undefined
  s.registryUnavailable = false
  s.epochs.clear()
  s.sessions.clear()
  s.calls.length = 0
  s.sessionTtlMs = 600_000
  s.badBinding = false
  s.continueChangesEpoch = false
}

function environment(overrides: Record<string, string> = {}, caFile = pki.caA, url = routerA.url): Record<string, string> {
  return {
    AERA_CLAUDE_WORKER_LE_ROUTER_URL: url,
    AERA_CLAUDE_WORKER_LE_CA_FILE: caFile,
    AERA_CLAUDE_WORKER_LE_CA_SHA256: caFingerprintSha256(readFileSync(pki.caA)),
    AERA_CLAUDE_WORKER_LE_ROUTER_URI_SAN: ROUTER_SAN,
    AERA_CLAUDE_WORKER_CIS_ISSUER: CIS_ISSUER,
    AERA_CLAUDE_WORKER_AGENT_PRINCIPAL_ID: PRINCIPAL,
    AERA_CLAUDE_WORKER_INSTALLATION_KEY_ID: custody.installationKeyId,
    AERA_CLAUDE_WORKER_AERA_SESSION_ID: SESSION,
    AERA_CLAUDE_WORKER_CONNECTION_ID: 'aera:connection:claude-worker-1',
    AERA_CLAUDE_WORKER_ORGANISATION_ID: 'aera:org:aera-studios',
    AERA_CLAUDE_WORKER_REPOSITORY_ID: 'aera-repo:aera-stack',
    AERA_CLAUDE_WORKER_WORKING_LINE_ID: 'aera:code_working_line:dogfood-1',
    ...testEffectCatalogEnv(),
    ...overrides,
  }
}

function profile(document: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'd0c-profile-'))
  writeFileSync(join(dir, AERA_CLAUDE_WORKER_CONFIG_FILENAME), typeof document === 'string' ? document : JSON.stringify(document))
  return dir
}

interface Harness { session: ReturnType<typeof createWorkerLocalEffectSession>, stateDir: string, handOverDir: string, logs: string[], epochChanges: number }

function harness(options: { env?: Record<string, string>, stateDir?: string, handOverDir?: string } = {}): Harness {
  const stateDir = options.stateDir ?? profile({ version: 1, environment: options.env ?? environment() })
  const logs: string[] = []
  const handOverDir = options.handOverDir ?? join(stateDir, 'aera-worker-public-dev')
  const h: Harness = {
    stateDir,
    handOverDir,
    logs,
    epochChanges: 0,
    session: createWorkerLocalEffectSession({
      config: loadWorkerLocalEffectConfig(stateDir),
      custody: custody.port,
      stateDir,
      handOverDir,
      log: (line) => { logs.push(line) },
    }),
  }
  h.session.onEpochChanged(() => { h.epochChanges += 1 })
  return h
}

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise
  } catch (cause) {
    return String((cause as { code?: unknown }).code)
  }
  return 'RESOLVED'
}

describe('D-0c1 config (strict profile file, CA pin at load)', () => {
  it('loads a complete document and names only keys, never values, when refusing', () => {
    const loaded = loadWorkerLocalEffectConfig(profile({ version: 1, environment: environment() }))
    expect(loaded.status).toBe('loaded')
    const cases: Array<[unknown, string]> = [
      [{ version: 1, environment: { ...environment(), AERA_CLAUDE_WORKER_EXTRA: 'x' } }, 'CONFIG_UNKNOWN_KEY:AERA_CLAUDE_WORKER_EXTRA'],
      [{ version: 1, environment: { ...environment(), AERA_CLAUDE_WORKER_CIS_ISSUER: undefined } }, 'CONFIG_MISSING_KEY:AERA_CLAUDE_WORKER_CIS_ISSUER'],
      [{ version: 2, environment: environment() }, 'CONFIG_VERSION'],
      [{ version: 1, environment: environment(), extra: true }, 'CONFIG_UNSUPPORTED_FIELDS'],
      [{ version: 1, environment: environment({ AERA_CLAUDE_WORKER_LE_CA_FILE: 'relative/ca.crt' }) }, 'CONFIG_INVALID:AERA_CLAUDE_WORKER_LE_CA_FILE'],
      [{ version: 1, environment: environment({ AERA_CLAUDE_WORKER_LE_ROUTER_URL: 'http://127.0.0.1:1/' }) }, 'CONFIG_INVALID:AERA_CLAUDE_WORKER_LE_ROUTER_URL'],
      [{ version: 1, environment: environment({ AERA_CLAUDE_WORKER_AGENT_PRINCIPAL_ID: 'not-a-principal' }) }, 'CONFIG_INVALID:AERA_CLAUDE_WORKER_AGENT_PRINCIPAL_ID'],
      [{ version: 1, environment: environment({ AERA_CLAUDE_WORKER_INSTALLATION_KEY_ID: 'short' }) }, 'CONFIG_INVALID:AERA_CLAUDE_WORKER_INSTALLATION_KEY_ID'],
      ['{not json', 'CONFIG_NOT_JSON'],
    ]
    for (const [document, reason] of cases) {
      const result = loadWorkerLocalEffectConfig(profile(document))
      expect(result).toEqual({ status: 'not-configured', reason })
    }
    expect(loadWorkerLocalEffectConfig(mkdtempSync(join(tmpdir(), 'd0c-empty-')))).toEqual({ status: 'not-configured', reason: 'CONFIG_MISSING' })
    const linked = mkdtempSync(join(tmpdir(), 'd0c-link-'))
    symlinkSync(join(profile({ version: 1, environment: environment() }), AERA_CLAUDE_WORKER_CONFIG_FILENAME), join(linked, AERA_CLAUDE_WORKER_CONFIG_FILENAME))
    expect(loadWorkerLocalEffectConfig(linked)).toEqual({ status: 'not-configured', reason: 'CONFIG_NOT_REGULAR_FILE' })
  })

  it('refuses a CA file whose fingerprint is not the pin, and a CA bundle, before any network call', async () => {
    resetRouter(routerA)
    const wrongPin = environment({ AERA_CLAUDE_WORKER_LE_CA_SHA256: caFingerprintSha256(readFileSync(pki.caB)) })
    expect(loadWorkerLocalEffectConfig(profile({ version: 1, environment: wrongPin }))).toEqual({ status: 'not-configured', reason: 'LE_CA_PIN_MISMATCH' })
    const bundle = join(pki.dir, 'bundle-a-b.crt')
    writeFileSync(bundle, Buffer.concat([readFileSync(pki.caA), readFileSync(pki.caB)]))
    expect(loadWorkerLocalEffectConfig(profile({ version: 1, environment: environment({}, bundle) }))).toEqual({ status: 'not-configured', reason: 'LE_CA_NOT_SINGLE_CERTIFICATE' })
    const h = harness({ env: wrongPin })
    expect(h.session.status()).toMatchObject({ state: 'NOT_CONFIGURED', reason: 'LE_CA_PIN_MISMATCH' })
    expect(await codeOf(h.session.beginEpoch())).toBe('NOT_CONFIGURED')
    expect(await codeOf(h.session.ensureSession())).toBe('NOT_CONFIGURED')
    expect(routerA.state.calls).toEqual([])
  })
})

describe('D-0c1 pinned transport: channel identity verified on every answer', () => {
  it('the session re-checks the CA pin itself (independent of the loader)', async () => {
    resetRouter(routerA)
    const loaded = loadWorkerLocalEffectConfig(profile({ version: 1, environment: environment() }))
    if (loaded.status !== 'loaded') throw new Error('fixture')
    const stateDir = mkdtempSync(join(tmpdir(), 'd0c-state-'))
    const session = createWorkerLocalEffectSession({
      config: { status: 'loaded', config: { ...loaded.config, caPem: readFileSync(pki.caB) } },
      custody: custody.port, stateDir, handOverDir: join(stateDir, 'pub'),
    })
    expect(session.status()).toMatchObject({ state: 'NOT_CONFIGURED', reason: 'LE_CA_PIN_MISMATCH' })
    expect(await codeOf(session.beginEpoch())).toBe('NOT_CONFIGURED')
    expect(routerA.state.calls).toEqual([])
  })

  it('refuses an answer whose verified chain ends at a CA other than the pin (trusted bundle), and a foreign channel binding', async () => {
    resetRouter(routerB)
    operatorWritePending(routerB.state, PRINCIPAL)
    const loaded = loadWorkerLocalEffectConfig(profile({ version: 1, environment: environment({}, pki.caA, routerB.url) }))
    if (loaded.status !== 'loaded') throw new Error('fixture')
    const stateDir = mkdtempSync(join(tmpdir(), 'd0c-state-'))
    // The bundle's FIRST certificate is the pinned CA, so the composition check passes; the server chains to CA-B.
    const bundle = Buffer.concat([readFileSync(pki.caA), readFileSync(pki.caB)])
    const session = createWorkerLocalEffectSession({ config: { status: 'loaded', config: { ...loaded.config, caPem: bundle } }, custody: custody.port, stateDir, handOverDir: join(stateDir, 'pub') })
    expect(await codeOf(session.beginEpoch())).toBe('CHANNEL_IDENTITY_MISMATCH')
    expect(session.status()).toMatchObject({ state: 'NO_EPOCH', lastRefusal: 'CHANNEL_IDENTITY_MISMATCH' })
    expect(routerB.state.calls).toEqual([RELAY.challenge])
    expect(routerB.state.epochs.size).toBe(0)

    resetRouter(routerA)
    operatorWritePending(routerA.state, PRINCIPAL)
    routerA.state.badBinding = true
    const h = harness()
    expect(await codeOf(h.session.beginEpoch())).toBe('CHANNEL_BINDING_MISMATCH')
    expect(h.session.status()).toMatchObject({ state: 'NO_EPOCH', lastRefusal: 'CHANNEL_BINDING_MISMATCH' })
    expect(routerA.state.epochs.size).toBe(0)
  })
})

describe('D-0c1 Worker Epoch state machine (C-7, CD-4, C-1, M-6)', () => {
  it('C-7 recovery: begin before the pending DP-9 write is refused; after the write the next begin succeeds with no reset', async () => {
    resetRouter(routerA)
    const h = harness()
    expect(h.session.status()).toMatchObject({ state: 'NO_EPOCH', agentPrincipalId: PRINCIPAL, aeraSessionId: SESSION })
    expect(await codeOf(h.session.beginEpoch())).toBe('AGENT_NOT_BOUND_TO_SESSION')
    expect(h.session.status().state).toBe('AWAITING_PENDING_BINDING')
    expect(h.session.workerEpochId()).toBeUndefined()

    operatorWritePending(routerA.state, PRINCIPAL)
    const begun = await h.session.beginEpoch()
    expect(begun.workerEpochId).toMatch(/^aera:worker_epoch:/u)
    expect(h.session.workerEpochId()).toBe(begun.workerEpochId)
    expect(h.session.status()).toMatchObject({ state: 'BEGUN_AWAITING_BINDING', workerEpochId: begun.workerEpochId })
    expect(h.epochChanges).toBe(1)
    expect(routerA.state.calls).toEqual([RELAY.challenge, RELAY.challenge, RELAY.begin])

    // M-6: the public Epoch record in the public hand-over location; ids only, 0644.
    const publicPath = join(h.handOverDir, WORKER_EPOCH_PUBLIC_FILENAME)
    expect(begun.publicEpochPath).toBe(publicPath)
    const published = JSON.parse(readFileSync(publicPath, 'utf8')) as Record<string, unknown>
    expect(Object.keys(published).sort()).toEqual(['aeraSessionId', 'agentPrincipalId', 'beganAt', 'workerEpochId'])
    expect(published).toMatchObject({ workerEpochId: begun.workerEpochId, agentPrincipalId: PRINCIPAL, aeraSessionId: SESSION })
    expect(statSync(publicPath).mode & 0o777).toBe(0o644)
    // The private state file is 0600 and holds no token.
    const statePath = join(h.stateDir, WORKER_EPOCH_STATE_FILENAME)
    expect(statSync(statePath).mode & 0o777).toBe(0o600)
    const tokens = [...routerA.state.sessions.keys()]
    expect(tokens.length).toBe(1)
    for (const text of [readFileSync(statePath, 'utf8'), readFileSync(publicPath, 'utf8'), JSON.stringify(h.session.status()), h.logs.join('\n')]) {
      for (const token of tokens) expect(text).not.toContain(token)
    }
  })

  it('M-1 (continue path): awaiting the Epoch write still probes; when the write lands the next attempt is READY, id unchanged', async () => {
    resetRouter(routerA)
    operatorWritePending(routerA.state, PRINCIPAL)
    routerA.state.sessionTtlMs = 60_000 // under the 120 s renewal margin: every ensureSession continues
    const h = harness()
    const { workerEpochId } = await h.session.beginEpoch()
    routerA.state.calls.length = 0
    expect(await codeOf(h.session.ensureSession())).toBe('AGENT_NOT_BOUND_TO_SESSION')
    expect(h.session.status().state).toBe('BEGUN_AWAITING_BINDING')
    expect(routerA.state.calls).toEqual([RELAY.challenge, RELAY.continue])

    operatorWriteEpoch(routerA.state, PRINCIPAL, workerEpochId)
    await h.session.ensureSession()
    expect(h.session.status()).toMatchObject({ state: 'READY', workerEpochId })
    expect(h.session.workerEpochId()).toBe(workerEpochId)
    expect(h.epochChanges).toBe(1) // C-1: continue never changes the Epoch
    expect(routerA.state.epochs.get(workerEpochId)).toBe('ACTIVE')
  })

  it('renews only under the 120 s margin, and refuses a continue that returns another Epoch id (C-1)', async () => {
    resetRouter(routerA)
    operatorWritePending(routerA.state, PRINCIPAL)
    const h = harness()
    const { workerEpochId } = await h.session.beginEpoch()
    operatorWriteEpoch(routerA.state, PRINCIPAL, workerEpochId)
    routerA.state.calls.length = 0
    await h.session.ensureSession() // 600 s left: no network
    expect(routerA.state.calls).toEqual([])

    routerA.state.sessionTtlMs = 60_000
    const h2 = harness({ stateDir: h.stateDir, handOverDir: h.handOverDir }) // restart: no token in memory → continue
    await h2.session.ensureSession()
    expect(routerA.state.calls).toEqual([RELAY.challenge, RELAY.continue])
    expect(h2.session.status()).toMatchObject({ state: 'READY', workerEpochId })
    routerA.state.continueChangesEpoch = true
    expect(await codeOf(h2.session.ensureSession())).toBe('EPOCH_CHANGED_ON_CONTINUE')
    expect(h2.session.workerEpochId()).toBe(workerEpochId)
    expect(h2.epochChanges).toBe(0)
  })

  it('CD-4: no auto-begin — no Epoch fails fast; a published Epoch (user-data loss) is continued, never superseded; a live Epoch blocks begin', async () => {
    resetRouter(routerA)
    operatorWritePending(routerA.state, PRINCIPAL)
    const fresh = harness()
    expect(await codeOf(fresh.session.ensureSession())).toBe('NO_EPOCH')
    expect(routerA.state.calls).toEqual([])

    const first = harness()
    const { workerEpochId } = await first.session.beginEpoch()
    operatorWriteEpoch(routerA.state, PRINCIPAL, workerEpochId)
    // User-data loss / new profile: no private state, but the public hand-over still names the Epoch.
    const lostProfile = mkdtempSync(join(tmpdir(), 'd0c-lost-'))
    writeFileSync(join(lostProfile, AERA_CLAUDE_WORKER_CONFIG_FILENAME), readFileSync(join(first.stateDir, AERA_CLAUDE_WORKER_CONFIG_FILENAME)))
    const recovered = harness({ stateDir: lostProfile, handOverDir: first.handOverDir })
    expect(recovered.session.workerEpochId()).toBe(workerEpochId)
    routerA.state.calls.length = 0
    expect(await codeOf(recovered.session.beginEpoch())).toBe('EPOCH_ALREADY_BEGUN')
    expect(routerA.state.calls).toEqual([])
    routerA.state.sessionTtlMs = 600_000
    await recovered.session.ensureSession()
    expect(routerA.state.calls).toEqual([RELAY.challenge, RELAY.continue])
    expect(recovered.session.status()).toMatchObject({ state: 'READY', workerEpochId })
    expect([...routerA.state.epochs.values()].filter(s => s === 'ACTIVE').length).toBe(1)
    expect(routerA.state.epochs.get(workerEpochId)).toBe('ACTIVE')
    expect(await codeOf(first.session.beginEpoch())).toBe('EPOCH_ALREADY_BEGUN')
    expect(recovered.epochChanges + first.epochChanges).toBe(1)
  })

  it('a CIS-retired Epoch is EPOCH_RETIRED: fail fast, no re-begin loop; only an explicit begin starts a new one', async () => {
    resetRouter(routerA)
    operatorWritePending(routerA.state, PRINCIPAL)
    routerA.state.sessionTtlMs = 60_000
    const h = harness()
    const { workerEpochId } = await h.session.beginEpoch()
    operatorWriteEpoch(routerA.state, PRINCIPAL, workerEpochId)
    routerA.state.epochs.set(workerEpochId, 'SUPERSEDED') // retired at CIS while the registry still names it
    expect(await codeOf(h.session.ensureSession())).toBe('EPOCH_NOT_ACTIVE')
    expect(h.session.status().state).toBe('EPOCH_RETIRED')
    routerA.state.calls.length = 0
    expect(await codeOf(h.session.ensureSession())).toBe('EPOCH_RETIRED')
    expect(routerA.state.calls).toEqual([])
    const next = await h.session.beginEpoch()
    expect(next.workerEpochId).not.toBe(workerEpochId)
    expect(h.session.status().state).toBe('BEGUN_AWAITING_BINDING')
    expect(h.epochChanges).toBe(2)
  })

  it('a READY Epoch the registry stops naming is BINDING_NOT_CURRENT (probes, never re-begins) and recovers when it is named again', async () => {
    resetRouter(routerA)
    operatorWritePending(routerA.state, PRINCIPAL)
    routerA.state.sessionTtlMs = 60_000
    const h = harness()
    const { workerEpochId } = await h.session.beginEpoch()
    operatorWriteEpoch(routerA.state, PRINCIPAL, workerEpochId)
    await h.session.ensureSession()
    expect(h.session.status().state).toBe('READY')
    operatorWriteEpoch(routerA.state, PRINCIPAL, 'aera:worker_epoch:someone-else')
    expect(await codeOf(h.session.ensureSession())).toBe('AGENT_NOT_BOUND_TO_SESSION')
    expect(h.session.status().state).toBe('BINDING_NOT_CURRENT')
    expect(await codeOf(h.session.beginEpoch())).toBe('EPOCH_ALREADY_BEGUN')
    routerA.state.registryUnavailable = true
    expect(await codeOf(h.session.ensureSession())).toBe('EXECUTION_REGISTRY_UNAVAILABLE')
    expect(h.session.status()).toMatchObject({ state: 'BINDING_NOT_CURRENT', lastRefusal: 'EXECUTION_REGISTRY_UNAVAILABLE' })
    routerA.state.registryUnavailable = false
    operatorWriteEpoch(routerA.state, PRINCIPAL, workerEpochId)
    await h.session.ensureSession()
    expect(h.session.status()).toMatchObject({ state: 'READY', workerEpochId })
    expect(h.session.status()).not.toHaveProperty('lastRefusal')
  })

  it('NOT_ENROLLED and KEY_ID_MISMATCH refuse without a network call, and recover once the owner enrols', async () => {
    resetRouter(routerA)
    operatorWritePending(routerA.state, PRINCIPAL)
    custody.enrolled = false
    try {
      const h = harness()
      expect(h.session.status().state).toBe('NOT_ENROLLED')
      expect(await codeOf(h.session.beginEpoch())).toBe('NOT_ENROLLED')
      const mismatch = harness({ env: environment({ AERA_CLAUDE_WORKER_INSTALLATION_KEY_ID: 'A'.repeat(43) }) })
      custody.enrolled = true
      expect(mismatch.session.status().state).toBe('KEY_ID_MISMATCH')
      expect(await codeOf(mismatch.session.beginEpoch())).toBe('KEY_ID_MISMATCH')
      expect(routerA.state.calls).toEqual([])
      expect(h.session.status().state).toBe('NO_EPOCH')
      await h.session.beginEpoch()
      expect(h.session.status().state).toBe('BEGUN_AWAITING_BINDING')
    } finally {
      custody.enrolled = true
    }
  })

  it('refuses a tampered private state file (wrong session/agent or malformed) and a public record for another Session', () => {
    resetRouter(routerA)
    const h = harness()
    mkdirSync(h.handOverDir, { recursive: true })
    writeFileSync(join(h.handOverDir, WORKER_EPOCH_PUBLIC_FILENAME), JSON.stringify({ workerEpochId: 'aera:worker_epoch:00000000-0000-4000-8000-000000000000', agentPrincipalId: PRINCIPAL, aeraSessionId: 'aera:session:other-window', beganAt: new Date().toISOString() }))
    writeFileSync(join(h.stateDir, WORKER_EPOCH_STATE_FILENAME), '{"version":1,"workerEpochId":"junk"}', { mode: 0o600 })
    const again = harness({ stateDir: h.stateDir, handOverDir: h.handOverDir })
    expect(again.session.status().state).toBe('NO_EPOCH')
    expect(again.session.workerEpochId()).toBeUndefined()
    expect(lstatSync(join(h.stateDir, WORKER_EPOCH_STATE_FILENAME)).isFile()).toBe(true)
  })
})
