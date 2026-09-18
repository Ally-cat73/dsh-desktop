/**
 * Coordination threads at the service level —
 * WO-AERA-COLLAB-RELAY-COORDINATION-THREADS-AND-WORKING-LINE-HANDOFF-001.
 *
 * The route tests above prove the wire boundary. These prove the thing the
 * route calls actually writes what it claims to, against a REAL disposable
 * durable store — because a coordination surface whose writes are only ever
 * exercised through a mock is a surface nobody has proven can write.
 *
 * Deterministic TEST participants throughout. No network, no provider call,
 * no model call.
 */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ParticipationStore, STORE_RECORD_FILES } from '@aera/participation-runtime'
import { issueAeraPrincipalId } from '@aera/cis-contracts'
import { CollabWorkspaceService, type CollabWorkspaceConfig } from '../src/aera-collab-service.ts'

const TEST_WO = 'WO-TEST-COORDINATION-DESKTOP-001'
const ownerPrincipalId = issueAeraPrincipalId()
const ownerName = 'TEST Owner'

let storeDir: string
let corpusRoot: string
let stackRoot: string
let gitDir: string

const config = (): CollabWorkspaceConfig => ({
  storeDir,
  corpusRoot,
  stackRoot,
  principalId: ownerPrincipalId as string,
  principalName: ownerName,
  repositoryId: 'aera-repo:aera-stack',
  workspaceRoot: gitDir,
  // The agent plane: a recorded delegation from the owner. Nothing is minted
  // silently, and the agent never becomes the sender of a person's message.
  delegationId: 'delegation-test-1',
  agentName: 'TEST Execution Child',
  agentRole: 'IMPLEMENTER',
})

async function joined(): Promise<CollabWorkspaceService> {
  const service = new CollabWorkspaceService(config())
  await service.openAgentWorkContext(TEST_WO)
  return service
}

beforeAll(() => {
  const base = mkdtempSync(join(tmpdir(), 'aera-coordination-test-'))
  storeDir = join(base, 'participation-store')
  corpusRoot = join(base, 'corpus')
  stackRoot = join(base, 'stack')
  gitDir = join(base, 'worktree')
  for (const root of [corpusRoot, stackRoot, gitDir]) mkdirSync(root, { recursive: true })
  const seedRepo = (root: string, name: string): void => {
    writeFileSync(join(root, 'README.md'), `# synthetic TEST ${name}\n`)
    execFileSync('git', ['-C', root, 'init', '-q'])
    execFileSync('git', ['-C', root, 'add', 'README.md'])
    execFileSync('git', ['-C', root, '-c', 'user.email=test@example.invalid', '-c', 'user.name=TEST', 'commit', '-qm', 'test: seed'])
  }
  seedRepo(corpusRoot, 'corpus')
  seedRepo(stackRoot, 'stack')
  seedRepo(gitDir, 'worktree')

  const store = new ParticipationStore(storeDir)
  store.registerHumanParticipant({ principalId: ownerPrincipalId, displayName: ownerName })
  store.registerWorkOrder({
    workOrderId: TEST_WO,
    title: 'TEST coordination order',
    exactPayload: 'AERA-WORK-ORDER-STANDARD-003 v3.0\n\nTEST\n',
    authorityClass: 'OWNER_SUPPLIED',
    lifecycleStatus: 'ACTIVE',
    owner: { principalId: ownerPrincipalId, displayName: ownerName },
    source: { nativeSessionId: 's', messageId: 'm', eventSequence: 1, submittedAt: new Date().toISOString() },
  })
})

describe('coordination writes require real authority', () => {
  it('joins on demand — a thread opens from a surface that never joined', async () => {
    /*
     * THE REGRESSION THIS PINS was found by mechanical GUI acceptance, not by
     * this suite: the Read-First surface projects a Work Order WITHOUT joining
     * it, so every coordination control was visible, reachable, and refused
     * with "No agent WorkContext is open" the moment it was pressed. The
     * earlier version of this test asserted that refusal and called it correct,
     * which is why the suite stayed green through a feature that did not work.
     *
     * A service that has never joined must now be able to write, because an
     * explicit POST is already a mutation and the session it implies is as
     * authorised as the message it carries.
     */
    const service = new CollabWorkspaceService(config())
    const opened = await service.openCoordinationThread({
      subject: 'Opened without a prior join', workOrderId: TEST_WO,
    })
    expect(opened.outcome).toBe('RECORDED')
    expect(opened.threadId).toMatch(/^aera:collab-thread:/)
  })

  it('refuses without a store rather than inventing one', async () => {
    const { storeDir: _omitted, ...withoutStore } = config()
    const service = new CollabWorkspaceService(withoutStore)
    await expect(service.openCoordinationThread({ subject: 'Overlap' }))
      .rejects.toMatchObject({ code: 'STORE_UNAVAILABLE' })
  })

  it('refuses to send without a canonical human principal — a sender is never invented', async () => {
    const { principalId: _omitted, ...withoutPrincipal } = config()
    const service = new CollabWorkspaceService(withoutPrincipal)
    await expect(service.openAgentWorkContext(TEST_WO)).rejects.toMatchObject({ code: 'AGENT_UNAVAILABLE' })
  })
})

describe('§9/§10 — a person sends, and the agent that carried it is not the sender', () => {
  it('records the human as sender and the agent as recorder', async () => {
    const service = await joined()
    const { threadId } = await service.openCoordinationThread({ subject: 'Authentication overlap' })
    const posted = await service.postCoordinationMessage({
      threadId, body: 'Three of your changes touch the authentication contract.', requestId: 'desk-1',
    })
    expect(posted.outcome).toBe('RECORDED')
    expect(posted.sequence).toBe(1)

    const store = new ParticipationStore(storeDir)
    const message = store.listCollabMessages(threadId as `aera:collab-thread:${string}`)[0]
    // §10: the PERSON is the sender. The kind comes from the registry, not the caller.
    expect(message?.sender.principalId).toBe(ownerPrincipalId)
    expect(message?.sender.principalKind).toBe('HUMAN')
    // §31/§49: the agent session typed it in, and the record says so.
    expect(message?.contribution.recordedBy).not.toBe(ownerPrincipalId)
  })

  it('§31 — a retried send is the same message, not a second one', async () => {
    const service = await joined()
    const { threadId } = await service.openCoordinationThread({ subject: 'Retry subject' })
    const first = await service.postCoordinationMessage({ threadId, body: 'once', requestId: 'retry-desk' })
    const again = await service.postCoordinationMessage({ threadId, body: 'once', requestId: 'retry-desk' })
    expect(again.outcome).toBe('IDEMPOTENT')
    expect(again.messageId).toBe(first.messageId)
    expect(new ParticipationStore(storeDir)
      .listCollabMessages(threadId as `aera:collab-thread:${string}`)).toHaveLength(1)
  })
})

describe('§35 — the surface projects threads, and reading them writes nothing', () => {
  it('threads appear on the Collab view with a Messages rail count', async () => {
    const service = await joined()
    const { threadId } = await service.openCoordinationThread({ subject: 'Visible on the surface' })
    await service.postCoordinationMessage({ threadId, body: 'A message to draw.', requestId: 'draw-1' })

    const view = await service.collabView({ workOrderId: TEST_WO })
    const thread = view.threads.find(row => row.subject === 'Visible on the surface')
    expect(thread).toBeDefined()
    expect(thread?.messages[0]?.body).toBe('A message to draw.')
    expect(thread?.messages[0]?.principalKind).toBe('HUMAN')
    // §40: a human's message carries no agent-analysis banner.
    expect(thread?.messages[0]?.authorshipNote).toBeUndefined()
    expect(thread?.aboutLine).toContain(TEST_WO)
    const rail = view.rail.find(tab => tab.section === 'COORDINATION')
    expect(rail?.count).toBe(view.threads.length)
    // §30/§55: the surface states plainly that delivery is durable, not live.
    expect(view.coordinationDeliveryNote).toContain('not pushed live yet')
  })

  it('§48 — projecting the surface leaves every durable record byte-identical', async () => {
    const service = await joined()
    const { threadId } = await service.openCoordinationThread({ subject: 'Read-only proof' })
    await service.postCoordinationMessage({ threadId, body: 'Written before the read.', requestId: 'read-1' })

    const snapshot = (): Record<string, string> => Object.fromEntries(
      STORE_RECORD_FILES.map((file) => {
        try {
          return [file, readFileSync(join(storeDir, file), 'utf8')]
        } catch {
          return [file, '<absent>']
        }
      }),
    )
    const before = snapshot()
    await service.collabView({ workOrderId: TEST_WO })
    await service.collabView({ workOrderId: TEST_WO })
    expect(snapshot()).toEqual(before)
  })
})

describe('§33 — archive hides a thread from the active surface and erases nothing', () => {
  it('archives, refuses new messages, and reopens intact', async () => {
    const service = await joined()
    const { threadId } = await service.openCoordinationThread({ subject: 'Archivable' })
    await service.postCoordinationMessage({ threadId, body: 'Said before archiving.', requestId: 'arch-1' })

    await service.setCoordinationThreadLifecycle({ threadId, lifecycle: 'ARCHIVED' })
    const archived = (await service.collabView({ workOrderId: TEST_WO }))
      .threads.find(row => row.subject === 'Archivable')
    expect(archived?.archived).toBe(true)
    expect(archived?.messages).toHaveLength(1)

    await expect(service.postCoordinationMessage({
      threadId, body: 'After archive.', requestId: 'arch-2',
    })).rejects.toThrow(/archived/)

    await service.setCoordinationThreadLifecycle({ threadId, lifecycle: 'ACTIVE' })
    const reopened = (await service.collabView({ workOrderId: TEST_WO }))
      .threads.find(row => row.subject === 'Archivable')
    expect(reopened?.archived).toBe(false)
    expect(reopened?.messages).toHaveLength(1)
  })
})

describe('§13/§14 — a decision is recorded explicitly, or not at all', () => {
  it('records a canonical DecisionV1 that cites the thread, and links it back', async () => {
    const service = await joined()
    const { threadId } = await service.openCoordinationThread({ subject: 'Decide something' })
    const message = await service.postCoordinationMessage({
      threadId, body: 'Option A is safer.', requestId: 'dec-1',
    })

    const { decisionId } = await service.recordDecisionFromThread({
      threadId,
      subject: 'Authentication contract change',
      options: [
        { optionId: 'A', label: 'Leave the contract alone' },
        { optionId: 'B', label: 'Widen the contract' },
      ],
      selectedOptionId: 'A',
      rationale: 'Two of the three overlaps are already superseded.',
      messageIds: [message.messageId],
    })

    const store = new ParticipationStore(storeDir)
    const decision = store.listDecisions(TEST_WO).find(row => row.decisionId === decisionId)
    // §49: the canonical model, not a parallel chat decision.
    expect(decision?.decisionVersion).toBe('DecisionV1')
    expect(decision?.threadId).toBe(threadId)
    expect(decision?.messageIds).toEqual([message.messageId])
    // §49/§31: the person decided; the agent session recorded.
    expect(decision?.contribution.performedBy).toBe(ownerPrincipalId)
    expect(decision?.contribution.recordedBy).not.toBe(ownerPrincipalId)
    // The reverse edge, so the thread can say a decision came out of it.
    const thread = store.listCollabThreads(TEST_WO).find(row => row.threadId === threadId)
    expect(thread?.decisionIds).toContain(decisionId)
  })

  it('§14 — casual agreement in a thread creates no decision whatsoever', async () => {
    const service = await joined()
    const { threadId } = await service.openCoordinationThread({ subject: 'No decision here' })
    const before = new ParticipationStore(storeDir).listDecisions(TEST_WO).length
    for (const [index, body] of ['yeah that sounds good', 'agreed', 'lgtm, ship it'].entries()) {
      await service.postCoordinationMessage({ threadId, body, requestId: `casual-desk-${String(index)}` })
    }
    expect(new ParticipationStore(storeDir).listDecisions(TEST_WO)).toHaveLength(before)
  })
})

describe('§41 — no model call anywhere on this path', () => {
  it('opening, sending and projecting make zero network calls', async () => {
    const spy = vi.fn()
    const original = globalThis.fetch
    globalThis.fetch = spy as unknown as typeof fetch
    try {
      const service = await joined()
      const { threadId } = await service.openCoordinationThread({ subject: 'No model call' })
      await service.postCoordinationMessage({ threadId, body: 'Nothing calls a model.', requestId: 'model-1' })
      await service.collabView({ workOrderId: TEST_WO })
      expect(spy).not.toHaveBeenCalled()
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('§21 — sharing a comparison that does not exist is refused, not fabricated', () => {
  it('refuses with a stated reason when no Compare has been computed', async () => {
    const service = await joined()
    await expect(service.shareComparePacket()).rejects.toMatchObject({ code: 'COMPARE_UNAVAILABLE' })
  })
})

describe('§20 — a packet that is not in the store is refused honestly', () => {
  it('names what is missing rather than returning an empty assessment', async () => {
    const service = await joined()
    expect(() => service.assessPacket('aera:coordination-packet:nope'))
      .toThrow(/No packet aera:coordination-packet:nope/)
  })
})
