/**
 * Per-turn provenance for the governed Claude worker — O-1 U-D,
 * WO-AERA-CODE-CLAUDE-CODE-GOVERNED-WORKER-INTEGRATION-001
 * (O1_PROVENANCE_SPEC_V2 §2.3, §4.1, §5, §8.2; V2.1 NO-1…NO-4; V2.2; G1
 * re-review NO-A).
 *
 * Aera writes each worker turn as WHOLE text blocks, each with a class:
 *
 *   AERA_BRIEFING     only Aera-minted ids, digests, integers and closed enums,
 *                     through a closed per-field allow-list (B1–B14). A value
 *                     that fails its validator is DEMOTED to the HUMAN block.
 *   AERA_RECORD       records (checkpoint, handoff, performed/denied effects),
 *                     including model-authored record text (R1–R6).
 *   AERA_OBSERVATION  one block per observation, always beginning with the
 *                     fixed host prefix (NO-4), tool by intent kind.
 *   HUMAN             every owner- or human-originated field (H1–H9) and every
 *                     demoted value. Never committed: it keeps the strict path.
 *
 * Before a turn is written, the SHA-256 of every non-HUMAN block that survives
 * the collision rule (N-4) and the well-formedness rule (N-3) is committed in
 * the provenance manifest carried by the signed attest v2. On the first turn
 * the manifest also carries ONE digest of the Claude CLI's own `session_context`
 * note, composed from the pinned 2.1.280 literals and the configured account
 * address (the address never leaves this function: only its digest does).
 * The Router proves blocks by whole-block exact digest; anything unproven is
 * human instruction. Character sets never decide origin.
 *
 * Layout invariant (NO-A): a fixed Aera header always follows a proven RECORD
 * or OBSERVATION block, so no hard-stop phrase can be completed across a block
 * boundary by the block after it.
 */
import { createHash } from 'node:crypto'
import { canonicalJson } from '@aera/authority-contracts'
import {
  MODEL_PROVENANCE_RECORD_TOOL,
  type ModelProvenanceEntry,
  type ModelProvenanceTool,
} from '@aera/local-effect-admission'

/** The reviewed pin the CLI_METADATA grammar is derived from (V2.1 NO-2: CLI version AND model). */
export const CLAUDE_CLI_PROVENANCE_PIN = Object.freeze({
  cliVersion: '2.1.280',
  binarySha256: '387a5c5dcdbb815085edf0baf79591f9d8894efe922bceaf3d75b1b08055229d',
  models: Object.freeze(['claude-opus-4-6']) as readonly string[],
})

/**
 * The 2.1.280 literals of the non-bare `session_context` attachment (§2.2),
 * equal to `tests/fixtures/claude-cli-2.1.280-literals.json` (asserted).
 */
export const CLI_SESSION_CONTEXT_LITERALS = Object.freeze({
  EH: '<system-reminder>',
  GEE: '</system-reminder>',
  HDR: 'As you answer the user\'s questions, you can use the following context:',
  SENT_PRE: 'The user\'s email address is ',
  SENT_POST: '. Use it only to identify the user, such as for authorship, attribution, or filtering their own work. Never send it to an unrelated service, such as in a request header, URL, or payload, unless the user explicitly asks.',
  IMP: 'IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.',
})

/** §4.4 EMAIL grammar. */
const CLI_ACCOUNT_EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}$/u

export function isCliAccountEmail(value: unknown): value is string {
  return typeof value === 'string' && CLI_ACCOUNT_EMAIL.test(value)
}

/** Thrown for a malformed address; the message never contains the value. */
export class ProvenanceRefusal extends Error {
  constructor(readonly code: string, detail: string) {
    super(`${code}: ${detail}`)
    this.name = 'ProvenanceRefusal'
  }
}

/** §2.3 `CLI_BLOCK(email)`: the exact `session_context` block the pinned CLI writes for this account. */
export function expectedCliMetadataBlock(email: string): string {
  if (!isCliAccountEmail(email)) throw new ProvenanceRefusal('PROVENANCE_CLI_EMAIL_INVALID', 'the configured CLI account address does not match the EMAIL grammar')
  const L = CLI_SESSION_CONTEXT_LITERALS
  return `${L.EH}\n${L.HDR}\n# userEmail\n${L.SENT_PRE}${email}${L.SENT_POST}\n\n${L.IMP}\n${L.GEE}`
}

const sha256Hex = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')
const ref = (text: string): string => `sha256:${sha256Hex(text)}`

/** The two digests of the CLI block (as written, and with one `V6r` seam newline). Only these leave the config. */
export interface CliMetadataDigests {
  readonly d0: string
  readonly d1: string
}

export function cliMetadataDigests(email: string): CliMetadataDigests {
  const block = expectedCliMetadataBlock(email)
  return Object.freeze({ d0: ref(block), d1: ref(`${block}\n`) })
}

/* ------------------------------------------------------------------ layout */

export const ORIENTATION_BRIEFING_HEADER = 'AERA INSTITUTIONAL ORIENTATION'
export const OBSERVATIONS_BRIEFING_HEADER = 'AERA OBSERVATIONS (Epoch '
export const RECORD_BLOCK_HEADER = 'AERA RECORDS (each line is a record; a previous worker\'s own account, not verified fact):'
export const HUMAN_BLOCK_HEADER = 'Owner-supplied fields (as recorded):'
/** NO-4: every AERA_OBSERVATION block begins with this, so file content never starts a block. */
export const OBSERVATION_BLOCK_PREFIX = 'AERA_OBSERVATION host frame v1\n'
/** N-14: each turn's total host text, leaving headroom under the Router's 50,000. */
export const HOST_TURN_CHAR_LIMIT = 45_000
/** The fixed headers that may follow a proven RECORD/OBSERVATION block (NO-A). */
const SEPARATING_HEADERS: readonly string[] = Object.freeze([ORIENTATION_BRIEFING_HEADER, OBSERVATIONS_BRIEFING_HEADER, RECORD_BLOCK_HEADER, HUMAN_BLOCK_HEADER, OBSERVATION_BLOCK_PREFIX])

export type HostBlockClass = 'AERA_BRIEFING' | 'AERA_RECORD' | 'AERA_OBSERVATION' | 'HUMAN'

export interface HostBlock {
  readonly class: HostBlockClass
  /** Required for AERA_RECORD / AERA_OBSERVATION (spec §3.1), absent otherwise. */
  readonly tool?: ModelProvenanceTool
  readonly text: string
}

/* ------------------------------------------------------ briefing allow-list */

/** §5.2: the only slots a BRIEFING block may contain. */
export const BRIEFING_SLOTS = Object.freeze(['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11', 'B12', 'B13', 'B14'] as const)

export interface BriefingFacts {
  /** B2 */ readonly sequence: number
  /** B3 */ readonly epochId: string
  /** B4 */ readonly aeraSessionId: string
  /** B5 */ readonly lifecycleState: 'ACTIVE' | 'COMPLETED' | 'SUPERSEDED' | 'UNRECORDED'
  /** B6 */ readonly stateSource: 'STATE_RECORD' | 'ADMISSION' | 'UNRECORDED'
  /** B7 */ readonly payloadLength: number
  /** B7 */ readonly payloadSha256: string
  /** B8 */ readonly codeWorkingLineId: string
  /** B9 */ readonly originRevision: string
  /** B10 */ readonly lineLifecycle: 'OPEN' | 'CLOSED' | 'ARCHIVED'
  /** B11 */ readonly checkpoint?: { readonly lineSequence: number, readonly checkpointId: string }
  /** B12 */ readonly handoffEvidenceId?: string
  /** B13 */ readonly performedCount: number
  /** B13 */ readonly deniedCount: number
  /** B13 */ readonly bindingCount: number
}

const EPOCH_ID = /^aera:worker-epoch:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const isInt = (value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
const matches = (pattern: RegExp) => (value: unknown): boolean => typeof value === 'string' && pattern.test(value)
const oneOf = (values: readonly string[]) => (value: unknown): boolean => typeof value === 'string' && values.includes(value)

/** One validator per field; the field name is `<slot>:<name>`. */
const BRIEFING_VALIDATORS: Readonly<Record<string, (value: unknown) => boolean>> = Object.freeze({
  'B2:sequence': (v: unknown) => isInt(v, 1, 10_000),
  'B3:epochId': matches(EPOCH_ID),
  'B4:aeraSessionId': matches(/^psession-[0-9]{4}-[0-9a-f]{8}$/u),
  'B5:lifecycleState': oneOf(['ACTIVE', 'COMPLETED', 'SUPERSEDED', 'UNRECORDED']),
  'B6:stateSource': oneOf(['STATE_RECORD', 'ADMISSION', 'UNRECORDED']),
  'B7:payloadLength': (v: unknown) => isInt(v, 0),
  'B7:payloadSha256': matches(/^[0-9a-f]{64}$/u),
  'B8:codeWorkingLineId': matches(/^aera:code_working_line:[0-9a-f]{8}$/u),
  'B9:originRevision': matches(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u),
  'B10:lineLifecycle': oneOf(['OPEN', 'CLOSED', 'ARCHIVED']),
  'B11:checkpointLineSequence': (v: unknown) => isInt(v, 1),
  'B11:checkpointId': matches(/^aera:code_checkpoint:[0-9a-f]{8}$/u),
  'B12:handoffEvidenceId': matches(/^aera:evidence:[0-9a-f]{8}$/u),
  'B13:performedCount': (v: unknown) => isInt(v, 0),
  'B13:deniedCount': (v: unknown) => isInt(v, 0),
  'B13:bindingCount': (v: unknown) => isInt(v, 0),
})

/** The placeholder a demoted slot shows in the briefing (B1 fixed wording). */
const DEMOTED = '(see the owner-supplied block)'
/** B14, effect-plane branch (aera-worker-session buildOrientation @7ea85636 l.446). */
export const CAS_AUTHORITY_SENTENCE = 'Authority: CAS decides every effect through the Router, against the owner\'s delegation (fs.read, fs.write and exec.test with a reviewed test command only). There are no local grants.'
const ENVELOPE_AUTHORITY_SENTENCE = 'Authority envelope: the owner\'s decisions, evaluated live on every intent, are listed in the owner-supplied block; anything not listed is denied.'

export interface OwnerFields {
  /** H1 */ readonly workOrderId: string
  /** H2 */ readonly title: string
  /** H3 */ readonly blocker?: string
  /** H4 */ readonly label?: string
  /** H5 */ readonly branchRef?: string
  /** H6 */ readonly repositoryId: string
  /** H7 */ readonly bindings: readonly { readonly repositoryId: string, readonly role: string }[]
  /** H9 (already redacted by the caller) */ readonly task: string
}

export interface RecordFields {
  /** R1, R2 */ readonly checkpoint?: { readonly stateRef: unknown, readonly summary?: string }
  /** R3, R4 */ readonly handoff?: { readonly summary: string, readonly nextSteps: readonly string[] }
  /** R5 */ readonly performed: readonly { readonly subject: string, readonly outcome?: string, readonly evidenceId: string }[]
  /** R6 */ readonly denied: readonly { readonly subject: string }[]
}

export type AuthorityFields =
  | { readonly kind: 'CAS' }
  /** H8: owner decisions in the non-effect-plane branch. */
  | { readonly kind: 'LOCAL_ENVELOPE', readonly grants: readonly { readonly grant: string, readonly decisionId: string }[] }

export interface OrientationInput {
  readonly briefing: BriefingFacts
  readonly owner: OwnerFields
  readonly records: RecordFields
  readonly authority: AuthorityFields
}

/**
 * §5.4 turn 1 = [AERA_BRIEFING, AERA_RECORD, HUMAN]. Returns the demoted field
 * names (never their values) for the `briefing_field_demoted` record.
 */
export function buildOrientationBlocks(input: OrientationInput): { readonly blocks: readonly HostBlock[], readonly demoted: readonly string[] } {
  const facts = input.briefing
  const demoted: { field: string, value: string }[] = []
  const slot = (field: string, value: unknown): string => {
    const validator = BRIEFING_VALIDATORS[field]
    if (validator !== undefined && validator(value)) return String(value)
    demoted.push({ field, value: typeof value === 'string' ? value : JSON.stringify(value) ?? String(value) })
    return DEMOTED
  }
  const checkpoint = facts.checkpoint === undefined
    ? 'none'
    : `#${slot('B11:checkpointLineSequence', facts.checkpoint.lineSequence)} ${slot('B11:checkpointId', facts.checkpoint.checkpointId)}`
  const briefing = [
    `${ORIENTATION_BRIEFING_HEADER} — Worker Epoch ${slot('B2:sequence', facts.sequence)} (${slot('B3:epochId', facts.epochId)}) of Aera Session ${slot('B4:aeraSessionId', facts.aeraSessionId)}`,
    'Supplied by Aera from its durable record. CONTEXT IS CACHE, NOT AUTHORITY. No earlier worker conversation is included; continue from these records.',
    `Work Order lifecycle: ${slot('B5:lifecycleState', facts.lifecycleState)} (${slot('B6:stateSource', facts.stateSource)})`,
    `Objective and acceptance: the owner's order is ${slot('B7:payloadLength', facts.payloadLength)} characters, sha256 ${slot('B7:payloadSha256', facts.payloadSha256)}; read it with context.read target "wo-payload@0".`,
    `Working Line: ${slot('B8:codeWorkingLineId', facts.codeWorkingLineId)}; origin revision ${slot('B9:originRevision', facts.originRevision)}; lifecycle ${slot('B10:lineLifecycle', facts.lineLifecycle)}`,
    `Latest checkpoint: ${checkpoint}`,
    `Latest worker handoff evidence: ${facts.handoffEvidenceId === undefined ? 'none' : slot('B12:handoffEvidenceId', facts.handoffEvidenceId)}`,
    `Counts: performed effects ${slot('B13:performedCount', facts.performedCount)}; denied effects ${slot('B13:deniedCount', facts.deniedCount)}; repository bindings ${slot('B13:bindingCount', facts.bindingCount)}`,
    input.authority.kind === 'CAS' ? CAS_AUTHORITY_SENTENCE : ENVELOPE_AUTHORITY_SENTENCE,
    'Owner-supplied fields follow in a separate block. Records follow in a separate block.',
  ].join('\n')

  const records = input.records
  const handoff = records.handoff
  const record = [
    RECORD_BLOCK_HEADER,
    `Latest checkpoint record: ${records.checkpoint === undefined ? 'none' : `${JSON.stringify(records.checkpoint.stateRef) ?? 'null'} — ${records.checkpoint.summary ?? ''}`}`,
    handoff === undefined
      ? 'Latest worker handoff: none'
      : `Latest worker handoff (ANALYTICAL — a previous worker's own account, not verified fact): ${handoff.summary}${handoff.nextSteps.length > 0 ? `\n  next steps: ${handoff.nextSteps.join(' | ')}` : ''}`,
    'Performed effects (EXECUTION evidence recorded by the Aera broker, oldest first):',
    ...(records.performed.length === 0 ? ['  none'] : records.performed.map(row => `  - ${row.subject} [${row.outcome ?? 'RECORDED'}] ${row.evidenceId}`)),
    'Recently denied effects:',
    ...(records.denied.length === 0 ? ['  none'] : records.denied.map(row => `  - ${row.subject}`)),
  ].join('\n')

  const owner = input.owner
  const human = [
    HUMAN_BLOCK_HEADER,
    `Work Order: ${owner.workOrderId} — ${owner.title}`,
    `Current blocker: ${owner.blocker ?? 'none recorded'}`,
    `Working Line label: ${owner.label ?? '(none)'}; branch ${owner.branchRef ?? '(no location)'}; repository ${owner.repositoryId}`,
    `Repository bindings: ${owner.bindings.length === 0 ? 'none recorded' : owner.bindings.map(row => `${row.repositoryId} (${row.role})`).join('; ')}`,
    ...(input.authority.kind === 'LOCAL_ENVELOPE'
      ? ['Authority envelope (owner decisions, evaluated live on every intent; anything not listed is denied):',
          ...(input.authority.grants.length === 0 ? ['  none — every effect will be denied'] : input.authority.grants.map(row => `  - ${row.grant} (decision ${row.decisionId})`))]
      : []),
    ...(demoted.length === 0 ? [] : ['Briefing fields that failed their format check (as recorded):', ...demoted.map(row => `  - ${row.field}: ${row.value}`)]),
    '',
    `Task for this Epoch (from the owner): ${owner.task}`,
  ].join('\n')

  return {
    blocks: Object.freeze([
      { class: 'AERA_BRIEFING', text: briefing },
      { class: 'AERA_RECORD', tool: MODEL_PROVENANCE_RECORD_TOOL, text: record },
      { class: 'HUMAN', text: human },
    ] satisfies HostBlock[]),
    demoted: Object.freeze(demoted.map(row => row.field)),
  }
}

/* ------------------------------------------------------- observation turns */

/** The observation tool for an intent kind (closed set, spec §3.1); host notices otherwise. */
export function observationTool(kind: string): ModelProvenanceTool {
  switch (kind) {
    case 'fs.read': return 'aera_fs_read'
    case 'fs.list': return 'aera_fs_list'
    case 'fs.write': return 'aera_fs_write'
    case 'exec.test': return 'aera_exec_test'
    case 'context.read': return 'aera_context_read'
    case 'git.status':
    case 'git.diff':
    case 'git.log':
    case 'git.commit': return 'aera_git'
    case 'checkpoint': return 'aera_checkpoint'
    default: return 'aera_host_notice'
  }
}

/** §5.4 observation turn = [AERA_BRIEFING header, one AERA_OBSERVATION per observation]. */
export function buildObservationBlocks(input: {
  readonly epochId: string
  /** `kind` is the intent kind, or HOST_NOTICE for Aera's own notices. */
  readonly observations: readonly { readonly kind: string, readonly text: string }[]
}): readonly HostBlock[] {
  const header: HostBlock = EPOCH_ID.test(input.epochId)
    ? { class: 'AERA_BRIEFING', text: `${OBSERVATIONS_BRIEFING_HEADER}${input.epochId})` }
    : { class: 'HUMAN', text: `${OBSERVATIONS_BRIEFING_HEADER}${input.epochId})` }
  return Object.freeze([
    header,
    ...input.observations.map((row): HostBlock => ({ class: 'AERA_OBSERVATION', tool: observationTool(row.kind), text: `${OBSERVATION_BLOCK_PREFIX}${row.text}` })),
  ])
}

/**
 * NO-A: every block that follows a RECORD or OBSERVATION block starts with a
 * fixed Aera header. Throws before anything is attested or written.
 */
export function assertFixedHeaderSeparation(blocks: readonly HostBlock[]): void {
  for (const [index, block] of blocks.entries()) {
    const next = blocks[index + 1]
    if (next === undefined) continue
    if (block.class !== 'AERA_RECORD' && block.class !== 'AERA_OBSERVATION') continue
    if (!SEPARATING_HEADERS.some(head => next.text.startsWith(head))) {
      throw new ProvenanceRefusal('PROVENANCE_LAYOUT_UNSEPARATED', `block ${String(index + 1)} follows a ${block.class} block without a fixed Aera header`)
    }
  }
}

/* ------------------------------------------------------------- turn bound */

const TRUNCATION_MARKER = `\n[… truncated by Aera: turn budget ${String(HOST_TURN_CHAR_LIMIT)} characters]`

/** Cut at most `length` UTF-16 units without splitting a surrogate pair. */
function cutWellFormed(text: string, length: number): string {
  let end = Math.max(0, Math.min(length, text.length))
  const code = text.charCodeAt(end - 1)
  if (end > 0 && end < text.length && code >= 0xd800 && code <= 0xdbff) end -= 1
  return text.slice(0, end)
}

/** The shortest form a block can take: its first line (its header) plus the marker. */
function minimalForm(text: string): string {
  const firstLine = text.indexOf('\n')
  const head = firstLine < 0 ? text : text.slice(0, firstLine + 1)
  return `${cutWellFormed(head, 160)}${TRUNCATION_MARKER}`
}

/** N-14: bound the turn's total host text to `limit`, in block order, keeping every block's header. */
export function boundHostTurn(blocks: readonly HostBlock[], limit = HOST_TURN_CHAR_LIMIT): readonly HostBlock[] {
  if (blocks.reduce((sum, row) => sum + row.text.length, 0) <= limit) return blocks
  const minimum = blocks.map(row => Math.min(row.text.length, minimalForm(row.text).length))
  let used = 0
  return Object.freeze(blocks.map((block, index) => {
    const reserve = minimum.slice(index + 1).reduce((sum, value) => sum + value, 0)
    const room = limit - used - reserve
    let text = block.text
    if (text.length > room) {
      const kept = cutWellFormed(text, room - TRUNCATION_MARKER.length)
      text = kept.length >= minimalForm(text).length - TRUNCATION_MARKER.length ? `${kept}${TRUNCATION_MARKER}` : minimalForm(text)
    }
    used += text.length
    return text === block.text ? block : { ...block, text }
  }))
}

/* ---------------------------------------------------------- the manifest */

export interface TurnProvenancePlan {
  readonly blocks: readonly HostBlock[]
  /** The exact strings written to stdin, one per block (lone surrogates replaced). */
  readonly emitted: readonly string[]
  /** Per block: is its digest committed? (HUMAN never is.) */
  readonly committed: readonly boolean[]
  /** Manifest entries in block order; the CLI entry last. */
  readonly entries: readonly ModelProvenanceEntry[]
  readonly cliCommitted: boolean
  /** The CLI note: committed, withheld by the collision rule, or not offered (no address, or not the first turn). */
  readonly cliState: 'committed' | 'withheld_collision' | 'not_offered'
  /** Blocks (including the CLI note) withheld by the collision rule (N-4). */
  readonly collisions: number
  /** Blocks withheld because they were not well-formed UTF-16 (N-3). */
  readonly notWellFormed: number
}

/** Every digest the Router could match a block against: the text, with one seam newline, and without one. */
function digestSet(text: string): Set<string> {
  const set = new Set([ref(text), ref(`${text}\n`)])
  if (text.endsWith('\n')) set.add(ref(text.slice(0, -1)))
  return set
}

/**
 * Plan one turn's provenance (§4.1 entry rules, §5.4 collision rule N-4, N-3).
 * `cliDigests` is passed only on the first turn of the CLI process and only
 * when an account address is configured.
 */
export function planTurnProvenance(input: {
  readonly blocks: readonly HostBlock[]
  readonly firstTurn: boolean
  readonly cliDigests?: CliMetadataDigests
}): TurnProvenancePlan {
  const { blocks } = input
  let notWellFormed = 0
  const wellFormed = blocks.map(block => block.text.isWellFormed())
  const emitted = blocks.map((block, index) => {
    if (wellFormed[index] === true) return block.text
    notWellFormed += 1
    return block.text.toWellFormed()
  })
  const sets = emitted.map(digestSet)
  const cli = input.firstTurn ? input.cliDigests : undefined
  const cliSet = cli === undefined ? undefined : new Set([cli.d0, cli.d1])
  const collided = blocks.map(() => false)
  let cliCollided = false
  for (let i = 0; i < blocks.length; i += 1) {
    for (let j = i + 1; j < blocks.length; j += 1) {
      if ([...sets[i]!].some(digest => sets[j]!.has(digest))) { collided[i] = true; collided[j] = true }
    }
    if (cliSet !== undefined && [...sets[i]!].some(digest => cliSet.has(digest))) { collided[i] = true; cliCollided = true }
  }
  const committed = blocks.map((block, index) => block.class !== 'HUMAN' && wellFormed[index] === true && !collided[index])
  const entries: ModelProvenanceEntry[] = []
  for (const [index, block] of blocks.entries()) {
    if (!committed[index]) continue
    entries.push({ digest: ref(emitted[index]!), class: block.class as Exclude<HostBlockClass, 'HUMAN'>, ...(block.tool === undefined ? {} : { tool: block.tool }) })
  }
  const cliCommitted = cli !== undefined && !cliCollided
  if (cliCommitted) entries.push({ digest: cli.d0, class: 'CLI_METADATA' })
  return Object.freeze({
    blocks,
    emitted: Object.freeze(emitted),
    committed: Object.freeze(committed),
    entries: Object.freeze(entries),
    cliCommitted,
    cliState: cli === undefined ? 'not_offered' : cliCollided ? 'withheld_collision' : 'committed',
    collisions: collided.filter(Boolean).length + (cliCollided ? 1 : 0),
    notWellFormed,
  })
}

/**
 * §5.5 `hostManifestDigest`: RFC 8785 over the host entries only. The
 * CLI_METADATA entry is excluded, so no address-derived digest is persisted.
 */
export function hostManifestDigest(entries: readonly ModelProvenanceEntry[]): string {
  return ref(canonicalJson(entries.filter(row => row.class !== 'CLI_METADATA').map(row => ({ ...row }))))
}

/** Content-free per-turn audit (Y-1e, NO-5): no text, no address, no digest of an unproven block or of the CLI note. */
export function turnAuditDescriptors(plan: TurnProvenancePlan): {
  readonly blocks: readonly { readonly i: number, readonly class: HostBlockClass, readonly chars: number, readonly digestPrefix: string, readonly proof: 'committed' | 'human' | 'withheld_collision' | 'withheld_not_well_formed' }[]
  readonly cliMetadata: TurnProvenancePlan['cliState']
} {
  return {
    blocks: plan.blocks.map((block, i) => {
      const proof = plan.committed[i] === true ? 'committed' as const
        : block.class === 'HUMAN' ? 'human' as const
          : block.text.isWellFormed() ? 'withheld_collision' as const : 'withheld_not_well_formed' as const
      return { i, class: block.class, chars: plan.emitted[i]!.length, digestPrefix: proof === 'committed' ? sha256Hex(plan.emitted[i]!).slice(0, 12) : 'withheld', proof }
    }),
    cliMetadata: plan.cliState,
  }
}
