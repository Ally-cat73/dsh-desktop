/**
 * D-0b — Worker installation-key custody (W3.1, product side) —
 * WO-AERA-CODE-CLAUDE-CODE-GOVERNED-WORKER-INTEGRATION-001.
 *
 * Every Keychain call in this file lands on a generated FAKE `security`
 * (absolute node shebang, state in the per-test tmp dir). A child_process
 * TRIPWIRE refuses — and counts — any attempt to execute a real `security`
 * binary; the count must stay 0 for the whole file (the sandbox also denies
 * it). The PRODUCTION Keychain item and the PRODUCTION public hand-over
 * directory are never reachable from a test or dev configuration (review M-2).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, verify } from 'node:crypto'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { inspect } from 'node:util'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  AGENT_SENDER_PROOF_PURPOSE,
  canonicalAgentCredentialProofBytes,
  issueAeraPrincipalId,
  issueAeraWorkerEpochId,
  type AgentSenderProofClaims,
} from '@aera/cis-contracts'
import { newSenderProofNonce, sha256Ref, MODEL_INVOCATION_ATTEST_ROUTE } from '@aera/local-effect-admission'

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

const custodyModule = await import('../src/aera-worker-installation-key.ts')
const {
  WORKER_INSTALLATION_KEYCHAIN_PRODUCTION,
  WORKER_INSTALLATION_PUBLIC_HANDOVER_DIR_PRODUCTION,
  WORKER_INSTALLATION_PUBLIC_JWK_FILENAME,
  WORKER_INSTALLATION_KEYCHAIN_TIMEOUT_MS,
  AERA_CODE_CANONICAL_INSTALL_PATH,
  resolveInstallationKeyScope,
  createWorkerInstallationKeyCustody,
  installationKeyThumbprint,
  publishPublicHandOverFile,
  securityCliKeychainPort,
} = custodyModule
const { parseWorkerAction, handleAeraWorkerActionRequest, handleAeraWorkerStatusRequest } = await import('../src/aera-worker-route.ts')
const { composeAeraWorker, aeraWorkerStatus, performAeraWorkerAction } = await import('../src/aera-worker-composition.ts')
const { AERA_CODE_PRODUCT } = await import('../src/product-brand.ts')
const { bootstrapAeraGatewayCredential } = await import('../src/aera-gateway-keychain.ts')
const { parseWorkerStatus } = await import('../src/client/aera-worker-api.ts')
const { AeraWorkerStatus } = await import('../src/client/AeraWorkerStatus.tsx')
const { en } = await import('../src/client/aera-collab-locales.ts')

const SRC = resolve(__dirname, '..', 'src')
const REPO_ROOT = resolve(__dirname, '..', '..')
const PKCS8_ED25519_PREFIX_B64 = 'MC4CAQAwBQYDK2VwBCIEI'
/** RFC 8037 Appendix A.1 / A.3 (Ed25519 test key and its RFC 7638 thumbprint). */
const RFC8037 = {
  d: 'nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A',
  x: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo',
  thumbprint: 'kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k',
}
const rfcPkcs8B64 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(RFC8037.d, 'base64url')]).toString('base64')

/* ----------------------------------------------------------------- fake security */

interface FakeSecurity {
  readonly path: string
  readonly root: string
  state(): Record<string, string>
  log(): readonly { argv: string[], stdin?: string[] }[]
  mode(mode: 'normal' | 'hang-add' | 'fail-add' | 'readback-mismatch' | 'exists-error' | 'store-then-fail-add' | 'store-then-hang'): void
  seed(service: string, account: string, value: string): void
}

const allFakeLogs: string[] = []

function makeFakeSecurity(): FakeSecurity {
  const root = mkdtempSync(join(tmpdir(), 'd0b-fake-keychain-'))
  const statePath = join(root, 'state.json')
  const logPath = join(root, 'log.ndjson')
  const modePath = join(root, 'mode')
  writeFileSync(statePath, '{}')
  writeFileSync(modePath, 'normal')
  const script = `#!${process.execPath}
const fs = require('fs')
const args = process.argv.slice(2)
const state = JSON.parse(fs.readFileSync(${JSON.stringify(statePath)}, 'utf8'))
const mode = fs.readFileSync(${JSON.stringify(modePath)}, 'utf8').trim()
const save = () => fs.writeFileSync(${JSON.stringify(statePath)}, JSON.stringify(state))
const log = (entry) => fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(entry) + '\\n')
const opt = (list, flag) => { const i = list.indexOf(flag); return i >= 0 ? list[i + 1] : undefined }
if (args[0] === 'find-generic-password') {
  log({ argv: args })
  if (mode === 'exists-error') process.exit(9)
  const key = opt(args, '-s') + '|' + opt(args, '-a')
  if (!(key in state)) process.exit(44)
  if (args.includes('-w')) process.stdout.write((mode === 'readback-mismatch' ? 'AAAA' : state[key]) + '\\n')
  else process.stdout.write('keychain: "fake"\\nclass: "genp"\\n')
  process.exit(0)
}
if (args.length === 1 && args[0] === '-i') {
  let input = ''
  process.stdin.on('data', (c) => { input += c })
  process.stdin.on('end', () => {
    for (const line of input.split('\\n').filter(Boolean)) {
      const tokens = line.trim().split(/\\s+/)
      const value = opt(tokens, '-w')
      log({ argv: args, stdin: tokens.map((t, i) => (tokens[i - 1] === '-w' ? '<value>' : t)) })
      if (mode === 'hang-add') { setInterval(() => {}, 1000); return }
      if (mode === 'fail-add') process.exit(1)
      if (tokens[0] !== 'add-generic-password') process.exit(2)
      const key = opt(tokens, '-s') + '|' + opt(tokens, '-a')
      if (key in state && !tokens.includes('-U')) { process.stderr.write('already exists\\n'); process.exit(45) }
      state[key] = value
      save()
      if (mode === 'store-then-fail-add') process.exit(1)
      if (mode === 'store-then-hang') { setInterval(() => {}, 1000); return }
    }
    process.exit(0)
  })
} else if (args[0] !== 'find-generic-password') {
  log({ argv: args })
  process.exit(2)
}
`
  const path = join(root, 'fake-security-bin')
  writeFileSync(path, script)
  chmodSync(path, 0o755)
  allFakeLogs.push(logPath)
  return {
    path,
    root,
    state: () => JSON.parse(readFileSync(statePath, 'utf8')) as Record<string, string>,
    log: () => existsSync(logPath)
      ? readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as { argv: string[], stdin?: string[] })
      : [],
    mode: (mode) => { writeFileSync(modePath, mode) },
    seed: (service, account, value) => {
      const current = JSON.parse(readFileSync(statePath, 'utf8')) as Record<string, string>
      current[`${service}|${account}`] = value
      writeFileSync(statePath, JSON.stringify(current))
    },
  }
}

/** The default Electron user-data dir of the installed bundle (`<appData>/<userDataDirectoryName>`, main.ts). */
const DEFAULT_USER_DATA_DIR = '/Users/Allyd/Library/Application Support/Aera Code'
const INSTALLED_EXEC_PATH = `${AERA_CODE_CANONICAL_INSTALL_PATH}/Contents/MacOS/Aera Code`
/** The installed, packaged bundle on its default profile — the only PRODUCTION launch. */
const INSTALLED_DEFAULT = Object.freeze({
  platform: 'darwin' as const,
  isPackaged: true,
  execPath: INSTALLED_EXEC_PATH,
  userDataDir: DEFAULT_USER_DATA_DIR,
  defaultUserDataDir: DEFAULT_USER_DATA_DIR,
  userDataOverride: undefined,
})

function devScope(userDataDir = mkdtempSync(join(tmpdir(), 'd0b-user-data-'))) {
  const scope = resolveInstallationKeyScope({ platform: 'darwin', isPackaged: false, execPath: '/some/dev/electron/Electron', userDataDir, defaultUserDataDir: DEFAULT_USER_DATA_DIR, userDataOverride: undefined })
  if (scope.kind !== 'DEV') throw new Error('expected a DEV scope')
  return scope
}

function devCustody(options: { timeoutMs?: number, log?: (line: string) => void } = {}) {
  const fake = makeFakeSecurity()
  const scope = devScope()
  const custody = createWorkerInstallationKeyCustody(scope, { securityPath: fake.path, ...options })
  return { fake, scope, custody }
}

/** Every surface a key could leak to must be free of private material. */
function assertNoKeyMaterial(surface: string, secrets: readonly string[]): void {
  expect(surface).not.toMatch(/PRIVATE KEY/u)
  expect(surface).not.toContain(PKCS8_ED25519_PREFIX_B64)
  for (const secret of secrets) {
    expect(secret.length).toBeGreaterThan(20)
    expect(surface).not.toContain(secret)
  }
}

function secretsOf(pkcs8B64: string): string[] {
  const der = Buffer.from(pkcs8B64, 'base64')
  const seed = der.subarray(16)
  return [pkcs8B64, der.toString('base64url'), seed.toString('base64url'), seed.toString('base64'), seed.toString('hex')]
}

const ORIGIN = 'http://127.0.0.1:4680'
function request(over: { method?: string, body?: string, url?: string }): IncomingMessage {
  return {
    method: over.method ?? 'POST',
    url: over.url ?? '/',
    headers: { origin: ORIGIN, host: '127.0.0.1:4680' },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() { if (over.body !== undefined) yield Buffer.from(over.body) },
  } as unknown as IncomingMessage
}
function response(): ServerResponse & { statusCode: number, raw: () => string } {
  let written = ''
  return {
    statusCode: 0,
    setHeader: vi.fn(),
    end: vi.fn((chunk?: string) => { written = chunk ?? '' }),
    raw: () => written,
  } as unknown as ServerResponse & { statusCode: number, raw: () => string }
}

beforeEach(() => { expect(trip.hits).toEqual([]) })
afterAll(() => {
  // The tripwire never fired, and no fake ever saw the PRODUCTION item names.
  expect(trip.hits).toEqual([])
  for (const logPath of allFakeLogs) {
    if (!existsSync(logPath)) continue
    const text = readFileSync(logPath, 'utf8')
    expect(text).not.toContain(WORKER_INSTALLATION_KEYCHAIN_PRODUCTION.service)
    expect(text).not.toContain(WORKER_INSTALLATION_KEYCHAIN_PRODUCTION.account)
  }
})

/* ---------------------------------------------------------------- scope (M-2) */

describe('M-2: the PRODUCTION Keychain item is unreachable from dev and test configuration', () => {
  it('names the production item and hand-over location exactly once, as the plan fixes them', () => {
    expect(WORKER_INSTALLATION_KEYCHAIN_PRODUCTION).toEqual({ service: 'com.aera.code.claude-worker.installation', account: 'claude-code-worker-installation-v1' })
    expect(WORKER_INSTALLATION_PUBLIC_HANDOVER_DIR_PRODUCTION.startsWith('/Users/Shared/')).toBe(true)
    expect(WORKER_INSTALLATION_PUBLIC_JWK_FILENAME).toBe('installation.public.jwk.json')
    expect(WORKER_INSTALLATION_KEYCHAIN_TIMEOUT_MS).toBe(20_000)
  })

  it('binds the production scope to the identity file’s canonical install path and bundle', () => {
    const identity = JSON.parse(readFileSync(join(REPO_ROOT, '.aera-product-identity.json'), 'utf8')) as Record<string, unknown>
    expect(identity.productFamily).toBe('AERA_CODE_DSH')
    expect(identity.status).toBe('CANONICAL_ACTIVE')
    expect(AERA_CODE_CANONICAL_INSTALL_PATH).toBe(identity.canonicalInstallPath)
    expect(AERA_CODE_PRODUCT.bundleIdentifier).toBe(identity.bundleId)
  })

  it('every dev, test, worktree-build or rollback-copy configuration resolves to a scoped DEV item — never the production names', () => {
    const userDataA = mkdtempSync(join(tmpdir(), 'd0b-ud-a-'))
    const userDataB = mkdtempSync(join(tmpdir(), 'd0b-ud-b-'))
    const configs = [
      { platform: 'darwin' as const, isPackaged: false, execPath: `${AERA_CODE_CANONICAL_INSTALL_PATH}/Contents/MacOS/Aera Code`, userDataDir: userDataA, defaultUserDataDir: DEFAULT_USER_DATA_DIR, userDataOverride: undefined },
      { platform: 'darwin' as const, isPackaged: false, execPath: '/Users/Allyd/AERA-Workspace/worktrees/x/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron', userDataDir: userDataA, defaultUserDataDir: DEFAULT_USER_DATA_DIR, userDataOverride: undefined },
      { platform: 'darwin' as const, isPackaged: true, execPath: '/Users/Allyd/AERA-Workspace/worktrees/x/release/mac-arm64/Aera Code.app/Contents/MacOS/Aera Code', userDataDir: userDataA, defaultUserDataDir: DEFAULT_USER_DATA_DIR, userDataOverride: undefined },
      { platform: 'darwin' as const, isPackaged: true, execPath: `${AERA_CODE_CANONICAL_INSTALL_PATH}.pre-desktop-worker-20261001/Contents/MacOS/Aera Code`, userDataDir: userDataB, defaultUserDataDir: DEFAULT_USER_DATA_DIR, userDataOverride: undefined },
      { platform: 'darwin' as const, isPackaged: true, execPath: `/Applications/Aera Code.app/Contents/MacOS/Aera Code`, userDataDir: userDataB, defaultUserDataDir: DEFAULT_USER_DATA_DIR, userDataOverride: undefined },
      { platform: 'darwin' as const, isPackaged: true, execPath: `${AERA_CODE_CANONICAL_INSTALL_PATH}/../Aera Code.app/Contents/MacOS/Aera Code`, userDataDir: userDataB, defaultUserDataDir: DEFAULT_USER_DATA_DIR, userDataOverride: undefined },
    ]
    const accounts = new Set<string>()
    for (const config of configs) {
      const scope = resolveInstallationKeyScope(config)
      expect(scope.kind).toBe('DEV')
      if (scope.kind !== 'DEV') continue
      expect(scope.keychain.service).not.toBe(WORKER_INSTALLATION_KEYCHAIN_PRODUCTION.service)
      expect(scope.keychain.account).not.toBe(WORKER_INSTALLATION_KEYCHAIN_PRODUCTION.account)
      expect(scope.handOverDir.startsWith(WORKER_INSTALLATION_PUBLIC_HANDOVER_DIR_PRODUCTION)).toBe(false)
      expect(scope.handOverDir.startsWith(config.userDataDir)).toBe(true)
      accounts.add(`${config.userDataDir}=${scope.keychain.account}`)
    }
    // Scoped per profile: two user-data dirs never share a dev item.
    const a = resolveInstallationKeyScope(configs[0]!)
    const b = resolveInstallationKeyScope(configs[3]!)
    expect(a.kind === 'DEV' && b.kind === 'DEV' && a.keychain.account !== b.keychain.account).toBe(true)
    expect(resolveInstallationKeyScope({ ...configs[0]!, platform: 'linux' }).kind).toBe('UNAVAILABLE')
    expect(accounts.size).toBeGreaterThan(1)
  })

  it('only the installed, packaged bundle at the canonical path resolves to PRODUCTION (pure resolution)', () => {
    const scope = resolveInstallationKeyScope(INSTALLED_DEFAULT)
    expect(scope.kind).toBe('PRODUCTION')
    if (scope.kind !== 'PRODUCTION') return
    expect(scope.keychain).toEqual(WORKER_INSTALLATION_KEYCHAIN_PRODUCTION)
    expect(scope.handOverDir).toBe(WORKER_INSTALLATION_PUBLIC_HANDOVER_DIR_PRODUCTION)
  })

  it('a PRODUCTION custody refuses to run under a test environment or with an injected security binary — nothing is spawned', async () => {
    const scope = resolveInstallationKeyScope(INSTALLED_DEFAULT)
    const fake = makeFakeSecurity()
    const underTest = createWorkerInstallationKeyCustody(scope)
    expect(underTest.view()).toMatchObject({ status: 'UNAVAILABLE', scope: 'PRODUCTION', reason: 'PRODUCTION_SCOPE_REFUSED_IN_TEST' })
    await expect(underTest.refresh()).resolves.toMatchObject({ status: 'UNAVAILABLE', reason: 'PRODUCTION_SCOPE_REFUSED_IN_TEST' })
    await expect(underTest.enrol()).rejects.toMatchObject({ code: 'PRODUCTION_SCOPE_REFUSED_IN_TEST' })
    // Even outside a test environment, production never accepts a substituted binary.
    const injected = createWorkerInstallationKeyCustody(scope, { securityPath: fake.path, environment: {} })
    expect(injected.view()).toMatchObject({ status: 'UNAVAILABLE', reason: 'PRODUCTION_SECURITY_PATH_FIXED' })
    await expect(injected.enrol()).rejects.toMatchObject({ code: 'PRODUCTION_SECURITY_PATH_FIXED' })
    expect(fake.log()).toEqual([])
    expect(trip.hits).toEqual([])
  })

  it('under a test environment even a DEV custody refuses the system security binary — nothing is spawned', async () => {
    const custody = createWorkerInstallationKeyCustody(devScope())
    expect(custody.view()).toMatchObject({ status: 'UNAVAILABLE', scope: 'DEV', reason: 'SYSTEM_KEYCHAIN_REFUSED_IN_TEST' })
    await expect(custody.refresh()).resolves.toMatchObject({ reason: 'SYSTEM_KEYCHAIN_REFUSED_IN_TEST' })
    await expect(custody.enrol()).rejects.toMatchObject({ code: 'SYSTEM_KEYCHAIN_REFUSED_IN_TEST' })
    const explicit = createWorkerInstallationKeyCustody(devScope(), { securityPath: '/usr/bin/security' })
    await expect(explicit.enrol()).rejects.toMatchObject({ code: 'SYSTEM_KEYCHAIN_REFUSED_IN_TEST' })
    expect(trip.hits).toEqual([])
  })
})

/* ------------------------------------------- D-0b-F: review R-1, R-2, R-3 regressions */

describe('D-0b-F R-1: PRODUCTION also requires the default user-data dir (no isolated profile)', () => {
  it('the installed, packaged bundle on its default profile is PRODUCTION', () => {
    expect(resolveInstallationKeyScope(INSTALLED_DEFAULT).kind).toBe('PRODUCTION')
  })

  it('the installed bundle with AERA_DESKTOP_USER_DATA_DIR or a non-default userData resolves to a profile-scoped DEV item, never PRODUCTION', () => {
    const isolated = mkdtempSync(join(tmpdir(), 'd0bf-isolated-profile-'))
    const variants = [
      // The acceptance/verification override (main.ts) on the installed bundle.
      { ...INSTALLED_DEFAULT, userDataDir: isolated, userDataOverride: isolated },
      // Any override present, even one main.ts ignores or one naming the default path.
      { ...INSTALLED_DEFAULT, userDataOverride: '' },
      { ...INSTALLED_DEFAULT, userDataOverride: 'relative/profile' },
      { ...INSTALLED_DEFAULT, userDataOverride: DEFAULT_USER_DATA_DIR },
      // userData moved some other way (no env override): still not the default.
      { ...INSTALLED_DEFAULT, userDataDir: isolated },
      { ...INSTALLED_DEFAULT, userDataDir: `${DEFAULT_USER_DATA_DIR}/` },
      { ...INSTALLED_DEFAULT, userDataDir: '/Users/Allyd/Library/Application Support/../Application Support/Aera Code' },
      { ...INSTALLED_DEFAULT, userDataDir: '', defaultUserDataDir: '' },
    ]
    for (const variant of variants) {
      const scope = resolveInstallationKeyScope(variant)
      expect(scope.kind, JSON.stringify(variant)).toBe('DEV')
      if (scope.kind !== 'DEV') continue
      expect(scope.keychain.service).not.toBe(WORKER_INSTALLATION_KEYCHAIN_PRODUCTION.service)
      expect(scope.keychain.account).not.toBe(WORKER_INSTALLATION_KEYCHAIN_PRODUCTION.account)
      expect(scope.handOverDir.startsWith(WORKER_INSTALLATION_PUBLIC_HANDOVER_DIR_PRODUCTION)).toBe(false)
      expect(scope.handOverDir).toBe(join(variant.userDataDir, 'aera-worker-public-dev'))
    }
    // The isolated profile is scoped to its own dir: a distinct dev item per profile.
    const a = resolveInstallationKeyScope(variants[0]!)
    const b = resolveInstallationKeyScope({ ...variants[0]!, userDataDir: mkdtempSync(join(tmpdir(), 'd0bf-isolated-other-')) })
    expect(a.kind === 'DEV' && b.kind === 'DEV' && a.keychain.account !== b.keychain.account).toBe(true)
  })

  it('the host wiring passes the override env and the <appData>/<userDataDirectoryName> default, exactly as main.ts derives them', () => {
    const collab = readFileSync(join(SRC, 'aera-collab.ts'), 'utf8')
    const main = readFileSync(join(SRC, 'main.ts'), 'utf8')
    expect(collab).toContain('userDataOverride: process.env.AERA_DESKTOP_USER_DATA_DIR,')
    expect(collab).toContain("defaultUserDataDir: join(electron.app.getPath('appData'), AERA_CODE_PRODUCT.userDataDirectoryName),")
    expect(collab).toContain("userDataDir: electron.app.getPath('userData'),")
    expect(main).toContain('const userDataOverride = process.env.AERA_DESKTOP_USER_DATA_DIR')
    expect(main).toContain("const appData = app.getPath('appData')")
    expect(main).toContain('join(appData, AERA_CODE_PRODUCT.userDataDirectoryName)')
  })
})

describe('D-0b-F R-2: regression tests for the defensive guards (reviewer probes P1–P5)', () => {
  it('P3: a nested executable inside the canonical bundle is not PRODUCTION', () => {
    for (const execPath of [
      `${AERA_CODE_CANONICAL_INSTALL_PATH}/Contents/MacOS/nested/Aera Code`,
      `${AERA_CODE_CANONICAL_INSTALL_PATH}/Contents/MacOS/Helpers/Other.app/Contents/MacOS/Aera Code`,
      `${AERA_CODE_CANONICAL_INSTALL_PATH}/Contents/MacOS//Aera Code`,
    ]) expect(resolveInstallationKeyScope({ ...INSTALLED_DEFAULT, execPath }).kind, execPath).toBe('DEV')
  })

  it('P4: a scope whose item names could reach the security -i line parser is refused before anything is spawned', async () => {
    const fake = makeFakeSecurity()
    const handOverDir = join(mkdtempSync(join(tmpdir(), 'd0bf-bad-item-')), 'handover')
    const ok = devScope().keychain
    const bad = [
      { service: ok.service, account: 'dev-x -w injected' },
      { service: ok.service, account: 'dev-x\nadd-generic-password -a a -s b -w c' },
      { service: ok.service, account: 'dev-"quoted"' },
      { service: ok.service, account: 'dev-#comment' },
      { service: ok.service, account: '' },
      { service: ok.service, account: 'a'.repeat(129) },
      { service: 'svc with space', account: ok.account },
      { service: 'svc\n', account: ok.account },
    ]
    for (const keychain of bad) {
      const custody = createWorkerInstallationKeyCustody({ kind: 'DEV', keychain, handOverDir }, { securityPath: fake.path })
      expect(custody.view(), JSON.stringify(keychain)).toMatchObject({ status: 'UNAVAILABLE', scope: 'DEV', reason: 'KEYCHAIN_UNAVAILABLE' })
      await expect(custody.refresh()).resolves.toMatchObject({ status: 'UNAVAILABLE', reason: 'KEYCHAIN_UNAVAILABLE' })
      await expect(custody.enrol()).rejects.toMatchObject({ code: 'KEYCHAIN_UNAVAILABLE' })
    }
    expect(fake.log()).toEqual([])
    expect(fake.state()).toEqual({})
    expect(existsSync(handOverDir)).toBe(false)
  })

  it('P2: the Keychain port refuses a non-base64 add value without spawning security (no stdin command smuggling)', async () => {
    const fake = makeFakeSecurity()
    const port = securityCliKeychainPort(fake.path, 2_000)
    const item = devScope().keychain
    for (const value of [
      'QUFB\ndelete-generic-password -a x -s y',
      'QUFB -U',
      'QUFB"',
      'QUFB#',
      'QUFB\n',
      '',
      'QUFB===',
    ]) await expect(port.add(item, value), JSON.stringify(value)).rejects.toMatchObject({ code: 'KEYCHAIN_ADD_FAILED' })
    expect(fake.log()).toEqual([])
    expect(fake.state()).toEqual({})
    // A well-formed value is accepted by the same port.
    await expect(port.add(item, 'QUFBQQ==')).resolves.toBeUndefined()
    expect(fake.state()[`${item.service}|${item.account}`]).toBe('QUFBQQ==')
  })

  it('P2: only the custody module uses the security CLI port', () => {
    const srcFiles = (dir = SRC): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
      entry.isDirectory() ? srcFiles(join(dir, entry.name)) : /\.(ts|tsx)$/u.test(entry.name) ? [join(dir, entry.name)] : [])
    for (const file of srcFiles()) {
      if (file.endsWith('/aera-worker-installation-key.ts')) continue
      expect(readFileSync(file, 'utf8'), file).not.toContain('securityCliKeychainPort')
    }
  })

  it('P1: the hand-over refuses a symlinked directory and a directory owned by another user', () => {
    const base = mkdtempSync(join(tmpdir(), 'd0bf-handover-'))
    // Symlinked directory: refused, the symlink target stays empty.
    const victim = join(base, 'victim')
    mkdirSync(victim)
    const link = join(base, 'link')
    symlinkSync(victim, link)
    expect(() => publishPublicHandOverFile(link, WORKER_INSTALLATION_PUBLIC_JWK_FILENAME, '{}')).toThrow(expect.objectContaining({ code: 'PUBLIC_HANDOVER_UNSAFE' }) as Error)
    expect(readdirSync(victim)).toEqual([])
    // A directory owned by another uid (root-owned /usr): refused before any chmod or write.
    const foreign = '/usr'
    expect(statSync(foreign).uid).not.toBe(process.getuid!())
    expect(() => publishPublicHandOverFile(foreign, WORKER_INSTALLATION_PUBLIC_JWK_FILENAME, '{}')).toThrow(expect.objectContaining({ code: 'PUBLIC_HANDOVER_UNSAFE' }) as Error)
    expect(existsSync(join(foreign, WORKER_INSTALLATION_PUBLIC_JWK_FILENAME))).toBe(false)
    // A traversal filename is refused.
    expect(() => publishPublicHandOverFile(victim, '../escape.json', '{}')).toThrow(expect.objectContaining({ code: 'PUBLIC_HANDOVER_UNSAFE' }) as Error)
    expect(existsSync(join(base, 'escape.json'))).toBe(false)
  })

  it('P1: a world-writable own directory is tightened to 0755 and a pre-planted symlink at the target is replaced, not followed', () => {
    const base = mkdtempSync(join(tmpdir(), 'd0bf-handover-'))
    const dir = join(base, 'handover')
    mkdirSync(dir)
    chmodSync(dir, 0o777)
    const outside = join(base, 'outside.txt')
    writeFileSync(outside, 'untouched')
    symlinkSync(outside, join(dir, WORKER_INSTALLATION_PUBLIC_JWK_FILENAME))
    const target = publishPublicHandOverFile(dir, WORKER_INSTALLATION_PUBLIC_JWK_FILENAME, '{"public":true}')
    expect(statSync(dir).mode & 0o777).toBe(0o755)
    expect(lstatSync(target).isSymbolicLink()).toBe(false)
    expect(statSync(target).mode & 0o777).toBe(0o644)
    expect(readFileSync(target, 'utf8')).toBe('{"public":true}')
    expect(readFileSync(outside, 'utf8')).toBe('untouched')
  })

  it('P5: no failure path of enrol or refresh leaks the private value into an error, the view or a log line', async () => {
    const cases = [
      { mode: 'store-then-fail-add' as const, code: 'KEYCHAIN_ADD_FAILED', timeoutMs: undefined },
      { mode: 'readback-mismatch' as const, code: 'KEYCHAIN_READBACK_MISMATCH', timeoutMs: undefined },
      { mode: 'store-then-hang' as const, code: 'KEYCHAIN_TIMEOUT', timeoutMs: 400 },
    ]
    for (const testCase of cases) {
      const logs: string[] = []
      const { fake, scope, custody } = devCustody({ log: line => logs.push(line), ...(testCase.timeoutMs === undefined ? {} : { timeoutMs: testCase.timeoutMs }) })
      fake.mode(testCase.mode)
      let caught: unknown
      try {
        await custody.enrol()
      } catch (error) {
        caught = error
      }
      expect(caught, testCase.mode).toMatchObject({ code: testCase.code })
      // The fake stored the generated value before failing: that is the secret to scan for.
      const stored = fake.state()[`${scope.keychain.service}|${scope.keychain.account}`]
      expect(typeof stored, testCase.mode).toBe('string')
      const error = caught as Error & { code: string, cause?: unknown }
      expect(error.message).toBe(`Worker installation key: ${testCase.code}`)
      for (const surface of [
        error.message, String(error), error.stack ?? '', JSON.stringify(error), inspect(error, { depth: 8, showHidden: true }),
        JSON.stringify(custody.view()), inspect(custody, { depth: 8, showHidden: true }), logs.join('\n'), JSON.stringify(fake.log()),
      ]) assertNoKeyMaterial(surface, secretsOf(stored!))
      expect(custody.view()).toMatchObject({ status: 'UNAVAILABLE', reason: testCase.code })
    }

    // refresh() over a stored item that is not an Ed25519 key: UNAVAILABLE, and the value is never echoed.
    const logs: string[] = []
    const { fake, scope, custody } = devCustody({ log: line => logs.push(line) })
    const notEd25519 = (generateKeyPairSync('x25519').privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer).toString('base64')
    fake.seed(scope.keychain.service, scope.keychain.account, notEd25519)
    await expect(custody.refresh()).resolves.toMatchObject({ status: 'UNAVAILABLE', reason: 'KEYCHAIN_ITEM_MALFORMED' })
    let enrolError: unknown
    try {
      await custody.enrol()
    } catch (error) {
      enrolError = error
    }
    expect(enrolError).toMatchObject({ code: 'WORKER_KEY_ALREADY_ENROLLED' })
    const der = Buffer.from(notEd25519, 'base64')
    for (const surface of [
      JSON.stringify(custody.view()), logs.join('\n'), String(enrolError), inspect(enrolError, { depth: 8, showHidden: true }),
    ]) {
      expect(surface).not.toContain(notEd25519)
      expect(surface).not.toContain(der.subarray(16).toString('base64url'))
    }
  })
})

describe('D-0b-F R-3: the test-environment tripwire normalises the security path', () => {
  it('a non-canonical spelling of /usr/bin/security (or a link to it) is still refused under a test environment — nothing is spawned', () => {
    const base = mkdtempSync(join(tmpdir(), 'd0bf-tripwire-'))
    const alias = join(base, 'kc-tool')
    symlinkSync('/usr/bin/security', alias)
    for (const securityPath of ['/usr/bin//security', '/usr/bin/../bin/security', '/usr/bin/./security', '//usr/bin/security', alias]) {
      // view() only: the constructor decides the refusal and never spawns.
      const custody = createWorkerInstallationKeyCustody(devScope(), { securityPath })
      expect(custody.view(), securityPath).toMatchObject({ status: 'UNAVAILABLE', scope: 'DEV', reason: 'SYSTEM_KEYCHAIN_REFUSED_IN_TEST' })
    }
    // A fake binary is still accepted under test.
    const fake = makeFakeSecurity()
    expect(createWorkerInstallationKeyCustody(devScope(), { securityPath: fake.path }).view()).toMatchObject({ reason: 'KEYCHAIN_NOT_YET_CONSULTED' })
    expect(trip.hits).toEqual([])
  })
})

/* ------------------------------------------------------------------- enrol */

describe('enrol: in-process Ed25519, Keychain via security -i stdin, public hand-over only', () => {
  it('generates, stores via stdin (argv is just -i, no -U), reads back, and publishes the public JWK', async () => {
    const logs: string[] = []
    const { fake, scope, custody } = devCustody({ log: line => logs.push(line) })
    await expect(custody.refresh()).resolves.toMatchObject({ status: 'NOT_ENROLLED', scope: 'DEV' })
    const enrolled = await custody.enrol()

    // Public JWK: exactly kty/crv/x, 43-char x, no d (agent-register checks, W3.2).
    expect(Object.keys(enrolled.publicJwk).sort()).toEqual(['crv', 'kty', 'x'])
    expect(enrolled.publicJwk).toMatchObject({ kty: 'OKP', crv: 'Ed25519' })
    expect(enrolled.publicJwk.x).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    const canonical = `{"crv":"Ed25519","kty":"OKP","x":"${enrolled.publicJwk.x}"}`
    expect(enrolled.installationKeyId).toBe(createHash('sha256').update(canonical).digest('base64url'))
    expect(enrolled.publicJwkSha256).toBe(createHash('sha256').update(canonical).digest('hex'))

    // Keychain write: one add line on stdin of `security -i`; never -U; the value never in argv.
    const entries = fake.log()
    const adds = entries.filter(entry => entry.stdin !== undefined)
    expect(adds).toHaveLength(1)
    expect(adds[0]!.argv).toEqual(['-i'])
    expect(adds[0]!.stdin).toEqual(['add-generic-password', '-a', scope.keychain.account, '-s', scope.keychain.service, '-w', '<value>'])
    const stored = fake.state()[`${scope.keychain.service}|${scope.keychain.account}`]!
    expect(stored).toMatch(/^[A-Za-z0-9+/]+=*$/u)
    for (const entry of entries) for (const arg of entry.argv) expect(arg).not.toContain(stored.slice(0, 24))
    // A read-back followed the add.
    expect(entries.some(entry => entry.argv.includes('-w') && entry.argv[0] === 'find-generic-password')).toBe(true)

    // The stored value is PKCS#8 DER of the key whose public half was published.
    const priv = createPrivateKey({ key: Buffer.from(stored, 'base64'), format: 'der', type: 'pkcs8' })
    expect(priv.asymmetricKeyType).toBe('ed25519')
    expect((createPublicKey(priv).export({ format: 'jwk' }) as { x: string }).x).toBe(enrolled.publicJwk.x)

    // M-6: the hand-over file is public-only, 0644, in a 0755 directory, bytes = canonical JWK.
    expect(enrolled.publicHandOverPath).toBe(join(scope.handOverDir, WORKER_INSTALLATION_PUBLIC_JWK_FILENAME))
    expect(readFileSync(enrolled.publicHandOverPath, 'utf8')).toBe(canonical)
    expect(createHash('sha256').update(readFileSync(enrolled.publicHandOverPath)).digest('hex')).toBe(enrolled.publicJwkSha256)
    expect(statSync(enrolled.publicHandOverPath).mode & 0o777).toBe(0o644)
    expect(statSync(scope.handOverDir).mode & 0o777).toBe(0o755)
    expect(readdirSync(scope.handOverDir)).toEqual([WORKER_INSTALLATION_PUBLIC_JWK_FILENAME])

    expect(custody.view()).toEqual({
      status: 'ENROLLED',
      scope: 'DEV',
      installationKeyId: enrolled.installationKeyId,
      x: enrolled.publicJwk.x,
      publicJwkSha256: enrolled.publicJwkSha256,
      publicHandOverPath: enrolled.publicHandOverPath,
    })
    expect(custody.publicJwk()).toEqual(enrolled.publicJwk)
    expect(custody.installationKeyId()).toBe(enrolled.installationKeyId)

    // No private material anywhere observable.
    const secrets = secretsOf(stored)
    for (const surface of [
      JSON.stringify(enrolled), JSON.stringify(custody.view()), JSON.stringify(custody), inspect(custody, { depth: 8, showHidden: true }),
      logs.join('\n'), readFileSync(enrolled.publicHandOverPath, 'utf8'), JSON.stringify(fake.log()),
      Object.values(process.env).join('\n'),
    ]) assertNoKeyMaterial(surface, secrets)
    expect(logs.some(line => line.includes(enrolled.installationKeyId))).toBe(true)
  })

  it('refuses to overwrite an existing item: nothing is added and the stored value is unchanged', async () => {
    const { fake, scope, custody } = devCustody()
    fake.seed(scope.keychain.service, scope.keychain.account, rfcPkcs8B64)
    await expect(custody.enrol()).rejects.toMatchObject({ code: 'WORKER_KEY_ALREADY_ENROLLED' })
    expect(fake.log().filter(entry => entry.stdin !== undefined)).toEqual([])
    expect(fake.state()[`${scope.keychain.service}|${scope.keychain.account}`]).toBe(rfcPkcs8B64)
    // The refusal leaves the custody showing the existing key, not a new one.
    expect(custody.view()).toMatchObject({ status: 'ENROLLED', installationKeyId: RFC8037.thumbprint })
  })

  it('a second enrol after a successful one is refused (ENROLLED)', async () => {
    const { fake, custody } = devCustody()
    const first = await custody.enrol()
    await expect(custody.enrol()).rejects.toMatchObject({ code: 'WORKER_KEY_ALREADY_ENROLLED' })
    expect(fake.log().filter(entry => entry.stdin !== undefined)).toHaveLength(1)
    expect(custody.installationKeyId()).toBe(first.installationKeyId)
  })

  it('a read-back mismatch is UNAVAILABLE: no hand-over file, no usable key', async () => {
    const { fake, scope, custody } = devCustody()
    fake.mode('readback-mismatch')
    await expect(custody.enrol()).rejects.toMatchObject({ code: 'KEYCHAIN_READBACK_MISMATCH' })
    expect(custody.view()).toMatchObject({ status: 'UNAVAILABLE', reason: 'KEYCHAIN_READBACK_MISMATCH' })
    expect(existsSync(join(scope.handOverDir, WORKER_INSTALLATION_PUBLIC_JWK_FILENAME))).toBe(false)
    expect(() => custody.installationKeyId()).toThrow(expect.objectContaining({ code: 'NOT_ENROLLED' }) as Error)
  })

  it('a prompting (hanging) security is killed by the watchdog and the custody is UNAVAILABLE', async () => {
    const { fake, custody } = devCustody({ timeoutMs: 400 })
    fake.mode('hang-add')
    await expect(custody.enrol()).rejects.toMatchObject({ code: 'KEYCHAIN_TIMEOUT' })
    expect(custody.view()).toMatchObject({ status: 'UNAVAILABLE', reason: 'KEYCHAIN_TIMEOUT' })
  })

  it('a failed add and an erroring Keychain are UNAVAILABLE, never ENROLLED', async () => {
    const failing = devCustody()
    failing.fake.mode('fail-add')
    await expect(failing.custody.enrol()).rejects.toMatchObject({ code: 'KEYCHAIN_ADD_FAILED' })
    expect(failing.custody.view().status).toBe('UNAVAILABLE')
    const erroring = devCustody()
    erroring.fake.mode('exists-error')
    await expect(erroring.custody.refresh()).resolves.toMatchObject({ status: 'UNAVAILABLE', reason: 'KEYCHAIN_UNAVAILABLE' })
    await expect(erroring.custody.enrol()).rejects.toMatchObject({ code: 'KEYCHAIN_UNAVAILABLE' })
  })

  it('refuses concurrent enrolment', async () => {
    const { fake, custody } = devCustody()
    const first = custody.enrol()
    await expect(custody.enrol()).rejects.toMatchObject({ code: 'ENROL_IN_PROGRESS' })
    await first
    expect(fake.log().filter(entry => entry.stdin !== undefined)).toHaveLength(1)
  })
})

/* ------------------------------------------------------------ parity + signing */

describe('parity and signing: the key never leaves the module', () => {
  it('RFC 7638 thumbprint equals the CIS installationKeyThumbprint (cis-registry agent-credentials.ts:128-131) on the RFC 8037 vector', () => {
    expect(installationKeyThumbprint({ kty: 'OKP', crv: 'Ed25519', x: RFC8037.x })).toBe(RFC8037.thumbprint)
  })

  it('an existing Keychain item loads, re-derives the public hand-over file, and yields the pinned key id', async () => {
    const { fake, scope, custody } = devCustody()
    fake.seed(scope.keychain.service, scope.keychain.account, rfcPkcs8B64)
    await expect(custody.refresh()).resolves.toMatchObject({ status: 'ENROLLED', installationKeyId: RFC8037.thumbprint, x: RFC8037.x })
    const file = join(scope.handOverDir, WORKER_INSTALLATION_PUBLIC_JWK_FILENAME)
    expect(readFileSync(file, 'utf8')).toBe(`{"crv":"Ed25519","kty":"OKP","x":"${RFC8037.x}"}`)
    // A tampered or missing public file is rewritten from the Keychain key.
    writeFileSync(file, '{"kty":"OKP","crv":"Ed25519","x":"tampered"}')
    await custody.refresh()
    expect(readFileSync(file, 'utf8')).toContain(RFC8037.x)
    // Malformed item content is UNAVAILABLE, not a crash and not an echo.
    const other = devCustody()
    other.fake.seed(other.scope.keychain.service, other.scope.keychain.account, 'not-a-key')
    await expect(other.custody.refresh()).resolves.toMatchObject({ status: 'UNAVAILABLE', reason: 'KEYCHAIN_ITEM_MALFORMED' })
  })

  it('signs CIS credential proofs and sender proofs inside custody; a key-id mismatch is refused', async () => {
    const { fake, scope, custody } = devCustody()
    fake.seed(scope.keychain.service, scope.keychain.account, rfcPkcs8B64)
    await custody.refresh()
    const publicKey = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: RFC8037.x }, format: 'jwk' })
    const payload = {
      purpose: 'aera.cis.agent.epoch.begin.v1' as const,
      audience: 'https://cis.example.invalid',
      principalId: issueAeraPrincipalId(),
      installationKeyId: RFC8037.thumbprint,
      challengeId: 'challenge-1',
      nonce: 'nonce-1',
    }
    const signature = custody.signAgentCredentialProof(payload)
    expect(verify(null, canonicalAgentCredentialProofBytes(payload), publicKey, Buffer.from(signature, 'base64url'))).toBe(true)
    expect(() => custody.signAgentCredentialProof({ ...payload, installationKeyId: 'someone-else' })).toThrow(expect.objectContaining({ code: 'KEY_ID_MISMATCH' }) as Error)

    const claims: AgentSenderProofClaims = {
      purpose: AGENT_SENDER_PROOF_PURPOSE,
      audience: 'spiffe://aera.local/workload/aera-router',
      method: 'POST',
      route: MODEL_INVOCATION_ATTEST_ROUTE,
      bodyDigest: sha256Ref('{}'),
      nonce: newSenderProofNonce(),
      issuedAt: 1_700_000_000,
      sessionId: 'agent-session-1',
      sessionTokenDigest: sha256Ref('token'),
      workerEpochId: issueAeraWorkerEpochId(),
      installationKeyId: RFC8037.thumbprint,
    }
    const proof = custody.senderProof(claims)
    const [header, body, sig] = proof.split('.')
    expect(JSON.parse(Buffer.from(header!, 'base64url').toString('utf8'))).toMatchObject({ alg: 'EdDSA', kid: RFC8037.thumbprint })
    expect(verify(null, Buffer.from(`${header!}.${body!}`, 'ascii'), publicKey, Buffer.from(sig!, 'base64url'))).toBe(true)
    expect(() => custody.senderProof({ ...claims, installationKeyId: 'someone-else' })).toThrow(expect.objectContaining({ code: 'KEY_ID_MISMATCH' }) as Error)

    expect(() => custody.assertInstallationKeyId(RFC8037.thumbprint)).not.toThrow()
    expect(() => custody.assertInstallationKeyId('kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4X')).toThrow(expect.objectContaining({ code: 'KEY_ID_MISMATCH' }) as Error)
    // The custody surface hands out no key object and no private bytes.
    expect(Object.keys(custody).sort()).toEqual(['assertInstallationKeyId', 'enrol', 'installationKeyId', 'publicJwk', 'refresh', 'senderProof', 'signAgentCredentialProof', 'view'])
    assertNoKeyMaterial(inspect(custody, { depth: 8, showHidden: true }) + JSON.stringify(custody), secretsOf(rfcPkcs8B64))
  })

  it('refuses to sign before enrolment (NOT_ENROLLED)', async () => {
    const { custody } = devCustody()
    await custody.refresh()
    expect(() => custody.publicJwk()).toThrow(expect.objectContaining({ code: 'NOT_ENROLLED' }) as Error)
    expect(() => custody.assertInstallationKeyId(RFC8037.thumbprint)).toThrow(expect.objectContaining({ code: 'NOT_ENROLLED' }) as Error)
  })
})

/* -------------------------------------------------- m-5 + static custody guards */

describe('m-5 and static custody guards', () => {
  const read = (file: string): string => readFileSync(join(SRC, file), 'utf8')
  const srcFiles = (dir = SRC): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? srcFiles(join(dir, entry.name)) : /\.(ts|tsx)$/u.test(entry.name) ? [join(dir, entry.name)] : [])

  it('the worker key is never a gatewayProfiles entry and the human composer’s Keychain bootstrap never reads it', () => {
    for (const profile of Object.values(AERA_CODE_PRODUCT.gatewayProfiles)) {
      expect(profile.keychainService).not.toMatch(/claude-worker\.installation/u)
    }
    const reads: string[] = []
    for (const activeProfile of [...Object.keys(AERA_CODE_PRODUCT.gatewayProfiles), 'aera-claude-worker', 'installation']) {
      const environment: Record<string, string | undefined> = {}
      try {
        bootstrapAeraGatewayCredential({ platform: 'darwin', environment, activeProfile, readPassword: (service, account) => { reads.push(`${service}|${account}`); return 'v' } })
      } catch { /* profile resolution refusals are fine here */ }
    }
    expect(reads.join('\n')).not.toMatch(/claude-worker\.installation|claude-code-worker-installation/u)
    expect(read('product-brand.ts')).not.toMatch(/claude-worker\.installation|claude-code-worker-installation/u)
    expect(read('aera-gateway-keychain.ts')).not.toMatch(/claude-worker\.installation|claude-code-worker-installation/u)
  })

  it('the custody module never writes process.env and does not reuse the gateway Keychain bootstrap', () => {
    const source = read('aera-worker-installation-key.ts')
    expect(source).not.toMatch(/process\.env(\.[A-Za-z_$][\w$]*|\[[^\]]+\])\s*=(?!=)/u)
    expect(source).not.toMatch(/Object\.assign\(\s*process\.env/u)
    expect(source).not.toMatch(/(from|import\()\s*['"][^'"]*aera-gateway-keychain/u)
    const code = source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '')
    expect(code).not.toMatch(/bootstrapAeraGatewayCredential|gatewayProfiles|AERA_CODE_PRODUCT/u)
    expect(source).not.toMatch(/console\./u)
    // The private key is never written to a file: no PEM export, no key file.
    expect(source).not.toMatch(/format:\s*'pem'|\.pem['"]|\.key['"]/u)
  })

  it('only the custody module names the installation item; /usr/bin/security appears only in the two Keychain modules', () => {
    for (const file of srcFiles()) {
      const text = readFileSync(file, 'utf8')
      const rel = file.slice(SRC.length + 1)
      if (rel !== 'aera-worker-installation-key.ts') expect(text, rel).not.toMatch(/claude-worker\.installation|claude-code-worker-installation/u)
      if (!['aera-worker-installation-key.ts', 'aera-gateway-keychain.ts'].includes(rel)) expect(text, rel).not.toContain('/usr/bin/security')
    }
  })
})

/* ------------------------------------------------------- route + composition + UI */

describe('ENROL_WORKER_KEY: owner route, composition status, worker card', () => {
  it('parses ENROL_WORKER_KEY strictly', () => {
    expect(parseWorkerAction({ action: 'ENROL_WORKER_KEY', workOrderId: 'WO-1' })).toEqual({ action: 'ENROL_WORKER_KEY', workOrderId: 'WO-1' })
    expect(parseWorkerAction({ action: 'ENROL_WORKER_KEY', workOrderId: 'WO-1', service: 'com.aera.code.claude-worker.installation' })).toBeUndefined()
    expect(parseWorkerAction({ action: 'ENROL_WORKER_KEY', workOrderId: 'WO-1', overwrite: true })).toBeUndefined()
  })

  it('enrols while the worker itself is UNAVAILABLE, projects public status only, and refuses a second enrol with 409', async () => {
    const { fake, scope, custody } = devCustody()
    await custody.refresh()
    const runtime = composeAeraWorker({}, { installationKey: custody })
    expect(runtime.kind).toBe('UNAVAILABLE')
    expect(aeraWorkerStatus(runtime, 'WO-1')).toMatchObject({ workOrderId: 'WO-1', unavailableReason: expect.any(String), installationKey: { status: 'NOT_ENROLLED', scope: 'DEV' } })

    const first = response()
    await handleAeraWorkerActionRequest(request({ body: JSON.stringify({ action: 'ENROL_WORKER_KEY', workOrderId: 'WO-1' }) }), first, ORIGIN, req => performAeraWorkerAction(runtime, req, vi.fn()), vi.fn())
    expect(first.statusCode).toBe(200)
    const body = JSON.parse(first.raw()) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['installationKeyId', 'publicHandOverPath', 'publicJwkSha256', 'x'])

    const statusRes = response()
    handleAeraWorkerStatusRequest(request({ method: 'GET', url: '/desktop/aera/worker/status?workOrderId=WO-1' }), statusRes, ORIGIN, id => aeraWorkerStatus(runtime, id), vi.fn())
    const projected = JSON.parse(statusRes.raw()) as { installationKey: Record<string, unknown> }
    expect(projected.installationKey).toMatchObject({ status: 'ENROLLED', installationKeyId: body.installationKeyId, x: body.x })

    const second = response()
    await handleAeraWorkerActionRequest(request({ body: JSON.stringify({ action: 'ENROL_WORKER_KEY', workOrderId: 'WO-1' }) }), second, ORIGIN, req => performAeraWorkerAction(runtime, req, vi.fn()), vi.fn())
    expect(second.statusCode).toBe(409)
    expect(JSON.parse(second.raw())).toMatchObject({ error: 'WORKER_KEY_ALREADY_ENROLLED' })

    const stored = fake.state()[`${scope.keychain.service}|${scope.keychain.account}`]!
    for (const surface of [first.raw(), statusRes.raw(), second.raw()]) assertNoKeyMaterial(surface, secretsOf(stored))
    // Other actions on an unavailable worker still refuse.
    await expect(performAeraWorkerAction(runtime, { action: 'CANCEL', workOrderId: 'WO-1' }, vi.fn())).rejects.toMatchObject({ code: 'WORKER_UNAVAILABLE' })
  })

  it('without a custody, ENROL is refused with a typed code', async () => {
    const runtime = composeAeraWorker({})
    await expect(performAeraWorkerAction(runtime, { action: 'ENROL_WORKER_KEY', workOrderId: 'WO-1' }, vi.fn())).rejects.toMatchObject({ code: 'WORKER_KEY_CUSTODY_UNAVAILABLE' })
  })

  const t = (key: keyof typeof en): string => en[key]
  it('the card offers Enrol only when NOT_ENROLLED (also when the worker is unavailable) and shows x / key id when ENROLLED', () => {
    const api = { status: vi.fn(), action: vi.fn() }
    const notEnrolled = parseWorkerStatus({ workOrderId: 'WO-1', unavailableReason: 'not configured', installationKey: { status: 'NOT_ENROLLED', scope: 'PRODUCTION' } })
    const markupA = renderToStaticMarkup(createElement(AeraWorkerStatus, { api, workOrderId: 'WO-1', lines: [], t, initialStatus: notEnrolled }))
    expect(markupA).toContain('not configured')
    expect(markupA).toContain(en.workerKeyEnrol)
    const enrolled = parseWorkerStatus({
      workOrderId: 'WO-1', unavailableReason: 'not configured',
      installationKey: { status: 'ENROLLED', scope: 'PRODUCTION', installationKeyId: RFC8037.thumbprint, x: RFC8037.x, publicJwkSha256: 'a'.repeat(64), publicHandOverPath: '/Users/Shared/aera-code-worker-public/installation.public.jwk.json' },
    })
    const markupB = renderToStaticMarkup(createElement(AeraWorkerStatus, { api, workOrderId: 'WO-1', lines: [], t, initialStatus: enrolled }))
    expect(markupB).toContain(RFC8037.thumbprint)
    expect(markupB).toContain(RFC8037.x)
    expect(markupB).toContain('/Users/Shared/aera-code-worker-public/installation.public.jwk.json')
    expect(markupB).not.toContain(en.workerKeyEnrol)
  })

  it('the renderer refuses a malformed installation-key projection', () => {
    expect(() => parseWorkerStatus({ workOrderId: 'WO', unavailableReason: 'x', installationKey: { status: 'MAYBE', scope: 'DEV' } })).toThrow()
    expect(() => parseWorkerStatus({ workOrderId: 'WO', unavailableReason: 'x', installationKey: { status: 'ENROLLED', scope: 'DEV', x: 'short' } })).toThrow()
    expect(() => parseWorkerStatus({ workOrderId: 'WO', unavailableReason: 'x', installationKey: { status: 'ENROLLED', scope: 'DEV', d: RFC8037.d } })).toThrow()
  })
})

