/**
 * Institutional orientation + Work Order state reconciliation —
 * WO-AERA-COLLAB-INSTITUTIONAL-ORIENTATION-AND-WORKORDER-STATE-RECONCILIATION-001.
 *
 * §34 REAL FAILURE REGRESSION. The owner opened a fresh Aera Code Session
 * rooted at a neutral directory, with no inherited conversation, no Work Order,
 * no repository and no PR, and asked "What am I currently working on, where is
 * it up to, and what should happen next?".
 *
 * What it received was the JOINED-Work-Order snapshot for an assessment that
 * had been finished days earlier — because the collaboration service is a
 * per-PROCESS singleton and the app process was warm: an EARLIER Session had
 * joined that Work Order, and `resumeAgentWorkContextForNativeSession` returned
 * the process's joined order without ever comparing the native Session id it
 * was handed. The model then reconstructed historical evidence and advised
 * merging a PR that was by then already merged.
 *
 * These tests pin the corrected seams against the REAL service and store:
 *
 *   1. a warm process holding another Session's joined Work Order hands a NEW
 *      Session the orientation frontier, not the stale order;
 *   2. a cold process produces the SAME frontier — orientation does not depend
 *      on process lifetime;
 *   3. a Session that genuinely joined a Work Order still gets that exact Work
 *      Order (joined work is not overridden by recency);
 *   4. recently COMPLETED work is reported as recent but not as unfinished;
 *   5. historical "PR opened" evidence plus live "PR merged" provider state
 *      produces truthful CURRENT orientation.
 *
 * No Work Order ID is hard-coded into the expectations: the fixture makes the
 * ordering and lifecycle deterministic and the assertions read it back.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { beforeAll, describe, expect, it } from 'vitest'
import { ParticipationStore } from '@aera/participation-runtime'
import { issueAeraPrincipalId } from '@aera/cis-contracts'
import { attributeChange, repositoryId } from '@aera/participation-contracts'
import { CollabWorkspaceService } from '../src/aera-collab-service.ts'

/** The order worked on FIRST and since completed — the "just finished" work. */
const COMPLETED_WO = 'WO-TEST-ORIENT-COMPLETED-001'
/** The older order that remains the unfinished, resumable programme work. */
const RESUMABLE_WO = 'WO-TEST-ORIENT-RESUMABLE-001'
/** The order that authorises state reconciliation in this fixture. */
const AUTHORISING_WO = 'WO-TEST-ORIENT-AUTHORITY-001'
/** The native Session that joined COMPLETED_WO in the warm process. */
const EARLIER_SESSION = 'test-native-session-earlier'
/** A brand-new Session, exactly like the owner's fresh Desktop Session. */
const FRESH_SESSION = 'test-native-session-fresh'

const humanPrincipalId = issueAeraPrincipalId()
const AGENT_NAME = 'TEST Orientation Worker'
const DELEGATION_ID = 'delegation-TEST-orientation-001'

const payload = (id: string): string => [
  'AERA-WORK-ORDER-STANDARD-003 v3.0',
  '',
  `WORK ORDER: ${id}`,
  'TITLE: Orientation regression order',
  'OWNER: Alyshia Daley',
  '',
  'END OWNER ORDER.',
].join('\n')

let storeDir: string
let corpusRoot: string
let stackRoot: string
/** A git-less neutral directory, exactly like /Users/<owner>/Desktop. */
let neutralWorkspace: string
let blockerEventId: string

function seedRepo(root: string, remoteUrl?: string): void {
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'README.md'), '# synthetic TEST root\n')
  execFileSync('git', ['-C', root, 'init', '-q'])
  execFileSync('git', ['-C', root, 'add', 'README.md'])
  execFileSync('git', ['-C', root, '-c', 'user.email=test@example.invalid', '-c', 'user.name=TEST', 'commit', '-qm', 'test: seed'])
  if (remoteUrl !== undefined) execFileSync('git', ['-C', root, 'remote', 'add', 'origin', remoteUrl])
}

function service(overrides: { runProvider?: (args: readonly string[]) => string } = {}): CollabWorkspaceService {
  return new CollabWorkspaceService({
    storeDir,
    corpusRoot,
    stackRoot,
    workspaceRoot: neutralWorkspace,
    principalId: humanPrincipalId as string,
    principalName: 'Alyshia Daley',
    agentName: AGENT_NAME,
    agentRole: 'IMPLEMENTER',
    delegationId: DELEGATION_ID,
    // The owner's failing run had NO AERA_COLLAB_REPOSITORY_ID.
  }, overrides.runProvider === undefined ? {} : { runProvider: overrides.runProvider })
}

beforeAll(async () => {
  const base = mkdtempSync(join(tmpdir(), 'aera-collab-orientation-'))
  storeDir = join(base, 'participation-store')
  corpusRoot = join(base, 'corpus')
  stackRoot = join(base, 'stack')
  neutralWorkspace = join(base, 'Desktop')
  seedRepo(corpusRoot)
  seedRepo(stackRoot)
  mkdirSync(neutralWorkspace, { recursive: true })

  const store = new ParticipationStore(storeDir)
  for (const [id, nativeSessionId] of [
    [AUTHORISING_WO, 'test-native-session-authority'],
    [RESUMABLE_WO, 'test-native-session-resumable'],
    [COMPLETED_WO, EARLIER_SESSION],
  ] as const) {
    store.registerWorkOrder({
      workOrderId: id,
      title: `Orientation regression order ${id}`,
      exactPayload: payload(id),
      authorityClass: 'OWNER_SUPPLIED',
      lifecycleStatus: 'ACTIVE',
      owner: { principalId: humanPrincipalId, displayName: 'Alyshia Daley' },
      source: { nativeSessionId, messageId: `message-${id}`, eventSequence: 1, submittedAt: new Date().toISOString() },
    })
  }

  const seed = service()
  // Repository identity, registered through the canonical authority path.
  const joined = await seed.openAgentWorkContext(AUTHORISING_WO, 'test-native-session-authority')
  store.registerRepositoryResource({
    sessionId: joined.sessionId,
    authorisingWorkOrderId: AUTHORISING_WO,
    repositoryId: repositoryId('test-stack'),
    displayName: 'TEST Stack',
    provider: { provider: 'github', owner: 'test-owner', name: 'test-stack' },
    canonicalRemote: 'https://github.com/test-owner/test-stack.git',
    canonicalBranch: 'dev',
    verification: 'GIT_REMOTE_VERIFIED',
  })
  for (const workOrderId of [COMPLETED_WO, RESUMABLE_WO]) {
    store.bindWorkOrderRepository({
      sessionId: joined.sessionId,
      authorisingWorkOrderId: AUTHORISING_WO,
      workOrderId,
      repositoryId: repositoryId('test-stack'),
      role: 'PRIMARY',
    })
  }

  // Deterministic activity ordering: the resumable order was worked on FIRST,
  // then the completed order — so the completed one is the most RECENT work
  // while the resumable one is the older unfinished work (§8's exact shape).
  const record = async (workOrderId: string, summary: string) => {
    const s = service()
    await s.openAgentWorkContext(workOrderId, `seed-${workOrderId}`)
    await s.agentRecordProgressNote(summary)
    await s.closeAgentWorkContext()
  }
  await record(RESUMABLE_WO, 'Opened the resumable programme work; implementation in progress.')
  await record(COMPLETED_WO, 'Historical evidence: PR #593 opened against dev for this assessment.')

  // The completed order is closed through the authority-safe state seam.
  store.recordWorkOrderState({
    sessionId: joined.sessionId,
    authorisingWorkOrderId: AUTHORISING_WO,
    workOrderId: COMPLETED_WO,
    lifecycleState: 'COMPLETED',
    evidence: 'PR #593 merged as 206b26ee0; independent review verdict banked; '
      + 'extensive historical receipt '.repeat(1_000),
  })
  const blocked = await seed.openAgentWorkContext(RESUMABLE_WO, 'test-native-session-resumable')
  const blockedSession = store.getSession(blocked.sessionId)
  if (blockedSession === undefined) throw new Error('blocked fixture session missing')
  const blockerEvent = store.appendEvent({
    eventKind: 'BREAK_REPORTED',
    workOrderId: RESUMABLE_WO,
    attribution: attributeChange({ session: blockedSession, workOrderId: RESUMABLE_WO }),
    summary: 'Owner login is required before the next authorised step can run.',
  })
  blockerEventId = blockerEvent.eventId
  const authority = service()
  const authorityJoin = await authority.openAgentWorkContext(AUTHORISING_WO, 'test-native-session-authority-active-state')
  store.recordWorkOrderState({
    sessionId: authorityJoin.sessionId,
    authorisingWorkOrderId: AUTHORISING_WO,
    workOrderId: RESUMABLE_WO,
    lifecycleState: 'ACTIVE',
    evidence: 'Active reconciliation recorded after the blocker; it does not itself repair the blocker.',
  })
  await authority.closeAgentWorkContext()
  await seed.closeAgentWorkContext()
})

describe('§34 — the real fresh-Desktop-Session failure', () => {
  it('a WARM process holding another Session\'s joined Work Order gives a NEW Session orientation, not the stale order', async () => {
    const warm = service()
    // An earlier Session in this process joined the (now completed) order —
    // exactly the state the owner's app was in.
    const earlier = await warm.resumeAgentWorkContextForNativeSession(EARLIER_SESSION)
    expect(earlier?.workOrderId).toBe(COMPLETED_WO)

    // A brand-new Session in the SAME process. Before the repair this returned
    // the process's joined Work Order and injected its joined-WO snapshot.
    const fresh = await warm.resumeAgentWorkContextForNativeSession(FRESH_SESSION)
    expect(fresh).toBeUndefined()

    const text = await warm.agentOrientationContext()
    expect(text).toContain('No Work Order is joined in this Session.')
    expect(text).toContain(RESUMABLE_WO)
    await warm.closeAgentWorkContext()
  })

  it('a COLD process produces the same orientation frontier — orientation does not depend on process lifetime', async () => {
    const warm = service()
    await warm.resumeAgentWorkContextForNativeSession(EARLIER_SESSION)
    const warmText = await warm.agentOrientationContext()
    await warm.closeAgentWorkContext()

    const cold = service()
    expect(await cold.resumeAgentWorkContextForNativeSession(FRESH_SESSION)).toBeUndefined()
    const coldText = await cold.agentOrientationContext()
    expect(coldText).toBe(warmText)
  })

  it('a Session that genuinely joined a Work Order still receives that exact Work Order', async () => {
    const subject = service()
    await subject.openAgentWorkContext(RESUMABLE_WO, FRESH_SESSION)
    const resumed = await subject.resumeAgentWorkContextForNativeSession(FRESH_SESSION)
    expect(resumed?.workOrderId).toBe(RESUMABLE_WO)
    const joinedSnapshot = await subject.agentInstitutionalContext()
    expect(joinedSnapshot).toContain(`Current canonical Work Order: ${RESUMABLE_WO}`)
    // …and a DIFFERENT Session in the same process is still unjoined.
    expect(await subject.resumeAgentWorkContextForNativeSession('some-other-session')).toBeUndefined()
    await subject.closeAgentWorkContext()
  })

  it('recently completed work is reported as recent but NOT as current unfinished work', async () => {
    const subject = service()
    const text = await subject.agentOrientationContext() ?? ''
    const resumableSection = text.slice(text.indexOf('Current / resumable work'), text.indexOf('Recently completed'))
    const completedSection = text.slice(text.indexOf('Recently completed'))
    expect(resumableSection).toContain(RESUMABLE_WO)
    expect(resumableSection).not.toContain(COMPLETED_WO)
    expect(completedSection).toContain(COMPLETED_WO)
    expect(completedSection).toContain('closure evidence: recorded; retrieve on demand')
    expect(completedSection).not.toContain('PR #593 merged as 206b26ee0')
    // The immutable admission still says ACTIVE; only the projection moved.
    const store = new ParticipationStore(storeDir)
    expect(store.listWorkOrders().find(row => row.workOrderId === COMPLETED_WO)?.lifecycleStatus).toBe('ACTIVE')
    expect(store.effectiveWorkOrderState(COMPLETED_WO)?.lifecycleState).toBe('COMPLETED')
  })

  it('keeps closure evidence and repository detail lazy in a bounded cold-orientation snapshot', async () => {
    const subject = service()
    const text = await subject.agentOrientationContext() ?? ''
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(2_500)
    expect(text).toContain('closure evidence: recorded; retrieve on demand')
    expect(text).not.toContain('PR #593 merged as 206b26ee0')
    expect(text).not.toContain('github:test-owner/test-stack')
    expect(text).toContain('Answer this orientation question directly from the frontier without calling collaboration tools when it contains enough facts.')
    expect(text).toContain('current blocker: Owner login is required before the next authorised step can run.')

    const repairService = service()
    const joined = await repairService.openAgentWorkContext(RESUMABLE_WO, 'test-native-session-repair')
    const store = new ParticipationStore(storeDir)
    const repairSession = store.getSession(joined.sessionId)
    if (repairSession === undefined) throw new Error('repair fixture session missing')
    store.appendEvent({
      eventKind: 'REPAIR_RECORDED',
      workOrderId: RESUMABLE_WO,
      attribution: attributeChange({ session: repairSession, workOrderId: RESUMABLE_WO }),
      summary: 'An unrelated repair was recorded.',
    })
    expect(await repairService.agentOrientationContext()).toContain('current blocker: Owner login is required')
    store.appendEvent({
      eventKind: 'REPAIR_RECORDED',
      workOrderId: RESUMABLE_WO,
      attribution: attributeChange({ session: repairSession, workOrderId: RESUMABLE_WO }),
      summary: 'Owner login completed; blocker cleared.',
      repairsEventId: blockerEventId,
    })
    expect(await repairService.agentOrientationContext()).not.toContain('current blocker:')
    store.appendEvent({
      eventKind: 'BREAK_REPORTED',
      workOrderId: RESUMABLE_WO,
      attribution: attributeChange({ session: repairSession, workOrderId: RESUMABLE_WO }),
      summary: 'Owner login is required before the next authorised step can run.',
    })
    await repairService.closeAgentWorkContext()
  })

  it('does not let a dirty unrelated checkout change institutional orientation', async () => {
    const subject = service()
    const before = await subject.agentOrientationContext()
    writeFileSync(join(neutralWorkspace, 'unrelated-owner-file.txt'), 'dirty but unrelated\n')
    expect(await subject.agentOrientationContext()).toBe(before)
  })

  it('orientation grants no execution authority and never infers a repository from the neutral workspace', async () => {
    const subject = service()
    const text = await subject.agentOrientationContext() ?? ''
    expect(text).toContain('grants no authority to write, merge or deploy')
    expect(text).toContain('Never infer a Work Order or a repository from the workspace path or name.')
    expect(text).not.toContain(neutralWorkspace)
    // Orientation did not join anything: the write tools still refuse.
    await expect(subject.agentRecordProgressNote('should not be possible')).rejects.toThrow()
  })

  it('historical "PR opened" evidence plus live "PR merged" state yields truthful CURRENT orientation', async () => {
    const subject = service({
      runProvider: (args) => {
        // Repository-qualified against the EXACT provider repository.
        expect(args.join(' ')).toContain('test-owner/test-stack')
        return JSON.stringify({
          number: 593,
          state: 'MERGED',
          mergeCommit: { oid: '206b26ee0609633e9cd15b5dfccf9a042d0290d4' },
          mergedAt: '2026-09-16T08:05:21Z',
          baseRefName: 'dev',
          headRefName: 'codex/assessment',
          url: 'https://github.com/test-owner/test-stack/pull/593',
        })
      },
    })
    await subject.openAgentWorkContext(COMPLETED_WO, FRESH_SESSION)
    // The recorded evidence still says what was true THEN.
    const packet = await subject.agentContextPacket()
    expect(JSON.stringify(packet)).toContain('PR #593 opened')
    // The provider says what is true NOW, repository-qualified.
    const live = await subject.agentResolveRepositoryResource({ pullRequestNumber: 593 })
    expect(live.resolution).toBe('RESOLVED')
    expect(live.repository?.repositoryId).toBe('aera-repo:test-stack')
    const liveState = live.liveState
    // Narrowed deliberately: an unavailable provider is a DIFFERENT shape that
    // carries no state at all, and must never be read as though it did.
    expect(liveState?.kind).toBe('LIVE_PROVIDER_STATE')
    if (liveState?.kind !== 'LIVE_PROVIDER_STATE') throw new Error('expected live provider state')
    expect(liveState.state).toBe('MERGED')
    expect(liveState.mergeCommit).toContain('206b26ee0')
    await subject.closeAgentWorkContext()
  })

  it('provider failure keeps canonical repository identity and reports live state unavailable', async () => {
    const subject = service({
      runProvider: () => { throw new Error('gh unavailable in this environment') },
    })
    await subject.openAgentWorkContext(COMPLETED_WO, FRESH_SESSION)
    const result = await subject.agentResolveRepositoryResource({ pullRequestNumber: 593 })
    expect(result.repository?.repositoryId).toBe('aera-repo:test-stack')
    expect(result.liveState?.kind).toBe('LIVE_PROVIDER_STATE_UNAVAILABLE')
    await subject.closeAgentWorkContext()
  })
})
