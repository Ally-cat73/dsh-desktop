/**
 * Worker installation-key custody (W3.1, product side) — D-0b of
 * WO-AERA-CODE-CLAUDE-CODE-GOVERNED-WORKER-INTEGRATION-001.
 *
 * The Claude Code Worker's CIS installation key is an Ed25519 key generated
 * INSIDE the Aera Code process on the owner's explicit Enrol click, stored
 * only in the owner's login Keychain, and used only in this module:
 *
 * - The private key is written to the Keychain with `security -i`, the
 *   `add-generic-password` line on STDIN (security's argv is just `-i`), under
 *   a 20 s watchdog, then read back and compared (the U6 C4-2 precedent).
 *   There is no `-U`: an existing item is never overwritten.
 * - The private key never reaches a file, a log line, an error message,
 *   `process.env`, the renderer or any return value. Signing happens here
 *   (`senderProof`, `signAgentCredentialProof`); the key is held in a closure.
 * - Only public material leaves: the `{kty,crv,x}` JWK, its RFC 7638
 *   thumbprint (`installationKeyId`, byte-identical to CIS
 *   `installationKeyThumbprint`) and the JWK sha256, published to ONE public
 *   hand-over location the operator reads without touching app data (M-6).
 *
 * PRODUCTION vs DEV (review M-2). The production Keychain item and the
 * production hand-over directory are used only by the packaged bundle running
 * from the canonical install path named in `.aera-product-identity.json`.
 * Every other launch (a dev Electron, a worktree package, a rollback copy, a
 * test) gets a profile-scoped DEV item and a hand-over directory inside its
 * own user-data dir. A production custody also refuses to run at all under a
 * test environment and never accepts a substituted `security` binary; under a
 * test environment no custody ever runs the system `security` at all.
 *
 * This module deliberately does not reuse `aera-gateway-keychain.ts`: that
 * bootstrap places values into `process.env` and resolves through the human
 * composer's `gatewayProfiles` (review m-5). The worker key is neither.
 */

import { spawn } from 'node:child_process'
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto'
import { chmodSync, closeSync, lstatSync, mkdirSync, openSync, renameSync, writeSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  canonicalAgentCredentialProofBytes,
  type AgentCredentialProofPayload,
  type AgentSenderProofClaims,
} from '@aera/cis-contracts'
import { createAgentSenderProof } from '@aera/local-effect-admission'

/** The production login-Keychain item (plan §4.2). Reachable only from the PRODUCTION scope. */
export const WORKER_INSTALLATION_KEYCHAIN_PRODUCTION = Object.freeze({
  service: 'com.aera.code.claude-worker.installation',
  account: 'claude-code-worker-installation-v1',
})
/** The ONE public hand-over location for the production key (M-6). Public files only, 0644 in 0755. */
export const WORKER_INSTALLATION_PUBLIC_HANDOVER_DIR_PRODUCTION = '/Users/Shared/aera-code-worker-public'
export const WORKER_INSTALLATION_PUBLIC_JWK_FILENAME = 'installation.public.jwk.json'
/** C4-2 watchdog: a `security` that has not finished by then is prompting, and is killed. */
export const WORKER_INSTALLATION_KEYCHAIN_TIMEOUT_MS = 20_000
/** `.aera-product-identity.json` `canonicalInstallPath` (pinned by a test against the file). */
export const AERA_CODE_CANONICAL_INSTALL_PATH = '/Users/Allyd/Applications/Aera Code.app'

const SYSTEM_SECURITY = '/usr/bin/security'
const DEV_SERVICE = 'com.aera.code.dev-scoped.claude-worker-key'
const DEV_HANDOVER_SUBDIR = 'aera-worker-public-dev'
const ITEM_NAME = /^[A-Za-z0-9._-]{1,128}$/u
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u
const MAX_KEYCHAIN_STDOUT = 64 * 1024

export interface KeychainItemName { readonly service: string, readonly account: string }

export type InstallationKeyScope =
  | { readonly kind: 'PRODUCTION', readonly keychain: KeychainItemName, readonly handOverDir: string }
  | { readonly kind: 'DEV', readonly keychain: KeychainItemName, readonly handOverDir: string }
  | { readonly kind: 'UNAVAILABLE', readonly reason: string }

/**
 * Decide which Keychain item this process may ever touch. PRODUCTION only for
 * the packaged bundle at the canonical install path; everything else is a DEV
 * item scoped to the user-data dir, so a dev launch can never create, read or
 * collide with the production item.
 */
export function resolveInstallationKeyScope(input: {
  readonly platform: NodeJS.Platform
  readonly isPackaged: boolean
  readonly execPath: string
  readonly userDataDir: string
}): InstallationKeyScope {
  if (input.platform !== 'darwin') return { kind: 'UNAVAILABLE', reason: 'KEYCHAIN_REQUIRES_MACOS' }
  const canonicalExecDir = `${AERA_CODE_CANONICAL_INSTALL_PATH}/Contents/MacOS/`
  const canonical = input.execPath.startsWith(canonicalExecDir)
    && !input.execPath.slice(canonicalExecDir.length).includes('/')
    && !input.execPath.includes('/../')
  if (input.isPackaged === true && canonical) {
    return { kind: 'PRODUCTION', keychain: WORKER_INSTALLATION_KEYCHAIN_PRODUCTION, handOverDir: WORKER_INSTALLATION_PUBLIC_HANDOVER_DIR_PRODUCTION }
  }
  const tag = createHash('sha256').update(input.userDataDir, 'utf8').digest('hex').slice(0, 16)
  return {
    kind: 'DEV',
    keychain: { service: DEV_SERVICE, account: `dev-${tag}` },
    handOverDir: join(input.userDataDir, DEV_HANDOVER_SUBDIR),
  }
}

export interface WorkerInstallationPublicJwk { readonly kty: 'OKP', readonly crv: 'Ed25519', readonly x: string }

/** The canonical RFC 7638 member order for an OKP key; also the hand-over file's exact bytes. */
function canonicalPublicJwk(x: string): string {
  return `{"crv":"Ed25519","kty":"OKP","x":"${x}"}`
}

/** RFC 7638 SHA-256 thumbprint — byte-identical to CIS `installationKeyThumbprint` (cis-registry agent-credentials.ts:128-131). */
export function installationKeyThumbprint(jwk: WorkerInstallationPublicJwk): string {
  return createHash('sha256').update(canonicalPublicJwk(jwk.x)).digest('base64url')
}

export type WorkerInstallationKeyStatus = 'NOT_ENROLLED' | 'ENROLLED' | 'UNAVAILABLE'

/** Public projection only — safe for logs, status and the renderer. */
export interface WorkerInstallationKeyView {
  readonly status: WorkerInstallationKeyStatus
  readonly scope: 'PRODUCTION' | 'DEV' | 'NONE'
  readonly installationKeyId?: string
  readonly x?: string
  readonly publicJwkSha256?: string
  readonly publicHandOverPath?: string
  readonly reason?: string
}

export interface WorkerInstallationKeyEnrolment {
  readonly publicJwk: WorkerInstallationPublicJwk
  readonly installationKeyId: string
  readonly publicJwkSha256: string
  readonly publicHandOverPath: string
}

export interface WorkerInstallationKeyCustody {
  /** Last known public state (synchronous; for the status route). */
  view(): WorkerInstallationKeyView
  /** Consult the Keychain; if an item exists, load it and re-derive the public hand-over file. */
  refresh(): Promise<WorkerInstallationKeyView>
  /** Owner's Enrol: generate in-process, store via `security -i` stdin, read back, publish. Refuses if an item exists. */
  enrol(): Promise<WorkerInstallationKeyEnrolment>
  publicJwk(): WorkerInstallationPublicJwk
  installationKeyId(): string
  /** KEY_ID_MISMATCH unless `expected` is this key's thumbprint (critical-path step 9 / CG-2 C-4). */
  assertInstallationKeyId(expected: string): void
  /** A sender proof signed inside custody; refuses claims naming another key. */
  senderProof(claims: AgentSenderProofClaims): string
  /** base64url Ed25519 signature over the CIS proof bytes; refuses a payload naming another key. */
  signAgentCredentialProof(payload: AgentCredentialProofPayload): string
}

export type InstallationKeyErrorCode =
  | 'NOT_ENROLLED'
  | 'KEY_ID_MISMATCH'
  | 'WORKER_KEY_ALREADY_ENROLLED'
  | 'ENROL_IN_PROGRESS'
  | 'KEYCHAIN_TIMEOUT'
  | 'KEYCHAIN_ADD_FAILED'
  | 'KEYCHAIN_READBACK_MISMATCH'
  | 'KEYCHAIN_UNAVAILABLE'
  | 'KEYCHAIN_ITEM_MALFORMED'
  | 'PUBLIC_HANDOVER_UNSAFE'
  | 'PRODUCTION_SCOPE_REFUSED_IN_TEST'
  | 'PRODUCTION_SECURITY_PATH_FIXED'
  | 'SYSTEM_KEYCHAIN_REFUSED_IN_TEST'
  | 'KEYCHAIN_REQUIRES_MACOS'

/** Errors carry a code and a fixed message; never a value, never security's output. */
function custodyError(code: InstallationKeyErrorCode | string): Error & { code: string } {
  return Object.assign(new Error(`Worker installation key: ${code}`), { code })
}

/* ------------------------------------------------------------- security CLI port */

interface SecurityRun { readonly code: number | null, readonly stdout: string, readonly timedOut: boolean }

function runSecurity(
  securityPath: string,
  args: readonly string[],
  options: { readonly stdin?: string, readonly captureStdout: boolean, readonly timeoutMs: number },
): Promise<SecurityRun> {
  return new Promise((resolve, reject) => {
    // A fixed, minimal environment: the value never travels in env or argv.
    const child = spawn(securityPath, [...args], {
      stdio: ['pipe', options.captureStdout ? 'pipe' : 'ignore', 'ignore'],
      env: { PATH: '/usr/bin:/bin', HOME: homedir() },
    })
    let stdout = ''
    let overflow = false
    let timedOut = false
    const watchdog = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, options.timeoutMs)
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      if (stdout.length + chunk.length > MAX_KEYCHAIN_STDOUT) { overflow = true; return }
      stdout += chunk
    })
    child.on('error', () => { clearTimeout(watchdog); reject(custodyError('KEYCHAIN_UNAVAILABLE')) })
    child.on('close', (code) => {
      clearTimeout(watchdog)
      resolve({ code: overflow ? -1 : code, stdout, timedOut })
    })
    child.stdin?.on('error', () => { /* a dead child is reported by close */ })
    child.stdin?.end(options.stdin ?? '')
  })
}

interface KeychainPort {
  exists(item: KeychainItemName): Promise<boolean>
  read(item: KeychainItemName): Promise<string | undefined>
  add(item: KeychainItemName, value: string): Promise<void>
}

function securityCliKeychain(securityPath: string, timeoutMs: number): KeychainPort {
  const find = async (item: KeychainItemName, withValue: boolean): Promise<SecurityRun> => {
    const run = await runSecurity(securityPath, ['find-generic-password', '-a', item.account, '-s', item.service, ...(withValue ? ['-w'] : [])], { captureStdout: withValue, timeoutMs })
    if (run.timedOut) throw custodyError('KEYCHAIN_TIMEOUT')
    return run
  }
  return {
    async exists(item) {
      const run = await find(item, false)
      if (run.code === 0) return true
      if (run.code === 44) return false
      throw custodyError('KEYCHAIN_UNAVAILABLE')
    },
    async read(item) {
      const run = await find(item, true)
      if (run.code === 44) return undefined
      if (run.code !== 0) throw custodyError('KEYCHAIN_UNAVAILABLE')
      return run.stdout.trim()
    },
    async add(item, value) {
      if (!BASE64.test(value)) throw custodyError('KEYCHAIN_ADD_FAILED')
      // No -U: an existing item is refused by security itself as well.
      const line = `add-generic-password -a ${item.account} -s ${item.service} -w ${value}\n`
      const run = await runSecurity(securityPath, ['-i'], { stdin: line, captureStdout: false, timeoutMs })
      if (run.timedOut) throw custodyError('KEYCHAIN_TIMEOUT')
      if (run.code !== 0) throw custodyError('KEYCHAIN_ADD_FAILED')
    },
  }
}

/* -------------------------------------------------------------- public hand-over */

/**
 * Write one PUBLIC file into a hand-over directory: the directory must be a
 * real directory owned by this user and not group/world-writable; the file is
 * written to a temp name (0644) and renamed into place. D-0c reuses this for
 * the public Worker Epoch record.
 */
export function publishPublicHandOverFile(dir: string, filename: string, content: string): string {
  if (!/^[a-z0-9][a-z0-9.-]{0,80}\.json$/u.test(filename)) throw custodyError('PUBLIC_HANDOVER_UNSAFE')
  mkdirSync(dir, { recursive: true, mode: 0o755 })
  const stat = lstatSync(dir)
  const uid = typeof process.getuid === 'function' ? process.getuid() : -1
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid) throw custodyError('PUBLIC_HANDOVER_UNSAFE')
  chmodSync(dir, 0o755)
  const target = join(dir, filename)
  const temp = join(dir, `.${filename}.${randomBytes(6).toString('hex')}.tmp`)
  const fd = openSync(temp, 'wx', 0o644)
  try {
    writeSync(fd, content)
  } finally {
    closeSync(fd)
  }
  chmodSync(temp, 0o644)
  renameSync(temp, target)
  return target
}

/* ------------------------------------------------------------------ the custody */

export interface WorkerInstallationKeyCustodyOptions {
  /** DEV scope only: a substitute `security` (tests use a fake). PRODUCTION always uses /usr/bin/security. */
  readonly securityPath?: string
  readonly timeoutMs?: number
  /** Ids and status codes only. */
  readonly log?: (line: string) => void
  /** Read-only view of the environment, for the test-environment refusal (defaults to process.env). */
  readonly environment?: Readonly<Record<string, string | undefined>>
}

const isTestEnvironment = (environment: Readonly<Record<string, string | undefined>>): boolean =>
  environment.VITEST !== undefined || environment.VITEST_WORKER_ID !== undefined || environment.NODE_ENV === 'test'

export function createWorkerInstallationKeyCustody(
  scope: InstallationKeyScope,
  options: WorkerInstallationKeyCustodyOptions = {},
): WorkerInstallationKeyCustody {
  const log = options.log ?? (() => {})
  const environment = options.environment ?? process.env
  const scopeKind: WorkerInstallationKeyView['scope'] = scope.kind === 'UNAVAILABLE' ? 'NONE' : scope.kind
  let refusal: string | undefined
  if (scope.kind === 'UNAVAILABLE') refusal = scope.reason
  else if (scope.kind === 'PRODUCTION' && isTestEnvironment(environment)) refusal = 'PRODUCTION_SCOPE_REFUSED_IN_TEST'
  else if (scope.kind === 'PRODUCTION' && options.securityPath !== undefined && options.securityPath !== SYSTEM_SECURITY) refusal = 'PRODUCTION_SECURITY_PATH_FIXED'
  // Tripwire: a test never reaches the real Keychain, not even for a DEV item.
  else if (isTestEnvironment(environment) && (options.securityPath ?? SYSTEM_SECURITY) === SYSTEM_SECURITY) refusal = 'SYSTEM_KEYCHAIN_REFUSED_IN_TEST'
  else if (!ITEM_NAME.test(scope.keychain.service) || !ITEM_NAME.test(scope.keychain.account)) refusal = 'KEYCHAIN_UNAVAILABLE'

  const keychain = scope.kind === 'UNAVAILABLE' || refusal !== undefined
    ? undefined
    : securityCliKeychain(scope.kind === 'PRODUCTION' ? SYSTEM_SECURITY : (options.securityPath ?? SYSTEM_SECURITY), options.timeoutMs ?? WORKER_INSTALLATION_KEYCHAIN_TIMEOUT_MS)
  const item = scope.kind === 'UNAVAILABLE' ? undefined : scope.keychain
  const handOverDir = scope.kind === 'UNAVAILABLE' ? undefined : scope.handOverDir

  // The only references to the private key. Never returned, logged or serialised.
  let privateKey: KeyObject | undefined
  let publicJwk: WorkerInstallationPublicJwk | undefined
  let keyId: string | undefined
  let enrolling = false
  let current: WorkerInstallationKeyView = refusal === undefined
    ? { status: 'UNAVAILABLE', scope: scopeKind, reason: 'KEYCHAIN_NOT_YET_CONSULTED' }
    : { status: 'UNAVAILABLE', scope: scopeKind, reason: refusal }

  const unavailable = (reason: string): WorkerInstallationKeyView => {
    privateKey = undefined
    publicJwk = undefined
    keyId = undefined
    current = { status: 'UNAVAILABLE', scope: scopeKind, reason }
    log(`aera-worker-installation-key: UNAVAILABLE ${reason}`)
    return current
  }

  const adopt = (key: KeyObject): WorkerInstallationKeyEnrolment => {
    const x = (createPublicKey(key).export({ format: 'jwk' }) as { x?: unknown }).x
    if (typeof x !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(x)) throw custodyError('KEYCHAIN_ITEM_MALFORMED')
    const jwk: WorkerInstallationPublicJwk = Object.freeze({ kty: 'OKP', crv: 'Ed25519', x })
    const canonical = canonicalPublicJwk(x)
    const id = installationKeyThumbprint(jwk)
    const sha = createHash('sha256').update(canonical).digest('hex')
    privateKey = key
    publicJwk = jwk
    keyId = id
    let path: string | undefined
    let reason: string | undefined
    try {
      path = publishPublicHandOverFile(handOverDir!, WORKER_INSTALLATION_PUBLIC_JWK_FILENAME, canonical)
    } catch {
      reason = 'PUBLIC_HANDOVER_WRITE_FAILED'
    }
    current = {
      status: 'ENROLLED',
      scope: scopeKind,
      installationKeyId: id,
      x,
      publicJwkSha256: sha,
      ...(path === undefined ? {} : { publicHandOverPath: path }),
      ...(reason === undefined ? {} : { reason }),
    }
    log(`aera-worker-installation-key: ENROLLED scope=${scopeKind} installationKeyId=${id}${reason === undefined ? '' : ` ${reason}`}`)
    return Object.freeze({ publicJwk: jwk, installationKeyId: id, publicJwkSha256: sha, publicHandOverPath: path ?? '' })
  }

  const parseStored = (value: string): KeyObject => {
    if (!BASE64.test(value)) throw custodyError('KEYCHAIN_ITEM_MALFORMED')
    let key: KeyObject
    try {
      key = createPrivateKey({ key: Buffer.from(value, 'base64'), format: 'der', type: 'pkcs8' })
    } catch {
      throw custodyError('KEYCHAIN_ITEM_MALFORMED')
    }
    if (key.asymmetricKeyType !== 'ed25519') throw custodyError('KEYCHAIN_ITEM_MALFORMED')
    return key
  }

  const codeOf = (cause: unknown): string =>
    cause !== null && typeof cause === 'object' && 'code' in cause && typeof (cause as { code: unknown }).code === 'string'
      ? (cause as { code: string }).code
      : 'KEYCHAIN_UNAVAILABLE'

  const refresh = async (): Promise<WorkerInstallationKeyView> => {
    if (refusal !== undefined || keychain === undefined || item === undefined) return current
    try {
      if (!(await keychain.exists(item))) {
        privateKey = undefined
        publicJwk = undefined
        keyId = undefined
        current = { status: 'NOT_ENROLLED', scope: scopeKind }
        return current
      }
      const value = await keychain.read(item)
      if (value === undefined) return unavailable('KEYCHAIN_UNAVAILABLE')
      adopt(parseStored(value))
      return current
    } catch (cause) {
      return unavailable(codeOf(cause))
    }
  }

  const requireKey = (): { key: KeyObject, id: string, jwk: WorkerInstallationPublicJwk } => {
    if (privateKey === undefined || keyId === undefined || publicJwk === undefined) throw custodyError('NOT_ENROLLED')
    return { key: privateKey, id: keyId, jwk: publicJwk }
  }

  const custody: WorkerInstallationKeyCustody = {
    view: () => current,
    refresh,
    async enrol() {
      if (refusal !== undefined || keychain === undefined || item === undefined) throw custodyError(refusal ?? 'KEYCHAIN_UNAVAILABLE')
      if (enrolling) throw custodyError('ENROL_IN_PROGRESS')
      enrolling = true
      try {
        if (current.status === 'ENROLLED') throw custodyError('WORKER_KEY_ALREADY_ENROLLED')
        let exists: boolean
        try {
          exists = await keychain.exists(item)
        } catch (cause) {
          unavailable(codeOf(cause))
          throw cause
        }
        if (exists) {
          await refresh()
          throw custodyError('WORKER_KEY_ALREADY_ENROLLED')
        }
        const pair = generateKeyPairSync('ed25519')
        const value = (pair.privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer).toString('base64')
        try {
          await keychain.add(item, value)
          const readBack = await keychain.read(item)
          if (readBack !== value) throw custodyError('KEYCHAIN_READBACK_MISMATCH')
        } catch (cause) {
          unavailable(codeOf(cause))
          throw custodyError(codeOf(cause))
        }
        return adopt(pair.privateKey)
      } finally {
        enrolling = false
      }
    },
    publicJwk: () => requireKey().jwk,
    installationKeyId: () => requireKey().id,
    assertInstallationKeyId(expected) {
      if (requireKey().id !== expected) throw custodyError('KEY_ID_MISMATCH')
    },
    senderProof(claims) {
      const { key, id } = requireKey()
      if (claims.installationKeyId !== id) throw custodyError('KEY_ID_MISMATCH')
      return createAgentSenderProof({ privateKey: key, claims })
    },
    signAgentCredentialProof(payload) {
      const { key, id } = requireKey()
      if (payload.installationKeyId !== id) throw custodyError('KEY_ID_MISMATCH')
      return sign(null, canonicalAgentCredentialProofBytes(payload), key).toString('base64url')
    },
  }
  return Object.freeze(custody)
}
