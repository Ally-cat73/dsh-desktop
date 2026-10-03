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
