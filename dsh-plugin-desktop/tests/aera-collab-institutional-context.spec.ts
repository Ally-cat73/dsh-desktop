/**
 * Role-shaped institutional context through the native tool —
 * WO-AERA-AUTONOMOUS-FACTORY-CONTEXT-CONVERGENCE-002, seam proposal §5.4.
 *
 * Uses the runtime's REAL agent/session/tool mechanics (the same composition
 * as `aera-collab-tools.spec.ts`). The ONLY double is the scripted model seam,
 * labelled TEST, which emits the tool calls a model would emit.
 *
 * The store is the G1 deterministic fixture, ported verbatim into
 * `tests/support/institutional-context-fixture.ts` (the stack copy is excluded
 * from the vendored dist). Case (0) proves the port is equivalent: compiled
 * the way the stack runner compiles it, it reproduces the stack runner's
 * packet bytes.
 *
 * (1) A joined IMPLEMENTER agent invokes `aera_collab_institutional_context`
 *     and the JSON the model receives deep-equals
 *     `compileAgentInstitutionalContext` over the same store and navigator.
 * (2) A REVIEWER-configured agent gets ROLE_NOT_PERMITTED for role
 *     IMPLEMENTER and no legacy find_evidence exposure.
 * (3) PASS_B is refused without frozen Pass A findings.
 * (4) The tool performs no store write: per-file sha256 is identical before
 *     and after the call. The session the join opens is measured separately.
 *
 * (5) Review round 1 (CD-16): a REVIEWER-configured agent that calls PASS_A
 *     with only role, repository, candidate revision and base revision gets
 *     an isolated packet. The implementer set is derived from the store and
 *     the reviewing principal is the joined session's principal.
 *
 * With `AERA_FRESH_AGENT_OUT=<dir>`, case (1) also writes the exact snapshot
 * text the joined agent received and the tool's IMPLEMENTER JSON, and case (5)
 * writes the tool's REVIEWER PASS_A JSON, with a SHA256SUMS manifest over the
 * files present. Without the variable nothing is written.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { CallId, createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import {
  ContextNavigator,
  ParticipationStore,
  buildParticipationProjection,
  compileAgentInstitutionalContext,
  mergeProjections,
} from '@aera/participation-runtime'
import { isAgentInstitutionalContextV1, type AgentInstitutionalContextV1 } from '@aera/participation-contracts'
import { CollabWorkspaceService } from '../src/aera-collab-service.ts'
import * as collabTools from '../src/aera-collab-tools.ts'
import {
  FIXTURE_PRINCIPALS,
  FIXTURE_SENTINELS,
  FIXTURE_WORK_ORDERS,
  buildFactoryContextFixture,
  buildFactoryContextNavigator,
  buildFactoryContextProjection,
  type FactoryContextFixtureIds,
} from './support/institutional-context-fixture.ts'

const COMPILED_AT = '2026-10-14T00:00:00.000Z'
/** sha256 of the stack runner's packets at aera-stack eb5bf17f6, unchanged at 6323987ff (runner-output/SHA256SUMS). */
const STACK_RUNNER_IMPLEMENTER_SHA256 = '648c38b13be7aff3cdbbe1717c97366270ca10e517746bd3d01b35b28334b1c5'
const STACK_RUNNER_REVIEWER_PASS_A_SHA256 = 'b8c99b1f43c113f5db8dca7ae89fc60aa6c2bb523ae1ed569d2de5314ea2257f'
/** The fresh-agent native output files, in SHA256SUMS order. */
const FRESH_AGENT_OUTPUT_FILES = ['native-snapshot.txt', 'native-implementer-tool-output.json', 'native-reviewer-pass-a-tool-output.json'] as const
const TARGET = FIXTURE_WORK_ORDERS.target
const SNAPSHOT_SOURCE_PLUGIN = 'aera-collab-agent-tools'

let corpusRoot: string
let stackRoot: string

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')
const stable = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

function toolCallTurn(rawCallId: string, name: string, args: object): StreamChunk[] {
  const callId = CallId(rawCallId)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name, arguments: JSON.stringify(args) } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

function textTurn(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** TEST scripted model double — the ONLY substituted seam. */
class ScriptedTestModelDouble extends LlmAdapter {
  requests: GenerateOptions[] = []
  constructor(private readonly script: (StreamChunk[] | ((options: GenerateOptions) => StreamChunk[]))[]) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const entry = this.script.shift()
    if (!entry) throw new Error('ScriptedTestModelDouble: script exhausted')
    const chunks = typeof entry === 'function' ? entry(options) : entry
    for (const chunk of chunks) yield chunk
  }
}

interface LooseBlock { readonly type: string, readonly text?: string, readonly toolCallId?: string, readonly isError?: boolean, readonly content?: readonly LooseBlock[] }
interface LooseMessage { readonly content: readonly LooseBlock[], readonly source?: { readonly kind?: string, readonly plugin?: string, readonly form?: string } }

/** The model-facing text and error flag of one tool result, as the runtime fed it back. */
function toolResult(requests: readonly GenerateOptions[], callId: string): { text: string, isError: boolean } {
  for (const request of requests) {
    for (const message of request.messages as unknown as readonly LooseMessage[]) {
      for (const block of message.content) {
        if (block.type === 'tool-result' && block.toolCallId === callId) {
          const text = (block.content ?? []).filter(part => part.type === 'text').map(part => part.text ?? '').join('')
          return { text, isError: block.isError === true }
        }
      }
    }
  }
  throw new Error(`no tool result for ${callId} in any model request`)
}

/** The snapshot text the pre-step hook injected into one model request. */
function snapshotText(request: GenerateOptions | undefined): string | undefined {
  const messages = (request?.messages ?? []) as unknown as readonly LooseMessage[]
  const snapshot = messages.filter(message =>
    message.source?.kind === 'plugin' && message.source.plugin === SNAPSHOT_SOURCE_PLUGIN && message.source.form === 'snapshot').at(-1)
  return snapshot?.content.find(block => block.type === 'text')?.text
}

/** sha256 of every file in a store directory, by file name. */
function storeDigests(directory: string): Record<string, string> {
  return Object.fromEntries(readdirSync(directory).sort().map(file => [file, sha256(readFileSync(join(directory, file), 'utf8'))]))
}

function changedFiles(before: Record<string, string>, after: Record<string, string>): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(file => before[file] !== after[file]).sort()
}

/**
 * The navigator `CollabWorkspaceService.mergedNavigator()` builds: base
 * projection + store projection. CD-13: the base is the fixture graph the
 * stack runner orients against (two ADRs + the parent Work Order), supplied
 * to the service through `CollabWorkspaceHooks.baseProjection`.
 */
function mergedNavigatorFor(store: ParticipationStore): ContextNavigator {
  const participation = buildParticipationProjection({ store, sourcePrefix: 'participation-store' })
  return new ContextNavigator(mergeProjections(buildFactoryContextProjection(), participation.projection))
}

/**
 * With `AERA_FRESH_AGENT_OUT` set, write one native output file and rewrite
 * SHA256SUMS over every listed output file present in the directory.
 */
function writeFreshAgentOutput(name: typeof FRESH_AGENT_OUTPUT_FILES[number], content: string): void {
  const out = process.env['AERA_FRESH_AGENT_OUT']
  if (out === undefined || out.trim() === '') return
  const directory = resolve(out)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, name), content, 'utf8')
  const present = new Set(readdirSync(directory))
  const sums = FRESH_AGENT_OUTPUT_FILES.filter(file => present.has(file))
    .map(file => `${sha256(readFileSync(join(directory, file), 'utf8'))}  ${file}`)
  writeFileSync(join(directory, 'SHA256SUMS'), `${sums.join('\n')}\n`, 'utf8')
}

function freshFixture(): { ids: FactoryContextFixtureIds, storeDir: string } {
  const storeDir = join(mkdtempSync(join(tmpdir(), 'aera-collab-institutional-context-')), 'store')
  mkdirSync(storeDir, { recursive: true })
  return { ids: buildFactoryContextFixture(storeDir), storeDir }
}

function serviceFor(storeDir: string, agent: { name: string, role: string, delegationId: string }): CollabWorkspaceService {
  return new CollabWorkspaceService({
    storeDir, corpusRoot, stackRoot,
    principalId: FIXTURE_PRINCIPALS.owner as string,
    principalName: 'Fixture Owner',
    agentName: agent.name,
    agentRole: agent.role,
    delegationId: agent.delegationId,
  }, { now: () => COMPILED_AT, baseProjection: buildFactoryContextProjection })
}

async function runtimeFor(service: CollabWorkspaceService, adapter: ScriptedTestModelDouble): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(collabTools, { service })
  ctx.llm.registerAdapter(['scripted-test'], adapter)
  return ctx
}

beforeAll(() => {
  const base = mkdtempSync(join(tmpdir(), 'aera-collab-institutional-context-roots-'))
  corpusRoot = join(base, 'corpus')
  stackRoot = join(base, 'stack')
  for (const root of [corpusRoot, stackRoot]) {
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'README.md'), '# synthetic TEST root\n')
    execFileSync('git', ['-C', root, 'init', '-q'])
    execFileSync('git', ['-C', root, 'add', 'README.md'])
    execFileSync('git', ['-C', root, '-c', 'user.email=test@example.invalid', '-c', 'user.name=TEST', 'commit', '-qm', 'test: seed'])
  }
})

describe('(0) the ported fixture is the G1 fixture', () => {
  it('compiled as the stack runner compiles it, it reproduces the stack runner packet bytes', () => {
    const { ids, storeDir } = freshFixture()
    const store = new ParticipationStore(storeDir)
    const navigator = buildFactoryContextNavigator()
    const implementer = compileAgentInstitutionalContext({
      store, workOrderId: ids.workOrders.target, role: 'IMPLEMENTER', navigator, now: () => COMPILED_AT,
    })
    const reviewerPassA = compileAgentInstitutionalContext({
      store, workOrderId: ids.workOrders.target, role: 'REVIEWER', navigator, now: () => COMPILED_AT,
      review: { pass: 'PASS_A', candidate: ids.candidate, reviewerPrincipalId: FIXTURE_PRINCIPALS.reviewer, implementerPrincipalIds: [FIXTURE_PRINCIPALS.implementer] },
    })
    expect(sha256(stable(implementer))).toBe(STACK_RUNNER_IMPLEMENTER_SHA256)
    expect(sha256(stable(reviewerPassA))).toBe(STACK_RUNNER_REVIEWER_PASS_A_SHA256)
  })
})

describe('(1)+(4) a joined IMPLEMENTER agent receives exactly the stack projection, and the tool writes nothing', () => {
  it('the tool JSON deep-equals compileAgentInstitutionalContext over the same store; per-file sha256 is unchanged by the call', async () => {
    const { storeDir } = freshFixture()
    const service = serviceFor(storeDir, { name: 'Fixture Implementer', role: 'IMPLEMENTER', delegationId: 'delegation-fixture-implementer' })
    const beforeJoin = storeDigests(storeDir)
    let beforeTool: Record<string, string> = {}
    let afterTool: Record<string, string> = {}
    const adapter = new ScriptedTestModelDouble([
      toolCallTurn('c1', 'aera_collab_resolve_work_context', { work_order_id: TARGET }),
      () => {
        beforeTool = storeDigests(storeDir)
        return toolCallTurn('c2', 'aera_collab_institutional_context', { role: 'IMPLEMENTER' })
      },
      () => {
        afterTool = storeDigests(storeDir)
        return textTurn('TEST DOUBLE: institutional context read.')
      },
      textTurn('TEST DOUBLE: second turn answered from the snapshot.'),
    ])
    const ctx = await runtimeFor(service, adapter)
    const agent = ctx.agentLoop.create(SessionId('factory-context-implementer'), { provider: 'scripted-test', model: 'TEST-scripted-double' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: `Resolve ${TARGET} and read its institutional context.` }], source: { kind: 'user' } }))
    await agent.whenIdle()
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'What am I working on?' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(4)

    // (1) The JSON the model received is exactly the stack projection.
    const result = toolResult(adapter.requests, 'c2')
    expect(result.isError).toBe(false)
    const native = JSON.parse(result.text) as AgentInstitutionalContextV1
    const store = new ParticipationStore(storeDir)
    const direct = compileAgentInstitutionalContext({
      store, workOrderId: TARGET, role: 'IMPLEMENTER', navigator: mergedNavigatorFor(store), now: () => COMPILED_AT,
    })
    expect(native).toEqual(direct)
    expect(isAgentInstitutionalContextV1(native)).toBe(true)
    // CD-13: with the runner's graph governors and the same pinned compiledAt,
    // the native packet IS the stack runner packet, byte for byte.
    expect(sha256(stable(native))).toBe(STACK_RUNNER_IMPLEMENTER_SHA256)
    expect(native.items.filter(item => item.factClass === 'GOVERNING_DOCUMENT').map(item => item.itemId)).toEqual(
      expect.arrayContaining([
        'GOVERNING_DOCUMENT:ewg:architecture_decision:ADR-FIXTURE-TYPED-RECORDS',
        'GOVERNING_DOCUMENT:ewg:architecture_decision:ADR-FIXTURE-GRAPH-EVENTS',
        `GOVERNING_DOCUMENT:ewg:work_order:${FIXTURE_WORK_ORDERS.authorising}`,
      ]))
    expect(native.authority).toEqual({ mode: 'RECORDED_NOT_ENFORCED', casEnforced: false, sentinelRelease: 'NOT_REPRESENTED', ownerAcceptance: 'NOT_DERIVED' })

    // (4) The tool call wrote nothing; the join wrote only its session record.
    expect(changedFiles(beforeTool, afterTool)).toEqual([])
    expect(changedFiles(beforeJoin, beforeTool)).toEqual(['SHA256SUMS', 'sessions.json'])

    // The joined snapshot names the tool.
    const snapshot = snapshotText(adapter.requests[3])
    expect(snapshot).toContain(`Current canonical Work Order: ${TARGET}`)
    // CD-12: the snapshot and the packet now agree on the effective state.
    expect(snapshot).toContain('Status: COMPLETED (source STATE_RECORD; state sequence ')
    expect(snapshot).not.toContain('Status: ACTIVE')
    // PA-7: the status line names who recorded the effective state: here the implementer's own completion claim.
    expect(snapshot).toContain(`; revision 1; state recorded by ${FIXTURE_PRINCIPALS.implementer} (AGENT)`)
    expect(native.items.find(item => item.itemId === `WORK_ORDER:${TARGET}#effective-state`)?.fields['effectiveLifecycleState']).toBe('COMPLETED')
    expect(snapshot).toContain('Institutional records (decisions incl. superseded, typed evidence, Working Lines, checkpoints, receipts): call aera_collab_institutional_context with your role.')

    if (snapshot !== undefined) {
      writeFreshAgentOutput('native-snapshot.txt', `${snapshot}\n`)
      writeFreshAgentOutput('native-implementer-tool-output.json', stable(native))
    }
  }, 60_000)

  it('record_id keeps only the items of that record; an unknown record is refused', async () => {
    const { ids, storeDir } = freshFixture()
    const service = serviceFor(storeDir, { name: 'Fixture Implementer', role: 'IMPLEMENTER', delegationId: 'delegation-fixture-implementer' })
    await expect(service.agentInstitutionalContextPacket({ role: 'IMPLEMENTER' })).rejects.toMatchObject({ code: 'NOT_JOINED' })
    await service.openAgentWorkContext(TARGET)
    const line = await service.agentInstitutionalContextPacket({ role: 'IMPLEMENTER', recordId: ids.lines.derived })
    expect(line.items.length).toBeGreaterThan(0)
    expect(line.items.every(item => item.source.recordId === ids.lines.derived)).toBe(true)
    expect(line.items.map(item => item.itemId)).toContain(`WORKING_LINE:${ids.lines.derived}#location`)
    await expect(service.agentInstitutionalContextPacket({ role: 'IMPLEMENTER', recordId: 'aera:decision:not-in-store' }))
      .rejects.toMatchObject({ code: 'RECORD_NOT_IN_CONTEXT' })
    await service.closeAgentWorkContext()
  })
})

describe('CD-14 the snapshot counts come from in-force records', () => {
  it('a superseded ADR is not counted as governing, and the open break is shown', async () => {
    const { ids, storeDir } = freshFixture()
    const service = serviceFor(storeDir, { name: 'Fixture Implementer', role: 'IMPLEMENTER', delegationId: 'delegation-fixture-implementer' })
    await service.openAgentWorkContext(TARGET)
    const snapshot = await service.agentInstitutionalContext() ?? ''
    const packet = await service.agentInstitutionalContextPacket({ role: 'IMPLEMENTER' })
    const governing = packet.items.filter(item => item.factClass === 'GOVERNING_DOCUMENT')
    // The fixture graph holds the superseded ADR; it is in the packet, marked not current.
    expect(governing.find(item => item.itemId === 'GOVERNING_DOCUMENT:ewg:architecture_decision:ADR-FIXTURE-GRAPH-EVENTS')?.current).toBe(false)
    expect(governing).toHaveLength(4)
    expect(packet.items.map(item => item.itemId)).toContain(`BREAK_REPAIR:${ids.events.openBreak}`)
    expect(snapshot).toContain('Counts from aera_collab_institutional_context (role IMPLEMENTER): '
      + `1 current decision(s), 3 current governing document(s), 2 superseded or revoked decision(s), 1 open break(s), ${packet.absences.length} stated absence(s).`)
    // No legacy count line survives.
    expect(snapshot).not.toContain('governing decision(s)')
    expect(snapshot).not.toContain('unresolved item(s)')
    await service.closeAgentWorkContext()
  })
})

describe('CD-12 an unrecorded authority class is never printed', () => {
  it('a minimal order (no authority class, no state record) prints no Authority line and its effective source', async () => {
    const { storeDir } = freshFixture()
    const service = serviceFor(storeDir, { name: 'Fixture Implementer', role: 'IMPLEMENTER', delegationId: 'delegation-fixture-implementer' })
    await service.openAgentWorkContext(FIXTURE_WORK_ORDERS.minimal)
    const snapshot = await service.agentInstitutionalContext() ?? ''
    const effective = new ParticipationStore(storeDir).effectiveWorkOrderState(FIXTURE_WORK_ORDERS.minimal)
    expect(effective?.authorityClass).toBe('UNRECORDED')
    expect(snapshot).toContain(`Current canonical Work Order: ${FIXTURE_WORK_ORDERS.minimal}`)
    expect(snapshot).not.toContain('Authority:')
    expect(snapshot).toContain(`Status: ${effective?.lifecycleState} (source ${effective?.source}`)
    expect(snapshot).not.toContain('RECORDED;')
    await service.closeAgentWorkContext()
  })
})

describe('(2)+(3) a REVIEWER-configured agent cannot widen its own input', () => {
  it('ROLE_NOT_PERMITTED for IMPLEMENTER, no legacy find_evidence exposure, PASS_B refused without frozen findings', async () => {
    const { ids, storeDir } = freshFixture()
    const service = serviceFor(storeDir, { name: 'Fixture Reviewer', role: 'REVIEWER', delegationId: 'delegation-fixture-reviewer' })
    const candidate = {
      candidate_repository_id: ids.candidate.repositoryId as string,
      candidate_revision: ids.candidate.candidateRevision,
      base_revision: ids.candidate.baseRevision,
      implementer_principal_ids: FIXTURE_PRINCIPALS.implementer as string,
    }
    const adapter = new ScriptedTestModelDouble([
      toolCallTurn('r1', 'aera_collab_resolve_work_context', { work_order_id: TARGET }),
      toolCallTurn('r2', 'aera_collab_institutional_context', { role: 'IMPLEMENTER' }),
      toolCallTurn('r3', 'aera_collab_find_evidence', {}),
      toolCallTurn('r4', 'aera_collab_institutional_context', { role: 'REVIEWER', review_pass: 'PASS_B', ...candidate }),
      toolCallTurn('r5', 'aera_collab_institutional_context', { role: 'REVIEWER', review_pass: 'PASS_A', ...candidate }),
      textTurn('TEST DOUBLE: reviewer sequence complete.'),
    ])
    const ctx = await runtimeFor(service, adapter)
    const agent = ctx.agentLoop.create(SessionId('factory-context-reviewer'), { provider: 'scripted-test', model: 'TEST-scripted-double' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: `Review the candidate of ${TARGET}.` }], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(6)

    const asImplementer = toolResult(adapter.requests, 'r2')
    expect(asImplementer.isError).toBe(true)
    expect(asImplementer.text).toContain('ROLE_NOT_PERMITTED')
    expect(asImplementer.text).not.toContain('contextVersion')

    const legacy = toolResult(adapter.requests, 'r3')
    expect(legacy.isError).toBe(true)
    expect(legacy.text).toContain('unknown tool')
    expect(legacy.text).not.toContain('nodeId')

    const passB = toolResult(adapter.requests, 'r4')
    expect(passB.isError).toBe(true)
    expect(passB.text).toContain('REVIEW_PASS_A_NOT_FROZEN')

    const passA = toolResult(adapter.requests, 'r5')
    expect(passA.isError).toBe(false)
    const packet = JSON.parse(passA.text) as AgentInstitutionalContextV1
    expect(isAgentInstitutionalContextV1(packet)).toBe(true)
    expect(packet.role).toBe('REVIEWER')
    expect(packet.reviewPass).toBe('PASS_A')
    // No candidate_working_line_id was passed, so the candidate carries none.
    expect(packet.candidate).toEqual({
      repositoryId: ids.candidate.repositoryId,
      candidateRevision: ids.candidate.candidateRevision,
      baseRevision: ids.candidate.baseRevision,
    })
    expect(passA.text).not.toContain('SENTINEL-')
  }, 60_000)
})

describe('(5) a fresh REVIEWER Pass A call needs only role, repository, candidate revision and base revision (CD-16)', () => {
  /** Implementer narrative and implementer locators of the fixture: none may reach a Pass A packet. */
  const IMPLEMENTER_MARKERS = [
    ...Object.values(FIXTURE_SENTINELS),
    'review/self-check@',
    'logs/implementer-unit-suite.log',
    'Context compiler line',
    'Context root line',
  ]
  const STRANGER = 'aera:participant:10000000-0000-4000-8000-000000000099'

  it('the tool derives the implementer set and the reviewing principal from the store and the join; the packet carries no implementer narrative', async () => {
    const { ids, storeDir } = freshFixture()
    const service = serviceFor(storeDir, { name: 'Fixture Reviewer', role: 'REVIEWER', delegationId: 'delegation-fixture-reviewer' })
    const fresh = {
      role: 'REVIEWER',
      review_pass: 'PASS_A',
      candidate_repository_id: ids.candidate.repositoryId as string,
      candidate_revision: ids.candidate.candidateRevision,
      base_revision: ids.candidate.baseRevision,
    }
    const adapter = new ScriptedTestModelDouble([
      toolCallTurn('f1', 'aera_collab_resolve_work_context', { work_order_id: TARGET }),
      toolCallTurn('f2', 'aera_collab_institutional_context', fresh),
      toolCallTurn('f3', 'aera_collab_institutional_context', { ...fresh, implementer_principal_ids: STRANGER }),
      toolCallTurn('f4', 'aera_collab_institutional_context', { ...fresh, implementer_principal_ids: FIXTURE_PRINCIPALS.reviewer as string }),
      toolCallTurn('f5', 'aera_collab_institutional_context', { ...fresh, candidate_working_line_id: 'aera:code_working_line:not-here' }),
      toolCallTurn('f6', 'aera_collab_institutional_context', { ...fresh, candidate_revision: 'md' }),
      toolCallTurn('f7', 'aera_collab_institutional_context', { ...fresh, candidate_working_line_id: ids.lines.root as string }),
      toolCallTurn('f8', 'aera_collab_institutional_context', { ...fresh, candidate_revision: 'abcdef0123456', candidate_working_line_id: ids.lines.root as string }),
      toolCallTurn('f9', 'aera_collab_institutional_context', { ...fresh, base_revision: 'not a revision' }),
      textTurn('TEST DOUBLE: fresh reviewer sequence complete.'),
    ])
    const ctx = await runtimeFor(service, adapter)
    const agent = ctx.agentLoop.create(SessionId('factory-context-fresh-reviewer'), { provider: 'scripted-test', model: 'TEST-scripted-double' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: `Review the candidate of ${TARGET}, Pass A.` }], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(10)

    const passA = toolResult(adapter.requests, 'f2')
    expect(passA.isError).toBe(false)
    const packet = JSON.parse(passA.text) as AgentInstitutionalContextV1
    expect(isAgentInstitutionalContextV1(packet)).toBe(true)
    expect(packet.reviewPass).toBe('PASS_A')
    expect(packet.candidate).toEqual({
      repositoryId: ids.candidate.repositoryId,
      candidateRevision: ids.candidate.candidateRevision,
      baseRevision: ids.candidate.baseRevision,
    })
    for (const marker of IMPLEMENTER_MARKERS) expect(passA.text).not.toContain(marker)
    // The candidate line was resolved from the revision; the implementer's records are flagged.
    expect(packet.items.find(item => item.itemId === `WORKING_LINE:${ids.lines.derived}`)?.fields['reviewCandidate']).toBe(true)
    expect(packet.items.find(item => item.itemId === `TYPED_EVIDENCE:${ids.evidence.implementerVerification}`)?.assertedByCandidateAuthor).toBe(true)
    // The joined reviewer is never an implementer: its own findings are not flagged.
    expect(packet.items.find(item => item.itemId === `TYPED_EVIDENCE:${ids.evidence.passAFindings}`)?.assertedByCandidateAuthor).toBeUndefined()
    // It is exactly the compiler's packet for the joined reviewer principal.
    const store = new ParticipationStore(storeDir)
    const direct = compileAgentInstitutionalContext({
      store, workOrderId: TARGET, role: 'REVIEWER', navigator: mergedNavigatorFor(store), now: () => COMPILED_AT,
      review: { pass: 'PASS_A', candidate: packet.candidate!, reviewerPrincipalId: FIXTURE_PRINCIPALS.reviewer },
    })
    expect(packet).toEqual(direct)

    // ADV-1 in product: a wrong implementer id cannot open the packet.
    const wrongId = toolResult(adapter.requests, 'f3')
    expect(wrongId.isError).toBe(false)
    for (const marker of IMPLEMENTER_MARKERS) expect(wrongId.text).not.toContain(marker)
    // PA-5: naming oneself as an implementer is refused.
    expect(toolResult(adapter.requests, 'f4').text).toContain('REVIEWER_IS_CANDIDATE_AUTHOR')
    // PA-1: an explicit line id must exist.
    expect(toolResult(adapter.requests, 'f5').text).toContain('CANDIDATE_LINE_NOT_FOUND')
    // PA-3: a candidate revision that is not revision-shaped is refused.
    expect(toolResult(adapter.requests, 'f6').text).toContain('REVIEW_CANDIDATE_REQUIRED')
    // R2-1 (CD-18): an existing line id that carries no checkpoint at the candidate revision is refused.
    const notAtRevision = toolResult(adapter.requests, 'f7')
    expect(notAtRevision.isError).toBe(true)
    expect(notAtRevision.text).toContain('CANDIDATE_LINE_NOT_AT_REVISION')
    // R2-1: with an uncheckpointed revision, a line id never opens a packet, and the refusal invites none.
    const uncheckpointed = toolResult(adapter.requests, 'f8')
    expect(uncheckpointed.isError).toBe(true)
    expect(uncheckpointed.text).toContain('IMPLEMENTER_SET_REQUIRED')
    expect(uncheckpointed.text).not.toMatch(/no line id given/i)
    for (const marker of IMPLEMENTER_MARKERS) expect(uncheckpointed.text).not.toContain(marker)
    // R2-5: the base revision is revision-shaped too.
    expect(toolResult(adapter.requests, 'f9').text).toContain('REVIEW_CANDIDATE_REQUIRED')

    writeFreshAgentOutput('native-reviewer-pass-a-tool-output.json', stable(packet))
    const out = process.env['AERA_FRESH_AGENT_OUT']
    if (out !== undefined && out.trim() !== '') {
      const written = readFileSync(join(resolve(out), 'native-reviewer-pass-a-tool-output.json'), 'utf8')
      expect(written).toBe(stable(packet))
      for (const marker of IMPLEMENTER_MARKERS) expect(written).not.toContain(marker)
    }
  }, 60_000)
})

/** C6 measures the real model request, including schemas, rather than plugin counts. */
describe('C6 configured-role request surface', () => {
  for (const role of ['ORCHESTRATOR', 'IMPLEMENTER', 'REVIEWER', 'NAVIGATOR', 'ARCHITECT', 'RESEARCHER', 'INCIDENT_RESPONDER']) {
    it(`captures the ${role} collaboration surface at the model seam`, async () => {
      const { storeDir } = freshFixture()
      const service = serviceFor(storeDir, { name: `Fixture ${role}`, role, delegationId: `delegation-fixture-${role.toLowerCase()}` })
      const adapter = new ScriptedTestModelDouble([textTurn('TEST DOUBLE: role census complete.')])
      const ctx = await runtimeFor(service, adapter)
      try {
        const agent = ctx.agentLoop.create(SessionId(`c6-${role.toLowerCase()}`), { provider: 'scripted-test', model: 'TEST-scripted-double' })
        agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Identify the available collaboration surface.' }], source: { kind: 'user' } }))
        await agent.whenIdle()
        expect(adapter.requests).toHaveLength(1)
        const request = adapter.requests[0]
        if (!request) throw new Error('C6 fixture produced no model request')
        const tools = request.tools ?? []
        expect(tools.some(tool => tool.name === 'aera_collab_institutional_context')).toBe(true)
        expect(tools.map(tool => tool.name).sort()).toEqual([
          'aera_collab_resolve_work_context', 'aera_collab_governing_decisions',
          'aera_collab_institutional_context', 'aera_collab_working_state',
          'aera_collab_record', 'aera_collab_repository_resource',
          ...(role === 'REVIEWER' ? [] : ['aera_collab_find_evidence']),
        ].sort())
        expect(tools.some(tool => tool.name === 'aera_collab_find_evidence')).toBe(role !== 'REVIEWER')
        const out = process.env['AERA_C6_CENSUS_OUT']
        if (out) {
          mkdirSync(out, { recursive: true })
          writeFileSync(join(out, `${role}.json`), `${JSON.stringify({
            role, composition: 'real Cordis runtime plus desktop collaboration tools; scripted model only; no standard preset plugins',
            tools, toolCount: tools.length, schemaBytes: Buffer.byteLength(JSON.stringify(tools)),
            system: request.system ?? '', systemBytes: Buffer.byteLength(request.system ?? ''),
            institutionalSnapshot: snapshotText(request) ?? '',
          }, null, 2)}\n`)
        }
      } finally { await ctx.fiber.dispose() }
    }, 60_000)
  }
})


describe('C6 retained institutional snapshots', () => {
  const snapshots = (request: GenerateOptions): readonly LooseMessage[] =>
    (request.messages as unknown as readonly LooseMessage[]).filter(message =>
      message.source?.kind === 'plugin' && message.source.plugin === SNAPSHOT_SOURCE_PLUGIN && message.source.form === 'snapshot')
  const follow = async (agent: ReturnType<Context['agentLoop']['create']>, text: string): Promise<void> => {
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    await agent.whenIdle()
  }

  it('recomputes every owner turn but retains one unchanged snapshot, independently for each native session', async () => {
    const { storeDir } = freshFixture()
    const service = serviceFor(storeDir, { name: 'C6 retention', role: 'IMPLEMENTER', delegationId: 'c6-retention' })
    const orientation = vi.spyOn(service, 'agentOrientationContext')
    const adapter = new ScriptedTestModelDouble(Array.from({ length: 10 }, () => textTurn('fixture completion')))
    const ctx = await runtimeFor(service, adapter)
    try {
      const agent = ctx.agentLoop.create(SessionId('c6-retention-one'), { provider: 'scripted-test', model: 'TEST' })
      for (let i = 0; i < 8; i++) await follow(agent, 'Continue the same bounded task.')
      expect(orientation).toHaveBeenCalledTimes(8)
      for (const request of adapter.requests) expect(snapshots(request)).toHaveLength(1)
      const second = ctx.agentLoop.create(SessionId('c6-retention-two'), { provider: 'scripted-test', model: 'TEST' })
      await follow(second, 'Start this independent task.')
      expect(snapshots(adapter.requests[8]!)).toHaveLength(1)
      expect(orientation).toHaveBeenCalledTimes(9)
    } finally { orientation.mockRestore(); await ctx.fiber.dispose() }
  })

  it('delivers changed context and a return to an older value; compares only the latest retained snapshot', async () => {
    const { storeDir } = freshFixture()
    const service = serviceFor(storeDir, { name: 'C6 changed', role: 'IMPLEMENTER', delegationId: 'c6-changed' })
    const original = await service.agentOrientationContext()
    const orientation = vi.spyOn(service, 'agentOrientationContext')
      .mockResolvedValueOnce(original).mockResolvedValueOnce(original)
      .mockResolvedValueOnce(`${original}\nA newly recorded authority constraint.`).mockResolvedValueOnce(original)
    const adapter = new ScriptedTestModelDouble(Array.from({ length: 4 }, () => textTurn('fixture completion')))
    const ctx = await runtimeFor(service, adapter)
    try {
      const agent = ctx.agentLoop.create(SessionId('c6-changed'), { provider: 'scripted-test', model: 'TEST' })
      for (let i = 0; i < 4; i++) await follow(agent, 'Refresh the institutional context.')
      expect(adapter.requests.map(request => snapshots(request).length)).toEqual([1, 1, 2, 3])
      expect(snapshotText(adapter.requests[2])).toContain('newly recorded authority constraint')
      expect(snapshotText(adapter.requests[3])).toBe(original)
    } finally { orientation.mockRestore(); await ctx.fiber.dispose() }
  })

  it('reinjects missing context after a real session surface replacement; old raw log entries do not suppress it', async () => {
    const { storeDir } = freshFixture()
    const service = serviceFor(storeDir, { name: 'C6 compacted', role: 'IMPLEMENTER', delegationId: 'c6-compacted' })
    const adapter = new ScriptedTestModelDouble([textTurn('first'), textTurn('second')])
    const ctx = await runtimeFor(service, adapter)
    try {
      const agent = ctx.agentLoop.create(SessionId('c6-compacted'), { provider: 'scripted-test', model: 'TEST' })
      await follow(agent, 'Inspect the fixture.')
      const snapshot = agent.session.events.find(event => event.type === 'user/message'
        && event.data.source.kind === 'plugin' && event.data.source.plugin === SNAPSHOT_SOURCE_PLUGIN)
      if (!snapshot) throw new Error('Missing original snapshot event')
      agent.session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: 'Fixture compaction summary; snapshot not retained.' }],
        source: { kind: 'plugin', plugin: 'c6-fixture-compactor' },
      }), { surfaceOp: { op: 'replace', start: snapshot.seq, end: snapshot.seq }, sourceEventSeqs: [snapshot.seq] })
      expect(agent.session.deriveMessages().some(message => message.source.kind === 'plugin' && message.source.plugin === SNAPSHOT_SOURCE_PLUGIN)).toBe(false)
      await follow(agent, 'Continue after compaction.')
      expect(snapshots(adapter.requests[1]!)).toHaveLength(1)
      expect(snapshotText(adapter.requests[1])).toBe(snapshotText(adapter.requests[0]))
      expect(agent.session.events.filter(event => event.type === 'user/message'
        && event.data.source.kind === 'plugin' && event.data.source.plugin === SNAPSHOT_SOURCE_PLUGIN)).toHaveLength(2)
    } finally { await ctx.fiber.dispose() }
  })
})
