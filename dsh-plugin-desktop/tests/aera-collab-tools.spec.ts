/**
 * Agent-callable collaboration tools — WO-AGC-001 Remit E (§4).
 *
 * Proves the five collaboration tools are AGENT-CALLABLE through the DSH
 * runtime's REAL agent/session/tool mechanics: a real Cordis composition of
 * the runtime's own `LlmRuntime` + `SessionStore` + `SystemPrompt` +
 * `ToolRuntime` + `AgentRegistry` + `AgentLoop`, a real `Agent` created by
 * `ctx.agentLoop.create`, and real tool dispatch through the registry
 * pipeline into the established collaboration owners.
 *
 * The ONLY double is at the MODEL SEAM: a deterministic scripted
 * `LlmAdapter` (labelled TEST throughout) that emits the tool calls a model
 * would emit. Everything else — tool registration, scheduling, execution,
 * session events, ParticipationSession identity, four-leg attribution,
 * durable store writes — is the real runtime. This proves the tools are
 * agent-callable by the runtime; it is NOT a live-model result and is never
 * claimed as one.
 *
 * Uses a disposable store directory and a tiny synthetic corpus/stack — no
 * shared infrastructure, no provider call, no network.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { CallId, createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { ParticipationStore } from '@aera/participation-runtime'
import { issueAeraPrincipalId } from '@aera/cis-contracts'
import { CollabWorkspaceService } from '../src/aera-collab-service.ts'
import * as collabTools from '../src/aera-collab-tools.ts'

const TEST_WO = 'WO-TEST-AGC-E-AGENT-ACCESS-001'
const humanPrincipalId = issueAeraPrincipalId()
const AGENT_NAME = 'TEST Aera Code Desktop Worker'
const DELEGATION_ID = 'delegation-TEST-agc-e-agent-access-001'

let storeDir: string
let corpusRoot: string
let stackRoot: string
let gitDir: string

/** One assistant turn containing exactly one tool call. */
function toolCallTurn(rawCallId: string, name: string, args: object): StreamChunk[] {
  const callId = CallId(rawCallId)
  const argumentsJson = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name, arguments: argumentsJson } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

/** One final assistant text turn. */
function textTurn(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/**
 * TEST scripted model double — the ONLY substituted seam. Each model call
 * consumes the next script entry; entries may derive their tool arguments
 * from the REAL tool results the runtime fed back into the request.
 */
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

/** The last `nodeId` value visible in the request (i.e. in real tool results). */
function lastNodeIdInRequest(options: GenerateOptions): string {
  const serialized = JSON.stringify(options.messages)
  const matches = [...serialized.matchAll(/\\"nodeId\\": \\"([^\\"]+)\\"/g)]
  const last = matches.at(-1)
  if (last === undefined) throw new Error('TEST double: no nodeId found in any prior tool result')
  return last[1] as string
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') { dispose(); resolve() }
    })
  })
}

beforeAll(async () => {
  const base = mkdtempSync(join(tmpdir(), 'aera-collab-agent-tools-'))
  storeDir = join(base, 'participation-store')
  corpusRoot = join(base, 'corpus')
  stackRoot = join(base, 'stack')
  gitDir = join(base, 'worktree')
  mkdirSync(corpusRoot, { recursive: true })
  mkdirSync(stackRoot, { recursive: true })
  mkdirSync(gitDir, { recursive: true })
  const seedRepo = (root: string): void => {
    writeFileSync(join(root, 'README.md'), '# synthetic TEST root\n')
    execFileSync('git', ['-C', root, 'init', '-q'])
    execFileSync('git', ['-C', root, 'add', 'README.md'])
    execFileSync('git', ['-C', root, '-c', 'user.email=test@example.invalid', '-c', 'user.name=TEST', 'commit', '-qm', 'test: seed'])
  }
  seedRepo(corpusRoot)
  seedRepo(stackRoot)
  seedRepo(gitDir)

  // Recorded owner order/decision registration (remit F §3): a receipt that
  // states the canonical TEST order id and its owner-adjudication document,
  // beside that document — the exact custodied shape the graph's
  // `ingestOwnerDecisionRecords` rule projects into a GOVERNS edge. This is
  // what makes the governing-decisions tool return a REAL recorded decision
  // with a source locator instead of an unresolved empty set.
  const orderRoot = join(corpusRoot, 'wo-test')
  mkdirSync(join(orderRoot, 'evidence', 'remit-x'), { recursive: true })
  writeFileSync(
    join(orderRoot, 'OWNER_ADJUDICATION_TEST_RULING.md'),
    '# OWNER ADJUDICATION — TEST RULING\n\nOPTION 1 — ACCEPT (TEST).\n',
  )
  writeFileSync(
    join(orderRoot, 'evidence', 'remit-x', 'receipt.json'),
    JSON.stringify({
      receiptVersion: 1,
      workOrderId: TEST_WO,
      ownerAdjudication: { document: 'OWNER_ADJUDICATION_TEST_RULING.md', option: 'OPTION 1 — ACCEPT (TEST)' },
    }),
  )
  // Registration record (remit G): a receipt whose `ownerAdjudications` array
  // registers an already-issued owner decision by EXACT projection-wide path —
  // including a document outside the decision filename pattern. This is the
  // custodied shape that closes residual R-F1 for the real dogfood order.
  mkdirSync(join(orderRoot, 'evidence', 'remit-g'), { recursive: true })
  writeFileSync(
    join(orderRoot, 'OWNER_CONTINUATION_TEST_SCOPE.md'),
    '# OWNER CONTINUATION — TEST SCOPE RULING\n\nBounded TEST scope ruling registered by exact path.\n',
  )
  writeFileSync(
    join(orderRoot, 'evidence', 'remit-g', 'receipt.json'),
    JSON.stringify({
      receiptVersion: 1,
      workOrderId: TEST_WO,
      ownerAdjudications: [
        {
          documentPath: 'Aera_Studios_Docs/wo-test/OWNER_CONTINUATION_TEST_SCOPE.md',
          decision: 'TEST scope ruling — registered by exact path (remit G shape)',
        },
      ],
    }),
  )
  execFileSync('git', ['-C', corpusRoot, 'add', '.'])
  execFileSync('git', ['-C', corpusRoot, '-c', 'user.email=test@example.invalid', '-c', 'user.name=TEST', 'commit', '-qm', 'test: recorded owner adjudication for the TEST order'])

  // Canonical TEST Work Order through the established owner, then one HUMAN
  // window session writing a note so all four store record files exist and
  // custody is complete (the merged projection then carries the store nodes).
  const store = new ParticipationStore(storeDir)
  store.registerWorkOrder({ workOrderId: TEST_WO, title: 'TEST agent-access work order' })
  const seedService = new CollabWorkspaceService({
    storeDir, corpusRoot, stackRoot,
    principalId: humanPrincipalId as string,
    principalName: 'TEST Workspace User',
  })
  await seedService.openWorkContext(TEST_WO)
  await seedService.recordProgressNote('TEST seed note from the human window session')
  await seedService.closeWorkContext()
})

describe('§4 agent-callable access through the real runtime mechanics', () => {
  it('an agent session invokes all five collaboration tools and records attributed progress', async () => {
    const service = new CollabWorkspaceService({
      storeDir, corpusRoot, stackRoot,
      principalId: humanPrincipalId as string,
      principalName: 'TEST Workspace User',
      repositoryId: 'aera-repo:test-worktree',
      workspaceRoot: gitDir,
      agentName: AGENT_NAME,
      agentRole: 'IMPLEMENTER',
      delegationId: DELEGATION_ID,
      agentProviderHint: 'scripted-test-model-double',
    })

    const adapter = new ScriptedTestModelDouble([
      toolCallTurn('c1', 'aera_collab_resolve_work_context', { work_order_id: TEST_WO }),
      toolCallTurn('c2', 'aera_collab_governing_decisions', {}),
      toolCallTurn('c3', 'aera_collab_working_state', {}),
      toolCallTurn('c4', 'aera_collab_find_evidence', {}),
      toolCallTurn('c5', 'aera_collab_record', {
        kind: 'PROGRESS_NOTE',
        summary: 'TEST agent progress note recorded through the native aera_collab_record tool',
      }),
      (options) => toolCallTurn('c6', 'aera_collab_record', {
        kind: 'EVIDENCE_REFERENCE',
        evidence_node_id: lastNodeIdInRequest(options),
        summary: 'TEST agent evidence reference recorded through the native aera_collab_record tool',
      }),
      textTurn('TEST DOUBLE: scripted tool sequence complete; the returned payloads live in the session events.'),
    ])

    // REAL runtime composition — the same plugin classes the shipped runtime loads.
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(collabTools, { service })
    ctx.llm.registerAdapter(['scripted-test'], adapter)

    const agent = ctx.agentLoop.create(SessionId('agc-e-agent-proof-1'), {
      provider: 'scripted-test',
      model: 'TEST-scripted-double',
    })
    const idle = waitForIdle(ctx, agent)
    agent.followup(createUserMessage({
      content: [{
        type: 'text',
        text: `Use your tools to resolve WorkOrder ${TEST_WO} and report what the tools returned.`,
      }],
      source: { kind: 'user' },
    }))
    await idle

    // Every scripted turn was consumed: the runtime dispatched all six calls.
    expect(adapter.requests.length).toBe(7)

    const eventsJson = JSON.stringify([...agent.session.events])
    for (const tool of [
      'aera_collab_resolve_work_context',
      'aera_collab_governing_decisions',
      'aera_collab_working_state',
      'aera_collab_find_evidence',
      'aera_collab_record',
    ]) {
      expect(eventsJson).toContain(tool)
    }
    // The resolve result carried the real session identity and delegation.
    expect(eventsJson).toContain(DELEGATION_ID)
    // The governing-decisions tool returned the RECORDED adjudication for the
    // order — the decision document itself is the source locator (remit F §3;
    // before the ingest repair this came back as an empty, not-ingested set).
    expect(eventsJson).toContain('OWNER_ADJUDICATION_TEST_RULING.md')
    // …and the decision registered through the remit-G `ownerAdjudications`
    // exact-path registration record — a document OUTSIDE the decision
    // filename pattern, returned solely because the custodied record states it.
    expect(eventsJson).toContain('OWNER_CONTINUATION_TEST_SCOPE.md')
    // A recorded source locator came back through a tool result. With the
    // remit-F ingest rule the order node is asserted by the RECEIPT that
    // stated it (the corpus node and the participation-store node share one
    // derived id and the corpus assertion wins the merge), so the canonical
    // locator surfaced here is a stating receipt — the FIRST in canonical
    // path order, which since the remit-G registration record is remit-g.
    expect(eventsJson).toContain('wo-test/evidence/remit-g/receipt.json')

    // Durable proof through the established owners: the agent principal is a
    // durable AGENT participant; its session carries the recorded delegation;
    // both writes carry the full four-leg attribution.
    const store = new ParticipationStore(storeDir)
    const agentPrincipal = store.listParticipants().find(p => p.displayName === AGENT_NAME)
    expect(agentPrincipal).toBeDefined()
    expect(agentPrincipal?.principalKind).toBe('AGENT')

    const agentSessions = store.listSessions().filter(s => s.principalId === agentPrincipal?.principalId)
    expect(agentSessions.length).toBe(1)
    expect(agentSessions[0]?.delegationRef?.delegationId).toBe(DELEGATION_ID)
    expect(agentSessions[0]?.delegationRef?.delegatorPrincipalId).toBe(humanPrincipalId)
    expect(agentSessions[0]?.workOrderId).toBe(TEST_WO)

    const agentEvents = store.listEvents().filter(e =>
      typeof e.attribution === 'object' && e.attribution !== null && 'principalId' in e.attribution
      && (e.attribution as { principalId: string }).principalId === agentPrincipal?.principalId)
    const kinds = agentEvents.map(e => e.eventKind)
    expect(kinds).toContain('CHANGE_RECORDED')
    expect(kinds).toContain('EVIDENCE_ATTACHED')
    for (const event of agentEvents) {
      const attribution = event.attribution as {
        principalId: string, participationSessionId: string,
        delegationRef: { delegationId: string }, workOrderId: string,
      }
      expect(attribution.participationSessionId).toBe(agentSessions[0]?.sessionId)
      expect(attribution.delegationRef.delegationId).toBe(DELEGATION_ID)
      expect(attribution.workOrderId).toBe(TEST_WO)
    }
  }, 60_000)

  it('refuses honestly when the agent plane is not configured', async () => {
    const service = new CollabWorkspaceService({
      storeDir, corpusRoot, stackRoot,
      principalId: humanPrincipalId as string,
      principalName: 'TEST Workspace User',
      // no agentName / agentRole / delegationId
    })
    await expect(service.openAgentWorkContext(TEST_WO)).rejects.toMatchObject({ code: 'AGENT_UNAVAILABLE' })
  })

  it('refuses an unknown WorkOrderId on the agent plane rather than creating it', async () => {
    const service = new CollabWorkspaceService({
      storeDir, corpusRoot, stackRoot,
      principalId: humanPrincipalId as string,
      principalName: 'TEST Workspace User',
      agentName: AGENT_NAME,
      agentRole: 'IMPLEMENTER',
      delegationId: DELEGATION_ID,
    })
    await expect(service.openAgentWorkContext('WO-TEST-DOES-NOT-EXIST-999')).rejects.toMatchObject({
      code: 'WORK_ORDER_NOT_FOUND',
    })
  })
})
