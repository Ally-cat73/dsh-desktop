/**
 * CollabWorkspaceService tests — WO-AGC-002 Remit C (desktop retarget).
 *
 * Ported from the remit A consumer tests, including the remit B adversarial
 * source-access review tests. Deterministic TEST participant throughout
 * (labelled TEST, §15). Uses a disposable store directory and a tiny
 * synthetic corpus/stack — no shared infrastructure, no provider call, no
 * network.
 */
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { beforeAll, describe, expect, it } from 'vitest'
import { ParticipationStore } from '@aera/participation-runtime'
import { issueAeraPrincipalId } from '@aera/cis-contracts'
import {
  CollabHonestError,
  CollabWorkspaceService,
  resolveCollabConfig,
  type CollabWorkspaceConfig,
} from '../src/aera-collab-service.ts'

const TEST_WO = 'WO-TEST-COLLAB-CONSUMER-002'
const principalId = issueAeraPrincipalId()
const principalName = 'TEST Native Workspace User'

let storeDir: string
let corpusRoot: string
let stackRoot: string
let gitDir: string

const config = (): CollabWorkspaceConfig => ({
  storeDir,
  corpusRoot,
  stackRoot,
  principalId: principalId as string,
  principalName,
  repositoryId: 'aera-repo:aera-stack',
  workspaceRoot: gitDir,
})

const without = (key: keyof CollabWorkspaceConfig): CollabWorkspaceConfig => {
  const { [key]: _omitted, ...rest } = config()
  return rest
}

beforeAll(() => {
  const base = mkdtempSync(join(tmpdir(), 'aera-collab-test-'))
  storeDir = join(base, 'participation-store')
  corpusRoot = join(base, 'corpus')
  stackRoot = join(base, 'stack')
  gitDir = join(base, 'worktree')
  mkdirSync(corpusRoot, { recursive: true })
  mkdirSync(stackRoot, { recursive: true })
  mkdirSync(gitDir, { recursive: true })
  // The graph scans the Git index, never the filesystem — synthetic roots
  // must be committed git repositories.
  const seedRepo = (root: string, name: string): void => {
    writeFileSync(join(root, 'README.md'), `# synthetic TEST ${name}\n`)
    execFileSync('git', ['-C', root, 'init', '-q'])
    execFileSync('git', ['-C', root, 'add', 'README.md'])
    execFileSync('git', ['-C', root, '-c', 'user.email=test@example.invalid', '-c', 'user.name=TEST', 'commit', '-qm', 'test: seed'])
  }
  seedRepo(corpusRoot, 'corpus')
  seedRepo(stackRoot, 'stack')
  execFileSync('git', ['-C', gitDir, 'init', '-q'])
  writeFileSync(join(gitDir, 'file.txt'), 'observed\n')
  execFileSync('git', ['-C', gitDir, 'add', 'file.txt'])
  execFileSync('git', ['-C', gitDir, '-c', 'user.email=test@example.invalid', '-c', 'user.name=TEST', 'commit', '-qm', 'test: seed'])

  // Register the canonical TEST Work Order through the established owner.
  const store = new ParticipationStore(storeDir)
  store.registerWorkOrder({ workOrderId: TEST_WO, title: 'TEST canonical work order' })
})

describe('resolveCollabConfig', () => {
  it('treats empty env values as absent', () => {
    const resolved = resolveCollabConfig({ AERA_COLLAB_STORE_DIR: ' ' }, undefined)
    expect(resolved.storeDir).toBeUndefined()
  })
})

describe('honest failure modes (§15 item 9)', () => {
  it('refuses without a store instead of inventing one', async () => {
    const service = new CollabWorkspaceService(without('storeDir'))
    await expect(service.openWorkContext(TEST_WO)).rejects.toMatchObject({ code: 'STORE_UNAVAILABLE' })
  })

  it('refuses without a canonical principal instead of inventing one', async () => {
    const service = new CollabWorkspaceService({ ...config(), principalId: 'not-a-principal' })
    await expect(service.openWorkContext(TEST_WO)).rejects.toMatchObject({ code: 'PRINCIPAL_UNAVAILABLE' })
  })

  it('refuses an unknown WorkOrderId rather than creating it', async () => {
    const service = new CollabWorkspaceService(config())
    await expect(service.openWorkContext('WO-TEST-DOES-NOT-EXIST-999')).rejects.toMatchObject({
      code: 'WORK_ORDER_NOT_FOUND',
    })
  })

  it('refuses evidence references to nodes that do not exist', async () => {
    const service = new CollabWorkspaceService(config())
    await service.openWorkContext(TEST_WO)
    await expect(service.attachEvidenceReference('ewg:nope', 'x')).rejects.toMatchObject({
      code: 'EVIDENCE_NOT_FOUND',
    })
    await service.closeWorkContext()
  })

  it('refuses source access outside the authorised roots (§10)', () => {
    const service = new CollabWorkspaceService(config())
    expect(() => service.resolveSourcePathToLocal('/etc/passwd')).toThrow(CollabHonestError)
    expect(() => service.resolveSourcePathToLocal('Aera_Studios_Docs/../../../etc/passwd')).toThrow(
      CollabHonestError,
    )
    expect(() => service.resolveSourcePathToLocal('some-other-root/file.md')).toThrow(CollabHonestError)
  })

  it('resolves an authorised corpus source to its local path', () => {
    const service = new CollabWorkspaceService(config())
    const local = service.resolveSourcePathToLocal('Aera_Studios_Docs/README.md')
    expect(local.endsWith('README.md')).toBe(true)
  })
})

describe('§5 slice A–H at the adapter level', () => {
  it('opens the registered Work Order, shows the TEST participant honestly, and observes working state', async () => {
    const service = new CollabWorkspaceService(config())
    const view = await service.openWorkContext(TEST_WO)
    expect(view.workOrderId).toBe(TEST_WO)
    expect(view.authorityMode).toBe('RECORDED_NOT_ENFORCED')
    expect(view.authorityModeNote).toBe('(recorded, not enforced)')

    const me = view.participants.find(p => p.displayName === principalName)
    expect(me).toBeDefined()
    expect(me?.statusLine).toContain('does not prove a live process')

    expect(view.workingState).toBeDefined()
    expect(view.workingState?.repositoryId).toBe('aera-repo:aera-stack')
    expect(view.workingState?.headRevision).toMatch(/^[0-9a-f]{40}$/)
    expect(view.workingState?.note).toContain('not an immutable historical object')

    expect(view.executionActions[0]?.state).toBe('UNAVAILABLE')
    await service.closeWorkContext()
  })

  it('reports working state unavailable without a stable RepositoryId (§7)', () => {
    const service = new CollabWorkspaceService(without('repositoryId'))
    const observed = service.observeWorkingState()
    expect(observed.view).toBeUndefined()
    expect(observed.unavailableReason).toContain('never minted from a local path')
  })

  it('records a progress note that survives close and reopen, visible to a second service (§5F/G/H)', async () => {
    const service = new CollabWorkspaceService(config())
    await service.openWorkContext(TEST_WO)
    const note = await service.recordProgressNote('TEST bounded progress note — desktop slice')
    expect(note.eventId).toMatch(/^pevent-/)
    expect(note.attributed).toBe(false) // HUMAN session without delegation → honest UNATTRIBUTED
    await service.closeWorkContext()

    // Second, independently constructed consumer over the same durable store.
    const second = new CollabWorkspaceService(config())
    const view = await second.openWorkContext(TEST_WO)
    expect(view.workOrderId).toBe(TEST_WO)
    const store = new ParticipationStore(storeDir)
    const events = store.listEvents()
    expect(events.some(e => e.summary.includes('TEST bounded progress note'))).toBe(true)
    // The first service's closed session is durable and reported Ended, never live.
    const sessions = store.listSessions().filter(s => s.workOrderId === TEST_WO)
    expect(sessions.some(s => s.endedAt !== undefined)).toBe(true)
    await second.closeWorkContext()
  })
})

describe('§10 source-access confinement (remit B adversarial review, carried over)', () => {
  let reviewCorpus: string
  let reviewStack: string
  let reviewStore: string
  let outsideDir: string

  beforeAll(() => {
    const base = mkdtempSync(join(tmpdir(), 'aera-collab-review-'))
    reviewCorpus = join(base, 'corpus')
    reviewStack = join(base, 'stack')
    reviewStore = join(base, 'store')
    outsideDir = join(base, 'outside')
    for (const dir of [reviewCorpus, reviewStack, reviewStore, outsideDir]) mkdirSync(dir, { recursive: true })
    writeFileSync(join(outsideDir, 'secret.txt'), 'PROTECTED\n')
    writeFileSync(join(reviewCorpus, 'ok.md'), 'fine\n')
    // A symlink INSIDE the corpus pointing OUTSIDE it.
    symlinkSync(join(outsideDir, 'secret.txt'), join(reviewCorpus, 'escape.md'))
    // A symlinked directory inside the corpus pointing outside.
    symlinkSync(outsideDir, join(reviewCorpus, 'linkdir'))
  })

  const reviewService = (): CollabWorkspaceService =>
    new CollabWorkspaceService({ corpusRoot: reviewCorpus, stackRoot: reviewStack, storeDir: reviewStore })

  it('refuses a symlinked FILE that escapes the corpus root', () => {
    expect(() => reviewService().resolveSourcePathToLocal('Aera_Studios_Docs/escape.md')).toThrow(
      CollabHonestError,
    )
  })

  it('refuses a path through a symlinked DIRECTORY escaping the corpus root', () => {
    expect(() =>
      reviewService().resolveSourcePathToLocal('Aera_Studios_Docs/linkdir/secret.txt'),
    ).toThrow(CollabHonestError)
  })

  it('still resolves a legitimate corpus file', () => {
    expect(reviewService().resolveSourcePathToLocal('Aera_Studios_Docs/ok.md').endsWith('ok.md')).toBe(
      true,
    )
  })

  it('refuses null-byte and encoded traversal inputs', () => {
    expect(() => reviewService().resolveSourcePathToLocal('Aera_Studios_Docs/a /../x')).toThrow(
      CollabHonestError,
    )
    expect(() => reviewService().resolveSourcePathToLocal('..')).toThrow(CollabHonestError)
    expect(() => reviewService().resolveSourcePathToLocal('participation-store/../corpus/ok.md')).toThrow(
      CollabHonestError,
    )
  })

  it('refuses store-prefixed access when no store is configured', () => {
    const svc = new CollabWorkspaceService({ corpusRoot: reviewCorpus, stackRoot: reviewStack })
    expect(() => svc.resolveSourcePathToLocal('participation-store/events.json')).toThrow(
      CollabHonestError,
    )
  })
})
