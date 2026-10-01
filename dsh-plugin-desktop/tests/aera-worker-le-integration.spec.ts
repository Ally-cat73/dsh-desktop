/**
 * INT-1 — desktop ↔ rehearsal integration (the V2.1 §3.14 test; desktop units
 * plan §4.9 with plan review M-5 and the R-1 review carries) —
 * WO-AERA-CODE-CLAUDE-CODE-GOVERNED-WORKER-INTEGRATION-001.
 *
 * The desktop's governed worker is composed in-process exactly as the host
 * does it (`aera-collab.ts`: config → D-0c session → D-0d2 plane with the
 * DEFAULT sandbox-exec port → `composeAeraWorker` with the H-1 hot path)
 * against a FRESH R-1 hold world (real Router LE listener and key door, CIS,
 * CAS, sentinel-api, Edge, ClickHouse, loopback Anthropic stub). The harness is
 * started by this spec, inside the same `aera-test-sandbox.sh` run (R-1 §2.4
 * rule 1: the wrapper denies loopback listeners that were live at its launch),
 * and torn down at the end (it removes only its own `hw-*` directory).
 *
 * Only test material is used: the world's disposable AGENT key (as a test
 * custody, never the Keychain), its test worker key file (the H-1 key reader
 * stand-in), its test-only client bearer (the CLI-OAuth stand-in, sent by the
 * fake CLI), and the deterministic fake CLI. No real `claude`, no real secret.
 *
 * Runs only with AERA_LE_REHEARSAL_HOLD_WORLD (the aera-stack worktree holding
 * the R-1 harness) and AERA_LE_REHEARSAL_PARENT (a short existing dir; the
 * world root is <parent>/hw-XXXXXX, see the harness's tsx pipe-length rule).
 * Optional: AERA_LE_REHEARSAL_DP9_HELPER (gw001-dp9-registry.sh, whose
 * `want_doc` generator the registry bytes are compared with) and
 * AERA_LE_REHEARSAL_JQ (default /opt/homebrew/bin/jq). Otherwise skipped.
 *
 * Scenario order matters (R-1 review N-3: an attestation admits key-door turns
 * for the AGENT + Connection for 120 s), so every "refused" model turn is
 * asserted before the first attestation of this run, or after the revoke.
 */
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { canonicalAgentCredentialProofBytes, issueAeraPrincipalId } from '@aera/cis-contracts'
import { createAgentSenderProof } from '@aera/local-effect-admission'
import { ParticipationStore } from '@aera/participation-runtime'
import { worktreeInstance } from '@aera/participation-contracts'
import { ClaudeCodeWorkerAdapter, buildClaudeWorkerArgv, buildClaudeWorkerEnv, type ClaudeWorkerPin } from '../src/aera-claude-worker-host.ts'
import { DEFAULT_WORKER_EPOCH_LIMITS } from '../src/aera-worker-adapter.ts'
import { NO_LOCAL_AUTHORITY_GATE, createGovernedEffectPlane, type GovernedEffectPlane } from '../src/aera-worker-effect-broker.ts'
import { AeraWorkerSessionManager } from '../src/aera-worker-session.ts'
import { AERA_CLAUDE_WORKER_CONFIG_FILENAME, loadWorkerLocalEffectConfig } from '../src/aera-worker-le-config.ts'
import { WORKER_EPOCH_PUBLIC_FILENAME, createWorkerLocalEffectSession, type WorkerLocalEffectSession } from '../src/aera-worker-le-session.ts'
import { installationKeyThumbprint } from '../src/aera-worker-installation-key.ts'
import { aeraWorkerStatus, composeAeraWorker, performAeraWorkerAction, resolveClaudeWorkerHotPath, type AeraWorkerRuntime } from '../src/aera-worker-composition.ts'
import { POISONED_PARENT_ENV, git, makeFakeClaude, type FakeScript } from './aera-worker-fixtures.ts'

const HOLD_REPO = process.env.AERA_LE_REHEARSAL_HOLD_WORLD
const PARENT = process.env.AERA_LE_REHEARSAL_PARENT
const DP9_HELPER = process.env.AERA_LE_REHEARSAL_DP9_HELPER
const JQ = process.env.AERA_LE_REHEARSAL_JQ ?? '/opt/homebrew/bin/jq'
const ENABLED = HOLD_REPO !== undefined && HOLD_REPO !== '' && PARENT !== undefined && PARENT !== ''
if (!ENABLED) {
  console.log('INT-1 skipped: set AERA_LE_REHEARSAL_HOLD_WORLD=<aera-stack worktree with the R-1 hold-world harness> and AERA_LE_REHEARSAL_PARENT=<short existing dir>, inside aera-test-sandbox.sh. INT-1 is not done unless it ran.')
}

/** R-1 review NO-2: the H-1 origin must be in AERA_DEV's exact allowed set. */
const ROUTER_HTTP_PORT = 4646
const ENVIRONMENT_ID = 'AERA_DEV'
const DELEGATION_ID = 'delegation-int1-desktop'
const GATEWAY_SESSION_SUBJECT = 'Worker Epoch Gateway Session: '

/** The keys of `aera.rehearsal.hold-world.handoff.v1` that INT-1 consumes. */
interface Handoff {
  readonly schema: string
  readonly worldRoot: string
  readonly router: { readonly localEffectUrl: string, readonly httpOrigin: string }
  readonly agent: { readonly principalId: string, readonly installationKeyId: string, readonly privateKeyFile: string }
  readonly binding: { readonly organisationId: string, readonly aeraSessionId: string, readonly workOrderId: string, readonly workingLineId: string, readonly repositoryId: string, readonly workerEpochId: string, readonly registryFile: string }
  readonly connection: { readonly connectionId: string, readonly modelId: string, readonly workerKeyFile: string, readonly testClientBearer: string }
  readonly workingLine: { readonly workspaceRoot: string, readonly readPath: string, readonly patchPath: string, readonly frozenPath: string }
  readonly catalog: { readonly testRuns: { readonly pass: { readonly executable: string, readonly argv: readonly string[] } } }
  readonly hooks: { readonly url: string, readonly token: string }
  readonly aeraClaudeWorkerConfig: Readonly<Record<string, string>>
}

interface StubCall { readonly headerNames: readonly string[], readonly hasAuthorization: boolean }

let harness: ChildProcessWithoutNullStreams | undefined
let harnessExit: Promise<number | null> | undefined
const harnessOutput: string[] = []
let h: Handoff
let workerKey: string
let base: string
let stateDir: string
let storeDir: string
let scratchRoot: string
let owner: string
let session: WorkerLocalEffectSession
let plane: GovernedEffectPlane
let runtime: AeraWorkerRuntime
let manager: AeraWorkerSessionManager
let windowEpochId: string | undefined
let worldEpochAtHandOver: string
const logs: string[] = []
const observations: string[] = []
/** Every AGENT session token this run held (scanned for in evidence and logs at the end). */
const agentTokens = new Set<string>()
const fakeDirs: string[] = []

/* ----------------------------------------------------------------- helpers */

async function startHarness(): Promise<string> {
  const repo = HOLD_REPO!
  const child = spawn(process.execPath, [
    '--import', join(repo, 'apps', 'sentinel-api', 'node_modules', 'tsx', 'dist', 'loader.mjs'),
    join(repo, 'tools', 'local-effect-rehearsal', 'src', 'hold-world.ts'),
    '--parent', PARENT!,
    '--router-http-port', String(ROUTER_HTTP_PORT),
  ], {
    cwd: join(repo, 'tools', 'local-effect-rehearsal'),
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? tmpdir(), TMPDIR: process.env.TMPDIR ?? tmpdir(), NODE_OPTIONS: '--max-old-space-size=1024' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  harness = child
  harnessExit = new Promise(resolve => { child.once('exit', code => { resolve(code) }) })
  return await new Promise<string>((resolve, reject) => {
    let settled = false
    // R-1 review NO-5: READY is on stdout, FAILED on stderr — read both.
    const onLine = (stream: string) => (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      harnessOutput.push(`${stream}: ${text}`)
      const ready = /HOLD_WORLD_READY (\S+)/u.exec(text)
      if (ready !== null && !settled) { settled = true; resolve(ready[1]!) }
      const failed = /HOLD_WORLD_FAILED ([^\n]*)/u.exec(text)
      if (failed !== null && !settled) { settled = true; reject(new Error(`HOLD_WORLD_FAILED ${failed[1] ?? ''}`)) }
    }
    child.stdout.on('data', onLine('stdout'))
    child.stderr.on('data', onLine('stderr'))
    void harnessExit!.then(code => { if (!settled) { settled = true; reject(new Error(`harness exited ${String(code)} before READY: ${harnessOutput.join('').slice(-2_000)}`)) } })
  })
}

async function hook(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number, body: Record<string, unknown> }> {
  const response = await fetch(`${h.hooks.url}${path}`, {
    method,
    headers: { authorization: `Bearer ${h.hooks.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

async function stubCalls(): Promise<StubCall[]> {
  const answer = await hook('GET', '/hooks/stub/calls')
  expect(answer.status).toBe(200)
  return (answer.body as { calls: StubCall[] }).calls
}

/** The world's disposable AGENT key as a D-0b-shaped custody port (never the Keychain). */
function handOffCustody() {
  const privateKey = createPrivateKey(readFileSync(h.agent.privateKeyFile))
  const x = (createPublicKey(privateKey).export({ format: 'jwk' }) as { x: string }).x
  const id = installationKeyThumbprint({ kty: 'OKP', crv: 'Ed25519', x })
  const refuse = (code: string): never => { throw Object.assign(new Error(`Worker installation key: ${code}`), { code }) }
  return {
    installationKeyId: id,
    port: {
      view: () => ({ status: 'ENROLLED', scope: 'DEV' }),
      assertInstallationKeyId: (expected: string) => { if (expected !== id) refuse('KEY_ID_MISMATCH') },
      senderProof: (claims: Parameters<typeof createAgentSenderProof>[0]['claims']) => {
        if (claims.installationKeyId !== id) refuse('KEY_ID_MISMATCH')
        return createAgentSenderProof({ privateKey, claims })
      },
      signAgentCredentialProof: (payload: Parameters<typeof canonicalAgentCredentialProofBytes>[0]) => {
        if (payload.installationKeyId !== id) refuse('KEY_ID_MISMATCH')
        return sign(null, canonicalAgentCredentialProofBytes(payload), privateKey).toString('base64url')
      },
    },
  }
}

/** NO-1: the desktop file is `{version:1, environment:{…}}`, the handoff's 15 keys as the environment. */
function writeConfig(dir: string): void {
  writeFileSync(join(dir, AERA_CLAUDE_WORKER_CONFIG_FILENAME), JSON.stringify({ version: 1, environment: h.aeraClaudeWorkerConfig }))
}

/**
 * The desktop's own store: owner, the binding's ACTIVE Work Order, and a Working
 * Line on the world's checkout. The store mints Working Line ids from content
 * (`aera:code_working_line:<sha8>`), while the world's CAS delegation and DP-9
 * record are fixed at the world's id, so this disposable store's line is
 * re-identified to the world's id (fixture only; dogfood uses the minted id).
 */
function seedStore(dir: string): string {
  const store = new ParticipationStore(dir)
  const human = issueAeraPrincipalId()
  store.registerHumanParticipant({ principalId: human, displayName: 'INT-1 Owner' })
  const workOrderId = h.binding.workOrderId
  store.registerWorkOrder({
    workOrderId,
    title: 'INT-1 governed Claude worker order',
    exactPayload: 'OBJECTIVE: INT-1 desktop rehearsal integration.\n',
    authorityClass: 'OWNER_SUPPLIED',
    lifecycleStatus: 'ACTIVE',
    owner: { principalId: human, displayName: 'INT-1 Owner' },
    source: { nativeSessionId: 's', messageId: 'm', eventSequence: 1, submittedAt: new Date().toISOString() },
  })
  const seeder = store.ensureAgentPrincipal({ displayName: 'INT-1 Line Seeder', agentRole: 'ORCHESTRATOR', createdBy: human })
  const seed = store.openSession({ principalId: seeder.principalId, workOrderId, delegationRef: { delegationId: DELEGATION_ID, delegatorPrincipalId: human, authorityMode: 'RECORDED_NOT_ENFORCED' } })
  const root = h.workingLine.workspaceRoot
  const branchRef = git(root, 'symbolic-ref', '--quiet', '--short', 'HEAD')
  // The world's Working Line is a fresh `git init` (unborn branch, untracked sources): record it as unborn, never commit into it.
  let head = '0'.repeat(40)
  try { head = git(root, 'rev-parse', '--verify', '--quiet', 'HEAD') } catch { /* unborn */ }
  type OpenInput = Parameters<ParticipationStore['openWorkingLine']>[0]
  const repositoryId = h.binding.repositoryId as OpenInput['repositoryId']
  const minted = store.openWorkingLine({
    sessionId: seed.sessionId,
    idempotencyKey: 'int1-line',
    authorisingWorkOrderId: workOrderId,
    workOrderId,
    repositoryId,
    originAcceptedStateId: 'aera:accepted_integration_state:int1-seed' as OpenInput['originAcceptedStateId'],
    originRevision: head,
    integrationTarget: { kind: 'ACCEPTED_INTEGRATION_STATE', repositoryId, targetRef: 'main' },
    expectedTargetRevision: head,
    label: 'INT-1 world line',
    branchRef,
    worktrees: [worktreeInstance({ repositoryId, localPath: root, branchRef, headRevision: head, dirtyState: 'CLEAN' })],
  }).line
  store.closeSession(seed.sessionId)
  const file = 'code-working-lines.json'
  const rows = (JSON.parse(readFileSync(join(dir, file), 'utf8')) as { codeWorkingLineId: string }[])
    .map(row => row.codeWorkingLineId === minted.codeWorkingLineId ? { ...row, codeWorkingLineId: h.binding.workingLineId } : row)
  ;(store as unknown as { writeRecords(file: string, records: unknown[]): void }).writeRecords(file, rows)
  expect(store.listCodeWorkingLines(workOrderId).map(row => row.codeWorkingLineId)).toEqual([h.binding.workingLineId])
  return human
}

function compositionEnv(pin: ClaudeWorkerPin): Record<string, string> {
  return {
    ...POISONED_PARENT_ENV,
    AERA_COLLAB_STORE_DIR: storeDir,
    AERA_COLLAB_PRINCIPAL_ID: owner,
    AERA_COLLAB_DELEGATION_ID: DELEGATION_ID,
    AERA_CLAUDE_WORKER_BINARY: pin.binaryPath,
    AERA_CLAUDE_WORKER_SHA256: pin.sha256,
    AERA_CLAUDE_WORKER_VERSION: pin.version,
    AERA_CLAUDE_WORKER_MODEL: pin.model,
  }
}

async function fake(script: FakeScript): Promise<ClaudeWorkerPin> {
  const dir = mkdtempSync(join(tmpdir(), 'int1-fake-'))
  fakeDirs.push(dir)
  return (await makeFakeClaude({ model: h.connection.modelId, modelRequest: true, modelBearer: h.connection.testClientBearer, ...script }, dir)).pin
}

/**
 * One fake-CLI model turn NOT gated by the desktop (the H-1 env and argv the
 * adapter builds, spawned directly): what the Router itself does with a turn.
 * Returns the Router's HTTP status as the fake CLI saw it.
 */
async function directModelTurn(): Promise<string> {
  const pin = await fake({ turns: [{ text: 'router=${ROUTER}' }] })
  const env = buildClaudeWorkerEnv(POISONED_PARENT_ENV, { baseUrl: h.router.httpOrigin, connectionId: h.connection.connectionId, routerKey: workerKey })
  const child = spawn(pin.binaryPath, buildClaudeWorkerArgv(pin, 'INT-1 direct model turn'), { env, cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] })
  const text = await new Promise<string>((resolve, reject) => {
    let buffer = ''
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      for (const line of buffer.split('\n')) {
        if (!line.startsWith('{')) continue
        try {
          const event = JSON.parse(line) as { type?: string, result?: string }
          if (event.type === 'result') resolve(String(event.result))
        } catch { /* partial line */ }
      }
    })
    child.once('exit', code => { reject(new Error(`fake CLI exited ${String(code)} before a result`)) })
    child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: 'INT-1 ping' } })}\n`)
  })
  child.stdin.end()
  observations.push(text)
  return (/router=(\S+)/u.exec(text) ?? ['', 'NONE'])[1]!
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

function localEffectState(): string {
  return String((aeraWorkerStatus(runtime, h.binding.workOrderId) as { localEffect?: { state?: string } }).localEffect?.state)
}

/** The registry bytes as written, and (if the helper is given) what gw001-dp9-registry.sh's own generator writes for the same tuple. */
function dp9Compare(epoch: string):{ written: string, generated: string | undefined } {
  const written = readFileSync(h.binding.registryFile, 'utf8')
  if (DP9_HELPER === undefined || DP9_HELPER === '') return { written, generated: undefined }
  const source = readFileSync(DP9_HELPER, 'utf8')
  const generator = /^want_doc\(\) \{[\s\S]*?\n\}\n/mu.exec(source)?.[0]
  const schema = /^SCHEMA=([^;\s]+)/mu.exec(source)?.[1]
  const pending = /PENDING=([^;\s]+)/u.exec(source)?.[1]
  expect(generator).toBeDefined()
  expect(schema).toBe('aera.router.execution-bindings/v1')
  expect(pending).toBe('aera:worker_epoch:pending')
  const b = h.binding
  const generated = execFileSync('/bin/bash', ['--noprofile', '--norc', '-c', `set -euo pipefail\n${generator!}\nwant_doc "$EPOCH" | jq -c .`], {
    env: { PATH: `${dirname(JQ)}:/usr/bin:/bin`, LC_ALL: 'C', SCHEMA: schema!, ORG: b.organisationId, SES: b.aeraSessionId, WO: b.workOrderId, LINE: b.workingLineId, REPO: b.repositoryId, A: h.agent.principalId, EPOCH: epoch === 'pending' ? pending! : epoch },
    encoding: 'utf8',
  }).replace(/\n$/u, '')
  return { written, generated }
}

/** Every file under `dir` (recursive), as text. */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => readFileSync(join(entry.parentPath, entry.name), 'utf8'))
}

/* ------------------------------------------------------------------- setup */

beforeAll(async () => {
  if (!ENABLED) return
  const handoffFile = await startHarness()
  h = JSON.parse(readFileSync(handoffFile, 'utf8')) as Handoff
  expect(h.schema).toBe('aera.rehearsal.hold-world.handoff.v1')
  expect(h.router.httpOrigin).toBe(`http://127.0.0.1:${String(ROUTER_HTTP_PORT)}`)
  workerKey = readFileSync(h.connection.workerKeyFile, 'utf8').trim()
  worldEpochAtHandOver = h.binding.workerEpochId
  base = mkdtempSync(join(tmpdir(), 'int1-desktop-'))
  stateDir = join(base, 'profile')
  storeDir = join(base, 'store')
  scratchRoot = join(base, 'scratch')
  for (const dir of [stateDir, storeDir, scratchRoot]) mkdirSync(dir, { recursive: true })
  owner = seedStore(storeDir)
}, 240_000)

afterAll(async () => {
  if (!ENABLED) return
  if (runtime?.kind === 'AVAILABLE') runtime.modelAttest?.dispose()
  if (harness !== undefined && harness.exitCode === null) {
    harness.kill('SIGTERM')
    const code = await Promise.race([harnessExit, new Promise<'TIMEOUT'>(resolve => { setTimeout(() => { resolve('TIMEOUT') }, 60_000) })])
    expect(code).toBe(0)
    expect(harnessOutput.join('')).toContain('HOLD_WORLD_CLOSED')
    // The harness removed its own world directory (and only that).
    expect(h === undefined || existsSync(h.worldRoot)).toBe(false)
  }
}, 90_000)

/* --------------------------------------------------------------- scenarios */

describe.skipIf(!ENABLED)('INT-1 desktop ↔ rehearsal world (fresh world per run)', () => {
  it('(1) not configured → UNAVAILABLE; configured → NO_EPOCH (Begin required); nothing spawns; an ungated model turn is refused by the Router and the stub sees nothing', async () => {
    const custody = handOffCustody()
    expect(custody.installationKeyId).toBe(h.agent.installationKeyId)
    const pin = await fake({ turns: [{ text: 'never spawned' }] })

    // (1a) No aera-claude-worker.json in the Profile: not configured, so no plane, so UNAVAILABLE.
    const emptyProfile = join(base, 'profile-empty')
    mkdirSync(emptyProfile)
    const notConfigured = loadWorkerLocalEffectConfig(emptyProfile)
    expect(notConfigured.status).toBe('not-configured')
    const bare = createWorkerLocalEffectSession({ config: notConfigured, custody: custody.port as never, stateDir: emptyProfile, handOverDir: join(emptyProfile, 'public'), log: line => { logs.push(line) } })
    const unconfigured = composeAeraWorker(compositionEnv(pin), { installationKey: custody.port as never, localEffect: bare, log: line => { logs.push(line) } })
    expect(unconfigured.kind).toBe('UNAVAILABLE')
    expect(aeraWorkerStatus(unconfigured, h.binding.workOrderId)).toMatchObject({ localEffect: { state: 'NOT_CONFIGURED' } })
    expect(await codeOf(performAeraWorkerAction(unconfigured, { action: 'START_EPOCH', workOrderId: h.binding.workOrderId, codeWorkingLineId: h.binding.workingLineId, task: 't' }, () => {}))).toBe('WORKER_UNAVAILABLE')
    expect(await codeOf(performAeraWorkerAction(unconfigured, { action: 'BEGIN_AGENT_EPOCH', workOrderId: h.binding.workOrderId }, () => {}))).toBe('NOT_CONFIGURED')

    // (1b) The handoff config, composed exactly as the host does: AVAILABLE, but no Epoch yet.
    writeConfig(stateDir)
    const loaded = loadWorkerLocalEffectConfig(stateDir)
    if (loaded.status !== 'loaded') throw new Error(`handoff config refused: ${loaded.reason}`)
    session = createWorkerLocalEffectSession({ config: loaded, custody: custody.port as never, stateDir, handOverDir: join(stateDir, 'public'), log: line => { logs.push(line) } })
    // The DEFAULT plane: the macOS sandbox-exec port (D-0d1 F-2), no sandbox injected.
    plane = createGovernedEffectPlane({ config: loaded.config, session, journalDir: join(stateDir, 'aera-worker', 'broker-journal'), log: line => { logs.push(line) } })
    const routerHotPath = { baseUrl: loaded.config.modelRouterOrigin, readRouterKey: async () => readFileSync(h.connection.workerKeyFile, 'utf8').trim() }
    runtime = composeAeraWorker(compositionEnv(pin), { installationKey: custody.port as never, localEffect: session, effectPlane: plane, routerHotPath, log: line => { logs.push(line) } })
    expect(runtime.kind).toBe('AVAILABLE')
    expect(localEffectState()).toBe('NO_EPOCH')
    expect(aeraWorkerStatus(runtime, h.binding.workOrderId)).toMatchObject({ authorityMode: 'CAS', authorityEnvelope: [], modelAttest: { state: 'NOT_ATTESTED' } })
    const before = (await stubCalls()).length
    expect(await codeOf(performAeraWorkerAction(runtime, { action: 'START_EPOCH', workOrderId: h.binding.workOrderId, codeWorkingLineId: h.binding.workingLineId, task: 't' }, () => {}))).toBe('MODEL_AUTHORITY_UNAVAILABLE')
    expect(new ParticipationStore(storeDir).listTypedEvidence(h.binding.workOrderId).filter(row => row.subject.startsWith('Worker Epoch'))).toHaveLength(0)

    // (1c) Before any attestation of this run: a model turn straight at the Router key door is refused, nothing reaches the stub.
    expect(await directModelTurn()).toBe('403')
    expect((await stubCalls()).length).toBe(before)
  }, 120_000)

  it('(2) registry ABSENT → Begin refused; unbound → AWAITING_PENDING_BINDING; DP-9 pending → Begin → BEGUN_AWAITING_BINDING (attest refused, nothing spawns); DP-9 epoch → READY with no manual reset (M-1 / C-7)', async () => {
    const registry = h.binding.registryFile
    const start = (): Promise<string> => codeOf(performAeraWorkerAction(runtime, { action: 'START_EPOCH', workOrderId: h.binding.workOrderId, codeWorkingLineId: h.binding.workingLineId, task: 't' }, () => {}))
    const begin = (): Promise<unknown> => performAeraWorkerAction(runtime, { action: 'BEGIN_AGENT_EPOCH', workOrderId: h.binding.workOrderId }, () => {})
    const stub0 = (await stubCalls()).length

    // ABSENT (the production state before the first DP-9 write): the Router answers UNAVAILABLE; the state does not move.
    renameSync(registry, `${registry}.int1-absent`)
    expect(await codeOf(begin())).toBe('EXECUTION_REGISTRY_UNAVAILABLE')
    expect(localEffectState()).toBe('NO_EPOCH')

    // A registry that does not bind the AGENT to the Session (operator-style 0600 write + rename; the hooks have no unbound state).
    const temp = `${registry}.int1-${String(process.pid)}`
    writeFileSync(temp, JSON.stringify({ schema: 'aera.router.execution-bindings/v1', bindings: [] }), { mode: 0o600 })
    chmodSync(temp, 0o600)
    renameSync(temp, registry)
    expect(await codeOf(begin())).toBe('AGENT_NOT_BOUND_TO_SESSION')
    expect(localEffectState()).toBe('AWAITING_PENDING_BINDING')
    expect(await start()).toBe('MODEL_AUTHORITY_UNAVAILABLE')

    // DP-9 write 1 (pending). The bytes equal the DP-9 helper's own generator for the same tuple.
    expect((await hook('POST', '/hooks/dp9/pending')).status).toBe(200)
    const pending = dp9Compare('pending')
    if (pending.generated !== undefined) {
      expect(pending.written).toBe(pending.generated)
      console.log(`INT1_DP9 pending written_bytes=${String(pending.written.length)} equals_helper_want_doc_jq_c=true`)
    } else {
      console.log('INT1_DP9_COMPARE skipped: AERA_LE_REHEARSAL_DP9_HELPER not set')
    }

    // Begin (explicit, CD-4): a new CIS Epoch supersedes the world's own.
    const begun = await begin() as { workerEpochId: string, publicEpochPath?: string }
    windowEpochId = begun.workerEpochId
    expect(windowEpochId).toMatch(/^aera:worker_epoch:[0-9a-f-]{36}$/u)
    expect(windowEpochId).not.toBe(worldEpochAtHandOver)
    expect(localEffectState()).toBe('BEGUN_AWAITING_BINDING')
    expect(await codeOf(begin())).toBe('EPOCH_ALREADY_BEGUN')

    // The registry still names pending: attest is attempted (M-1) and refused; nothing spawns, nothing reaches the stub.
    expect(await start()).toBe('MODEL_AUTHORITY_UNAVAILABLE')
    expect(localEffectState()).toBe('BEGUN_AWAITING_BINDING')
    expect(aeraWorkerStatus(runtime, h.binding.workOrderId)).toMatchObject({ modelAttest: { state: 'MODEL_AUTHORITY_REFUSED' } })
    expect((await stubCalls()).length).toBe(stub0)

    // DP-9 write 2: the operator reads the Epoch id from the ONE public hand-over file (M-6), never app-data.
    expect(begun.publicEpochPath).toBe(join(stateDir, 'public', WORKER_EPOCH_PUBLIC_FILENAME))
    const handedOver = JSON.parse(readFileSync(begun.publicEpochPath!, 'utf8')) as Record<string, unknown>
    expect(Object.keys(handedOver).sort()).toEqual(['aeraSessionId', 'agentPrincipalId', 'beganAt', 'workerEpochId'])
    expect(handedOver).toMatchObject({ workerEpochId: windowEpochId, agentPrincipalId: h.agent.principalId, aeraSessionId: h.binding.aeraSessionId })
    expect((await hook('POST', '/hooks/dp9/epoch', { workerEpochId: handedOver.workerEpochId })).status).toBe(200)
    const epoch = dp9Compare(begun.workerEpochId)
    if (epoch.generated !== undefined) {
      expect(epoch.written).toBe(epoch.generated)
      console.log(`INT1_DP9 epoch written_bytes=${String(epoch.written.length)} equals_helper_want_doc_jq_c=true`)
    }
    expect(JSON.parse(epoch.written)).toEqual({ schema: 'aera.router.execution-bindings/v1', bindings: [{ organisationId: h.binding.organisationId, aeraSessionId: h.binding.aeraSessionId, workOrderId: h.binding.workOrderId, workingLineId: h.binding.workingLineId, repositoryId: h.binding.repositoryId, agentPrincipalId: h.agent.principalId, currentWorkerEpochId: windowEpochId, status: 'ACTIVE' }] })

    // No re-begin and no reset: the next gate attempt succeeds and the session is READY.
    if (runtime.kind !== 'AVAILABLE' || runtime.modelAttest === undefined) throw new Error('no attestor composed')
    const attested = await runtime.modelAttest.ensureFresh()
    expect(attested).toMatchObject({ ok: true, workerEpochId: windowEpochId })
    expect(localEffectState()).toBe('READY')
    expect(session.workerEpochId()).toBe(windowEpochId)
    agentTokens.add(await session.credentials().sessionToken())
  }, 120_000)

  it('(3)+(4) one window Epoch: fake-CLI model turns reach the stub through the Router with the CLI bearer and no x-aera-* header; governed effects: patch released + reported, frozen withheld, out of scope refused, test.run fails closed at the nested sandbox', async () => {
    if (runtime.kind !== 'AVAILABLE' || runtime.modelAttest === undefined) throw new Error('no attestor composed')
    const root = h.workingLine.workspaceRoot
    const frozenBefore = readFileSync(join(root, h.workingLine.frozenPath), 'utf8')
    const appBefore = readFileSync(join(root, h.workingLine.patchPath), 'utf8')
    const patched = `export const version = 'int1-${String(process.pid)}'\n`
    expect(appBefore).not.toBe(patched)
    const pass = h.catalog.testRuns.pass
    const stub0 = (await stubCalls()).length
    const pin = await fake({
      turns: [
        {
          text: 'router=${ROUTER}',
          intents: [
            { intentId: 'r1', kind: 'fs.read', path: h.workingLine.readPath },
            { intentId: 'w1', kind: 'fs.write', path: h.workingLine.patchPath, content: patched },
            { intentId: 'w2', kind: 'fs.write', path: h.workingLine.frozenPath, content: 'export const frozen = "changed"\n' },
            { intentId: 'c1', kind: 'git.commit', paths: [h.workingLine.patchPath], message: 'int1' },
            { intentId: 's1', kind: 'exec.shell', argv: ['/bin/echo', 'hi'] },
            { intentId: 't0', kind: 'exec.test', argv: ['/bin/echo', 'not in the catalog'] },
            { intentId: 't1', kind: 'exec.test', argv: [pass.executable, ...pass.argv] },
          ],
        },
        { text: 'router=${ROUTER}', status: 'DONE' },
      ],
    })
    // The composed attestor, plane and gate; the adapter as composition builds it (pin + resolved H-1 hot path),
    // except that the fake CLI is unsigned, so the darwin TeamIdentifier pin is not set (as in every fake-CLI suite).
    const routing = resolveClaudeWorkerHotPath({ environmentId: ENVIRONMENT_ID, connectionId: h.connection.connectionId, source: { baseUrl: h.router.httpOrigin, readRouterKey: async () => readFileSync(h.connection.workerKeyFile, 'utf8').trim() } })
    if (routing.kind !== 'ROUTED') throw new Error(routing.reason)
    manager = new AeraWorkerSessionManager({
      store: new ParticipationStore(storeDir),
      adapter: new ClaudeCodeWorkerAdapter(pin, { parentEnv: POISONED_PARENT_ENV, scratchRoot, hotPath: routing.hotPath }),
      gate: NO_LOCAL_AUTHORITY_GATE,
      config: { humanPrincipalId: owner as never, delegationId: DELEGATION_ID, environmentId: ENVIRONMENT_ID, limits: { ...DEFAULT_WORKER_EPOCH_LIMITS, turnTimeoutMs: 30_000, epochTimeoutMs: 90_000, cancelGraceMs: 500 } },
      broker: { parentEnv: POISONED_PARENT_ENV },
      modelAttest: runtime.modelAttest,
      effectPlane: plane,
    })
    const result = await manager.runEpoch({ workOrderId: h.binding.workOrderId, codeWorkingLineId: h.binding.workingLineId, task: 'INT-1 governed window task' })
    observations.push(...result.outcomes.map(outcome => outcome.observation))
    agentTokens.add(await session.credentials().sessionToken())
    expect(result.terminal.status).toBe('COMPLETED')

    // (3) Both turns went through the Router key door (200) to the stub: the CLI's bearer, no x-aera-* header.
    const calls = (await stubCalls()).slice(stub0)
    expect(calls).toHaveLength(2)
    for (const call of calls) {
      expect(call.hasAuthorization).toBe(true)
      expect(call.headerNames.filter(name => name.toLowerCase().startsWith('x-aera-'))).toEqual([])
    }
    const turnTexts = new ParticipationStore(storeDir).listTypedEvidence(h.binding.workOrderId).map(row => row.body).join('\n')
    expect(turnTexts).toContain('router=200')
    expect(turnTexts).not.toMatch(/router=(?!200)\S+/u)

    // (4) Governed effects, CAS deciding through the Router.
    const byId = new Map(result.outcomes.map(outcome => [outcome.intentId, outcome]))
    expect(byId.get('r1')).toMatchObject({ performed: true, stage: 'EXECUTION', code: 'PERFORMED' })
    expect(byId.get('w1')).toMatchObject({ performed: true, stage: 'EXECUTION', code: 'PERFORMED', combinedDecisionId: expect.stringMatching(/\S/u) })
    expect(byId.get('w1')?.observation).toContain('outcome reported: yes')
    expect(byId.get('w1')?.observation).toContain('verification PASS')
    expect(readFileSync(join(root, h.workingLine.patchPath), 'utf8')).toBe(patched)
    expect(byId.get('w2')).toMatchObject({ performed: false, stage: 'AUTHORITY', code: expect.stringMatching(/^WITHHELD:/u), combinedDecisionId: expect.stringMatching(/\S/u) })
    expect(readFileSync(join(root, h.workingLine.frozenPath), 'utf8')).toBe(frozenBefore)
    expect(byId.get('c1')).toMatchObject({ performed: false, code: 'NOT_DELEGATED_IN_GOVERNED_MODE' })
    expect(byId.get('s1')).toMatchObject({ performed: false, code: 'NOT_DELEGATED_IN_GOVERNED_MODE' })
    expect(byId.get('t0')).toMatchObject({ performed: false, code: 'TEST_COMMAND_NOT_IN_CATALOG' })
    // Controller decision (R-1 N-1): inside the wrapper the real Seatbelt cannot nest, so aera.test.run FAILS CLOSED:
    // released, but the command never ran (no output); reported as a failure, never a pass.
    const t1 = byId.get('t1')!
    console.log(`INT1_TEST_RUN code=${t1.code} stage=${t1.stage} performed=${String(t1.performed)} observation=${JSON.stringify(t1.observation.slice(0, 600))}`)
    // The signature: CAS released it (combined decision), the sandbox-exec wrapper exited 71 (`sandbox_apply` refused
    // when nested) so the catalog command produced no output, the outcome went back to the Router, and it is a FAIL.
    expect(t1).toMatchObject({ performed: true, stage: 'EXECUTION', code: 'PERFORMED_WITH_FAILURE', combinedDecisionId: expect.stringMatching(/\S/u) })
    expect(t1.observation).toContain('outcome reported: yes; verification FAIL')
    expect(t1.observation).toMatch(/\nexit 71\n--- stdout ---\s*$/u)
    expect(t1.observation).not.toContain('17 passed')

    // Evidence: every performed effect is recorded with its combined decision, performed/verified by Aera principals.
    const store = new ParticipationStore(storeDir)
    const performed = store.listTypedEvidence(h.binding.workOrderId).filter(row => row.evidenceClass === 'EXECUTION_EVIDENCE')
    expect(performed.find(row => row.subject.includes('(t1)'))?.outcome).toBe('FAIL')
    const w1Row = performed.find(row => row.subject.includes('(w1)'))
    expect(w1Row?.outcome).toBe('PASS')
    expect(w1Row?.body).toContain(String(byId.get('w1')?.combinedDecisionId))
    const principals = manager.principals(h.binding.workOrderId)
    expect(w1Row?.contribution).toMatchObject({ performedBy: principals.broker, verifiedBy: principals.verifier })

    // (7) Exactly one Gateway Session recorded for the window (one desktop Epoch, one native CLI session id).
    const gateway = store.listTypedEvidence(h.binding.workOrderId).filter(row => row.subject.startsWith(GATEWAY_SESSION_SUBJECT))
    expect(gateway).toHaveLength(1)
    expect(gateway[0]!.subject).toBe(`${GATEWAY_SESSION_SUBJECT}${result.epochId}`)
    expect(JSON.parse(String(gateway[0]!.body))).toMatchObject({ epochId: result.epochId, aeraSessionId: expect.any(String), nativeSessionId: expect.stringMatching(/^[0-9a-f-]{36}$/u) })
    expect(aeraWorkerStatus(runtime, h.binding.workOrderId)).toMatchObject({ authorityMode: 'CAS', authorityEnvelope: [] })

    // K-9 (record only): the oracle-style git top-level lookup on the world's checkout.
    const t = process.hrtime.bigint()
    execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { env: { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' } })
    console.log(`INT1_K9 git_rev_parse_ms=${(Number(process.hrtime.bigint() - t) / 1e6).toFixed(1)}`)
  }, 180_000)

  it('(5) revoke the delegation → the next model turn is refused (even within a fresh receipt), the next attest is refused, and nothing spawns', async () => {
    if (runtime.kind !== 'AVAILABLE' || runtime.modelAttest === undefined) throw new Error('no attestor composed')
    const stub0 = (await stubCalls()).length
    const started0 = new ParticipationStore(storeDir).listTypedEvidence(h.binding.workOrderId).filter(row => row.subject.startsWith('Worker Epoch started')).length
    expect((await hook('POST', '/hooks/delegation/revoke')).body).toEqual({ revoked: true })
    // NO-3: a model turn after the revoke, asserted BEFORE any further attestation attempt.
    expect(await directModelTurn()).toBe('403')
    expect((await stubCalls()).length).toBe(stub0)
    const attest = await runtime.modelAttest.attestNow()
    expect(attest).toMatchObject({ ok: false, state: 'MODEL_AUTHORITY_REFUSED' })
    expect(aeraWorkerStatus(runtime, h.binding.workOrderId)).toMatchObject({ modelAttest: { state: 'MODEL_AUTHORITY_REFUSED' } })
    expect(await codeOf(manager.runEpoch({ workOrderId: h.binding.workOrderId, codeWorkingLineId: h.binding.workingLineId, task: 'after revoke' }))).toBe('MODEL_AUTHORITY_UNAVAILABLE')
    expect(await codeOf(performAeraWorkerAction(runtime, { action: 'START_EPOCH', workOrderId: h.binding.workOrderId, codeWorkingLineId: h.binding.workingLineId, task: 't' }, () => {}))).toBe('MODEL_AUTHORITY_UNAVAILABLE')
    expect(new ParticipationStore(storeDir).listTypedEvidence(h.binding.workOrderId).filter(row => row.subject.startsWith('Worker Epoch started'))).toHaveLength(started0)
    expect((await stubCalls()).length).toBe(stub0)
    console.log(`INT1_ATTEST_AFTER_REVOKE code=${attest.ok ? 'OK' : attest.code}`)
  }, 120_000)

  it('(7) no worker key, AGENT token, client bearer, hook token or AGENT key material in evidence, logs, app-data, journal, scratch or stub-received headers', async () => {
    const pem = readFileSync(h.agent.privateKeyFile, 'utf8')
    const pemBody = pem.split('\n').filter(line => line !== '' && !line.startsWith('-----')).join('')
    const secrets = [workerKey, h.connection.testClientBearer, h.hooks.token, pemBody, ...agentTokens]
    expect(agentTokens.size).toBeGreaterThan(0)
    for (const secret of secrets) expect(secret.length).toBeGreaterThan(15)
    const statuses = JSON.stringify(aeraWorkerStatus(runtime, h.binding.workOrderId))
    const haystack = [
      logs.join('\n'),
      observations.join('\n'),
      statuses,
      harnessOutput.join(''),
      ...filesUnder(stateDir),
      ...filesUnder(storeDir),
      ...filesUnder(scratchRoot),
      ...filesUnder(join(base, 'profile-empty')),
    ].join('\n')
    expect(haystack.length).toBeGreaterThan(1_000)
    for (const secret of secrets) expect(haystack.includes(secret)).toBe(false)
    // The key is never in this process's environment (H-1: child env only).
    for (const value of Object.values(process.env)) expect(value?.includes(workerKey) ?? false).toBe(false)
    // The stub saw no Aera header at all (names only are exposed; a key could only travel under an x-aera-* name).
    for (const call of await stubCalls()) {
      expect(call.headerNames.filter(name => name.toLowerCase().startsWith('x-aera-'))).toEqual([])
    }
    console.log(`INT1_EVIDENCE_SCAN secrets=${String(secrets.length)} haystack_bytes=${String(haystack.length)} tokens=${String(agentTokens.size)}`)
  }, 60_000)
})
