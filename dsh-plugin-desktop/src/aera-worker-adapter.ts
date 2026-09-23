/**
 * Provider-neutral Worker Adapter contract —
 * WO-AERA-CODE-CLAUDE-CODE-GOVERNED-WORKER-INTEGRATION-001 §6.
 *
 * A worker is COMPUTE. It owns nothing institutional: not the Aera Session,
 * not the Work Order, not the Working Line, not authority, not evidence. An
 * adapter starts one Worker Epoch (one bounded worker process), hands it
 * bounded institutional input, returns what the worker said, and reports how
 * the Epoch ended. Effects are never performed by an adapter: a worker can only
 * PROPOSE typed effect intents in its output, which Aera then governs
 * (`aera-worker-effect-broker.ts`).
 *
 * Aligned with, not a replacement for, the canonical `ProviderAdapterPort` in
 * `@aera/participation-runtime`: that port is one-shot (task → events →
 * completion). A governed worker needs a turn loop in which Aera returns
 * authorised observations between turns, plus cancellation and an explicit
 * terminal record, so the Epoch contract is additive here. Intents are mapped
 * onto the canonical `ProviderEvent` `ACTION_REQUEST` operation/resource pair.
 *
 * DURABLE IDENTITY IS THE AERA SESSION. An Epoch's provider session id,
 * process id, model instance and conversation are telemetry only; an Aera
 * Session may run Epoch 1 on Claude A, Epoch 2 on Claude B and Epoch 3 on a
 * different worker type without losing identity.
 */

/** Non-secret authentication class of a local worker runtime. */
export type WorkerAuthClass =
  | 'SUBSCRIPTION_OAUTH'
  | 'NOT_LOGGED_IN'
  | 'API_KEY_AUTH_REFUSED'
  | 'NOT_APPLICABLE'
  | 'UNKNOWN'

/** Identity of the runtime an Epoch ran on — recorded per Epoch, never authority. */
export interface WorkerRuntimeIdentity {
  readonly workerType: string
  readonly adapterId: string
  readonly cliVersion?: string
  readonly binaryPath?: string
  readonly binarySha256?: string
  readonly signerTeamIdentifier?: string
  readonly modelRequested?: string
}

/** Bounds the host enforces on one Epoch. The worker cannot widen them. */
export interface WorkerEpochLimits {
  /** Wall clock for one turn (input written → result event). */
  readonly turnTimeoutMs: number
  /** Wall clock for the whole Epoch. */
  readonly epochTimeoutMs: number
  /** Grace between SIGINT → SIGTERM → SIGKILL. */
  readonly cancelGraceMs: number
  /** Maximum worker turns in one Epoch. */
  readonly maxTurns: number
}

export const DEFAULT_WORKER_EPOCH_LIMITS: WorkerEpochLimits = Object.freeze({
  turnTimeoutMs: 300_000,
  epochTimeoutMs: 1_800_000,
  cancelGraceMs: 3_000,
  maxTurns: 12,
})

/** The bounded institutional input for one Epoch (§8/§13). */
export interface WorkerEpochSpec {
  readonly epochId: string
  readonly aeraSessionId: string
  readonly workOrderId: string
  readonly codeWorkingLineId: string
  /** Protocol + non-authority rules. Replaces the provider's default prompt. */
  readonly systemPrompt: string
  readonly limits: WorkerEpochLimits
  /** Live, non-durable progress callback (UI streaming). Never authority. */
  readonly onEvent?: (event: WorkerLiveEvent) => void
}

/** Token usage as the runtime reported it. `reported: false` is an honest gap. */
export interface WorkerUsage {
  readonly reported: boolean
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly cacheCreationInputTokens?: number
  readonly cacheReadInputTokens?: number
  /** Notional list-price figure from the CLI. NOT a subscription charge. */
  readonly notionalCostUsd?: number
  readonly note?: string
}

/** One completed worker turn. */
export interface WorkerTurnCompleted {
  readonly kind: 'TURN_COMPLETED'
  readonly turn: number
  /** Everything the worker SAID this turn. Data, never an effect. */
  readonly text: string
  readonly usage: WorkerUsage
  readonly modelReported?: string
  readonly providerSessionId?: string
  readonly authClass: WorkerAuthClass
  readonly durationMs?: number
  readonly terminalReason?: string
  readonly isError: boolean
}

export const WORKER_EPOCH_TERMINAL_STATUSES = [
  'COMPLETED',
  'CANCELLED',
  'FAILED',
  'CRASHED',
  'TIMED_OUT',
  'GUARD_REFUSED',
  'NATIVE_EFFECT_DETECTED',
  'AUTH_UNAVAILABLE',
  'MALFORMED_OUTPUT',
  'SUPERSEDED_UNCLEAN',
] as const
export type WorkerEpochTerminalStatus = (typeof WORKER_EPOCH_TERMINAL_STATUSES)[number]

/** How an Epoch ended. Synthesised by the host when the runtime reports nothing. */
export interface WorkerEpochTerminal {
  readonly status: WorkerEpochTerminalStatus
  readonly reason: string
  readonly exitCode: number | null
  readonly signal: string | null
  readonly turns: number
  readonly usage: WorkerUsage
  /** A process-group member had to be killed after the worker exited. */
  readonly orphanReaped: boolean
  /** What the runtime did not tell us, stated rather than omitted (§12). */
  readonly limitations: readonly string[]
  /** Anything found in the Epoch scratch dir (names only). Non-empty is a native-effect finding. */
  readonly scratchResidue: readonly string[]
}

export type WorkerTurnOutcome =
  | WorkerTurnCompleted
  | { readonly kind: 'EPOCH_TERMINATED', readonly terminal: WorkerEpochTerminal }

/** Live progress (UI only). Durable truth is what the session manager records. */
export type WorkerLiveEvent =
  | { readonly kind: 'PROCESS_STARTED', readonly pid: number }
  | { readonly kind: 'RUNTIME_READY', readonly model: string, readonly cliVersion?: string }
  | { readonly kind: 'ASSISTANT_TEXT', readonly text: string }
  | { readonly kind: 'TURN_COMPLETED', readonly turn: number }
  | { readonly kind: 'TERMINATED', readonly status: WorkerEpochTerminalStatus }

/** One running Epoch. */
export interface WorkerEpochHandle {
  readonly epochId: string
  readonly runtime: WorkerRuntimeIdentity
  readonly pid: number | undefined
  /** Absolute path of the Epoch's Aera-owned scratch cwd (empty by contract). */
  readonly scratchDir: string | undefined
  /** Hand the worker bounded input and wait for its turn to complete. */
  runTurn(input: string): Promise<WorkerTurnOutcome>
  /** Orderly completion: no further input. */
  endInput(): Promise<WorkerEpochTerminal>
  /** SIGINT → SIGTERM → SIGKILL on the process group. */
  cancel(reason: string): Promise<WorkerEpochTerminal>
  /** Resolves once, when the Epoch has ended for any reason. */
  terminal(): Promise<WorkerEpochTerminal>
}

/** A replaceable worker backend. */
export interface WorkerAdapter {
  readonly adapterId: string
  readonly workerType: string
  /** Verify the runtime before any Epoch (pin, version, signer). Throws a typed refusal. */
  preflight(): Promise<WorkerRuntimeIdentity>
  startEpoch(spec: WorkerEpochSpec): Promise<WorkerEpochHandle>
}

/** Typed refusal from an adapter or host. */
export class WorkerRefusal extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'WorkerRefusal'
  }
}

/** Sum two usage records, keeping `reported` honest. */
export function addWorkerUsage(left: WorkerUsage, right: WorkerUsage): WorkerUsage {
  const sum = (a: number | undefined, b: number | undefined): number | undefined =>
    a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0)
  const inputTokens = sum(left.inputTokens, right.inputTokens)
  const outputTokens = sum(left.outputTokens, right.outputTokens)
  const cacheCreationInputTokens = sum(left.cacheCreationInputTokens, right.cacheCreationInputTokens)
  const cacheReadInputTokens = sum(left.cacheReadInputTokens, right.cacheReadInputTokens)
  const notionalCostUsd = sum(left.notionalCostUsd, right.notionalCostUsd)
  const notes = [left.note, right.note].filter((note): note is string => note !== undefined)
  return {
    reported: left.reported && right.reported,
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(cacheCreationInputTokens === undefined ? {} : { cacheCreationInputTokens }),
    ...(cacheReadInputTokens === undefined ? {} : { cacheReadInputTokens }),
    ...(notionalCostUsd === undefined ? {} : { notionalCostUsd }),
    ...(notes.length === 0 ? {} : { note: [...new Set(notes)].join('; ') }),
  }
}

export const NO_USAGE: WorkerUsage = Object.freeze({ reported: true })
