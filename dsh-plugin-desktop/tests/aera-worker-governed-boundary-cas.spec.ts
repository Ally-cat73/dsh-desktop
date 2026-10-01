/**
 * D-0d2 — governed effect AUTHORITY is CAS, through the Router attempts route
 * (WO-AERA-CODE-CLAUDE-CODE-GOVERNED-WORKER-INTEGRATION-001).
 *
 * The real desktop host drives the deterministic fake CLI; parser-validated
 * intents are planned by D-0d1, executed by the vendored EffectBroker with the
 * D-0c credentials, decided by CAS at the (fake, TLS 1.3, generated-PKI)
 * Router, and their outcomes reported back through it. No local DecisionV1
 * grant is ever an authority path (owner addendum §11 / §24, CD-2), and no
 * worker can be composed without that plane (review M-3 / U8 N-6; D-0d2b).
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { issueAeraPrincipalId } from '@aera/cis-contracts'
import { SANDBOX_CONTRACT_VERSION, caFingerprintSha256, type SandboxPort } from '@aera/effect-broker'
import { MODEL_INVOCATION_ATTEST_ROUTE } from '@aera/local-effect-admission'
import { ParticipationStore } from '@aera/participation-runtime'
import { ClaudeCodeWorkerAdapter } from '../src/aera-claude-worker-host.ts'
import { DEFAULT_WORKER_EPOCH_LIMITS } from '../src/aera-worker-adapter.ts'
import { LocalExecutionPolicyGate, createGovernedEffectPlane, type GovernedEffectPlane } from '../src/aera-worker-effect-broker.ts'
import { AeraWorkerSessionManager } from '../src/aera-worker-session.ts'
import { AERA_CLAUDE_WORKER_CONFIG_FILENAME, loadWorkerLocalEffectConfig, type WorkerLocalEffectConfig } from '../src/aera-worker-le-config.ts'
import { createWorkerLocalEffectSession } from '../src/aera-worker-le-session.ts'
import { POISONED_PARENT_ENV, git, makeFakeClaude, makeWorkerWorld, type FakeScript, type WorkerWorld } from './aera-worker-fixtures.ts'
import {
  CIS_ISSUER, EFFECT_ROUTES, RELAY, ROUTER_SAN, generatePki, operatorWriteEpoch, operatorWritePending, startFakeRouter, testCustody, testEffectCatalogEnv,
  type FakeRouter, type Pki, type TestCustody,
} from './aera-worker-le-fixtures.ts'

const PRINCIPAL = issueAeraPrincipalId()
const SESSION = 'aera:session:w2-execution-d0d2'
const CONNECTION = 'claude-worker-d0d2'
const LIMITS = { ...DEFAULT_WORKER_EPOCH_LIMITS, turnTimeoutMs: 15_000, epochTimeoutMs: 60_000, cancelGraceMs: 300 }
let pki: Pki
let custody: TestCustody
let router: FakeRouter
const logs: string[] = []
const dirs: string[] = []
const observations: string[] = []

beforeAll(async () => {
  pki = generatePki()
  custody = testCustody()
  router = await startFakeRouter(pki.leafA, { principalId: PRINCIPAL, custody })
}, 60_000)

afterAll(() => {
  router.close()
  // No AGENT token in logs, observations, the store, the Epoch state or the broker journal.
  const tokens = [...router.state.sessions.keys()]
  expect(tokens.length).toBeGreaterThan(3)
  const files = dirs.flatMap(dir => readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => readFileSync(join(entry.parentPath, entry.name), 'utf8')))
  const haystack = [logs.join('\n'), observations.join('\n'), files.join('\n')].join('\n')
  for (const token of tokens) expect(haystack.includes(token)).toBe(false)
})

/** A sandbox that establishes and runs the trusted command directly (the test wrapper is itself Seatbelt). */
function testSandbox(): SandboxPort & { runs: { executable: string, argv: readonly string[] }[] } {
  const runs: { executable: string, argv: readonly string[] }[] = []
  return {
    contractVersion: SANDBOX_CONTRACT_VERSION,
    runs,
    establish: async () => ({ ok: true, profileDigest: 'a'.repeat(64) }),
    run: (spec) => new Promise((resolve) => {
      runs.push({ executable: spec.executable, argv: spec.argv })
      execFile(spec.executable, [...spec.argv], { cwd: spec.cwd, env: { ...spec.env }, encoding: 'buffer' }, (error, stdout, stderr) => {
        resolve({ exitStatus: error === null ? 0 : typeof error.code === 'number' ? error.code : 1, timedOut: false, stdout: new Uint8Array(stdout), stderr: new Uint8Array(stderr), truncated: false })
      })
    }),
  }
}

function resetRouter(): void {
  const s = router.state
  s.registry = undefined
  s.epochs.clear()
  s.casOutcome = 'ALLOW'
  s.attemptHang = false
  s.outcomeUnavailable = 0
  s.attempts.length = 0
  s.attemptClaims.length = 0
  s.outcomes.length = 0
}

function writeProfile(world: WorkerWorld, overrides: Record<string, string> = {}): string {
  const stateDir = mkdtempSync(join(tmpdir(), 'd0d2-profile-'))
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
      AERA_CLAUDE_WORKER_ORGANISATION_ID: 'aera-org:test',
      AERA_CLAUDE_WORKER_REPOSITORY_ID: world.line.repositoryId,
      AERA_CLAUDE_WORKER_WORKING_LINE_ID: world.line.codeWorkingLineId,
      ...testEffectCatalogEnv(),
      ...overrides,
    },
  }))
  return stateDir
}

/** A READY D-0c session (begun; the operator's Epoch write landed) and its governed effect plane. */
async function governed(world: WorkerWorld, overrides: Record<string, string> = {}, sandbox: SandboxPort | null = testSandbox()) {
  resetRouter()
  const stateDir = writeProfile(world, overrides)
  const loaded = loadWorkerLocalEffectConfig(stateDir)
  if (loaded.status !== 'loaded') throw new Error(`fixture config refused: ${loaded.reason}`)
  const session = createWorkerLocalEffectSession({ config: loaded, custody: custody.port, stateDir, handOverDir: join(stateDir, 'public'), log: line => { logs.push(line) } })
  operatorWritePending(router.state, PRINCIPAL)
  const { workerEpochId } = await session.beginEpoch()
  operatorWriteEpoch(router.state, PRINCIPAL, workerEpochId)
  const journalDir = join(stateDir, 'aera-worker', 'broker-journal')
  const plane = createGovernedEffectPlane({
    config: loaded.config,
    session,
    journalDir,
    ...(sandbox === null ? {} : { sandbox }),
    releaseTimeoutMs: 1_500,
    log: line => { logs.push(line) },
  })
  return { session, plane, config: loaded.config, stateDir, journalDir, workerEpochId, sandbox }
}

async function manager(world: WorkerWorld, plane: GovernedEffectPlane, script: FakeScript): Promise<AeraWorkerSessionManager> {
  const { pin } = await makeFakeClaude(script)
  return new AeraWorkerSessionManager({
    store: new ParticipationStore(world.storeDir),
    adapter: new ClaudeCodeWorkerAdapter(pin, { parentEnv: POISONED_PARENT_ENV, scratchRoot: world.scratchRoot }),
    // A permissive local gate: governed mode must never consult it.
    gate: new LocalExecutionPolicyGate(),
    config: { humanPrincipalId: world.owner, delegationId: world.delegationId, environmentId: 'AERA_DEV', limits: LIMITS },
    broker: { parentEnv: POISONED_PARENT_ENV },
    effectPlane: plane,
  })
}

async function run(world: WorkerWorld, plane: GovernedEffectPlane, script: FakeScript, prepare?: (m: AeraWorkerSessionManager) => void) {
  const m = await manager(world, plane, script)
  prepare?.(m)
  const result = await m.runEpoch({ workOrderId: world.workOrderId, codeWorkingLineId: world.line.codeWorkingLineId, task: 'TEST governed task' })
  observations.push(...result.outcomes.map(outcome => outcome.observation))
  return { m, result }
}

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise
  } catch (cause) {
    observations.push(String(cause))
    return String((cause as { code?: unknown }).code)
  }
  return 'RESOLVED'
}

function repoUnchanged(world: WorkerWorld, head: string): void {
  expect(git(world.repoRoot, 'rev-parse', 'HEAD')).toBe(head)
  expect(git(world.repoRoot, 'status', '--porcelain')).toBe('')
}

// ---------------------------------------------------------------------------

describe('D-0d2 governed intents: CAS decides through the Router; the effect broker performs', () => {
  it('RELEASED read and patch → COMPLETED and recorded, outcomes reported through the Router, with no local grant', async () => {
    const world = makeWorkerWorld()
    // Sentinel's mutation path policy allows source paths (patchPathClass), e.g. src/*.ts.
    mkdirSync(join(world.repoRoot, 'src'))
    writeFileSync(join(world.repoRoot, 'src', 'app.ts'), 'export const v = 1\n')
    git(world.repoRoot, 'add', 'src/app.ts')
    git(world.repoRoot, 'commit', '-qm', 'test: seed src')
    const g = await governed(world)
    const { result, m } = await run(world, g.plane, {
      turns: [
        { intents: [{ intentId: 'r1', kind: 'fs.read', path: 'README.md' }, { intentId: 'w1', kind: 'fs.write', path: 'src/app.ts', content: 'export const v = 2\n' }] },
        { status: 'DONE' },
      ],
    })
    expect(result.terminal.status).toBe('COMPLETED')
    expect(result.outcomes.map(o => [o.intentId, o.performed, o.stage, o.code])).toEqual([['r1', true, 'EXECUTION', 'PERFORMED'], ['w1', true, 'EXECUTION', 'PERFORMED']])
    expect(readFileSync(join(world.repoRoot, 'src', 'app.ts'), 'utf8')).toBe('export const v = 2\n')
    expect(result.outcomes[0]?.observation).toContain('first line')
    // Both attempts went to the Router attempts route, signed by the D-0c credentials for that route.
    expect(router.state.attempts).toHaveLength(2)
    expect(router.state.attemptClaims.map(c => c.route)).toEqual([EFFECT_ROUTES.attempt, EFFECT_ROUTES.attempt])
    expect(router.state.attempts.map(a => (a.attempt as { idempotencyKey: string }).idempotencyKey)).toEqual([`${result.epochId}:t1:1`, `${result.epochId}:t1:2`])
    expect(router.state.attempts.map(a => (a.release as { workerEpochId: string }).workerEpochId)).toEqual([g.workerEpochId, g.workerEpochId])
    expect(router.state.outcomes.map(o => o.terminalState)).toEqual(['COMPLETED', 'COMPLETED'])
    // combinedDecisionId on every outcome and in the recorded evidence; performed/verified by distinct Aera principals.
    const principals = m.principals(world.workOrderId)
    const performed = new ParticipationStore(world.storeDir).listTypedEvidence(world.workOrderId).filter(row => row.evidenceClass === 'EXECUTION_EVIDENCE')
    expect(performed).toHaveLength(2)
    for (const [index, row] of performed.entries()) {
      const decisionId = result.outcomes[index]?.combinedDecisionId
      expect(decisionId).toMatch(/\S/u)
      expect(row.body).toContain(String(decisionId))
      expect(row.contribution).toMatchObject({ performedBy: principals.broker, verifiedBy: principals.verifier })
      expect(Object.values(row.contribution)).not.toContain(principals.worker)
      expect(row.outcome).toBe('PASS')
    }
    expect(m.status(world.workOrderId)).toMatchObject({ authorityMode: 'CAS', authorityEnvelope: [] })
  }, 60_000)

  it('a local DecisionV1 grant present but CAS DENY → WITHHELD at AUTHORITY, nothing written (no parallel authority)', async () => {
    const world = makeWorkerWorld()
    const head = git(world.repoRoot, 'rev-parse', 'HEAD')
    const g = await governed(world)
    router.state.casOutcome = 'DENY'
    const { result } = await run(world, g.plane, {
      turns: [{ intents: [{ intentId: 'w1', kind: 'fs.write', path: 'x.txt', content: 'x' }] }, { status: 'DONE' }],
    }, m => { m.grantAuthority({ workOrderId: world.workOrderId, codeWorkingLineId: world.line.codeWorkingLineId, grants: [{ effectClass: 'fs.write' }] }) })
    expect(result.outcomes[0]).toMatchObject({ performed: false, stage: 'AUTHORITY', code: 'WITHHELD:AUTHORITY_DENY', combinedDecisionId: expect.stringMatching(/\S/u) })
    expect(existsSync(join(world.repoRoot, 'x.txt'))).toBe(false)
    repoUnchanged(world, head)
    expect(router.state.attempts).toHaveLength(1)
    expect(router.state.outcomes).toHaveLength(0)
  }, 60_000)

  it('outside the delegated set (commit, shell) and an unmatched test command are refused typed, with no Router call; a catalog test runs in the sandbox', async () => {
    const world = makeWorkerWorld()
    const sandbox = testSandbox()
    const g = await governed(world, {}, sandbox)
    const { result } = await run(world, g.plane, {
      turns: [{
        intents: [
          { intentId: 'c1', kind: 'git.commit', paths: ['README.md'], message: 'x' },
          { intentId: 's1', kind: 'exec.shell', argv: ['/bin/echo', 'hi'] },
          { intentId: 't0', kind: 'exec.test', argv: ['/bin/echo', 'anything'] },
          { intentId: 't1', kind: 'exec.test', argv: ['/bin/echo', 'router affected: 17 passed'] },
        ],
      }, { status: 'DONE' }],
    })
    expect(result.outcomes.map(o => [o.intentId, o.performed, o.code])).toEqual([
      ['c1', false, 'NOT_DELEGATED_IN_GOVERNED_MODE'],
      ['s1', false, 'NOT_DELEGATED_IN_GOVERNED_MODE'],
      ['t0', false, 'TEST_COMMAND_NOT_IN_CATALOG'],
      ['t1', true, 'PERFORMED'],
    ])
    expect(result.outcomes[3]?.observation).toContain('17 passed')
    expect(router.state.attempts).toHaveLength(1)
    expect(sandbox.runs).toMatchObject([{ executable: '/bin/echo', argv: ['router affected: 17 passed'] }])
  }, 60_000)

  it('a Router timeout → RELEASE_UNAVAILABLE, nothing executed', async () => {
    const world = makeWorkerWorld()
    const head = git(world.repoRoot, 'rev-parse', 'HEAD')
    const g = await governed(world)
    router.state.attemptHang = true
    const { result } = await run(world, g.plane, { turns: [{ intents: [{ intentId: 'w1', kind: 'fs.write', path: 'late.txt', content: 'x' }] }, { status: 'DONE' }] })
    expect(result.outcomes[0]).toMatchObject({ performed: false, stage: 'RELEASE', code: 'RELEASE_UNAVAILABLE:ROUTER_TIMEOUT' })
    expect(existsSync(join(world.repoRoot, 'late.txt'))).toBe(false)
    repoUnchanged(world, head)
  }, 60_000)

  it('a configured Working Line that is not the local one refuses the Epoch before any spawn or record (M-4 wired)', async () => {
    const world = makeWorkerWorld()
    const g = await governed(world, { AERA_CLAUDE_WORKER_WORKING_LINE_ID: world.otherLine.codeWorkingLineId })
    const m = await manager(world, g.plane, { turns: [{ text: 'never spawned' }] })
    expect(await codeOf(m.runEpoch({ workOrderId: world.workOrderId, codeWorkingLineId: world.line.codeWorkingLineId, task: 't' }))).toBe('WORKING_LINE_BINDING_MISMATCH')
    expect(new ParticipationStore(world.storeDir).listTypedEvidence(world.workOrderId).filter(row => row.subject.startsWith('Worker Epoch'))).toHaveLength(0)
  }, 60_000)
})

describe('D-0d2 the per-Epoch plane: stale Epoch, attempt-id uniqueness (N-4), reconcile, N-1', () => {
  const read = { intentId: 'r', kind: 'fs.read' as const, path: 'README.md' }

  it('a CIS Epoch that changed after the broker was opened → REFUSED STALE_WORKER_EPOCH, no Router call', async () => {
    const world = makeWorkerWorld()
    router.state.sessionTtlMs = 60_000 // every credential use continues the Epoch (< 120 s left)
    const g = await governed(world).finally(() => { router.state.sessionTtlMs = 600_000 })
    const effects = await g.plane.openEpoch({ desktopEpochId: 'aera:worker-epoch:stale-1', line: world.line, workspaceRoot: world.repoRoot })
    for (const id of router.state.epochs.keys()) router.state.epochs.set(id, 'SUPERSEDED')
    router.state.sessions.clear()
    expect(await codeOf(g.session.ensureSession())).toBe('EPOCH_NOT_ACTIVE')
    const { workerEpochId } = await g.session.beginEpoch()
    operatorWriteEpoch(router.state, PRINCIPAL, workerEpochId)
    const attempts = router.state.attempts.length
    const outcome = await effects.execute({ ...read, codeWorkingLineId: world.line.codeWorkingLineId }, { turn: 1, ordinal: 1 })
    expect(outcome).toMatchObject({ kind: 'BROKER', result: { status: 'REFUSED', reason: 'STALE_WORKER_EPOCH' } })
    expect(router.state.attempts.length).toBe(attempts)
  }, 60_000)

  it('N-4: an attempt id is never reused within an Epoch — not in one session, not after a restart on the same Epoch journal', async () => {
    const world = makeWorkerWorld()
    const g = await governed(world)
    const intent = { ...read, codeWorkingLineId: world.line.codeWorkingLineId }
    const first = await g.plane.openEpoch({ desktopEpochId: 'aera:worker-epoch:n4', line: world.line, workspaceRoot: world.repoRoot })
    expect(await first.execute(intent, { turn: 1, ordinal: 1 })).toMatchObject({ kind: 'BROKER', result: { status: 'COMPLETED' } })
    expect(await first.execute(intent, { turn: 1, ordinal: 1 })).toMatchObject({ kind: 'REFUSED', code: 'EFFECT_ATTEMPT_ID_REUSED' })
    const restarted = createGovernedEffectPlane({ config: g.config, session: g.session, journalDir: g.journalDir, sandbox: testSandbox() })
    const again = await restarted.openEpoch({ desktopEpochId: 'aera:worker-epoch:n4', line: world.line, workspaceRoot: world.repoRoot })
    expect(await again.execute(intent, { turn: 1, ordinal: 1 })).toMatchObject({ kind: 'REFUSED', code: 'EFFECT_ATTEMPT_ID_REUSED' })
    expect(router.state.attempts).toHaveLength(1)
  }, 60_000)

  it('Epoch start reconciles the journal: an outcome a crash left unreported is reported', async () => {
    const world = makeWorkerWorld()
    const g = await governed(world)
    router.state.outcomeUnavailable = 1
    const effects = await g.plane.openEpoch({ desktopEpochId: 'aera:worker-epoch:rc', line: world.line, workspaceRoot: world.repoRoot })
    expect(await effects.execute({ ...read, codeWorkingLineId: world.line.codeWorkingLineId }, { turn: 1, ordinal: 1 })).toMatchObject({ kind: 'BROKER', result: { status: 'COMPLETED', outcomeReported: false } })
    expect(router.state.outcomes).toHaveLength(0)
    const reopened = await g.plane.openEpoch({ desktopEpochId: 'aera:worker-epoch:rc-2', line: world.line, workspaceRoot: world.repoRoot })
    expect(reopened.reconciled).toMatchObject([{ status: 'COMPLETED', effectAttemptId: 'aera:worker-epoch:rc:t1:1', outcomeReported: true }])
    expect(router.state.outcomes).toHaveLength(1)
  }, 60_000)

  it('N-1: anything other than an ok plan is a refusal (an unvalidated kind never reaches the broker)', async () => {
    const world = makeWorkerWorld()
    const g = await governed(world)
    const effects = await g.plane.openEpoch({ desktopEpochId: 'aera:worker-epoch:n1', line: world.line, workspaceRoot: world.repoRoot })
    const outcome = await effects.execute({ intentId: 'x', kind: 'toString' as never, codeWorkingLineId: world.line.codeWorkingLineId }, { turn: 1, ordinal: 1 })
    expect(outcome).toMatchObject({ kind: 'REFUSED' })
    expect(router.state.attempts).toHaveLength(0)
  }, 60_000)

  it('F-2: the default plane is given the sandbox-exec port (an effect is not refused SANDBOX_NOT_PROVIDED)', async () => {
    if (process.platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec')) return
    const world = makeWorkerWorld()
    const g = await governed(world, {}, null)
    const effects = await g.plane.openEpoch({ desktopEpochId: 'aera:worker-epoch:f2', line: world.line, workspaceRoot: world.repoRoot })
    expect(await effects.execute({ ...read, codeWorkingLineId: world.line.codeWorkingLineId }, { turn: 1, ordinal: 1 })).toMatchObject({ kind: 'BROKER', result: { status: 'COMPLETED' } })
  }, 60_000)
})

describe('D-0d2 credentials (N-9) and config (F-1)', () => {
  it('N-9: senderProof signs only the effect attempt and outcome routes', async () => {
    const world = makeWorkerWorld()
    const g = await governed(world)
    const credentials = g.session.credentials()
    for (const route of [MODEL_INVOCATION_ATTEST_ROUTE, RELAY.begin, RELAY.continue, '/v1/local-effects/evaluate', '/v1/local-effects/attempts/x']) {
      expect(await codeOf(credentials.senderProof({ method: 'POST', route, body: {} }))).toBe('ROUTE_NOT_ALLOWED')
    }
    expect(await codeOf(credentials.senderProof({ method: 'GET', route: EFFECT_ROUTES.attempt, body: {} }))).toBe('ROUTE_NOT_ALLOWED')
    for (const route of [EFFECT_ROUTES.attempt, EFFECT_ROUTES.outcome]) {
      expect(await credentials.senderProof({ method: 'POST', route, body: { a: 1 } })).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/u)
    }
  }, 60_000)

  it('F-1: the effect catalog and its pin are required config; a broken catalog leaves the plane unconfigured', () => {
    const world = makeWorkerWorld()
    const missing = writeProfile(world)
    const document = JSON.parse(readFileSync(join(missing, AERA_CLAUDE_WORKER_CONFIG_FILENAME), 'utf8')) as { environment: Record<string, string> }
    delete document.environment.AERA_CLAUDE_WORKER_EFFECT_CATALOG
    writeFileSync(join(missing, AERA_CLAUDE_WORKER_CONFIG_FILENAME), JSON.stringify(document))
    expect(loadWorkerLocalEffectConfig(missing)).toEqual({ status: 'not-configured', reason: 'CONFIG_MISSING_KEY:AERA_CLAUDE_WORKER_EFFECT_CATALOG' })
    const pin = testEffectCatalogEnv()
    expect(loadWorkerLocalEffectConfig(writeProfile(world, { AERA_CLAUDE_WORKER_EFFECT_CATALOG_SHA256: 'b'.repeat(64), AERA_CLAUDE_WORKER_EFFECT_CATALOG: pin.AERA_CLAUDE_WORKER_EFFECT_CATALOG })))
      .toEqual({ status: 'not-configured', reason: 'CATALOG_PIN_MISMATCH' })
    const loaded = loadWorkerLocalEffectConfig(writeProfile(world))
    expect(loaded.status).toBe('loaded')
    const config = (loaded as { config: WorkerLocalEffectConfig }).config
    expect(Object.keys(config.effectCatalog.catalog).sort()).toEqual(['aera.repo.patch', 'aera.repo.read', 'aera.test.run'])
  })
})
