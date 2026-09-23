/**
 * Local Claude Code worker host —
 * WO-AERA-CODE-CLAUDE-CODE-GOVERNED-WORKER-INTEGRATION-001 §7 (CLASS 2 seam).
 *
 * The smallest host that runs the owner's installed, already-authenticated
 * Claude Code as REASONING-ONLY compute:
 *
 * - PINNED BINARY. An absolute versioned path, never `claude` from PATH. At
 *   every Epoch start: not a symlink, sha256 equals the pin, `--version`
 *   equals the pinned version, and (darwin) the code signature's
 *   TeamIdentifier equals the pin. Phase A saw the binary replace itself
 *   despite `autoUpdates:false`; a moved binary is refused, not trusted.
 * - ENVIRONMENT BUILT FROM NOTHING. Exactly HOME, PATH=/usr/bin:/bin, USER,
 *   LOGNAME (the minimum for the CLI to find the owner's keychain login).
 *   Nothing is filtered from the parent, so CLAUDE_CODE_MESSAGING_TOKEN,
 *   ANTHROPIC_*, AERA_* and every other variable are absent by construction.
 * - NO EXECUTOR. `--tools "" --safe-mode --setting-sources "" --strict-mcp-config
 *   --disable-slash-commands`, verified on EVERY `system/init` by the
 *   fail-closed guard (`aera-claude-stream.ts`).
 * - AERA-OWNED EMPTY CWD. A fresh 0700 scratch dir per Epoch — never the
 *   repository, never HOME — asserted empty after every turn. Anything that
 *   appears there is a native effect and ends the Epoch.
 * - NO CREDENTIAL CUSTODY. The CLI reads the keychain in-process. This module
 *   never reads, copies, hashes or stores a credential, never passes an API
 *   key, and never uses `--bare` (which would force API-key auth, §16).
 * - LIFECYCLE. Own process group; cancellation SIGINT → SIGTERM → SIGKILL;
 *   per-turn and per-Epoch wall clocks; the group is verified gone after exit
 *   and any straggler is killed and recorded (no orphans).
 */

import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, lstatSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import {
  NO_USAGE,
  WorkerRefusal,
  addWorkerUsage,
  type WorkerAdapter,
  type WorkerAuthClass,
  type WorkerEpochHandle,
  type WorkerEpochSpec,
  type WorkerEpochTerminal,
  type WorkerEpochTerminalStatus,
  type WorkerRuntimeIdentity,
  type WorkerTurnOutcome,
  type WorkerUsage,
} from './aera-worker-adapter.ts'
import {
  StreamLineFramer,
  assistantText,
  classifyAuth,
  evaluateEventGuard,
  evaluateInitGuard,
  isAuthenticationFailure,
  parseStreamLine,
  resultModel,
  resultUsage,
} from './aera-claude-stream.ts'
import { maskSecrets } from './mask-secrets.ts'

export const CLAUDE_CODE_ADAPTER_ID = 'worker-claude-code-cli'
export const CLAUDE_CODE_WORKER_TYPE = 'CLAUDE_CODE'
/** Anthropic's Apple Developer TeamIdentifier on the native binary (Phase A §A). */
export const CLAUDE_CODE_TEAM_IDENTIFIER = 'Q6L2SF6YDW'
/** The PATH the worker sees. The native binary needs nothing else. */
export const CLAUDE_WORKER_PATH = '/usr/bin:/bin'
/** The only environment variables the worker process receives. */
export const CLAUDE_WORKER_ENV_KEYS: readonly string[] = Object.freeze(['HOME', 'PATH', 'USER', 'LOGNAME'])

const MAX_STDERR_BYTES = 64 * 1024

/**
 * What the CLI does that Aera cannot see or switch off (Phase A §F), recorded
 * on every Epoch terminal instead of being omitted (§12).
 */
export const CLAUDE_WORKER_STATIC_LIMITATIONS: readonly string[] = Object.freeze([
  'model transport is the CLI\'s own connection to Anthropic; Aera Router/Sentinel do not see it',
  'telemetry@builtin reports to Anthropic; not governed by Aera',
  'the CLI injects the account email and an environment snapshot into model context; no flag removes them',
  'the CLI opens an inbound messaging socket (/tmp/cc-socks/<pid>.sock) for the Epoch lifetime',
  'the worker process runs as the owner with no OS sandbox; confinement is by executor removal, verified per init',
])

/** The pinned runtime. */
export interface ClaudeWorkerPin {
  readonly binaryPath: string
  readonly sha256: string
  readonly version: string
  readonly model: string
  /** Required code-signing TeamIdentifier (darwin). Absent = not checked (tests). */
  readonly teamIdentifier?: string
}

export type ClaudeWorkerPinResolution =
  | { readonly kind: 'PINNED', readonly pin: ClaudeWorkerPin }
  | { readonly kind: 'UNAVAILABLE', readonly reason: string }

/**
 * Resolve the pin from configuration. Missing configuration is an honest
 * UNAVAILABLE — there is no fallback to PATH and no default binary.
 *
 *   AERA_CLAUDE_WORKER_BINARY   absolute versioned binary path
 *   AERA_CLAUDE_WORKER_SHA256   its sha256
 *   AERA_CLAUDE_WORKER_VERSION  its `--version` string (e.g. 2.1.280)
 *   AERA_CLAUDE_WORKER_MODEL    explicit model (never the owner's default)
 */
export function resolveClaudeWorkerPin(
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform = process.platform,
): ClaudeWorkerPinResolution {
  const pick = (key: string): string | undefined => {
    const value = env[key]?.trim()
    return value === undefined || value === '' ? undefined : value
  }
  const binaryPath = pick('AERA_CLAUDE_WORKER_BINARY')
  const sha256 = pick('AERA_CLAUDE_WORKER_SHA256')?.toLowerCase()
  const version = pick('AERA_CLAUDE_WORKER_VERSION')
  const model = pick('AERA_CLAUDE_WORKER_MODEL')
  const missing = [
    binaryPath === undefined ? 'AERA_CLAUDE_WORKER_BINARY' : undefined,
    sha256 === undefined ? 'AERA_CLAUDE_WORKER_SHA256' : undefined,
    version === undefined ? 'AERA_CLAUDE_WORKER_VERSION' : undefined,
    model === undefined ? 'AERA_CLAUDE_WORKER_MODEL' : undefined,
  ].filter((key): key is string => key !== undefined)
  if (missing.length > 0 || binaryPath === undefined || sha256 === undefined || version === undefined || model === undefined) {
    return { kind: 'UNAVAILABLE', reason: `Claude Code worker is not pinned: ${missing.join(', ')} not configured. Aera never resolves \`claude\` from PATH.` }
  }
  if (!isAbsolute(binaryPath)) return { kind: 'UNAVAILABLE', reason: 'AERA_CLAUDE_WORKER_BINARY must be an absolute versioned path' }
  if (!/^[0-9a-f]{64}$/u.test(sha256)) return { kind: 'UNAVAILABLE', reason: 'AERA_CLAUDE_WORKER_SHA256 is not a sha256' }
  return {
    kind: 'PINNED',
    pin: {
      binaryPath,
      sha256,
      version,
      model,
      ...(platform === 'darwin' ? { teamIdentifier: CLAUDE_CODE_TEAM_IDENTIFIER } : {}),
    },
  }
}

/** The worker environment: built from nothing, four keys, no inheritance. */
export function buildClaudeWorkerEnv(parent: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const home = parent.HOME
  const user = parent.USER ?? parent.LOGNAME
  const logname = parent.LOGNAME ?? parent.USER
  if (home === undefined || home === '' || user === undefined || logname === undefined) {
    throw new WorkerRefusal('WORKER_ENV_INCOMPLETE', 'HOME, USER and LOGNAME are required for the CLI to resolve the existing keychain login')
  }
  return { HOME: home, PATH: CLAUDE_WORKER_PATH, USER: user, LOGNAME: logname }
}

/**
 * The fixed isolation argv. Only the pinned model and the Aera system prompt
 * vary. Never `--bare`, `--resume`, `--mcp-config`, `--add-dir` or
 * `--dangerously-skip-permissions`.
 */
export function buildClaudeWorkerArgv(pin: ClaudeWorkerPin, systemPrompt: string): string[] {
  return [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-hook-events',
    '--safe-mode',
    '--setting-sources', '',
    '--tools', '',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--no-session-persistence',
    '--permission-mode', 'dontAsk',
    '--permission-prompts', 'none',
    '--model', pin.model,
    '--system-prompt', systemPrompt,
  ]
}

/** Streaming sha256 of a file. */
export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    createReadStream(path)
      .on('data', chunk => hash.update(chunk))
      .on('error', reject)
      .on('end', () => { resolve() })
  })
  return hash.digest('hex')
}

/** Default darwin signer check: the TeamIdentifier `codesign` reports, or undefined. */
export async function defaultSignerTeamIdentifier(path: string): Promise<string | undefined> {
  return await new Promise(resolve => {
    execFile('/usr/bin/codesign', ['-dv', '--verbose=2', path], { timeout: 20_000, env: { PATH: CLAUDE_WORKER_PATH } }, (_error, _stdout, stderr) => {
      const match = /TeamIdentifier=([A-Z0-9]+)/u.exec(String(stderr))
      resolve(match?.[1])
    })
  })
}

/** Run `<binary> --version` in the clean env and return its first token. */
async function reportedVersion(binaryPath: string, env: Record<string, string>): Promise<string | undefined> {
  return await new Promise(resolve => {
    execFile(binaryPath, ['--version'], { timeout: 20_000, env, cwd: tmpdir() }, (error, stdout) => {
      if (error !== null) { resolve(undefined); return }
      resolve(/^\s*(\S+)/u.exec(String(stdout))?.[1])
    })
  })
}

export interface ClaudeWorkerHostDeps {
  /** The parent environment the four allowed keys are copied from. */
  readonly parentEnv?: Readonly<Record<string, string | undefined>>
  /** Where Epoch scratch dirs are created. */
  readonly scratchRoot?: string
  /** Signer verifier (injectable; darwin default uses codesign). */
  readonly signerTeamIdentifier?: (path: string) => Promise<string | undefined>
}

/** Verify the pinned binary. Throws `WorkerRefusal('WORKER_BINARY_UNPINNED', …)`. */
export async function verifyClaudeWorkerBinary(
  pin: ClaudeWorkerPin,
  deps: ClaudeWorkerHostDeps = {},
): Promise<WorkerRuntimeIdentity> {
  const refuse = (detail: string): never => {
    throw new WorkerRefusal('WORKER_BINARY_UNPINNED', `Pinned Claude Code binary refused: ${detail}`)
  }
  if (!isAbsolute(pin.binaryPath)) refuse('path is not absolute')
  let stat
  try {
    stat = lstatSync(pin.binaryPath)
  } catch {
    return refuse('binary does not exist at the pinned path')
  }
  if (stat.isSymbolicLink()) refuse('pinned path is a symlink (a moving target)')
  if (!stat.isFile()) refuse('pinned path is not a regular file')
  const digest = await sha256File(pin.binaryPath)
  if (digest !== pin.sha256) refuse(`sha256 ${digest.slice(0, 12)}… does not match the pin ${pin.sha256.slice(0, 12)}…`)
  const env = buildClaudeWorkerEnv(deps.parentEnv ?? process.env)
  const version = await reportedVersion(pin.binaryPath, env)
  if (version !== pin.version) refuse(`--version reports ${version ?? 'nothing'}, pinned ${pin.version}`)
  let signer: string | undefined
  if (pin.teamIdentifier !== undefined) {
    signer = await (deps.signerTeamIdentifier ?? defaultSignerTeamIdentifier)(pin.binaryPath)
    if (signer !== pin.teamIdentifier) refuse(`code signature TeamIdentifier ${signer ?? 'absent'}, pinned ${pin.teamIdentifier}`)
  }
  return {
    workerType: CLAUDE_CODE_WORKER_TYPE,
    adapterId: CLAUDE_CODE_ADAPTER_ID,
    cliVersion: pin.version,
    binaryPath: pin.binaryPath,
    binarySha256: digest,
    ...(signer === undefined ? {} : { signerTeamIdentifier: signer }),
    modelRequested: pin.model,
  }
}

/** The Claude Code CLI behind the provider-neutral Worker Adapter contract. */
export class ClaudeCodeWorkerAdapter implements WorkerAdapter {
  readonly adapterId = CLAUDE_CODE_ADAPTER_ID
  readonly workerType = CLAUDE_CODE_WORKER_TYPE

  constructor(
    private readonly pin: ClaudeWorkerPin,
    private readonly deps: ClaudeWorkerHostDeps = {},
  ) {}

  async preflight(): Promise<WorkerRuntimeIdentity> {
    return await verifyClaudeWorkerBinary(this.pin, this.deps)
  }

  async startEpoch(spec: WorkerEpochSpec): Promise<WorkerEpochHandle> {
    // Re-verified at EVERY Epoch start: a binary that moved since the last
    // Epoch is refused here, before any process exists.
    const runtime = await this.preflight()
    const env = buildClaudeWorkerEnv(this.deps.parentEnv ?? process.env)
    const scratchDir = mkdtempSync(join(this.deps.scratchRoot ?? tmpdir(), 'aera-worker-epoch-'))
    return ClaudeEpochProcess.launch({
      pin: this.pin,
      runtime,
      env,
      scratchDir,
      spec,
      argv: buildClaudeWorkerArgv(this.pin, spec.systemPrompt),
    })
  }
}

interface PendingTurn {
  readonly resolve: (outcome: WorkerTurnOutcome) => void
  readonly turn: number
  text: string
  timer: NodeJS.Timeout | undefined
}

/** One running Claude process = one Worker Epoch. */
class ClaudeEpochProcess implements WorkerEpochHandle {
  readonly epochId: string
  readonly runtime: WorkerRuntimeIdentity
  readonly scratchDir: string
  private readonly child: ChildProcessWithoutNullStreams
  private readonly framer = new StreamLineFramer()
  private readonly spec: WorkerEpochSpec
  private readonly pin: ClaudeWorkerPin
  private pending: PendingTurn | undefined
  private turns = 0
  private usage: WorkerUsage = NO_USAGE
  private failure: { status: WorkerEpochTerminalStatus, reason: string } | undefined
  private cancelRequested: { reason: string } | undefined
  private timedOut = false
  private endRequested = false
  private exited = false
  private stderr = ''
  private apiKeySource: unknown
  private authFailed = false
  private providerSessionId: string | undefined
  private modelReported: string | undefined
  private readonly epochTimer: NodeJS.Timeout
  private readonly terminalPromise: Promise<WorkerEpochTerminal>
  private resolveTerminal!: (terminal: WorkerEpochTerminal) => void
  private readonly limitations = new Set<string>(CLAUDE_WORKER_STATIC_LIMITATIONS)

  static launch(input: {
    readonly pin: ClaudeWorkerPin
    readonly runtime: WorkerRuntimeIdentity
    readonly env: Record<string, string>
    readonly scratchDir: string
    readonly spec: WorkerEpochSpec
    readonly argv: readonly string[]
  }): ClaudeEpochProcess {
    return new ClaudeEpochProcess(input)
  }

  private constructor(input: {
    readonly pin: ClaudeWorkerPin
    readonly runtime: WorkerRuntimeIdentity
    readonly env: Record<string, string>
    readonly scratchDir: string
    readonly spec: WorkerEpochSpec
    readonly argv: readonly string[]
  }) {
    this.epochId = input.spec.epochId
    this.runtime = input.runtime
    this.scratchDir = input.scratchDir
    this.spec = input.spec
    this.pin = input.pin
    this.terminalPromise = new Promise(resolve => { this.resolveTerminal = resolve })
    this.child = spawn(input.pin.binaryPath, [...input.argv], {
      cwd: input.scratchDir,
      env: input.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
      shell: false,
    })
    this.child.stdout.setEncoding('utf8')
    this.child.stderr.setEncoding('utf8')
    this.child.stdin.on('error', () => { /* EPIPE after exit is reported via the exit path */ })
    this.child.stdout.on('data', (chunk: string) => { this.onStdout(chunk) })
    this.child.stderr.on('data', (chunk: string) => {
      if (this.stderr.length < MAX_STDERR_BYTES) this.stderr += chunk.slice(0, MAX_STDERR_BYTES - this.stderr.length)
    })
    this.child.on('error', (error) => {
      this.fail('CRASHED', `worker process error: ${error.message}`)
      if (this.child.pid === undefined) void this.onExit(null, null)
    })
    this.child.on('exit', (code, signal) => { void this.onExit(code, signal) })
    this.epochTimer = setTimeout(() => {
      this.timedOut = true
      this.fail('TIMED_OUT', `Epoch exceeded ${String(input.spec.limits.epochTimeoutMs)} ms`)
    }, input.spec.limits.epochTimeoutMs)
    if (this.child.pid !== undefined) input.spec.onEvent?.({ kind: 'PROCESS_STARTED', pid: this.child.pid })
  }

  get pid(): number | undefined {
    return this.child.pid
  }

  terminal(): Promise<WorkerEpochTerminal> {
    return this.terminalPromise
  }

  async runTurn(input: string): Promise<WorkerTurnOutcome> {
    if (this.exited || this.failure !== undefined || this.cancelRequested !== undefined || this.endRequested) {
      return { kind: 'EPOCH_TERMINATED', terminal: await this.terminalPromise }
    }
    if (this.pending !== undefined) throw new WorkerRefusal('TURN_IN_FLIGHT', 'a turn is already in flight')
    if (this.turns >= this.spec.limits.maxTurns) {
      await this.endInput()
      return { kind: 'EPOCH_TERMINATED', terminal: await this.terminalPromise }
    }
    this.turns += 1
    const turn = this.turns
    let resolveTurn!: (outcome: WorkerTurnOutcome) => void
    const outcome = new Promise<WorkerTurnOutcome>(resolve => { resolveTurn = resolve })
    this.pending = {
      resolve: resolveTurn,
      turn,
      text: '',
      timer: setTimeout(() => {
        this.timedOut = true
        this.fail('TIMED_OUT', `turn ${String(turn)} exceeded ${String(this.spec.limits.turnTimeoutMs)} ms`)
      }, this.spec.limits.turnTimeoutMs),
    }
    this.child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: input } })}\n`)
    return await outcome
  }

  async endInput(): Promise<WorkerEpochTerminal> {
    if (!this.exited && !this.endRequested) {
      this.endRequested = true
      this.child.stdin.end()
      const grace = setTimeout(() => { void this.escalate() }, this.spec.limits.cancelGraceMs * 3)
      void this.terminalPromise.then(() => { clearTimeout(grace) })
    }
    return await this.terminalPromise
  }

  async cancel(reason: string): Promise<WorkerEpochTerminal> {
    if (!this.exited && this.cancelRequested === undefined) {
      this.cancelRequested = { reason }
      void this.escalate()
    }
    return await this.terminalPromise
  }

  /** Signal the whole process group, escalating until it is gone. */
  private async escalate(): Promise<void> {
    const pid = this.child.pid
    if (pid === undefined) return
    const grace = this.spec.limits.cancelGraceMs
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGKILL'] as const) {
      if (this.exited) return
      try { process.kill(-pid, signal) } catch { /* group already gone */ }
      if (signal === 'SIGKILL') return
      const deadline = Date.now() + grace
      while (!this.exited && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 25))
      }
    }
  }

  /** Record a fail-closed reason and stop the process. First reason wins. */
  private fail(status: WorkerEpochTerminalStatus, reason: string): void {
    if (this.failure === undefined) this.failure = { status, reason }
    void this.escalate()
  }

  private onStdout(chunk: string): void {
    let lines: string[]
    try {
      lines = this.framer.push(chunk)
    } catch {
      this.fail('MALFORMED_OUTPUT', 'stdout line exceeds the protocol bound')
      return
    }
    for (const line of lines) {
      if (this.failure !== undefined) return
      const parsed = parseStreamLine(line)
      if (!parsed.ok) {
        this.fail('MALFORMED_OUTPUT', `stdout protocol violation: ${parsed.reason}`)
        return
      }
      this.onEvent(parsed.event)
    }
  }

  private onEvent(event: Readonly<Record<string, unknown>>): void {
    if (event.type === 'system' && event.subtype === 'init') {
      const verdict = evaluateInitGuard(event, {
        scratchDirs: [this.scratchDir, realpathSync(this.scratchDir)],
        cliVersion: this.pin.version,
        model: this.pin.model,
      })
      this.apiKeySource = event.apiKeySource
      if (!verdict.ok) {
        this.fail('GUARD_REFUSED', `${verdict.code}: ${verdict.detail}`)
        return
      }
      if (typeof event.session_id === 'string') this.providerSessionId = event.session_id
      if (typeof event.model === 'string') {
        this.modelReported = event.model
        this.spec.onEvent?.({ kind: 'RUNTIME_READY', model: event.model, cliVersion: this.pin.version })
      }
      return
    }
    const verdict = evaluateEventGuard(event)
    if (!verdict.ok) {
      this.fail('GUARD_REFUSED', `${verdict.code}: ${verdict.detail}`)
      return
    }
    if (isAuthenticationFailure(event)) this.authFailed = true
    if (event.type === 'assistant') {
      const text = assistantText(event)
      if (text !== '' && this.pending !== undefined) {
        this.pending.text += text
        this.spec.onEvent?.({ kind: 'ASSISTANT_TEXT', text })
      }
      return
    }
    if (event.type === 'result') this.completeTurn(event)
  }

  private completeTurn(event: Readonly<Record<string, unknown>>): void {
    const pending = this.pending
    if (pending === undefined) {
      this.fail('MALFORMED_OUTPUT', 'result event with no turn in flight')
      return
    }
    // A native effect in the scratch cwd ends the Epoch BEFORE its output is used.
    const residue = this.scratchResidue()
    if (residue.length > 0) {
      this.fail('NATIVE_EFFECT_DETECTED', `Epoch scratch dir is no longer empty: ${residue.join(', ')}`)
      return
    }
    if (this.authFailed) {
      this.fail('AUTH_UNAVAILABLE', 'Claude Code reports it is not logged in. The owner logs in with `claude` themselves; Aera never automates a login or holds a credential.')
      return
    }
    if (pending.timer !== undefined) clearTimeout(pending.timer)
    this.pending = undefined
    const usage = resultUsage(event)
    this.usage = addWorkerUsage(this.usage, usage)
    const modelReported = resultModel(event) ?? this.modelReported
    const authClass: WorkerAuthClass = classifyAuth({
      apiKeySource: this.apiKeySource,
      authenticationFailed: this.authFailed,
      turnSucceeded: event.is_error !== true,
    })
    const durationMs = typeof event.duration_ms === 'number' ? event.duration_ms : undefined
    const terminalReason = typeof event.terminal_reason === 'string' ? event.terminal_reason : undefined
    this.spec.onEvent?.({ kind: 'TURN_COMPLETED', turn: pending.turn })
    pending.resolve({
      kind: 'TURN_COMPLETED',
      turn: pending.turn,
      text: pending.text !== '' ? pending.text : typeof event.result === 'string' ? event.result : '',
      usage,
      ...(modelReported === undefined ? {} : { modelReported }),
      ...(this.providerSessionId === undefined ? {} : { providerSessionId: this.providerSessionId }),
      authClass,
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(terminalReason === undefined ? {} : { terminalReason }),
      isError: event.is_error === true,
    })
  }

  private scratchResidue(): string[] {
    try {
      return readdirSync(this.scratchDir).sort()
    } catch {
      return ['<scratch dir missing>']
    }
  }

  private async onExit(code: number | null, signal: NodeJS.Signals | null): Promise<void> {
    if (this.exited) return
    this.exited = true
    clearTimeout(this.epochTimer)
    if (this.pending?.timer !== undefined) clearTimeout(this.pending.timer)
    // No orphans: the process group must be gone now.
    let orphanReaped = false
    const pid = this.child.pid
    if (pid !== undefined) {
      try {
        process.kill(-pid, 0)
        orphanReaped = true
        try { process.kill(-pid, 'SIGKILL') } catch { /* raced to exit */ }
      } catch { /* ESRCH: group gone, as required */ }
    }
    const residue = this.scratchResidue()
    let status: WorkerEpochTerminalStatus
    let reason: string
    if (this.failure !== undefined) {
      ({ status, reason } = this.failure)
    } else if (this.cancelRequested !== undefined) {
      status = this.timedOut ? 'TIMED_OUT' : 'CANCELLED'
      reason = this.cancelRequested.reason
    } else if (this.endRequested && code === 0) {
      status = 'COMPLETED'
      reason = 'input ended; worker exited cleanly'
    } else {
      status = 'CRASHED'
      reason = `worker exited unexpectedly (code ${String(code)}, signal ${String(signal)})`
    }
    if (residue.length > 0 && status !== 'NATIVE_EFFECT_DETECTED') {
      reason = `${reason}; scratch residue found: ${residue.join(', ')}`
      status = 'NATIVE_EFFECT_DETECTED'
    }
    if (this.pending !== undefined || status === 'CANCELLED' || status === 'TIMED_OUT') {
      this.limitations.add('the in-flight turn did not complete: the CLI zeroes usage on SIGINT and emits no result on SIGTERM/SIGKILL, so its token usage is not reported')
      this.usage = addWorkerUsage(this.usage, { reported: false })
    }
    if (this.stderr.trim() !== '') this.limitations.add(`stderr (redacted, bounded): ${maskSecrets(this.stderr.trim()).slice(0, 2_000)}`)
    try { rmSync(this.scratchDir, { recursive: true, force: true }) } catch { /* recorded by residue */ }
    const terminal: WorkerEpochTerminal = {
      status,
      reason,
      exitCode: code,
      signal,
      turns: this.turns,
      usage: this.usage,
      orphanReaped,
      limitations: [...this.limitations],
      scratchResidue: residue,
    }
    this.spec.onEvent?.({ kind: 'TERMINATED', status })
    this.resolveTerminal(terminal)
    const pending = this.pending
    this.pending = undefined
    pending?.resolve({ kind: 'EPOCH_TERMINATED', terminal })
  }
}
