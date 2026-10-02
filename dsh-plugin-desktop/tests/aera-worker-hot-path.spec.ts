/**
 * H-1 — the governed Claude Code CLI on the Router hot path (critical-path
 * step 8, desktop part) — WO-AERA-CODE-CLAUDE-CODE-GOVERNED-WORKER-INTEGRATION-001.
 *
 * - The CLI's Anthropic base URL is the Router hot-path origin from the
 *   validated `aera-claude-worker.json` (exact allowed set of the bound
 *   environment), and the Router worker key rides the CLI's own
 *   `ANTHROPIC_CUSTOM_HEADERS` as `x-aera-gateway-key`, with the pinned
 *   Connection as `x-aera-connection-id`. No `x-aera-session-id`: the governed
 *   Session arises by native bootstrap from `x-claude-code-session-id`.
 * - The key is read from the Keychain in the main process AT SPAWN TIME and
 *   placed only in that child's environment: never `process.env`, logs,
 *   evidence, status or `gatewayProfiles` (plan review m-5).
 * - No fallback to direct Anthropic: no hot path, no key or no config means
 *   no spawn, and the worker is UNAVAILABLE unless D-0b, D-0c, U8, D-0d and
 *   H-1 are all composed (D-0d2 review F-1, plan review M-3).
 * - One Gateway Session per window is the CD-4 runbook rule (one desktop
 *   Epoch); the native session id from `system/init` is recorded (m-13).
 *
 * Every model request here goes to a fake Router on loopback, sent by a fake
 * CLI binary. Never the real `claude`, never a real credential, never the real
 * Keychain (tripwire below).
 */
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { issueAeraPrincipalId } from '@aera/cis-contracts'
import { caFingerprintSha256 } from '@aera/effect-broker'
import { ParticipationStore } from '@aera/participation-runtime'

const trip = vi.hoisted(() => ({ hits: [] as string[] }))
vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>()
  const guard = (file: unknown): void => {
    const path = String(file)
    if (path === '/usr/bin/security' || /(^|\/)security$/u.test(path)) {
      trip.hits.push(path)
      throw new Error(`TRIPWIRE: a real security binary was about to run: ${path}`)
    }
  }
  return {
    ...real,
    spawn: ((file: string, ...rest: unknown[]) => { guard(file); return (real.spawn as (...a: unknown[]) => unknown)(file, ...rest) }) as typeof real.spawn,
    spawnSync: ((file: string, ...rest: unknown[]) => { guard(file); return (real.spawnSync as (...a: unknown[]) => unknown)(file, ...rest) }) as typeof real.spawnSync,
    execFile: ((file: string, ...rest: unknown[]) => { guard(file); return (real.execFile as (...a: unknown[]) => unknown)(file, ...rest) }) as typeof real.execFile,
    execFileSync: ((file: string, ...rest: unknown[]) => { guard(file); return (real.execFileSync as (...a: unknown[]) => unknown)(file, ...rest) }) as typeof real.execFileSync,
  }
})

const {
  CLAUDE_WORKER_ENV_KEYS,
  ClaudeCodeWorkerAdapter,
  buildClaudeWorkerEnv,
} = await import('../src/aera-claude-worker-host.ts')
const { DEFAULT_WORKER_EPOCH_LIMITS } = await import('../src/aera-worker-adapter.ts')
const { LocalExecutionPolicyGate } = await import('../src/aera-worker-effect-broker.ts')
const { AeraWorkerSessionManager } = await import('../src/aera-worker-session.ts')
const { composeAeraWorker, performAeraWorkerAction, resolveClaudeWorkerHotPath } = await import('../src/aera-worker-composition.ts')
const { AERA_CLAUDE_WORKER_CONFIG_FILENAME, loadWorkerLocalEffectConfig } = await import('../src/aera-worker-le-config.ts')
const {
  CLAUDE_WORKER_ROUTER_KEYCHAIN_PRODUCTION,
  createClaudeWorkerRouterKeyReader,
  resolveInstallationKeyScope,
} = await import('../src/aera-worker-installation-key.ts')
const { AERA_CODE_PRODUCT } = await import('../src/product-brand.ts')
const { bootstrapAeraGatewayCredential } = await import('../src/aera-gateway-keychain.ts')
const { AGC_CANARY_SYDNEY_ROUTER_ORIGIN, AGC_GOVERNED_ROUTER_ORIGIN } = await import('../src/aera-gateway-agc-binding.ts')
const { POISONED_PARENT_ENV, TEST_ROUTER_KEY, makeFakeClaude, makeWorkerWorld, testHotPath } = await import('./aera-worker-fixtures.ts')
const { CIS_ISSUER, ROUTER_SAN, generatePki, testCustody, testEffectCatalogEnv, testModelRoutingEnv } = await import('./aera-worker-le-fixtures.ts')

const SRC = join(import.meta.dirname, '..', 'src')
const TESTS = import.meta.dirname
const CONNECTION = 'claude-worker-connection-h1'
const LIMITS = { ...DEFAULT_WORKER_EPOCH_LIMITS, turnTimeoutMs: 15_000, epochTimeoutMs: 60_000, cancelGraceMs: 300 }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
const servers: Server[] = []

afterAll(() => {
  for (const server of servers) server.close()
  // Nothing here ever ran a real `security`.
  expect(trip.hits).toEqual([])
})

interface Captured { readonly method: string | undefined, readonly url: string | undefined, readonly headers: IncomingHttpHeaders, readonly body: string }

/** A fake Router hot path on loopback: records each request, answers 200. */
async function fakeRouter(): Promise<{ origin: string, captured: Captured[] }> {
  const captured: Captured[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { body += chunk })
    request.on('end', () => {
      captured.push({ method: request.method, url: request.url, headers: request.headers, body })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"type":"message","content":[]}')
    })
  })
  servers.push(server)
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no address')
  return { origin: `http://127.0.0.1:${String(address.port)}`, captured }
}

const spec = (epochId = 'aera:worker-epoch:00000000-0000-4000-8000-000000000001', events: { kind: string }[] = []) => ({
  epochId,
  aeraSessionId: 'psession-h1',
  workOrderId: 'WO-TEST-H1',
  codeWorkingLineId: 'aera:code_working_line:test',
  systemPrompt: `Always use epochId ${epochId} and codeWorkingLineId aera:code_working_line:test.`,
  limits: LIMITS,
  onEvent: (event: { kind: string }) => { events.push(event) },
})

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise
  } catch (cause) {
    return String((cause as { code?: unknown }).code)
  }
  return 'RESOLVED'
}

/* ------------------------------------------------------------------ the env */

describe('H-1 env: the hot-path pair, built from nothing', () => {
  it('adds exactly ANTHROPIC_BASE_URL and ANTHROPIC_CUSTOM_HEADERS (key + pinned Connection) to the base keys (four + PE-2 suppression four)', () => {
    const parent = { ...POISONED_PARENT_ENV }
    const env = buildClaudeWorkerEnv(parent, { baseUrl: 'http://127.0.0.1:4646', connectionId: CONNECTION, routerKey: TEST_ROUTER_KEY })
    expect(Object.keys(env).sort()).toEqual([
      'ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'DISABLE_AUTOUPDATER',
      'DISABLE_ERROR_REPORTING', 'DISABLE_TELEMETRY', 'HOME', 'LOGNAME', 'PATH', 'USER',
    ])
    for (const key of ['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'DISABLE_AUTOUPDATER', 'DISABLE_ERROR_REPORTING', 'DISABLE_TELEMETRY']) expect(env[key], key).toBe('1')
    // The Router key is in ANTHROPIC_CUSTOM_HEADERS and in no other variable.
    expect(Object.keys(env).filter(key => env[key]?.includes(TEST_ROUTER_KEY))).toEqual(['ANTHROPIC_CUSTOM_HEADERS'])
    expect([...CLAUDE_WORKER_ENV_KEYS].sort()).toEqual(Object.keys(env).sort())
    expect(env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:4646')
    expect(env.ANTHROPIC_CUSTOM_HEADERS).toBe(`x-aera-gateway-key: ${TEST_ROUTER_KEY}\nx-aera-connection-id: ${CONNECTION}`)
    expect(env.PATH).toBe('/usr/bin:/bin')
    // Nothing of the parent's: no API key, auth token, poisoned base URL or headers; no explicit Aera Session.
    expect(JSON.stringify(env)).not.toMatch(/SHOULD-NEVER-LEAK|poisoned|x-aera-session-id|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|apiKeyHelper/u)
    // The parent is never written (the key never reaches the app's process.env).
    expect(parent).toEqual(POISONED_PARENT_ENV)
  })

  it('refuses, typed and without echoing a value, a missing hot path or a bad base URL, Connection id or key', () => {
    const good = { baseUrl: 'http://127.0.0.1:4646', connectionId: CONNECTION, routerKey: TEST_ROUTER_KEY }
    const bad: unknown[] = [
      undefined,
      { ...good, baseUrl: '' },
      { ...good, baseUrl: 'ftp://127.0.0.1:4646' },
      { ...good, baseUrl: 'http://127.0.0.1:4646/' },
      { ...good, baseUrl: 'http://127.0.0.1:4646/v1' },
      { ...good, baseUrl: 'http://user:pw@127.0.0.1:4646' },
      { ...good, baseUrl: 'http://127.0.0.1:4646?x=1' },
      { ...good, connectionId: 'aera:connection:claude-worker-1' },
      { ...good, connectionId: 'a\nx-aera-session-id: s' },
      { ...good, connectionId: '' },
      { ...good, routerKey: '' },
      { ...good, routerKey: 'has a space-0123456789' },
      { ...good, routerKey: `${TEST_ROUTER_KEY}\nx-aera-session-id: s` },
      { ...good, routerKey: 'short' },
    ]
    for (const routing of bad) {
      let caught: unknown
      try {
        buildClaudeWorkerEnv(POISONED_PARENT_ENV, routing as never)
      } catch (cause) {
        caught = cause
      }
      expect(caught, JSON.stringify(routing)).toMatchObject({ code: 'WORKER_MODEL_ROUTING_UNAVAILABLE' })
      expect(String((caught as Error).message)).not.toContain(TEST_ROUTER_KEY)
    }
  })
})

/* ---------------------------------------------------------------- the spawn */

describe('H-1 spawn: the key is read in the main process at spawn time, into that child env only', () => {
  it('a fake CLI sends its first Messages request to the fake Router hot path with the key, the pinned Connection and its native session id', async () => {
    const router = await fakeRouter()
    let reads = 0
    const { pin } = await makeFakeClaude({ modelRequest: true, turns: [{ text: 'ROUTER=${ROUTER}' }] })
    const scratchRoot = mkdtempSync(join(tmpdir(), 'h1-scratch-'))
    const logs: string[] = []
    const adapter = new ClaudeCodeWorkerAdapter(pin, {
      parentEnv: POISONED_PARENT_ENV,
      scratchRoot,
      hotPath: testHotPath({ baseUrl: router.origin, connectionId: CONNECTION, readRouterKey: async () => { reads += 1; return TEST_ROUTER_KEY } }),
    })
    // Composing the adapter reads nothing: the key is read at spawn.
    expect(reads).toBe(0)
    const events: { kind: string }[] = []
    const handle = await adapter.startEpoch(spec(undefined, events))
    expect(reads).toBe(1)
    const turn = await handle.runTurn('hello')
    expect(turn.kind).toBe('TURN_COMPLETED')
    if (turn.kind !== 'TURN_COMPLETED') return
    expect(turn.text).toContain('ROUTER=200')
    expect(router.captured).toHaveLength(1)
    const [first] = router.captured
    expect(first?.method).toBe('POST')
    expect(first?.url).toBe('/v1/messages')
    expect(first?.headers['x-aera-gateway-key']).toBe(TEST_ROUTER_KEY)
    expect(first?.headers['x-aera-connection-id']).toBe(CONNECTION)
    expect(first?.headers['x-claude-code-session-id']).toMatch(UUID)
    expect(first?.headers['x-claude-code-session-id']).toBe(turn.providerSessionId)
    // Aera adds no explicit Session, no API key and no bearer: the CLI's OAuth is its own.
    for (const name of ['x-aera-session-id', 'x-api-key', 'authorization', 'x-poison']) expect(first?.headers[name], name).toBeUndefined()
    const terminal = await handle.endInput()
    expect(terminal.status).toBe('COMPLETED')
    // The key is nowhere but the child's env: not the app's process.env, the outcome, events, limitations or logs.
    expect(Object.values(process.env).some(value => value?.includes(TEST_ROUTER_KEY) === true)).toBe(false)
    for (const surface of [turn, terminal, events, logs]) expect(JSON.stringify(surface)).not.toContain(TEST_ROUTER_KEY)
    // Truthful limitations: model transport is the Router hot path; the direct exceptions are declared.
    const limitations = terminal.limitations.join('\n')
    expect(limitations).toMatch(/Router hot path/u)
    expect(limitations).not.toMatch(/Router\/Sentinel do not see it/u)
    expect(limitations).toMatch(/S-1/u)
    // A second Epoch reads the key again: it is never cached.
    const again = await adapter.startEpoch(spec('aera:worker-epoch:00000000-0000-4000-8000-000000000002'))
    expect(reads).toBe(2)
    await again.endInput()
  }, 60_000)

  it('no hot path, a broken hot path, a failing key read or a malformed key: refused before any process or scratch dir exists', async () => {
    const { pin } = await makeFakeClaude({ modelRequest: true, turns: [{ text: 'never' }] })
    const cases: { hotPath: unknown, code: string }[] = [
      { hotPath: undefined, code: 'WORKER_MODEL_ROUTING_UNAVAILABLE' },
      { hotPath: testHotPath({ baseUrl: 'https://api.anthropic.com/v1' }), code: 'WORKER_MODEL_ROUTING_UNAVAILABLE' },
      { hotPath: testHotPath({ connectionId: 'aera:connection:x' }), code: 'WORKER_MODEL_ROUTING_UNAVAILABLE' },
      { hotPath: testHotPath({ readRouterKey: async () => { throw Object.assign(new Error('Worker installation key: KEYCHAIN_UNAVAILABLE'), { code: 'KEYCHAIN_UNAVAILABLE' }) } }), code: 'WORKER_ROUTER_KEY_UNAVAILABLE' },
      { hotPath: testHotPath({ readRouterKey: async () => `${TEST_ROUTER_KEY}\nx-aera-session-id: s` }), code: 'WORKER_MODEL_ROUTING_UNAVAILABLE' },
    ]
    for (const { hotPath, code } of cases) {
      const scratchRoot = mkdtempSync(join(tmpdir(), 'h1-refused-'))
      const events: { kind: string }[] = []
      const adapter = new ClaudeCodeWorkerAdapter(pin, { parentEnv: POISONED_PARENT_ENV, scratchRoot, hotPath: hotPath as never })
      let caught: unknown
      try {
        await adapter.startEpoch(spec(undefined, events))
      } catch (cause) {
        caught = cause
      }
      expect(caught, code).toMatchObject({ code })
      expect(String((caught as Error).message)).not.toContain(TEST_ROUTER_KEY)
      expect(events.map(event => event.kind)).not.toContain('PROCESS_STARTED')
      expect(readdirSync(scratchRoot)).toEqual([])
    }
  }, 60_000)
})

/* ----------------------------------------------------------- the composition */

describe('H-1 composition: AVAILABLE only with D-0b, D-0c, U8, D-0d and H-1 (no direct fallback)', () => {
  async function pieces(connectionId = CONNECTION) {
    const world = makeWorkerWorld()
    const { pin } = await makeFakeClaude({ turns: [{ text: 'never spawned' }] })
    const env = {
      AERA_COLLAB_STORE_DIR: world.storeDir,
      AERA_COLLAB_PRINCIPAL_ID: world.owner,
      AERA_COLLAB_DELEGATION_ID: world.delegationId,
      AERA_CLAUDE_WORKER_BINARY: pin.binaryPath,
      AERA_CLAUDE_WORKER_SHA256: pin.sha256,
      AERA_CLAUDE_WORKER_VERSION: pin.version,
      AERA_CLAUDE_WORKER_MODEL: pin.model,
    }
    let reads = 0
    const localEffect = {
      aeraSessionId: 'aera:session:h1', connectionId,
      workerEpochId: () => undefined, onEpochChanged: () => () => {},
      postSigned: async () => { throw new Error('never posted') },
      status: () => ({ state: 'READY' }), beginEpoch: async () => ({ workerEpochId: 'x' }), ensureSession: async () => ({ state: 'READY' }), credentials: () => ({}),
    }
    const full = {
      installationKey: testCustody().port as never,
      localEffect: localEffect as never,
      effectPlane: { openEpoch: () => Promise.reject(new Error('never opened')) },
      routerHotPath: { baseUrl: AGC_GOVERNED_ROUTER_ORIGIN, readRouterKey: async () => { reads += 1; return TEST_ROUTER_KEY } },
    }
    return { world, env, full, reads: () => reads }
  }
  const dispose = (runtime: ReturnType<typeof composeAeraWorker>): void => { if (runtime.kind === 'AVAILABLE') runtime.modelAttest?.dispose() }

  it('all five compose AVAILABLE; dropping any one is UNAVAILABLE with an honest reason and START_EPOCH refuses; the key is not read at composition', async () => {
    const { world, env, full, reads } = await pieces()
    const runtime = composeAeraWorker(env, full)
    expect(runtime.kind).toBe('AVAILABLE')
    dispose(runtime)
    const drops: [keyof typeof full | 'connection', RegExp][] = [
      ['installationKey', /installation-key custody/u],
      ['localEffect', /local-effect session/u],
      ['connection', /AERA_CLAUDE_WORKER_CONNECTION_ID/u],
      ['effectPlane', /effect plane/u],
      ['routerHotPath', /hot path/u],
    ]
    for (const [drop, reason] of drops) {
      const options = drop === 'connection'
        ? { ...full, localEffect: { ...(full.localEffect as object), connectionId: 'aera:connection:claude-worker-1' } as never }
        : Object.fromEntries(Object.entries(full).filter(([key]) => key !== drop))
      const unavailable = composeAeraWorker(env, options)
      expect(unavailable.kind, drop).toBe('UNAVAILABLE')
      expect(unavailable, drop).toMatchObject({ reason: expect.stringMatching(reason) })
      expect(await codeOf(performAeraWorkerAction(unavailable, { action: 'START_EPOCH', workOrderId: world.workOrderId, codeWorkingLineId: world.line.codeWorkingLineId, task: 't' }, () => {})), drop).toBe('WORKER_UNAVAILABLE')
    }
    expect(reads()).toBe(0)
    expect(new ParticipationStore(world.storeDir).listTypedEvidence(world.workOrderId).filter(row => row.subject.startsWith('Worker Epoch'))).toHaveLength(0)
  }, 60_000)

  it('the base URL must be character-identical to a member of the bound environment\'s exact allowed set', async () => {
    const { env, full } = await pieces()
    const verdict = (environment: Record<string, string>, baseUrl: string) => {
      const runtime = composeAeraWorker({ ...env, ...environment }, { ...full, routerHotPath: { ...full.routerHotPath, baseUrl } })
      dispose(runtime)
      return runtime.kind
    }
    expect(verdict({}, AGC_GOVERNED_ROUTER_ORIGIN)).toBe('AVAILABLE')
    for (const refused of [AGC_CANARY_SYDNEY_ROUTER_ORIGIN, 'http://127.0.0.1:9999', 'https://api.anthropic.com', `${AGC_GOVERNED_ROUTER_ORIGIN}/`, 'http://localhost:4646', '']) {
      expect(verdict({}, refused), refused).toBe('UNAVAILABLE')
    }
    const sydney = { AERA_GATEWAY_AGC_ENVIRONMENT_ID: 'AERA_CANARY' }
    expect(verdict(sydney, AGC_CANARY_SYDNEY_ROUTER_ORIGIN)).toBe('AVAILABLE')
    for (const refused of ['https://100.90.140.5:14646', 'http://100.90.140.5:14300', AGC_GOVERNED_ROUTER_ORIGIN]) {
      expect(verdict(sydney, refused), refused).toBe('UNAVAILABLE')
    }
  }, 60_000)

  it('the composed hot path carries the D-0c pinned Connection and the configured origin, and reads the key only when asked', async () => {
    let reads = 0
    const resolved = resolveClaudeWorkerHotPath({
      environmentId: 'CANARY',
      connectionId: CONNECTION,
      source: { baseUrl: AGC_CANARY_SYDNEY_ROUTER_ORIGIN, readRouterKey: async () => { reads += 1; return TEST_ROUTER_KEY } },
    })
    expect(resolved.kind).toBe('ROUTED')
    if (resolved.kind !== 'ROUTED') return
    expect(resolved.hotPath.baseUrl).toBe(AGC_CANARY_SYDNEY_ROUTER_ORIGIN)
    expect(resolved.hotPath.connectionId).toBe(CONNECTION)
    expect(reads).toBe(0)
    expect(await resolved.hotPath.readRouterKey()).toBe(TEST_ROUTER_KEY)
    expect(reads).toBe(1)
    expect(JSON.stringify(resolved)).not.toContain(TEST_ROUTER_KEY)
    expect(resolveClaudeWorkerHotPath({ environmentId: 'AERA_DEV', connectionId: CONNECTION, source: undefined }).kind).toBe('UNAVAILABLE')
  })
})

/* -------------------------------------------------------------- the config */

describe('H-1 config: AERA_CLAUDE_WORKER_MODEL_ROUTER_ORIGIN is a required, canonical origin', () => {
  it('missing or malformed is not-configured (naming the key, never the value); valid loads as modelRouterOrigin', () => {
    const pki = generatePki()
    const custody = testCustody()
    const write = (overrides: Record<string, string | undefined>): string => {
      const dir = mkdtempSync(join(tmpdir(), 'h1-profile-'))
      const environment: Record<string, string | undefined> = {
        AERA_CLAUDE_WORKER_LE_ROUTER_URL: 'https://127.0.0.1:1/',
        AERA_CLAUDE_WORKER_LE_CA_FILE: pki.caA,
        AERA_CLAUDE_WORKER_LE_CA_SHA256: caFingerprintSha256(readFileSync(pki.caA)),
        AERA_CLAUDE_WORKER_LE_ROUTER_URI_SAN: ROUTER_SAN,
        AERA_CLAUDE_WORKER_CIS_ISSUER: CIS_ISSUER,
        AERA_CLAUDE_WORKER_AGENT_PRINCIPAL_ID: issueAeraPrincipalId(),
        AERA_CLAUDE_WORKER_INSTALLATION_KEY_ID: custody.installationKeyId,
        AERA_CLAUDE_WORKER_AERA_SESSION_ID: 'aera:session:h1',
        AERA_CLAUDE_WORKER_CONNECTION_ID: CONNECTION,
        AERA_CLAUDE_WORKER_ORGANISATION_ID: 'aera-org:test',
        AERA_CLAUDE_WORKER_REPOSITORY_ID: 'aera-repo:test',
        AERA_CLAUDE_WORKER_WORKING_LINE_ID: 'aera:code_working_line:h1',
        ...testEffectCatalogEnv(),
        ...testModelRoutingEnv(),
        ...overrides,
      }
      writeFileSync(join(dir, AERA_CLAUDE_WORKER_CONFIG_FILENAME), JSON.stringify({ version: 1, environment }))
      return dir
    }
    expect(loadWorkerLocalEffectConfig(write({ AERA_CLAUDE_WORKER_MODEL_ROUTER_ORIGIN: undefined })))
      .toEqual({ status: 'not-configured', reason: 'CONFIG_MISSING_KEY:AERA_CLAUDE_WORKER_MODEL_ROUTER_ORIGIN' })
    for (const value of ['http://127.0.0.1:4646/', 'http://127.0.0.1:4646/v1', 'ftp://127.0.0.1:4646', 'http://u:p@127.0.0.1:4646', 'http://127.0.0.1:4646#x', 'not a url']) {
      expect(loadWorkerLocalEffectConfig(write({ AERA_CLAUDE_WORKER_MODEL_ROUTER_ORIGIN: value })), value)
        .toEqual({ status: 'not-configured', reason: 'CONFIG_INVALID:AERA_CLAUDE_WORKER_MODEL_ROUTER_ORIGIN' })
    }
    for (const value of [AGC_GOVERNED_ROUTER_ORIGIN, AGC_CANARY_SYDNEY_ROUTER_ORIGIN]) {
      const loaded = loadWorkerLocalEffectConfig(write({ AERA_CLAUDE_WORKER_MODEL_ROUTER_ORIGIN: value }))
      expect(loaded.status, value).toBe('loaded')
      if (loaded.status === 'loaded') expect(loaded.config.modelRouterOrigin).toBe(value)
    }
  }, 60_000)
})

/* ---------------------------------------------------------- the key custody */

describe('H-1 Router worker key custody (plan review m-5)', () => {
  const devScope = () => resolveInstallationKeyScope({
    platform: 'darwin', isPackaged: false, execPath: '/x/Electron', userDataDir: mkdtempSync(join(tmpdir(), 'h1-ud-')), defaultUserDataDir: '/nonexistent', userDataOverride: undefined,
  })

  /** A fake `security`: find-generic-password -a A -s S -w → the seeded value; logs argv. */
  function fakeSecurity(seed: Record<string, string>): { path: string, log: () => string[][] } {
    const root = mkdtempSync(join(tmpdir(), 'h1-fake-security-'))
    const logPath = join(root, 'log.ndjson')
    writeFileSync(logPath, '')
    const path = join(root, 'fake-sec')
    writeFileSync(path, `#!${process.execPath}
const fs = require('fs')
const args = process.argv.slice(2)
fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(args) + '\\n')
const opt = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined }
const state = ${JSON.stringify(seed)}
const key = opt('-s') + '|' + opt('-a')
if (args[0] !== 'find-generic-password' || !args.includes('-w')) process.exit(2)
if (!(key in state)) process.exit(44)
process.stdout.write(state[key] + '\\n')
`)
    chmodSync(path, 0o755)
    return { path, log: () => readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as string[]) }
  }

  it('names the owner-placed E-7B item (gw001-worker-key-owner.sh), reachable only from the PRODUCTION scope', () => {
    expect(CLAUDE_WORKER_ROUTER_KEYCHAIN_PRODUCTION).toEqual({ service: 'com.aera.gateway.claude-worker.execution', account: 'aera-code-claude-worker-key-v1' })
  })

  it('under a test environment no reader ever runs the system security, and PRODUCTION is refused outright', async () => {
    const production = { kind: 'PRODUCTION' as const, keychain: { service: 'com.aera.code.claude-worker.installation', account: 'claude-code-worker-installation-v1' }, handOverDir: '/nonexistent' }
    expect(await codeOf(createClaudeWorkerRouterKeyReader(production)())).toBe('PRODUCTION_SCOPE_REFUSED_IN_TEST')
    expect(await codeOf(createClaudeWorkerRouterKeyReader(devScope())())).toBe('SYSTEM_KEYCHAIN_REFUSED_IN_TEST')
    expect(await codeOf(createClaudeWorkerRouterKeyReader({ kind: 'UNAVAILABLE', reason: 'KEYCHAIN_REQUIRES_MACOS' })())).toBe('KEYCHAIN_REQUIRES_MACOS')
    expect(trip.hits).toEqual([])
  })

  it('a DEV scope reads only its own dev-scoped item, returns the value without touching process.env, and refuses absent or malformed values by code', async () => {
    const scope = devScope()
    if (scope.kind !== 'DEV') throw new Error('expected a DEV scope')
    const devItem = `com.aera.code.dev-scoped.claude-worker-router-key|${scope.keychain.account}`
    const productionItem = `${CLAUDE_WORKER_ROUTER_KEYCHAIN_PRODUCTION.service}|${CLAUDE_WORKER_ROUTER_KEYCHAIN_PRODUCTION.account}`
    const before = { ...process.env }
    const present = fakeSecurity({ [devItem]: TEST_ROUTER_KEY, [productionItem]: 'production-value-must-never-be-read-0001' })
    const reader = createClaudeWorkerRouterKeyReader(scope, { securityPath: present.path })
    expect(present.log()).toEqual([])
    expect(await reader()).toBe(TEST_ROUTER_KEY)
    expect(present.log()).toEqual([['find-generic-password', '-a', scope.keychain.account, '-s', 'com.aera.code.dev-scoped.claude-worker-router-key', '-w']])
    expect(process.env).toEqual(before)
    const absent = fakeSecurity({})
    expect(await codeOf(createClaudeWorkerRouterKeyReader(scope, { securityPath: absent.path })())).toBe('ROUTER_KEY_NOT_PRESENT')
    const malformed = fakeSecurity({ [devItem]: 'has a space in it-0123456789' })
    let caught: unknown
    try { await createClaudeWorkerRouterKeyReader(scope, { securityPath: malformed.path })() } catch (cause) { caught = cause }
    expect(caught).toMatchObject({ code: 'ROUTER_KEY_MALFORMED' })
    expect(String((caught as Error).message)).not.toContain('has a space')
  })

  it('the worker key is not a gatewayProfiles entry and the human composer\'s bootstrap can never resolve it', () => {
    for (const profile of Object.values(AERA_CODE_PRODUCT.gatewayProfiles)) {
      expect(profile.keychainService).not.toBe(CLAUDE_WORKER_ROUTER_KEYCHAIN_PRODUCTION.service)
      expect(profile.keychainAccount).not.toBe(CLAUDE_WORKER_ROUTER_KEYCHAIN_PRODUCTION.account)
    }
    expect(readFileSync(join(SRC, 'product-brand.ts'), 'utf8')).not.toMatch(/claude-worker/u)
    const asked: string[] = []
    for (const activeProfile of Object.keys(AERA_CODE_PRODUCT.gatewayProfiles)) {
      try {
        bootstrapAeraGatewayCredential({ activeProfile, platform: 'darwin', environment: {}, readPassword: (service) => { asked.push(service); return 'x' } })
      } catch { /* profile resolution refusals are fine here */ }
    }
    expect(asked).not.toContain(CLAUDE_WORKER_ROUTER_KEYCHAIN_PRODUCTION.service)
  })
})

/* ------------------------------------------------------------- static checks */

describe('H-1 static: no governed spawn path can omit the base URL; the key has one door', () => {
  const read = (name: string): string => readFileSync(join(SRC, name), 'utf8')
  const code = (name: string): string => read(name).replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '')
  const srcFiles = (): string[] => readdirSync(SRC, { recursive: true }).map(String).filter(name => /\.(ts|tsx)$/u.test(name))

  it('the host spawns the CLI once, with the env only buildClaudeWorkerEnv(parent, routing) makes; the preflight uses the base env', () => {
    const host = read('aera-claude-worker-host.ts')
    expect(host.match(/\bspawn\(/gu)).toHaveLength(1)
    expect(host).toMatch(/spawn\(input\.pin\.binaryPath, \[\.\.\.input\.argv\], \{[^}]*env: input\.env,/u)
    expect(host.match(/ClaudeEpochProcess\.launch\(/gu)).toHaveLength(1)
    expect(host.match(/buildClaudeWorkerEnv\(/gu)).toHaveLength(2) // the definition and the one spawn-time call
    expect(host).toMatch(/const env = buildClaudeWorkerEnv\(this\.deps\.parentEnv \?\? process\.env, \{ baseUrl: hotPath\.baseUrl, connectionId: hotPath\.connectionId, routerKey \}\)/u)
    expect(host).toMatch(/reportedVersion\(pin\.binaryPath, buildClaudeWorkerBaseEnv\(/u)
    expect(code('aera-claude-worker-host.ts')).not.toMatch(/x-aera-session-id|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|apiKeyHelper/u)
    // The key is held only in startEpoch's locals: never a field.
    expect(host).not.toMatch(/this\.(routerKey|key)\b/u)
  })

  it('the product composes the adapter only in composition, always with the hot path; the host wires config origin + key reader', () => {
    const constructing = srcFiles().filter(name => read(name).includes('new ClaudeCodeWorkerAdapter('))
    expect(constructing).toEqual(['aera-worker-composition.ts'])
    expect(read('aera-worker-composition.ts')).toMatch(/new ClaudeCodeWorkerAdapter\(pin\.pin, \{ parentEnv: env, hotPath: routing\.hotPath \}\)/u)
    const collab = read('aera-collab.ts')
    expect(collab).toMatch(/baseUrl: localEffectConfig\.config\.modelRouterOrigin/u)
    expect(collab).toMatch(/readRouterKey: createClaudeWorkerRouterKeyReader\(installationKeyScope\)/u)
    expect(collab).toMatch(/const worker = composeAeraWorker\(.*routerHotPath/u)
  })

  it('only the custody module names the Router worker key item; nothing writes ANTHROPIC_* or the key into process.env', () => {
    for (const name of srcFiles()) {
      const text = read(name)
      if (name !== 'aera-worker-installation-key.ts') expect(text, name).not.toMatch(/claude-worker\.execution|aera-code-claude-worker-key-v1/u)
      expect(text, name).not.toMatch(/process\.env\.ANTHROPIC_\w+\s*=[^=]|Object\.assign\(\s*process\.env/u)
    }
    // The H-1 modules never write process.env at all, and never use the human composer's Keychain bootstrap.
    for (const name of ['aera-claude-worker-host.ts', 'aera-worker-composition.ts', 'aera-worker-installation-key.ts', 'aera-worker-le-config.ts', 'aera-collab.ts']) {
      expect(read(name), name).not.toMatch(/process\.env(\.[A-Za-z_$][\w$]*|\[[^\]]+\])\s*=(?!=)/u)
      expect(code(name), name).not.toMatch(/aera-gateway-keychain|bootstrapAeraGatewayCredential/u)
    }
  })

  it('m-10: the env-gated real-CLI spec can only ever point the CLI at the Sydney Router, and holds no Router key', () => {
    const real = readFileSync(join(TESTS, 'aera-claude-worker-real-cli.spec.ts'), 'utf8')
    expect(real.match(/baseUrl:/gu)).toHaveLength(1)
    expect(real).toMatch(/baseUrl: AGC_CANARY_SYDNEY_ROUTER_ORIGIN,/u)
    expect(real).not.toMatch(/ANTHROPIC_BASE_URL|AERA_CLAUDE_WORKER_REAL_CLI_BASE_URL/u)
    expect(real).toMatch(/readRouterKey: async \(\) => \{ throw new Error\('REAL_CLI_ROUTER_KEY_OWNER_ONLY/u)
  })

  it('typecheck: the adapter cannot be constructed without a hot path', async () => {
    const { pin } = await makeFakeClaude({ turns: [{ text: 'x' }] })
    // @ts-expect-error H-1: `hotPath` is required — there is no adapter without the Router hot path.
    const adapter = new ClaudeCodeWorkerAdapter(pin, { parentEnv: POISONED_PARENT_ENV })
    expect(await codeOf(adapter.startEpoch(spec()))).toBe('WORKER_MODEL_ROUTING_UNAVAILABLE')
  })
})

/* ------------------------------------------------------------ the session id */

describe('H-1 Gateway Session (CD-4 / m-13): the native session id is recorded', () => {
  it('the native session id from system/init is recorded once per distinct id, and is exactly the id the Router saw', async () => {
    const router = await fakeRouter()
    const world = makeWorkerWorld('WO-TEST-H1-SESSION-001')
    const { pin } = await makeFakeClaude({ modelRequest: true, turns: [{ text: 'a', status: 'CONTINUE' }, { text: 'b', status: 'DONE' }] })
    const manager = new AeraWorkerSessionManager({
      store: new ParticipationStore(world.storeDir),
      adapter: new ClaudeCodeWorkerAdapter(pin, { parentEnv: POISONED_PARENT_ENV, scratchRoot: world.scratchRoot, hotPath: testHotPath({ baseUrl: router.origin, connectionId: CONNECTION }) }),
      gate: new LocalExecutionPolicyGate(),
      config: { humanPrincipalId: world.owner, delegationId: world.delegationId, environmentId: 'AERA_DEV', limits: LIMITS },
      broker: { parentEnv: POISONED_PARENT_ENV },
    })
    const result = await manager.runEpoch({ workOrderId: world.workOrderId, codeWorkingLineId: world.line.codeWorkingLineId, task: 'TEST' })
    expect(result.terminal.status).toBe('COMPLETED')
    expect(router.captured.length).toBeGreaterThanOrEqual(2)
    const seen = [...new Set(router.captured.map(request => request.headers['x-claude-code-session-id']))]
    expect(seen).toHaveLength(1)
    const rows = new ParticipationStore(world.storeDir).listTypedEvidence(world.workOrderId).filter(row => row.subject.startsWith('Worker Epoch Gateway Session: '))
    expect(rows).toHaveLength(1)
    const body = JSON.parse(rows[0]?.body ?? '{}') as Record<string, unknown>
    expect(body.nativeSessionId).toBe(seen[0])
    expect(body.epochId).toMatch(/^aera:worker-epoch:/u)
    for (const row of new ParticipationStore(world.storeDir).listTypedEvidence(world.workOrderId)) expect(row.body ?? '').not.toContain(TEST_ROUTER_KEY)
  }, 60_000)
})
