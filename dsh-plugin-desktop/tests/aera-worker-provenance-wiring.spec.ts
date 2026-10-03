/**
 * O-1 U-D wiring: the provenance manifest from config to the written turn —
 * WO-AERA-CODE-CLAUDE-CODE-GOVERNED-WORKER-INTEGRATION-001
 * (O1_PROVENANCE_SPEC_V2 §4.1, §5.4, §5.5, §7, §9.2; V2.1 NO-2, NO-11).
 *
 * (d) the two optional Profile keys (`AERA_CLAUDE_WORKER_CLI_ACCOUNT_EMAIL`,
 *     `AERA_CLAUDE_WORKER_PROVENANCE_MANIFEST`), the address never echoed and
 *     reduced to its two CLI-note digests at load (NO-11);
 * (g) manifest mode refused outside the reviewed model set and CLI pin, before
 *     any spawn and before any attest (NO-2 / A61).
 *
 * Only `.invalid` addresses appear here.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { issueAeraPrincipalId } from '@aera/cis-contracts'
import { caFingerprintSha256 } from '@aera/effect-broker'
import {
  CIS_ISSUER, ROUTER_SAN, generatePki, testCustody, testEffectCatalogEnv, testModelRoutingEnv,
  type Pki, type TestCustody,
} from './aera-worker-le-fixtures.ts'
import { makeFakeClaude, makeWorkerWorld } from './aera-worker-fixtures.ts'

const { AERA_CLAUDE_WORKER_CONFIG_FILENAME, loadWorkerLocalEffectConfig } = await import('../src/aera-worker-le-config.ts')
const { cliMetadataDigests, CLAUDE_CLI_PROVENANCE_PIN } = await import('../src/aera-worker-provenance.ts')
const { composeAeraWorker, aeraWorkerStatus, performAeraWorkerAction } = await import('../src/aera-worker-composition.ts')
const { isDesktopLogFileName } = await import('../src/log-files.ts')

const HERE = dirname(fileURLToPath(import.meta.url))
const DUMMY = 'worker-fixture@example.invalid'
const PRINCIPAL = issueAeraPrincipalId()
let pki: Pki
let custody: TestCustody

beforeAll(() => {
  pki = generatePki()
  custody = testCustody()
}, 60_000)

function environment(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    AERA_CLAUDE_WORKER_LE_ROUTER_URL: 'https://127.0.0.1:4443/',
    AERA_CLAUDE_WORKER_LE_CA_FILE: pki.caA,
    AERA_CLAUDE_WORKER_LE_CA_SHA256: caFingerprintSha256(readFileSync(pki.caA)),
    AERA_CLAUDE_WORKER_LE_ROUTER_URI_SAN: ROUTER_SAN,
    AERA_CLAUDE_WORKER_CIS_ISSUER: CIS_ISSUER,
    AERA_CLAUDE_WORKER_AGENT_PRINCIPAL_ID: PRINCIPAL,
    AERA_CLAUDE_WORKER_INSTALLATION_KEY_ID: custody.installationKeyId,
    AERA_CLAUDE_WORKER_AERA_SESSION_ID: 'aera:session:o1-ud-wiring',
    AERA_CLAUDE_WORKER_CONNECTION_ID: 'claude-worker-o1ud',
    AERA_CLAUDE_WORKER_ORGANISATION_ID: 'aera:org:aera-studios',
    AERA_CLAUDE_WORKER_REPOSITORY_ID: 'aera-repo:aera-stack',
    AERA_CLAUDE_WORKER_WORKING_LINE_ID: 'aera:code_working_line:o1ud-1',
    ...testEffectCatalogEnv(),
    ...testModelRoutingEnv(),
    ...overrides,
  }
}

function profile(env: Record<string, string | undefined>): string {
  const dir = mkdtempSync(join(tmpdir(), 'o1ud-profile-'))
  writeFileSync(join(dir, AERA_CLAUDE_WORKER_CONFIG_FILENAME), JSON.stringify({ version: 1, environment: env }))
  return dir
}

describe('(d) the optional CLI account address and the manifest flag (§7, NO-11)', () => {
  it('both keys are optional: absent → loaded, manifest off, no CLI digest', () => {
    const loaded = loadWorkerLocalEffectConfig(profile(environment()))
    expect(loaded.status).toBe('loaded')
    if (loaded.status !== 'loaded') return
    expect(loaded.config.provenance).toEqual({ manifest: false })
    expect('cliMetadata' in loaded.config.provenance).toBe(false)
  })

  it('manifest on/off parse; any other value is CONFIG_INVALID naming the key only', () => {
    for (const [value, manifest] of [['on', true], ['off', false]] as const) {
      const loaded = loadWorkerLocalEffectConfig(profile(environment({ AERA_CLAUDE_WORKER_PROVENANCE_MANIFEST: value })))
      expect(loaded).toMatchObject({ status: 'loaded', config: { provenance: { manifest } } })
    }
    for (const value of ['ON', 'true', '1', 'yes']) {
      expect(loadWorkerLocalEffectConfig(profile(environment({ AERA_CLAUDE_WORKER_PROVENANCE_MANIFEST: value }))))
        .toEqual({ status: 'not-configured', reason: 'CONFIG_INVALID:AERA_CLAUDE_WORKER_PROVENANCE_MANIFEST' })
    }
  })

  it('a valid address is reduced at load to the two CLI-note digests; the address itself is held nowhere in the config', () => {
    const loaded = loadWorkerLocalEffectConfig(profile(environment({ AERA_CLAUDE_WORKER_CLI_ACCOUNT_EMAIL: DUMMY, AERA_CLAUDE_WORKER_PROVENANCE_MANIFEST: 'on' })))
    expect(loaded.status).toBe('loaded')
    if (loaded.status !== 'loaded') return
    expect(loaded.config.provenance).toEqual({ manifest: true, cliMetadata: cliMetadataDigests(DUMMY) })
    const surface = JSON.stringify(loaded.config, (_key, value: unknown) => Buffer.isBuffer(value) ? '<pem>' : value)
    expect(surface).not.toContain(DUMMY)
    expect(surface).not.toContain('worker-fixture')
  })

  it('an invalid address is not-configured with a reason naming the key, never the value', () => {
    for (const bad of ['not-an-address', 'two@@example.invalid', 'worker-fixture@example', 'worker fixture@example.invalid']) {
      const result = loadWorkerLocalEffectConfig(profile(environment({ AERA_CLAUDE_WORKER_CLI_ACCOUNT_EMAIL: bad })))
      expect(result).toEqual({ status: 'not-configured', reason: 'CONFIG_INVALID:AERA_CLAUDE_WORKER_CLI_ACCOUNT_EMAIL' })
      expect(JSON.stringify(result)).not.toContain(bad)
    }
  })

  it('the required keys stay required; an unknown key is still refused', () => {
    expect(loadWorkerLocalEffectConfig(profile(environment({ AERA_CLAUDE_WORKER_CIS_ISSUER: undefined }))))
      .toEqual({ status: 'not-configured', reason: 'CONFIG_MISSING_KEY:AERA_CLAUDE_WORKER_CIS_ISSUER' })
    expect(loadWorkerLocalEffectConfig(profile(environment({ AERA_CLAUDE_WORKER_CLI_EMAIL: DUMMY }))))
      .toEqual({ status: 'not-configured', reason: 'CONFIG_UNKNOWN_KEY:AERA_CLAUDE_WORKER_CLI_EMAIL' })
  })

  it('the header comment names the one optional address key and the flag; aera-collab passes the loaded provenance to composition', () => {
    const config = readFileSync(join(HERE, '../src/aera-worker-le-config.ts'), 'utf8')
    expect(config).toContain('AERA_CLAUDE_WORKER_CLI_ACCOUNT_EMAIL')
    expect(config).toMatch(/every key\s+\*?\s*required except/u)
    const collab = readFileSync(join(HERE, '../src/aera-collab.ts'), 'utf8')
    expect(collab).toContain('provenance: localEffectConfig.config.provenance')
  })

  it('the profile file is never part of the diagnostics export (logs only)', () => {
    expect(isDesktopLogFileName(AERA_CLAUDE_WORKER_CONFIG_FILENAME)).toBe(false)
  })
})

/* ------------------------------------------------- (g) NO-2 through composition */

const EPOCH_A = 'aera:worker_epoch:o1ud-a'
interface Port {
  readonly aeraSessionId: string
  readonly connectionId: string
  readonly posts: Record<string, unknown>[]
  workerEpochId(): string
  onEpochChanged(listener: () => void): () => void
  postSigned(route: string, build: () => Readonly<Record<string, unknown>>): Promise<{ status: number, body: Record<string, unknown> }>
}
function port(): Port {
  const p: Port = {
    aeraSessionId: 'aera:session:o1-ud-wiring',
    connectionId: 'claude-worker-o1ud',
    posts: [],
    workerEpochId: () => EPOCH_A,
    onEpochChanged: () => () => {},
    async postSigned(_route, build) {
      p.posts.push({ ...build() })
      return { status: 403, body: { error: 'MALFORMED_ATTEMPT' } }
    },
  }
  return p
}
const INSTALLATION_KEY = { view: () => ({ status: 'ENROLLED', scope: 'DEV' }) } as never
const le = (p: Port) => Object.assign(p, { status: () => ({ state: 'READY' }), beginEpoch: async () => ({ workerEpochId: EPOCH_A }), ensureSession: async () => ({ state: 'READY' }), credentials: () => ({}) })

async function composed(options: { model?: string, version?: string, provenance?: { manifest: boolean, cliMetadata?: ReturnType<typeof cliMetadataDigests> } }) {
  const world = makeWorkerWorld()
  const { pin } = await makeFakeClaude({ turns: [{ text: 'never spawned' }], ...(options.model === undefined ? {} : { model: options.model }), ...(options.version === undefined ? {} : { version: options.version }) })
  const p = port()
  const logs: string[] = []
  const runtime = composeAeraWorker({
    AERA_COLLAB_STORE_DIR: world.storeDir,
    AERA_COLLAB_PRINCIPAL_ID: world.owner,
    AERA_COLLAB_DELEGATION_ID: world.delegationId,
    AERA_CLAUDE_WORKER_BINARY: pin.binaryPath,
    AERA_CLAUDE_WORKER_SHA256: pin.sha256,
    AERA_CLAUDE_WORKER_VERSION: pin.version,
    AERA_CLAUDE_WORKER_MODEL: pin.model,
  }, {
    installationKey: INSTALLATION_KEY,
    localEffect: le(p) as never,
    effectPlane: { openEpoch: () => Promise.reject(new Error('never opened')) },
    routerHotPath: { baseUrl: 'http://127.0.0.1:4646', readRouterKey: async () => { throw new Error('never read') } },
    ...(options.provenance === undefined ? {} : { provenance: options.provenance }),
    log: (line) => { logs.push(line) },
  })
  return { world, runtime, port: p, logs }
}

const start = (runtime: Awaited<ReturnType<typeof composed>>['runtime'], world: ReturnType<typeof makeWorkerWorld>) =>
  performAeraWorkerAction(runtime, { action: 'START_EPOCH', workOrderId: world.workOrderId, codeWorkingLineId: world.line.codeWorkingLineId, task: 'go' }, () => {})

describe('(g) NO-2 / A61: manifest mode only for the reviewed model and CLI pin', () => {
  it('the reviewed set is exactly claude-opus-4-6 on CLI 2.1.280', () => {
    expect(CLAUDE_CLI_PROVENANCE_PIN.models).toEqual(['claude-opus-4-6'])
    expect(CLAUDE_CLI_PROVENANCE_PIN.cliVersion).toBe('2.1.280')
  })

  it('manifest on + an unreviewed model: typed PROVENANCE_MODEL_NOT_REVIEWED before spawn; no attest of any version is sent', async () => {
    const { world, runtime, port: p } = await composed({ version: '2.1.280', provenance: { manifest: true, cliMetadata: cliMetadataDigests(DUMMY) } })
    expect(runtime.kind).toBe('AVAILABLE')
    await expect(start(runtime, world)).rejects.toMatchObject({ code: 'PROVENANCE_MODEL_NOT_REVIEWED' })
    expect(p.posts).toHaveLength(0)
    expect(world.store.listTypedEvidence(world.workOrderId).filter(row => row.subject.startsWith('Worker Epoch'))).toHaveLength(0)
    if (runtime.kind === 'AVAILABLE') runtime.modelAttest?.dispose()
  })

  it('manifest on + the reviewed model on another CLI version: typed PROVENANCE_CLI_NOT_REVIEWED, nothing sent', async () => {
    const { world, runtime, port: p } = await composed({ model: 'claude-opus-4-6', provenance: { manifest: true } })
    await expect(start(runtime, world)).rejects.toMatchObject({ code: 'PROVENANCE_CLI_NOT_REVIEWED' })
    expect(p.posts).toHaveLength(0)
    if (runtime.kind === 'AVAILABLE') runtime.modelAttest?.dispose()
  })

  it('manifest on + the reviewed pin passes NO-2 and reaches the v1 spawn gate (no v2 before a turn)', async () => {
    const { world, runtime, port: p } = await composed({ model: 'claude-opus-4-6', version: '2.1.280', provenance: { manifest: true } })
    await expect(start(runtime, world)).rejects.toMatchObject({ code: 'MODEL_AUTHORITY_UNAVAILABLE' })
    expect(p.posts).toHaveLength(1)
    expect(p.posts[0]!.schema).toBe('aera.gateway.model-invocation-attestation.v1')
    if (runtime.kind === 'AVAILABLE') runtime.modelAttest?.dispose()
  })

  it('manifest off: any model runs as today (v1 gate)', async () => {
    const { world, runtime, port: p } = await composed({ provenance: { manifest: false } })
    await expect(start(runtime, world)).rejects.toMatchObject({ code: 'MODEL_AUTHORITY_UNAVAILABLE' })
    expect(p.posts).toHaveLength(1)
    if (runtime.kind === 'AVAILABLE') runtime.modelAttest?.dispose()
  })

  it('NO-11: with an address configured, neither the address nor a CLI digest reaches status JSON or the logs', async () => {
    const digests = cliMetadataDigests(DUMMY)
    const { world, runtime, logs } = await composed({ provenance: { manifest: true, cliMetadata: digests } })
    await start(runtime, world).catch(() => {})
    const surface = `${JSON.stringify(aeraWorkerStatus(runtime, world.workOrderId))}\n${logs.join('\n')}`
    for (const needle of [DUMMY, digests.d0.slice(7), digests.d1.slice(7)]) expect(surface).not.toContain(needle)
    if (runtime.kind === 'AVAILABLE') runtime.modelAttest?.dispose()
  })
})

/* -------------------------------------------- session: blocks → manifest → write */

type AttestOutcome = { ok: true, workerEpochId: string, casReceiptId: string, notAfter: string, attestedAtMs: number } | { ok: false, state: 'MODEL_AUTHORITY_REFUSED' | 'MODEL_AUTHORITY_UNAVAILABLE', code: string }
const FRESH: AttestOutcome = { ok: true, workerEpochId: EPOCH_A, casReceiptId: 'cas-1', notAfter: '2099-01-01T00:00:00.000Z', attestedAtMs: 0 }
type TurnInput = string | readonly string[]

function gateStub(order: string[], turnResults: AttestOutcome[] = []) {
  const turns: { baseTurnSeq: number, entries: readonly { digest: string, class: string, tool?: string }[] }[] = []
  return {
    turns,
    async ensureFresh() { order.push('fresh'); return FRESH },
    async attestTurn(input: { baseTurnSeq: number, entries: readonly { digest: string, class: string, tool?: string }[] }) {
      order.push('attestTurn')
      turns.push({ baseTurnSeq: input.baseTurnSeq, entries: input.entries.map(entry => ({ ...entry })) })
      return turnResults.shift() ?? FRESH
    },
    noteTurnActivity() {},
    setTurnPossible() {},
    stop() {},
  }
}

/** A scripted handle: turn 1 proposes one fs.read (denied: no grant), turn 2 says DONE. */
function scriptedAdapter(order: string[], replies?: (turn: number, spec: { epochId: string, codeWorkingLineId: string }) => string) {
  const inputs: TurnInput[] = []
  const adapter = {
    adapterId: 'scripted-adapter',
    workerType: 'CLAUDE_CODE',
    inputs,
    async preflight() { return { workerType: 'CLAUDE_CODE', adapterId: 'scripted-adapter' } },
    async startEpoch(spec: { epochId: string, codeWorkingLineId: string }) {
      order.push('spawn')
      let turn = 0
      const terminal = { status: 'COMPLETED' as const, reason: 'done', exitCode: 0, signal: null, turns: 0, usage: { reported: false }, orphanReaped: false, limitations: [], scratchResidue: [] }
      return {
        epochId: spec.epochId,
        runtime: { workerType: 'CLAUDE_CODE', adapterId: 'scripted-adapter' },
        pid: undefined,
        scratchDir: undefined,
        async runTurn(input: TurnInput) {
          if (turn >= 4) return { kind: 'EPOCH_TERMINATED' as const, terminal: { ...terminal, turns: turn } }
          turn += 1
          inputs.push(input)
          order.push('turn')
          const batch = (status: string, intents: unknown[]) => `<aera-effect-intents>${JSON.stringify({ version: 'AeraEffectIntentBatchV1', epochId: spec.epochId, status, intents })}</aera-effect-intents>`
          const text = replies?.(turn, spec) ?? (turn === 1
            ? `reading\n${batch('CONTINUE', [{ intentId: 'r1', kind: 'fs.read', codeWorkingLineId: spec.codeWorkingLineId, path: 'README.md' }])}`
            : `done\n${batch('DONE', [])}`)
          return { kind: 'TURN_COMPLETED' as const, turn, text, usage: { reported: false }, authClass: 'SUBSCRIPTION_OAUTH' as const, isError: false }
        },
        async endInput() { order.push('end'); return { ...terminal, turns: turn } },
        async cancel(reason: string) { order.push('cancel'); return { ...terminal, status: 'CANCELLED' as const, reason, turns: turn } },
        async terminal() { return terminal },
      }
    },
  }
  return adapter
}

const { AeraWorkerSessionManager } = await import('../src/aera-worker-session.ts')
const { LocalExecutionPolicyGate } = await import('../src/aera-worker-effect-broker.ts')
const P = await import('../src/aera-worker-provenance.ts')
const sha = (text: string): string => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`

function sessionManager(world: ReturnType<typeof makeWorkerWorld>, adapter: unknown, gate: unknown, options: { manifest?: boolean, cli?: boolean, log?: string[] } = {}) {
  return new AeraWorkerSessionManager({
    store: world.store,
    adapter: adapter as never,
    gate: new LocalExecutionPolicyGate(),
    config: {
      humanPrincipalId: world.owner,
      delegationId: world.delegationId,
      environmentId: 'AERA_DEV',
      ...(options.manifest === false ? {} : { provenance: { manifest: true, model: 'claude-opus-4-6', cliVersion: '2.1.280', ...(options.cli === false ? {} : { cliMetadata: cliMetadataDigests(DUMMY) }) } }),
    },
    modelAttest: gate as never,
    ...(options.log === undefined ? {} : { log: (line: string) => { options.log?.push(line) } }),
  })
}

const run = (m: InstanceType<typeof AeraWorkerSessionManager>, world: ReturnType<typeof makeWorkerWorld>, task = 'TEST task: make the README say hello') =>
  m.runEpoch({ workOrderId: world.workOrderId, codeWorkingLineId: world.line.codeWorkingLineId, task })

describe('session: orientation and observation turns as provenance blocks (§5.4, F2-2)', () => {
  it('F2-2: turn 1 carries no Work Order payload text — only its length, sha256 and the context.read pointer', async () => {
    const world = makeWorkerWorld()
    const order: string[] = []
    const result = await run(sessionManager(world, scriptedAdapter(order), gateStub(order)), world)
    const payload = world.store.listWorkOrders()[0]!.exactPayload ?? ''
    expect(result.orientation).not.toContain('OBJECTIVE: make README say hello.')
    expect(result.orientation).toContain(`the owner's order is ${String(payload.length)} characters, sha256 ${createHash('sha256').update(payload).digest('hex')}; read it with context.read target "wo-payload@0".`)
    expect(readFileSync(join(HERE, '../src/aera-worker-session.ts'), 'utf8')).not.toContain('ORIENTATION_PAYLOAD_EXCERPT')
  })

  it('manifest on: turn 1 = [BRIEFING, RECORD, HUMAN] written as blocks only after attestTurn; HUMAN never committed; one CLI digest on turn 1 only', async () => {
    const world = makeWorkerWorld()
    const order: string[] = []
    const adapter = scriptedAdapter(order)
    const gate = gateStub(order)
    const result = await run(sessionManager(world, adapter, gate), world)
    expect(result.terminal.status).toBe('COMPLETED')
    expect(order.filter(step => ['fresh', 'attestTurn', 'spawn', 'turn'].includes(step))).toEqual(['fresh', 'spawn', 'attestTurn', 'turn', 'attestTurn', 'turn'])
    const first = adapter.inputs[0] as readonly string[]
    expect(Array.isArray(first)).toBe(true)
    expect(first).toHaveLength(3)
    expect(first[0]!.startsWith(P.ORIENTATION_BRIEFING_HEADER)).toBe(true)
    expect(first[1]!.startsWith(P.RECORD_BLOCK_HEADER)).toBe(true)
    expect(first[2]!.startsWith(P.HUMAN_BLOCK_HEADER)).toBe(true)
    expect(first[2]).toContain('Task for this Epoch (from the owner): TEST task: make the README say hello')
    expect(result.orientation).toBe(first.join('\n\n'))
    const t1 = gate.turns[0]!
    expect(t1.baseTurnSeq).toBe(1001)
    expect(t1.entries).toEqual([
      { digest: sha(first[0]!), class: 'AERA_BRIEFING' },
      { digest: sha(first[1]!), class: 'AERA_RECORD', tool: 'aera_record_context' },
      { digest: cliMetadataDigests(DUMMY).d0, class: 'CLI_METADATA' },
    ])
    expect(t1.entries.map(entry => entry.digest)).not.toContain(sha(first[2]!))
  })

  it('manifest on: an observation turn = [BRIEFING header, OBSERVATION…], every observation behind the fixed prefix, tool by intent kind; no CLI entry', async () => {
    const world = makeWorkerWorld()
    const order: string[] = []
    const adapter = scriptedAdapter(order)
    const gate = gateStub(order)
    const result = await run(sessionManager(world, adapter, gate), world)
    const second = adapter.inputs[1] as readonly string[]
    expect(second).toEqual([`${P.OBSERVATIONS_BRIEFING_HEADER}${result.epochId})`, `${P.OBSERVATION_BLOCK_PREFIX}${result.outcomes[0]!.observation}`])
    expect(gate.turns[1]).toEqual({ baseTurnSeq: 1002, entries: [{ digest: sha(second[0]!), class: 'AERA_BRIEFING' }, { digest: sha(second[1]!), class: 'AERA_OBSERVATION', tool: 'aera_fs_read' }] })
    expect(() => P.assertFixedHeaderSeparation([{ class: 'AERA_BRIEFING', text: second[0]! }, { class: 'AERA_OBSERVATION', tool: 'aera_fs_read', text: second[1]! }])).not.toThrow()
  })

  it('a host notice is its own observation (aera_host_notice)', async () => {
    const world = makeWorkerWorld()
    const order: string[] = []
    const adapter = scriptedAdapter(order, (turn, spec) => turn === 1 ? 'no block at all' : `<aera-effect-intents>${JSON.stringify({ version: 'AeraEffectIntentBatchV1', epochId: spec.epochId, status: 'DONE', intents: [] })}</aera-effect-intents>`)
    const gate = gateStub(order)
    await run(sessionManager(world, adapter, gate), world)
    const second = adapter.inputs[1] as readonly string[]
    expect(second).toHaveLength(2)
    expect(second[1]!.startsWith(P.OBSERVATION_BLOCK_PREFIX)).toBe(true)
    expect(gate.turns[1]!.entries[1]).toMatchObject({ class: 'AERA_OBSERVATION', tool: 'aera_host_notice' })
  })

  it('A52 (session): manifest on and the turn attest refused → that turn is NOT written; typed terminal MODEL_AUTHORITY_UNAVAILABLE', async () => {
    const world = makeWorkerWorld()
    const order: string[] = []
    const adapter = scriptedAdapter(order)
    const gate = gateStub(order, [{ ok: false, state: 'MODEL_AUTHORITY_REFUSED', code: 'MALFORMED_ATTEMPT' }])
    const result = await run(sessionManager(world, adapter, gate), world)
    expect(adapter.inputs).toHaveLength(0)
    expect(result.terminal.status).toBe('MODEL_AUTHORITY_UNAVAILABLE')
    expect(result.terminal.reason).toContain('MODEL_AUTHORITY_REFUSED:MALFORMED_ATTEMPT')
    const terminal = world.store.listTypedEvidence(world.workOrderId).find(row => row.subject.startsWith('Worker Epoch terminal: '))
    expect(terminal?.subject).toContain('MODEL_AUTHORITY_UNAVAILABLE')
  })

  it('manifest off: v1 gate before every turn, turns written as one string (blocks joined by a blank line), no v2', async () => {
    const world = makeWorkerWorld()
    const order: string[] = []
    const adapter = scriptedAdapter(order)
    const gate = gateStub(order)
    const result = await run(sessionManager(world, adapter, gate, { manifest: false }), world)
    expect(order.filter(step => ['fresh', 'attestTurn', 'spawn', 'turn'].includes(step))).toEqual(['fresh', 'spawn', 'fresh', 'turn', 'fresh', 'turn'])
    expect(typeof adapter.inputs[0]).toBe('string')
    expect(adapter.inputs[0]).toBe(result.orientation)
    expect(adapter.inputs[1]).toBe(`${P.OBSERVATIONS_BRIEFING_HEADER}${result.epochId})\n\n${P.OBSERVATION_BLOCK_PREFIX}${result.outcomes[0]!.observation}`)
    expect(gate.turns).toHaveLength(0)
  })

  it('evidence (§5.5, N-11): contextText kept; a companion row binds the per-block sha256 list and the host-only manifest digest; no address or CLI digest in the store', async () => {
    const world = makeWorkerWorld()
    const order: string[] = []
    const adapter = scriptedAdapter(order)
    const gate = gateStub(order)
    const result = await run(sessionManager(world, adapter, gate), world)
    const rows = world.store.listTypedEvidence(world.workOrderId)
    const context = rows.find(row => row.subject === `Worker Epoch context supplied: ${result.epochId}`)
    expect(context?.body).toContain(`\n\nORIENTATION\n${result.orientation}`)
    const companion = rows.find(row => row.subject === `Worker Epoch context provenance: ${result.epochId}`)
    expect(companion?.evidenceClass).toBe('SOURCE_EVIDENCE')
    const body = JSON.parse(companion?.body ?? '{}') as Record<string, unknown>
    const first = adapter.inputs[0] as readonly string[]
    expect(body).toEqual({
      contextSha256: createHash('sha256').update(context?.body ?? '').digest('hex'),
      hostBlocks: [{ class: 'AERA_BRIEFING', sha256: sha(first[0]!) }, { class: 'AERA_RECORD', sha256: sha(first[1]!) }, { class: 'HUMAN', sha256: sha(first[2]!) }],
      hostManifestDigest: P.hostManifestDigest(gate.turns[0]!.entries as never),
      demotedFields: expect.any(Array),
    })
    const digests = cliMetadataDigests(DUMMY)
    const storeBytes = JSON.stringify(rows)
    for (const needle of [DUMMY, digests.d0.slice(7), digests.d1.slice(7)]) expect(storeBytes).not.toContain(needle)
  })

  it('NO-11 absent address: no CLI entry is ever committed; the descriptor says not_offered; the log line is content-free', async () => {
    const world = makeWorkerWorld()
    const order: string[] = []
    const adapter = scriptedAdapter(order)
    const gate = gateStub(order)
    const log: string[] = []
    await run(sessionManager(world, adapter, gate, { cli: false, log }), world)
    expect(gate.turns.flatMap(turn => turn.entries).some(entry => entry.class === 'CLI_METADATA')).toBe(false)
    const lines = log.filter(line => line.startsWith('aera-worker-provenance: '))
    expect(lines).toHaveLength(2)
    const first = JSON.parse(lines[0]!.slice('aera-worker-provenance: '.length)) as { turn: number, cliMetadata: string, blocks: { class: string, digestPrefix: string, proof: string }[] }
    expect(first).toMatchObject({ turn: 1, cliMetadata: 'not_offered' })
    expect(first.blocks.map(row => [row.class, row.proof])).toEqual([['AERA_BRIEFING', 'committed'], ['AERA_RECORD', 'committed'], ['HUMAN', 'human']])
    expect(first.blocks[2]!.digestPrefix).toBe('withheld')
    const text = log.join('\n')
    expect(text).not.toContain('TEST task')
    expect(text).not.toContain(P.ORIENTATION_BRIEFING_HEADER)
  })

  it('NO-11 with an address: the descriptor says committed, and neither the address nor a CLI digest reaches the log', async () => {
    const world = makeWorkerWorld()
    const order: string[] = []
    const log: string[] = []
    await run(sessionManager(world, scriptedAdapter(order), gateStub(order), { log }), world)
    const text = log.join('\n')
    expect(text).toContain('"cliMetadata":"committed"')
    const digests = cliMetadataDigests(DUMMY)
    for (const needle of [DUMMY, digests.d0.slice(7, 19), digests.d1.slice(7, 19)]) expect(text).not.toContain(needle)
  })

  it('N-3: a task that is not well-formed UTF-16 is replaced before writing and a provenance notice is recorded', async () => {
    const world = makeWorkerWorld()
    const order: string[] = []
    const adapter = scriptedAdapter(order)
    const result = await run(sessionManager(world, adapter, gateStub(order)), world, 'TEST task \uD800 lone')
    const first = adapter.inputs[0] as readonly string[]
    expect(first.every(text => text.isWellFormed())).toBe(true)
    const notice = world.store.listTypedEvidence(world.workOrderId).find(row => row.subject.startsWith(`Worker provenance notice (${result.epochId} turn 1)`))
    expect(JSON.parse(notice?.body ?? '{}')).toMatchObject({ turn: 1, notWellFormed: 1, collisions: 0 })
  })
})
