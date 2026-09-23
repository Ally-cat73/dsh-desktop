/**
 * Governed effect boundary and Aera execution broker —
 * WO-AERA-CODE-CLAUDE-CODE-GOVERNED-WORKER-INTEGRATION-001 §10/§11.
 *
 * Every worker intent passes, in order and fail-closed at each step:
 *
 *   1. RESOLVE   Aera Session (complete attribution tuple), current Epoch
 *                (anything else is STALE_EPOCH), Work Order lifecycle, the
 *                Working Line and its recorded worktree location.
 *   2. AUTHORITY the canonical CAS port is consulted and recorded
 *                (RECORDED_NOT_ENFORCED, stated as such); ENFORCEMENT reads the
 *                owner's live DecisionV1 grants (`aera-worker-authority.ts`).
 *   3. SENTINEL  the `executeProtected`-shaped gate. V1's production binding is
 *                the truthfully-labelled AERA_CODE_LOCAL_EXECUTION_POLICY; a
 *                remote Sentinel evaluator can be bound behind the same shape.
 *   4. PERFORM   the broker — never the worker — performs the effect, inside
 *                the Working Line worktree only.
 *   5. VERIFY    an independent re-observation of the result.
 *   6. RECORD    typed evidence + a SENTINEL_EXECUTION participation event,
 *                with performedBy / recordedBy / authorisedBy / verifiedBy as
 *                four DISTINCT principals and the proposer named separately.
 *   7. RETURN    the observation, redacted and bounded, byte-identical to the
 *                recorded body — only after the record exists.
 *
 * The worker process holds no executor (`aera-claude-worker-host.ts`), so this
 * is the only path by which anything a worker proposes can happen.
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, normalize, relative, resolve, sep } from 'node:path'
import {
  RecordedAuthorityPort,
  requireParticipationExecutionContext,
  type AuthorityPort,
  type ParticipationStore,
} from '@aera/participation-runtime'
import type { ParticipationSession } from '@aera/evidentiary-work-graph-contracts'
import type { CodeWorkingLineV1 } from '@aera/participation-contracts'
import type { AeraPrincipalId } from '@aera/cis-contracts'
import {
  NO_EXECUTOR_INTENT_KINDS,
  effectClassOf,
  intentToActionRequest,
  type EffectIntentV1,
} from './aera-worker-effect-intent.ts'
import { evaluateWorkerAuthority, type WorkerAuthorityResult } from './aera-worker-authority.ts'
import { maskSecrets } from './mask-secrets.ts'

/** Bound on any single observation returned to the worker (and recorded). */
export const MAX_OBSERVATION_BYTES = 64 * 1024
const MAX_LIST_ENTRIES = 500

/** The distinct durable principals of the governed boundary. */
export interface WorkerBoundaryPrincipals {
  /** Aera Code Worker Host — the Aera Session principal; RECORDS. */
  readonly host: AeraPrincipalId
  /** Aera Code Execution Broker — PERFORMS. */
  readonly broker: AeraPrincipalId
  /** Aera Code Effect Verifier — VERIFIES. */
  readonly verifier: AeraPrincipalId
  /** The worker (e.g. Claude Code) — only ever PROPOSES. */
  readonly worker: AeraPrincipalId
  /** The Work Order owner (HUMAN) — AUTHORISES via recorded decisions. */
  readonly owner: AeraPrincipalId | undefined
}

/**
 * Structural twin of `@aera/harness` `ProtectedExecutionAuthorizationRequest`
 * (AgentLoop.ts). The harness package is a type-only placeholder in the
 * desktop runtime, so the shape is restated rather than imported.
 */
export interface ProtectedExecutionRequestShape {
  readonly origin: 'tool'
  readonly operation: 'tool.execute'
  readonly resource: string
  readonly sessionId: string
  readonly runId: string
  readonly input: unknown
  readonly participation: ReturnType<typeof requireParticipationExecutionContext>
}

/** Structural twin of `@aera/harness` `ProtectedExecutionExecutor`. */
export type ProtectedExecutionSeam = <TResult>(
  request: ProtectedExecutionRequestShape,
  effect: () => Promise<TResult>,
) => Promise<{ readonly effectExecuted: boolean, readonly result?: TResult }>

export interface SentinelGateVerdict {
  readonly verdict: 'PERMIT' | 'DENY' | 'UNAVAILABLE'
  /** Which evaluator decided. Never labelled Sentinel unless it is. */
  readonly evaluator: string
  /** Did a remote Sentinel evaluate this? False for local policy. */
  readonly remote: boolean
  readonly reason: string
}

/** Input to the gate: the protected-execution request plus the resolved scope. */
export interface SentinelGateRequest {
  readonly request: ProtectedExecutionRequestShape
  readonly intent: EffectIntentV1
  readonly worktreeRoot: string
}

/** The Sentinel leg of the boundary. The effect runs only inside `gate`. */
export interface SentinelGate {
  readonly evaluator: string
  readonly remote: boolean
  gate<T>(input: SentinelGateRequest, effect: () => Promise<T>): Promise<{
    readonly verdict: SentinelGateVerdict
    readonly effectExecuted: boolean
    readonly result?: T
  }>
}

/**
 * Bind any canonical `executeProtected` executor (for example a remote
 * Sentinel client) as the gate. A thrown or absent decision is a denial.
 */
export function gateFromProtectedExecutor(
  executor: ProtectedExecutionSeam,
  evaluator: string,
  remote: boolean,
): SentinelGate {
  return {
    evaluator,
    remote,
    async gate(input, effect) {
      try {
        const outcome = await executor(input.request, effect)
        return outcome.effectExecuted
          ? { verdict: { verdict: 'PERMIT', evaluator, remote, reason: 'permitted by protected executor' }, effectExecuted: true, ...(outcome.result === undefined ? {} : { result: outcome.result }) }
          : { verdict: { verdict: 'DENY', evaluator, remote, reason: 'denied by protected executor' }, effectExecuted: false }
      } catch (error) {
        return { verdict: { verdict: 'UNAVAILABLE', evaluator, remote, reason: `protected executor failed closed: ${error instanceof Error ? error.message : String(error)}` }, effectExecuted: false }
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Local execution policy (the V1 production gate)
// ---------------------------------------------------------------------------

const SHELLS = new Set(['sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'csh', 'tcsh', 'env', 'sudo', 'su', 'doas', 'osascript', 'open', 'xargs', 'nohup', 'exec'])
const NETWORK_TOOLS = new Set(['curl', 'wget', 'ssh', 'scp', 'sftp', 'rsync', 'nc', 'ncat', 'netcat', 'telnet', 'ftp', 'gh', 'aws', 'gcloud', 'az', 'kubectl', 'docker', 'npx', 'pnpx', 'bunx'])
const INLINE_CODE_INTERPRETERS = new Set(['node', 'python', 'python3', 'ruby', 'perl', 'deno', 'bun', 'php', 'lua'])
const INLINE_CODE_FLAGS = new Set(['-e', '--eval', '-c', '-p', '--print', '-r', '--require', '--import', '--loader', '--experimental-loader'])
const PACKAGE_MANAGERS = new Set(['npm', 'yarn', 'pnpm', 'bun', 'pip', 'pip3', 'brew', 'gem', 'cargo', 'go', 'apt', 'apt-get', 'port', 'poetry', 'uv'])
const PACKAGE_MUTATING_VERBS = new Set(['install', 'i', 'add', 'remove', 'rm', 'uninstall', 'up', 'upgrade', 'update', 'dlx', 'exec', 'x', 'link', 'publish', 'get', 'global', 'create', 'init', 'set', 'config', 'login', 'logout'])

/** Is `candidate` inside `root` (both absolute, already real)? */
function within(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

/** Resolve a worker-proposed relative path inside the worktree, or refuse. */
export function resolveConfinedPath(
  root: string,
  proposed: string,
  mode: 'read' | 'write' | 'list',
): { readonly ok: true, readonly absolute: string, readonly relativePath: string } | { readonly ok: false, readonly reason: string } {
  if (proposed.includes('\0')) return { ok: false, reason: 'path contains NUL' }
  if (isAbsolute(proposed)) return { ok: false, reason: 'absolute paths are refused; paths are relative to the Working Line worktree' }
  const normalised = normalize(proposed)
  if (normalised === '..' || normalised.startsWith(`..${sep}`)) return { ok: false, reason: 'path escapes the Working Line worktree' }
  const segments = normalised.split(sep)
  if (segments.includes('.git')) return { ok: false, reason: '.git internals are refused; use git.* intents' }
  const absolute = resolve(root, normalised)
  if (!within(root, absolute)) return { ok: false, reason: 'path escapes the Working Line worktree' }
  // Symlink containment: the nearest existing ancestor (or the target) must
  // resolve inside the root.
  let probe = absolute
  while (!existsSync(probe)) {
    const parent = dirname(probe)
    if (parent === probe) break
    probe = parent
  }
  let real: string
  try {
    real = realpathSync(probe)
  } catch {
    return { ok: false, reason: 'path cannot be resolved' }
  }
  if (!within(root, real)) return { ok: false, reason: 'path resolves outside the Working Line worktree (symlink)' }
  if (mode === 'write' && existsSync(absolute)) {
    const stat = lstatSync(absolute)
    if (stat.isSymbolicLink()) return { ok: false, reason: 'writing through a symlink is refused' }
    if (!stat.isFile()) return { ok: false, reason: 'target exists and is not a regular file' }
  }
  if (mode !== 'write' && existsSync(absolute) && !within(root, realpathSync(absolute))) {
    return { ok: false, reason: 'path resolves outside the Working Line worktree (symlink)' }
  }
  return { ok: true, absolute, relativePath: relative(root, absolute) }
}

/** Argv policy for brokered commands. Returns a refusal reason or undefined. */
export function argvPolicyRefusal(argv: readonly string[], root: string): string | undefined {
  const head = argv[0]
  if (head === undefined) return 'empty argv'
  if (head.includes('/') && !within(root, resolve(root, head))) return 'executables outside the worktree are refused by path; name the command'
  const command = basename(head)
  if (SHELLS.has(command)) return `${command} is a shell or launcher; commands are argv arrays, never shell strings`
  if (NETWORK_TOOLS.has(command)) return `${command} reaches the network or fetches packages; no network executor exists in V1`
  if (command === 'git') return 'git runs only through git.* intents'
  if (INLINE_CODE_INTERPRETERS.has(command) && argv.slice(1).some(arg => INLINE_CODE_FLAGS.has(arg) || /^--(eval|print|require|import|loader)=/u.test(arg))) {
    return `${command} with inline code is refused`
  }
  const tokens = command === 'corepack' ? argv.slice(1) : argv
  const manager = tokens[0] === undefined ? undefined : basename(tokens[0])
  if (manager !== undefined && PACKAGE_MANAGERS.has(manager)) {
    const verb = tokens.slice(1).find(token => !token.startsWith('-'))
    if (verb === undefined || PACKAGE_MUTATING_VERBS.has(verb)) return `${manager} ${verb ?? '(bare)'} installs or mutates packages; no package executor exists in V1`
  }
  for (const arg of argv.slice(1)) {
    const candidate = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : arg
    if (isAbsolute(candidate) && !within(root, candidate)) return `argument ${candidate} is outside the Working Line worktree`
    if (candidate.split(/[\\/]/u).includes('..') && !within(root, resolve(root, candidate))) return `argument ${candidate} escapes the Working Line worktree`
  }
  return undefined
}

/**
 * AERA_CODE_LOCAL_EXECUTION_POLICY — the V1 production gate for local
 * workspace effects. It is NOT Sentinel and never says it is: Sentinel sees
 * Router/Sentinel-API traffic, and no Sentinel endpoint evaluates local
 * workspace effects without a server change (§1/§21). `remote: false` is
 * recorded on every verdict.
 */
export class LocalExecutionPolicyGate implements SentinelGate {
  readonly evaluator = 'AERA_CODE_LOCAL_EXECUTION_POLICY'
  readonly remote = false

  evaluate(input: SentinelGateRequest): SentinelGateVerdict {
    const deny = (reason: string): SentinelGateVerdict => ({ verdict: 'DENY', evaluator: this.evaluator, remote: false, reason })
    const { intent, worktreeRoot } = input
    if (intent.path !== undefined) {
      const mode = intent.kind === 'fs.write' ? 'write' : intent.kind === 'fs.list' ? 'list' : 'read'
      const confined = resolveConfinedPath(worktreeRoot, intent.path, mode)
      if (!confined.ok) return deny(confined.reason)
    }
    for (const path of intent.paths ?? []) {
      const confined = resolveConfinedPath(worktreeRoot, path, 'write')
      if (!confined.ok) return deny(`${path}: ${confined.reason}`)
    }
    if (intent.argv !== undefined) {
      const refusal = argvPolicyRefusal(intent.argv, worktreeRoot)
      if (refusal !== undefined) return deny(refusal)
    }
    if (intent.ref !== undefined && !/^[A-Za-z0-9._/~^@{}-]+$/u.test(intent.ref)) return deny('ref contains characters outside a git revision')
    if (intent.ref?.startsWith('-') === true) return deny('ref may not start with -')
    return { verdict: 'PERMIT', evaluator: this.evaluator, remote: false, reason: 'within the Working Line worktree and the local execution policy' }
  }

  async gate<T>(input: SentinelGateRequest, effect: () => Promise<T>): Promise<{
    readonly verdict: SentinelGateVerdict
    readonly effectExecuted: boolean
    readonly result?: T
  }> {
    const verdict = this.evaluate(input)
    if (verdict.verdict !== 'PERMIT') return { verdict, effectExecuted: false }
    const result = await effect()
    return { verdict, effectExecuted: true, result }
  }
}

// ---------------------------------------------------------------------------
// Broker
// ---------------------------------------------------------------------------

/** Per-intent broker context, resolved from durable Aera state by the caller. */
export interface WorkerBrokerContext {
  readonly aeraSessionId: string
  readonly epochId: string
  readonly workOrderId: string
  readonly codeWorkingLineId: string
  /** LIVE lookup of the Aera Session's current Epoch from the store. */
  readonly currentEpochId: () => string | undefined
  readonly modelId?: string
}

export type BrokerStage = 'CONTEXT' | 'AUTHORITY' | 'NO_EXECUTOR' | 'SENTINEL' | 'EXECUTION' | 'VERIFICATION'

export interface WorkerBrokerOutcome {
  readonly intentId: string
  readonly kind: EffectIntentV1['kind']
  readonly performed: boolean
  readonly stage: BrokerStage
  readonly code: string
  /** Exactly what is returned to the worker (and recorded). */
  readonly observation: string
  readonly proposalEvidenceId?: string
  readonly outcomeEvidenceId?: string
  readonly sentinelEventId?: string
  readonly authority?: WorkerAuthorityResult
  readonly gate?: SentinelGateVerdict
}

interface ExecutionResult {
  readonly observation: string
  readonly detail: Record<string, unknown>
  readonly failed: boolean
}

interface VerificationResult {
  readonly outcome: 'PASS' | 'FAIL' | 'INCONCLUSIVE'
  readonly detail: string
}

export interface WorkerEffectBrokerDeps {
  readonly store: ParticipationStore
  readonly principals: WorkerBoundaryPrincipals
  readonly gate: SentinelGate
  readonly casPort?: AuthorityPort
  /** PATH for brokered commands (the host's own); everything else is fixed. */
  readonly commandPath?: string
  readonly commandTimeoutMs?: number
  readonly parentEnv?: Readonly<Record<string, string | undefined>>
}

const sha256 = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex')

// eslint-disable-next-line no-control-regex
const CONTROL_BYTES = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu

/** Redact secret-shaped substrings from UNTRUSTED content (file bytes, command output, worker text). */
export function redact(text: string): string {
  return maskSecrets(text)
}

/**
 * Sanitise and bound an observation. What the worker receives is
 * byte-identical to what is recorded: control bytes (e.g. ANSI escapes) are
 * rendered visibly, the text is trimmed (the store's prose rule) and bounded.
 * Untrusted content inside it has already passed `redact`; Aera's own
 * metadata (digests, ids) is left intact.
 */
export function boundObservation(text: string): string {
  const clean = text
    .replace(CONTROL_BYTES, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
    .trim()
  if (clean === '') return '(empty)'
  if (Buffer.byteLength(clean, 'utf8') <= MAX_OBSERVATION_BYTES) return clean
  const cut = Buffer.from(clean, 'utf8').subarray(0, MAX_OBSERVATION_BYTES - 64).toString('utf8').trim()
  return `${cut}\n[… truncated by Aera at ${String(MAX_OBSERVATION_BYTES)} bytes]`
}

function runCommand(
  command: string,
  args: readonly string[],
  options: { cwd: string, env: Record<string, string>, timeoutMs: number },
): Promise<{ code: number | null, stdout: string, stderr: string, timedOut: boolean }> {
  return new Promise(resolvePromise => {
    execFile(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      shell: false,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      const err = error as (NodeJS.ErrnoException & { code?: number | string, killed?: boolean }) | null
      resolvePromise({
        code: err === null ? 0 : typeof err.code === 'number' ? err.code : null,
        stdout: String(stdout),
        stderr: err !== null && typeof err.code === 'string' ? `${String(stderr)}\n${err.code}: ${err.message}` : String(stderr),
        timedOut: err?.killed === true,
      })
    })
  })
}

/** The Aera execution broker. The ONLY executor a worker intent can reach. */
export class WorkerEffectBroker {
  private readonly casPort: AuthorityPort
  private ordinal = 0

  constructor(private readonly deps: WorkerEffectBrokerDeps) {
    this.casPort = deps.casPort ?? new RecordedAuthorityPort()
  }

  private commandEnv(): Record<string, string> {
    const parent = this.deps.parentEnv ?? process.env
    const env: Record<string, string> = { CI: '1', GIT_TERMINAL_PROMPT: '0', PATH: this.deps.commandPath ?? parent.PATH ?? '/usr/bin:/bin' }
    for (const key of ['HOME', 'USER', 'LOGNAME', 'LANG'] as const) {
      const value = parent[key]
      if (value !== undefined) env[key] = value
    }
    return env
  }

  private git(root: string, args: readonly string[]): Promise<{ code: number | null, stdout: string, stderr: string, timedOut: boolean }> {
    return runCommand('git', ['-c', 'core.fsmonitor=false', '-C', root, ...args], { cwd: root, env: this.commandEnv(), timeoutMs: 60_000 })
  }

  /** Resolve the Working Line's worktree root and verify it is where the line says. */
  private async resolveWorktree(line: CodeWorkingLineV1): Promise<{ ok: true, root: string } | { ok: false, reason: string }> {
    const location = line.worktrees.find(worktree => worktree.repositoryId === line.repositoryId && existsSync(worktree.localPath))
    if (location === undefined) return { ok: false, reason: 'the Working Line has no recorded worktree location on this device' }
    let root: string
    try {
      root = realpathSync(location.localPath)
    } catch {
      return { ok: false, reason: 'the recorded worktree location cannot be resolved' }
    }
    if (!statSync(root).isDirectory()) return { ok: false, reason: 'the recorded worktree location is not a directory' }
    const top = await this.git(root, ['rev-parse', '--show-toplevel'])
    if (top.code !== 0 || realpathSync(top.stdout.trim()) !== root) return { ok: false, reason: 'the recorded worktree location is not the root of a git worktree' }
    const expected = (line.branchRef ?? location.branchRef).replace(/^refs\/heads\//u, '')
    const head = await this.git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
    if (head.code !== 0 || head.stdout.trim() !== expected) {
      return { ok: false, reason: `the worktree is on ${head.stdout.trim() || 'a detached HEAD'}, not the Working Line branch ${expected}` }
    }
    return { ok: true, root }
  }

  /** Govern one intent end to end. Never throws for a governance refusal. */
  async handleIntent(ctx: WorkerBrokerContext, intent: EffectIntentV1): Promise<WorkerBrokerOutcome> {
    const { store, principals } = this.deps
    this.ordinal += 1
    const key = `${ctx.epochId}:${String(this.ordinal)}:${intent.intentId}`
    const effectClass = effectClassOf(intent.kind)
    const session = store.getSession(ctx.aeraSessionId)
    if (session === undefined || session.endedAt !== undefined) {
      // Without an open Aera Session nothing can be recorded, so nothing is performed.
      return this.unrecorded(intent, 'CONTEXT', 'AERA_SESSION_CLOSED', 'the Aera Session is not open; nothing is performed and nothing can be recorded')
    }

    // (0) The proposal is recorded FIRST, as analysis — never as an observation.
    const proposal = this.record(ctx, {
      idempotencyKey: `${key}:proposal`,
      evidenceClass: 'ANALYTICAL_EVIDENCE',
      subject: `Worker effect intent proposed: ${intent.kind} (${intent.intentId})`,
      body: boundObservation(JSON.stringify({ proposedBy: principals.worker, epochId: ctx.epochId, intent: JSON.parse(redact(JSON.stringify({ ...intent, content: intent.content === undefined ? undefined : `<${String(Buffer.byteLength(intent.content, 'utf8'))} bytes>` }))) as unknown, contentSha256: intent.content === undefined ? undefined : sha256(intent.content) })),
      analyticalProvenance: {
        producer: principals.worker,
        ...(ctx.modelId === undefined ? {} : { modelId: ctx.modelId }),
        inputs: [ctx.epochId, ctx.aeraSessionId],
        producedAt: store.nowIso(),
      },
      links: { codeWorkingLineIds: [ctx.codeWorkingLineId as never] },
    })

    const deny = (stage: BrokerStage, code: string, reason: string, extra: {
      authority?: WorkerAuthorityResult
      gate?: SentinelGateVerdict
      sentinelEventId?: string
    } = {}): WorkerBrokerOutcome => {
      const observation = boundObservation(`[${intent.intentId} ${intent.kind}] DENIED at ${stage} (${code}): ${reason}. Nothing was performed.`)
      const outcome = this.record(ctx, {
        idempotencyKey: `${key}:outcome`,
        evidenceClass: 'DECISION_EVIDENCE',
        subject: `Worker effect denied: ${intent.kind} (${intent.intentId}) at ${stage}: ${code}`,
        outcome: 'FAIL',
        body: observation,
        sourceRef: `sha256:${sha256(observation)}`,
        links: { codeWorkingLineIds: [ctx.codeWorkingLineId as never] },
      })
      return {
        intentId: intent.intentId,
        kind: intent.kind,
        performed: false,
        stage,
        code,
        observation,
        ...(proposal === undefined ? {} : { proposalEvidenceId: proposal }),
        ...(outcome === undefined ? {} : { outcomeEvidenceId: outcome }),
        ...(extra.authority === undefined ? {} : { authority: extra.authority }),
        ...(extra.gate === undefined ? {} : { gate: extra.gate }),
        ...(extra.sentinelEventId === undefined ? {} : { sentinelEventId: extra.sentinelEventId }),
      }
    }

    // (1) RESOLVE ----------------------------------------------------------
    const current = ctx.currentEpochId()
    if (current !== ctx.epochId) {
      return deny('CONTEXT', 'STALE_EPOCH', `Epoch ${ctx.epochId} is not the Aera Session's current Epoch (${current ?? 'none'}); a replaced worker cannot act`)
    }
    let participation: ReturnType<typeof requireParticipationExecutionContext>
    try {
      participation = requireParticipationExecutionContext(session as ParticipationSession)
    } catch (error) {
      return deny('CONTEXT', 'ATTRIBUTION_INCOMPLETE', error instanceof Error ? error.message : String(error))
    }
    if (session.workOrderId !== ctx.workOrderId) {
      return deny('CONTEXT', 'WORK_ORDER_MISMATCH', 'the Aera Session is not under this Work Order')
    }
    const state = store.effectiveWorkOrderState(ctx.workOrderId)
    if (state === undefined || (state.lifecycleState !== 'ACTIVE' && state.lifecycleState !== 'UNRECORDED')) {
      return deny('CONTEXT', 'WORK_ORDER_NOT_ACTIVE', `the Work Order is ${state?.lifecycleState ?? 'not registered'}`)
    }
    if (intent.codeWorkingLineId !== ctx.codeWorkingLineId) {
      return deny('CONTEXT', 'WORKING_LINE_MISMATCH', `the intent names ${intent.codeWorkingLineId}; this Epoch is bound to ${ctx.codeWorkingLineId}`)
    }
    const line = store.listCodeWorkingLines(ctx.workOrderId).find(row => row.codeWorkingLineId === ctx.codeWorkingLineId)
    if (line === undefined) return deny('CONTEXT', 'WORKING_LINE_MISMATCH', 'the Working Line is not recorded under this Work Order')
    if (line.lifecycle !== 'OPEN') return deny('CONTEXT', 'WORKING_LINE_NOT_OPEN', `the Working Line is ${line.lifecycle}`)
    const worktree = intent.kind === 'context.read' ? { ok: true as const, root: '' } : await this.resolveWorktree(line)
    if (!worktree.ok) return deny('CONTEXT', 'WORKING_LINE_LOCATION_MISMATCH', worktree.reason)

    // (2) AUTHORITY --------------------------------------------------------
    const action = intentToActionRequest(intent, line.repositoryId)
    if (participation.delegationRef !== undefined) {
      await this.casPort.evaluate({
        delegationRef: participation.delegationRef,
        action: action.operation,
        resource: action.resource,
        workOrderId: ctx.workOrderId,
      })
    }
    const authority = evaluateWorkerAuthority({
      decisions: store.listDecisions(ctx.workOrderId),
      ownerPrincipalId: principals.owner,
      workOrderId: ctx.workOrderId,
      codeWorkingLineId: ctx.codeWorkingLineId,
      effectClass,
      ...(intent.argv === undefined ? {} : { argv: intent.argv }),
    })
    if (authority.kind === 'DENIED') {
      return deny('AUTHORITY', authority.code, `${authority.reason} (CAS port ${this.casPort.portId}: recorded, not enforced; enforcement is Aera Code against owner decisions)`, { authority })
    }
    if (NO_EXECUTOR_INTENT_KINDS.includes(intent.kind)) {
      return deny('NO_EXECUTOR', 'DENIED_NO_EXECUTOR', `Aera Code V1 has no governed executor for ${intent.kind}; it is recorded and never run`, { authority })
    }

    // (3) SENTINEL gate → (4) PERFORM --------------------------------------
    const request: ProtectedExecutionRequestShape = {
      origin: 'tool',
      operation: 'tool.execute',
      resource: action.resource,
      sessionId: session.sessionId,
      runId: ctx.epochId,
      input: { operation: action.operation, intentId: intent.intentId, kind: intent.kind },
      participation,
    }
    let execution: ExecutionResult | undefined
    let gated: Awaited<ReturnType<SentinelGate['gate']>>
    try {
      gated = await this.deps.gate.gate({ request, intent, worktreeRoot: worktree.root }, async () => {
        try {
          execution = await this.perform(ctx, intent, worktree.root, line)
        } catch (error) {
          // The effect was attempted by the broker and failed; that is an
          // execution outcome, recorded as such — never a silent success.
          execution = { observation: `execution error: ${error instanceof Error ? error.message : String(error)}`, detail: { error: true }, failed: true }
        }
        return execution
      })
    } catch (error) {
      gated = { verdict: { verdict: 'UNAVAILABLE', evaluator: this.deps.gate.evaluator, remote: this.deps.gate.remote, reason: `gate failed closed: ${error instanceof Error ? error.message : String(error)}` }, effectExecuted: false }
    }
    const sentinelEvent = store.appendEvent({
      eventKind: 'SENTINEL_EXECUTION',
      workOrderId: participation.workOrderId,
      attribution: participation,
      sentinelAction: { operation: action.operation, resource: action.resource },
      summary: gated.effectExecuted
        ? `Governed worker effect permitted by ${gated.verdict.evaluator} (remote Sentinel: ${gated.verdict.remote ? 'yes' : 'no — local workspace effect'}) and performed by the Aera broker: ${action.operation} on ${action.resource}`
        : `Governed worker effect denied by ${gated.verdict.evaluator} (remote Sentinel: ${gated.verdict.remote ? 'yes' : 'no — local workspace effect'}): ${action.operation} on ${action.resource} — ${gated.verdict.reason}`,
    })
    if (!gated.effectExecuted || execution === undefined) {
      return deny('SENTINEL', gated.verdict.verdict === 'UNAVAILABLE' ? 'SENTINEL_UNAVAILABLE' : 'SENTINEL_DENIED', gated.verdict.reason, { authority, gate: gated.verdict, sentinelEventId: sentinelEvent.eventId })
    }

    // (5) VERIFY ------------------------------------------------------------
    const verification = await this.verify(intent, worktree.root, execution)

    // (6) RECORD → (7) RETURN ----------------------------------------------
    const observation = boundObservation(`[${intent.intentId} ${intent.kind}] PERFORMED by the Aera broker (authorised by owner decision ${authority.decisionId}; ${gated.verdict.evaluator}: ${gated.verdict.verdict}; verification ${verification.outcome}).\n${execution.observation}`)
    const outcomeEvidence = this.record(ctx, {
      idempotencyKey: `${key}:outcome`,
      evidenceClass: 'EXECUTION_EVIDENCE',
      subject: `Worker effect performed: ${intent.kind} (${intent.intentId})${execution.failed ? ' — command reported failure' : ''}`,
      outcome: execution.failed || verification.outcome === 'FAIL' ? 'FAIL' : verification.outcome === 'PASS' ? 'PASS' : 'INCONCLUSIVE',
      body: observation,
      sourceRef: `sha256:${sha256(observation)}`,
      links: {
        codeWorkingLineIds: [ctx.codeWorkingLineId as never],
        eventIds: [sentinelEvent.eventId],
        decisionIds: [authority.decisionId as never],
        repositoryIds: [line.repositoryId],
        resourceRefs: [action.resource],
      },
      performedBy: principals.broker,
      authorisedBy: authority.authorisedBy as AeraPrincipalId,
      verifiedBy: principals.verifier,
    })
    return {
      intentId: intent.intentId,
      kind: intent.kind,
      performed: true,
      stage: 'EXECUTION',
      code: execution.failed ? 'PERFORMED_WITH_FAILURE' : 'PERFORMED',
      observation,
      ...(proposal === undefined ? {} : { proposalEvidenceId: proposal }),
      ...(outcomeEvidence === undefined ? {} : { outcomeEvidenceId: outcomeEvidence }),
      sentinelEventId: sentinelEvent.eventId,
      authority,
      gate: gated.verdict,
    }
  }

  private unrecorded(intent: EffectIntentV1, stage: BrokerStage, code: string, reason: string): WorkerBrokerOutcome {
    return {
      intentId: intent.intentId,
      kind: intent.kind,
      performed: false,
      stage,
      code,
      observation: boundObservation(`[${intent.intentId} ${intent.kind}] DENIED at ${stage} (${code}): ${reason}.`),
    }
  }

  private record(ctx: WorkerBrokerContext, input: Omit<Parameters<ParticipationStore['recordTypedEvidence']>[0], 'sessionId' | 'authorisingWorkOrderId' | 'workOrderId'>): string | undefined {
    const recorded = this.deps.store.recordTypedEvidence({
      sessionId: ctx.aeraSessionId,
      authorisingWorkOrderId: ctx.workOrderId,
      workOrderId: ctx.workOrderId,
      ...input,
    })
    return recorded.evidence.evidenceId
  }

  // --- executors (reachable only inside the gate) --------------------------

  private async perform(ctx: WorkerBrokerContext, intent: EffectIntentV1, root: string, line: CodeWorkingLineV1): Promise<ExecutionResult> {
    switch (intent.kind) {
      case 'context.read': return this.contextRead(ctx, intent)
      case 'fs.list': return this.fsList(root, intent.path ?? '.')
      case 'fs.read': return this.fsRead(root, intent.path ?? '')
      case 'fs.write': return this.fsWrite(root, intent.path ?? '', intent.content ?? '')
      case 'exec.test':
      case 'exec.build':
      case 'exec.shell': return await this.exec(root, intent.argv ?? [])
      case 'git.status': return await this.gitRead(root, ['status', '--porcelain=v1', '--branch'])
      case 'git.diff': return await this.gitRead(root, ['diff', '--no-color', '--no-ext-diff', ...(intent.ref === undefined ? [] : [intent.ref])])
      case 'git.log': return await this.gitRead(root, ['log', '--no-color', '-n', '20', '--format=%H %s', ...(intent.ref === undefined ? [] : [intent.ref])])
      case 'git.commit': return await this.gitCommit(ctx, root, intent)
      case 'checkpoint': return await this.checkpoint(ctx, root, line, intent)
      default: throw new Error(`no executor for ${intent.kind}`)
    }
  }

  private confined(root: string, path: string, mode: 'read' | 'write' | 'list'): string {
    const confined = resolveConfinedPath(root, path, mode)
    if (!confined.ok) throw new Error(confined.reason)
    return confined.absolute
  }

  private contextRead(ctx: WorkerBrokerContext, intent: EffectIntentV1): ExecutionResult {
    const { store } = this.deps
    const target = intent.target ?? ''
    const payloadMatch = /^wo-payload(?:@(\d+))?$/u.exec(target)
    if (payloadMatch !== null) {
      const order = store.listWorkOrders().find(row => row.workOrderId === ctx.workOrderId)
      const payload = order?.exactPayload ?? ''
      const offset = Number(payloadMatch[1] ?? '0')
      const slice = payload.slice(offset, offset + 16_384)
      return { observation: `Work Order payload [${String(offset)}..${String(offset + slice.length)} of ${String(payload.length)}]:\n${redact(slice)}`, detail: { target, offset, length: slice.length }, failed: false }
    }
    const evidenceMatch = /^evidence\/(aera:evidence:[A-Za-z0-9_-]+)$/u.exec(target)
    if (evidenceMatch !== null) {
      const evidence = store.listTypedEvidence(ctx.workOrderId).find(row => row.evidenceId === evidenceMatch[1])
      return evidence === undefined
        ? { observation: `No evidence ${String(evidenceMatch[1])} on this Work Order.`, detail: { target }, failed: true }
        : { observation: `${evidence.evidenceClass} ${evidence.evidenceId}: ${evidence.subject}\n${redact(evidence.body ?? '(no body)')}`, detail: { target }, failed: false }
    }
    const decisionMatch = /^decision\/(aera:decision:[A-Za-z0-9_-]+)$/u.exec(target)
    if (decisionMatch !== null) {
      const decision = store.listDecisions(ctx.workOrderId).find(row => row.decisionId === decisionMatch[1])
      return decision === undefined
        ? { observation: `No decision ${String(decisionMatch[1])} on this Work Order.`, detail: { target }, failed: true }
        : { observation: `Decision ${decision.decisionId} (${decision.status}): ${decision.subject}; selected ${decision.selectedOptionId}; authorised effects: ${decision.authorisedEffects.join(', ') || 'none'}`, detail: { target }, failed: false }
    }
    if (target === 'checkpoints') {
      const rows = store.listCodeCheckpoints(ctx.codeWorkingLineId as never)
      return { observation: rows.length === 0 ? 'No checkpoints on this Working Line.' : rows.map(row => `#${String(row.lineSequence)} ${row.checkpointId} ${JSON.stringify(row.stateRef)} ${row.summary ?? ''}`).join('\n'), detail: { target, count: rows.length }, failed: false }
    }
    return { observation: `Unknown context target ${target}. Known: wo-payload[@offset], evidence/<id>, decision/<id>, checkpoints.`, detail: { target }, failed: true }
  }

  private fsList(root: string, path: string): ExecutionResult {
    const absolute = this.confined(root, path, 'list')
    const entries = readdirSync(absolute, { withFileTypes: true })
      .filter(entry => entry.name !== '.git')
      .map(entry => entry.isDirectory() ? `${entry.name}/` : entry.name)
      .sort()
    const shown = entries.slice(0, MAX_LIST_ENTRIES)
    return { observation: `${relative(root, absolute) || '.'}:\n${shown.join('\n')}${entries.length > shown.length ? `\n[… ${String(entries.length - shown.length)} more]` : ''}`, detail: { count: entries.length }, failed: false }
  }

  private fsRead(root: string, path: string): ExecutionResult {
    const absolute = this.confined(root, path, 'read')
    const bytes = readFileSync(absolute)
    return { observation: `${relative(root, absolute)} (${String(bytes.byteLength)} bytes, sha256 ${sha256(bytes)}):\n${redact(bytes.toString('utf8'))}`, detail: { sha256: sha256(bytes), bytes: bytes.byteLength }, failed: false }
  }

  private fsWrite(root: string, path: string, content: string): ExecutionResult {
    const absolute = this.confined(root, path, 'write')
    mkdirSync(dirname(absolute), { recursive: true })
    // Re-check after creating parents: nothing may have been redirected.
    this.confined(root, path, 'write')
    writeFileSync(absolute, content, { encoding: 'utf8', flag: 'w' })
    return { observation: `wrote ${relative(root, absolute)} (${String(Buffer.byteLength(content, 'utf8'))} bytes, sha256 ${sha256(content)})`, detail: { path: relative(root, absolute), sha256: sha256(content) }, failed: false }
  }

  private async exec(root: string, argv: readonly string[]): Promise<ExecutionResult> {
    const [command, ...args] = argv
    if (command === undefined) throw new Error('empty argv')
    const result = await runCommand(command, args, { cwd: root, env: this.commandEnv(), timeoutMs: this.deps.commandTimeoutMs ?? 600_000 })
    return {
      observation: `$ ${redact(argv.join(' '))}\nexit ${String(result.code)}${result.timedOut ? ' (timed out)' : ''}\n--- stdout ---\n${redact(result.stdout)}\n--- stderr ---\n${redact(result.stderr)}`,
      detail: { exitCode: result.code, timedOut: result.timedOut },
      failed: result.code !== 0,
    }
  }

  private async gitRead(root: string, args: readonly string[]): Promise<ExecutionResult> {
    const result = await this.git(root, args)
    return { observation: `$ git ${args.join(' ')}\nexit ${String(result.code)}\n${redact(result.stdout)}${result.stderr === '' ? '' : `\n${redact(result.stderr)}`}`, detail: { exitCode: result.code }, failed: result.code !== 0 }
  }

  private async gitCommit(ctx: WorkerBrokerContext, root: string, intent: EffectIntentV1): Promise<ExecutionResult> {
    const paths = (intent.paths ?? []).map(path => relative(root, this.confined(root, path, 'write')))
    const before = (await this.git(root, ['rev-parse', 'HEAD'])).stdout.trim()
    const add = await this.git(root, ['add', '--', ...paths])
    if (add.code !== 0) return { observation: `git add failed: ${redact(add.stderr)}`, detail: { stage: 'add' }, failed: true }
    const message = `${intent.message ?? 'worker change'}\n\nAera-Worker-Epoch: ${ctx.epochId}\nAera-Session: ${ctx.aeraSessionId}\nProposed-By: governed worker (performed by the Aera execution broker)`
    const commit = await this.git(root, ['commit', '-m', message, '--', ...paths])
    const after = (await this.git(root, ['rev-parse', 'HEAD'])).stdout.trim()
    return {
      observation: `$ git commit -- ${paths.join(' ')}\nexit ${String(commit.code)}\n${redact(commit.stdout)}${redact(commit.stderr)}\nHEAD ${before} -> ${after}`,
      detail: { before, after, paths },
      failed: commit.code !== 0,
    }
  }

  private async checkpoint(ctx: WorkerBrokerContext, root: string, line: CodeWorkingLineV1, intent: EffectIntentV1): Promise<ExecutionResult> {
    const status = await this.git(root, ['status', '--porcelain=v1'])
    if (status.stdout.trim() !== '') {
      return { observation: 'Checkpoint refused: the worktree has uncommitted changes. Commit through git.commit first; Aera checkpoints only a state it can observe exactly.', detail: { dirty: true }, failed: true }
    }
    const head = (await this.git(root, ['rev-parse', 'HEAD'])).stdout.trim()
    const handoffs = this.deps.store.listTypedEvidence(ctx.workOrderId)
      .filter(row => row.evidenceClass === 'ANALYTICAL_EVIDENCE' && row.subject.startsWith('Worker handoff')
        && (row.links.codeWorkingLineIds ?? []).includes(line.codeWorkingLineId))
    const minted = this.deps.store.mintCheckpoint({
      sessionId: ctx.aeraSessionId,
      idempotencyKey: `${ctx.epochId}:${intent.intentId}`,
      authorisingWorkOrderId: ctx.workOrderId,
      codeWorkingLineId: line.codeWorkingLineId,
      // Aera's OWN observation of the worktree — never the worker's claim.
      stateRef: { kind: 'COMMIT', revision: head },
      origin: 'MANUAL_CHECKPOINT',
      creators: [this.deps.principals.worker],
      evidenceIds: handoffs.slice(-1).map(row => row.evidenceId),
      summary: intent.summary ?? `Worker checkpoint (Epoch ${ctx.epochId})`,
      performedBy: this.deps.principals.broker,
    })
    return { observation: `checkpoint ${minted.checkpoint.checkpointId} #${String(minted.checkpoint.lineSequence)} at ${head}`, detail: { checkpointId: minted.checkpoint.checkpointId, head }, failed: false }
  }

  // --- independent verification --------------------------------------------

  private async verify(intent: EffectIntentV1, root: string, execution: ExecutionResult): Promise<VerificationResult> {
    try {
      switch (intent.kind) {
        case 'fs.write': {
          const absolute = this.confined(root, intent.path ?? '', 'read')
          const observed = sha256(readFileSync(absolute))
          return observed === execution.detail.sha256
            ? { outcome: 'PASS', detail: `re-read sha256 ${observed}` }
            : { outcome: 'FAIL', detail: `re-read sha256 ${observed} differs from written ${String(execution.detail.sha256)}` }
        }
        case 'fs.read': {
          const observed = sha256(readFileSync(this.confined(root, intent.path ?? '', 'read')))
          return observed === execution.detail.sha256 ? { outcome: 'PASS', detail: 'content unchanged since read' } : { outcome: 'INCONCLUSIVE', detail: 'file changed after read' }
        }
        case 'git.commit': {
          const head = (await this.git(root, ['rev-parse', 'HEAD'])).stdout.trim()
          const moved = head === execution.detail.after && head !== execution.detail.before
          return moved ? { outcome: 'PASS', detail: `HEAD is ${head}` } : { outcome: 'FAIL', detail: `HEAD is ${head}; no new commit observed` }
        }
        case 'checkpoint': {
          const head = (await this.git(root, ['rev-parse', 'HEAD'])).stdout.trim()
          return head === execution.detail.head ? { outcome: 'PASS', detail: `HEAD still ${head}` } : { outcome: 'FAIL', detail: 'HEAD moved during checkpoint' }
        }
        default:
          return execution.failed ? { outcome: 'FAIL', detail: 'the broker observed a failure' } : { outcome: 'PASS', detail: 'exit status observed by the broker' }
      }
    } catch (error) {
      return { outcome: 'INCONCLUSIVE', detail: error instanceof Error ? error.message : String(error) }
    }
  }
}
