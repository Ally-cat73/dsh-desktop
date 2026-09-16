/**
 * Repository resource identity — WO-AERA-COLLAB-STABLE-REPOSITORY-RESOURCE-IDENTITY-001.
 *
 * Proves, against the REAL `CollabWorkspaceService` + `ParticipationStore`
 * (disposable directory, synthetic corpus, real git checkouts), that:
 *
 *   * a Work Order's canonical repository binding is sufficient repository
 *     identity for working-state observation — AERA_COLLAB_REPOSITORY_ID is
 *     no longer the sole source (CASE 4);
 *   * a workspace that is not a checkout of the bound repository is never
 *     labelled with its identity (no path-minted identity by another name);
 *   * an environment override that conflicts with the binding is reported,
 *     not resolved silently;
 *   * the repository resource read plane returns every binding with truthful
 *     roles, repository-qualifies a PR against the EXACT provider repository,
 *     returns AMBIGUOUS_REPOSITORY instead of choosing, and reports
 *     LIVE_PROVIDER_STATE_UNAVAILABLE instead of guessing when the provider
 *     runner fails (CASES 3, 9, 10, 12).
 *
 * The ONLY double is the provider runner (`gh`), injected through the
 * service's hooks. No network, no shared infrastructure.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { beforeAll, describe, expect, it } from 'vitest'
import { ParticipationStore } from '@aera/participation-runtime'
import { issueAeraPrincipalId } from '@aera/cis-contracts'
import { repositoryId } from '@aera/participation-contracts'
import { CollabWorkspaceService } from '../src/aera-collab-service.ts'

const OWNER_WO = 'WO-TEST-REPO-IDENTITY-OWNER-001'
const LEGACY_WO = 'WO-TEST-REPO-IDENTITY-LEGACY-001'
const humanPrincipalId = issueAeraPrincipalId()
const AGENT_NAME = 'TEST Repository Identity Worker'
const DELEGATION_ID = 'delegation-TEST-repo-identity-001'
const OWNER_PAYLOAD = [
  'AERA-WORK-ORDER-STANDARD-003 v3.0',
  '',
  `WORK ORDER: ${OWNER_WO}`,
  'TITLE: Repository identity test order',
  'OWNER: Alyshia Daley',
  '',
  'END OWNER ORDER.',
].join('\n')

let storeDir: string
let corpusRoot: string
let stackRoot: string
/** A checkout whose remote is the bound provider repository. */
let stackCheckout: string
/** A checkout whose remote is a DIFFERENT provider repository. */
let strangerCheckout: string
/** A git-less directory, like /Users/<owner>/Desktop. */
let plainDirectory: string

function seedRepo(root: string, remoteUrl?: string): void {
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'README.md'), '# synthetic TEST root\n')
  execFileSync('git', ['-C', root, 'init', '-q'])
  execFileSync('git', ['-C', root, 'add', 'README.md'])
  execFileSync('git', ['-C', root, '-c', 'user.email=test@example.invalid', '-c', 'user.name=TEST', 'commit', '-qm', 'test: seed'])
  if (remoteUrl !== undefined) execFileSync('git', ['-C', root, 'remote', 'add', 'origin', remoteUrl])
}

function service(overrides: { workspaceRoot?: string, repositoryId?: string, runProvider?: (args: readonly string[]) => string } = {}): CollabWorkspaceService {
  return new CollabWorkspaceService({
    storeDir, corpusRoot, stackRoot,
    principalId: humanPrincipalId as string,
    principalName: 'Alyshia Daley',
    agentName: AGENT_NAME,
    agentRole: 'IMPLEMENTER',
    delegationId: DELEGATION_ID,
    ...(overrides.workspaceRoot === undefined ? {} : { workspaceRoot: overrides.workspaceRoot }),
    ...(overrides.repositoryId === undefined ? {} : { repositoryId: overrides.repositoryId }),
  }, overrides.runProvider === undefined ? {} : { runProvider: overrides.runProvider })
}

beforeAll(async () => {
  const base = mkdtempSync(join(tmpdir(), 'aera-collab-repo-identity-'))
  storeDir = join(base, 'participation-store')
  corpusRoot = join(base, 'corpus')
  stackRoot = join(base, 'stack')
  stackCheckout = join(base, 'checkout-of-bound-repo')
  strangerCheckout = join(base, 'checkout-of-other-repo')
  plainDirectory = join(base, 'Desktop')
  seedRepo(corpusRoot)
  seedRepo(stackRoot)
  seedRepo(stackCheckout, 'https://github.com/test-owner/test-stack.git')
  seedRepo(strangerCheckout, 'git@github.com:someone-else/unrelated.git')
  mkdirSync(plainDirectory, { recursive: true })

  // Owner-supplied Work Order admitted through the store's own registration
  // (the same path the desktop's pre-step admission uses), plus a legacy
  // Work Order with no repository binding.
  const store = new ParticipationStore(storeDir)
  store.registerWorkOrder({
    workOrderId: OWNER_WO,
    title: 'Repository identity test order',
    exactPayload: OWNER_PAYLOAD,
    authorityClass: 'OWNER_SUPPLIED',
    lifecycleStatus: 'ACTIVE',
    owner: { principalId: humanPrincipalId, displayName: 'Alyshia Daley' },
    source: { nativeSessionId: 'test-native-session', messageId: 'test-message', eventSequence: 1, submittedAt: new Date().toISOString() },
  })
  store.registerWorkOrder({ workOrderId: LEGACY_WO, title: 'Legacy order without repository binding' })

  // Register resources + bindings through the canonical authority path: a
  // delegated agent session under the owner-supplied Work Order.
  const seed = service()
  const joined = await seed.openAgentWorkContext(OWNER_WO)
  const register = (input: Parameters<ParticipationStore['registerRepositoryResource']>[0]) => store.registerRepositoryResource(input)
  register({
    sessionId: joined.sessionId, authorisingWorkOrderId: OWNER_WO,
    repositoryId: repositoryId('test-stack'), displayName: 'TEST Stack',
    provider: { provider: 'github', owner: 'test-owner', name: 'test-stack' },
    canonicalRemote: 'https://github.com/test-owner/test-stack.git', canonicalBranch: 'dev',
    verification: 'GIT_REMOTE_VERIFIED',
  })
  register({
    sessionId: joined.sessionId, authorisingWorkOrderId: OWNER_WO,
    repositoryId: repositoryId('test-desktop'), displayName: 'TEST Desktop',
    provider: { provider: 'github', owner: 'test-owner', name: 'test-desktop' },
    canonicalBranch: 'master', verification: 'GIT_REMOTE_VERIFIED',
  })
  register({
    sessionId: joined.sessionId, authorisingWorkOrderId: OWNER_WO,
    repositoryId: repositoryId('test-local-only'), displayName: 'TEST local-only',
    canonicalBranch: 'main', verification: 'NO_PROVIDER_REMOTE',
  })
  store.bindWorkOrderRepository({ sessionId: joined.sessionId, authorisingWorkOrderId: OWNER_WO, workOrderId: OWNER_WO, repositoryId: repositoryId('test-stack'), role: 'PRIMARY', note: 'banking PR to dev' })
  store.bindWorkOrderRepository({ sessionId: joined.sessionId, authorisingWorkOrderId: OWNER_WO, workOrderId: OWNER_WO, repositoryId: repositoryId('test-desktop'), role: 'AFFECTED' })
  store.bindWorkOrderRepository({ sessionId: joined.sessionId, authorisingWorkOrderId: OWNER_WO, workOrderId: OWNER_WO, repositoryId: repositoryId('test-local-only'), role: 'SOURCE_EVIDENCE' })
  await seed.closeAgentWorkContext()
})

describe('working state identity from the institutional binding (CASE 4)', () => {
  it('labels a checkout of the PRIMARY repository with the bound RepositoryId when the env var is unset', async () => {
    const subject = service({ workspaceRoot: stackCheckout })
    await subject.openAgentWorkContext(OWNER_WO)
    const observed = subject.observeWorkingState()
    expect(observed.unavailableReason).toBeUndefined()
    expect(observed.view?.repositoryId).toBe('aera-repo:test-stack')
    expect(observed.view?.localPath).toBe(stackCheckout)
    expect(observed.instance?.repositoryId).toBe('aera-repo:test-stack')
    await subject.closeAgentWorkContext()
  })

  it('never labels a checkout of a different provider repository with the bound identity', async () => {
    const subject = service({ workspaceRoot: strangerCheckout })
    await subject.openAgentWorkContext(OWNER_WO)
    const observed = subject.observeWorkingState()
    expect(observed.view).toBeUndefined()
    expect(observed.unavailableReason).toContain('not a checkout of aera-repo:test-stack')
    expect(observed.unavailableReason).toContain('github:someone-else/unrelated')
    await subject.closeAgentWorkContext()
  })

  it('a checkout with several provider remotes is not labelled on the strength of a secondary remote', async () => {
    const dual = join(mkdtempSync(join(tmpdir(), 'aera-collab-dual-remote-')), 'nixsum-like')
    seedRepo(dual, 'https://github.com/test-owner/test-modulop.git')
    execFileSync('git', ['-C', dual, 'remote', 'rename', 'origin', 'modulop'])
    execFileSync('git', ['-C', dual, 'remote', 'add', 'aera', 'https://github.com/test-owner/test-stack.git'])
    const subject = service({ workspaceRoot: dual })
    await subject.openAgentWorkContext(OWNER_WO)
    const observed = subject.observeWorkingState()
    expect(observed.view).toBeUndefined()
    expect(observed.unavailableReason).toContain('several provider remotes')
    expect(observed.unavailableReason).toContain('github:test-owner/test-stack')
    expect(observed.unavailableReason).toContain('not labelled aera-repo:test-stack')
    await subject.closeAgentWorkContext()
  })

  it('a git-less neutral workspace reports the institutional identity and that it was not observed there', async () => {
    const subject = service({ workspaceRoot: plainDirectory })
    await subject.openAgentWorkContext(OWNER_WO)
    const observed = subject.observeWorkingState()
    expect(observed.view).toBeUndefined()
    expect(observed.unavailableReason).toContain('not an observable git working tree')
    expect(observed.unavailableReason).toContain('aera-repo:test-stack (INSTITUTIONAL_BINDING)')
    await subject.closeAgentWorkContext()
  })

  it('an environment override that conflicts with the binding is reported, not resolved silently', async () => {
    const subject = service({ workspaceRoot: stackCheckout, repositoryId: 'aera-repo:something-else' })
    await subject.openAgentWorkContext(OWNER_WO)
    const observed = subject.observeWorkingState()
    expect(observed.view).toBeUndefined()
    expect(observed.unavailableReason).toContain('AERA_COLLAB_REPOSITORY_ID names aera-repo:something-else')
    expect(observed.unavailableReason).toContain('not resolved silently')
    await subject.closeAgentWorkContext()
  })

  it('an environment override naming a bound repository selects it and is still verified against the workspace', async () => {
    const good = service({ workspaceRoot: stackCheckout, repositoryId: 'aera-repo:test-stack' })
    await good.openAgentWorkContext(OWNER_WO)
    expect(good.observeWorkingState().view?.repositoryId).toBe('aera-repo:test-stack')
    await good.closeAgentWorkContext()
    const mismatched = service({ workspaceRoot: strangerCheckout, repositoryId: 'aera-repo:test-desktop' })
    await mismatched.openAgentWorkContext(OWNER_WO)
    expect(mismatched.observeWorkingState().unavailableReason).toContain('not a checkout of aera-repo:test-desktop')
    await mismatched.closeAgentWorkContext()
  })

  it('CASE 12 — a legacy Work Order without bindings keeps the honest pre-existing behaviour', async () => {
    const subject = service({ workspaceRoot: stackCheckout })
    await subject.openAgentWorkContext(LEGACY_WO)
    const observed = subject.observeWorkingState()
    expect(observed.view).toBeUndefined()
    expect(observed.unavailableReason).toContain(`${LEGACY_WO} has no canonical repository binding`)
    expect(observed.unavailableReason).toContain('never minted from a local path')
    // the env var still selects identity for a legacy order, exactly as before
    const legacyEnv = service({ workspaceRoot: stackCheckout, repositoryId: 'aera-repo:legacy-env-only' })
    await legacyEnv.openAgentWorkContext(LEGACY_WO)
    expect(legacyEnv.observeWorkingState().view?.repositoryId).toBe('aera-repo:legacy-env-only')
    await legacyEnv.closeAgentWorkContext()
    await subject.closeAgentWorkContext()
  })
})

describe('the repository resource read plane', () => {
  it('CASE 3 — returns every canonical binding with truthful roles, PRIMARY first, no local paths', async () => {
    const subject = service()
    await subject.openAgentWorkContext(OWNER_WO)
    const { repositories } = subject.agentRepositoryResources()
    expect(repositories.map(row => [row.repositoryId, row.role, row.providerIdentity ?? null])).toEqual([
      ['aera-repo:test-stack', 'PRIMARY', 'github:test-owner/test-stack'],
      ['aera-repo:test-desktop', 'AFFECTED', 'github:test-owner/test-desktop'],
      ['aera-repo:test-local-only', 'SOURCE_EVIDENCE', null],
    ])
    expect(JSON.stringify(repositories)).not.toContain(tmpdir())
    await subject.closeAgentWorkContext()
  })

  it('the institutional context injected into the model names the bindings and forbids workspace inference', async () => {
    const subject = service()
    await subject.openAgentWorkContext(OWNER_WO)
    const text = await subject.agentInstitutionalContext()
    expect(text).toContain('aera-repo:test-stack (PRIMARY; github:test-owner/test-stack; branch dev)')
    expect(text).toContain('aera_collab_repository_resource')
    expect(text).toContain('never infer a repository from the workspace')
    await subject.closeAgentWorkContext()
  })

  it('a cold process with no joined Work Order is offered the bounded orientation frontier — described, never chosen', async () => {
    const subject = service()
    const text = await subject.agentOrientationContext()
    expect(text).toContain('No Work Order is joined in this Session.')
    expect(text).toContain(`- ${OWNER_WO} — Repository identity test order`)
    expect(text).toContain('aera-repo:test-stack (PRIMARY; github:test-owner/test-stack; branch dev)')
    // Orientation ranks by MEANINGFUL activity, so an order nothing has been
    // recorded against never appears — registration alone is not recent work.
    expect(text).not.toContain(LEGACY_WO)
    expect(text).toContain('aera_collab_resolve_work_context(work_order_id)')
    // WO-AERA-COLLAB-INSTITUTIONAL-ORIENTATION-...-001 §8/§28: the owner
    // explicitly rejects "several are active, therefore ask". Orientation must
    // answer truthfully; disambiguation is required only for an ACTION.
    expect(text).not.toContain('ask rather than choosing')
    expect(text).toContain('Do NOT ask which Work Order is meant merely because more than one is listed')
    expect(text).toContain('grants no authority to write, merge or deploy')
    expect(text).toContain('Never infer a Work Order or a repository from the workspace path or name.')
    // a store-less service offers nothing rather than inventing orders
    const unconfigured = new CollabWorkspaceService({ principalId: humanPrincipalId as string, principalName: 'Alyshia Daley' })
    expect(await unconfigured.agentOrientationContext()).toBeUndefined()
  })

  it('multi-repository ambiguity is returned, never silently resolved', async () => {
    const subject = service()
    await subject.openAgentWorkContext(OWNER_WO)
    const result = subject.agentResolveRepositoryResource({ pullRequestNumber: 593 })
    expect(result.resolution).toBe('AMBIGUOUS_REPOSITORY')
    expect(result.repository).toBeUndefined()
    expect(result.liveState).toBeUndefined()
    expect(result.repositories).toHaveLength(3)
    await subject.closeAgentWorkContext()
  })

  it('CASE 9 — a PR number resolves against the EXACT provider repository and fetches live state through the runner', async () => {
    const calls: string[][] = []
    const subject = service({
      runProvider: (args) => {
        calls.push([...args])
        return JSON.stringify({ state: 'OPEN', mergeCommit: null, mergedAt: null, headRefOid: '3bcaefdaa5a49458a254ecdbe0b65418d3dacc6f', baseRefName: 'dev', headRefName: 'codex/test', url: 'https://github.com/test-owner/test-stack/pull/593' })
      },
    })
    await subject.openAgentWorkContext(OWNER_WO)
    const result = subject.agentResolveRepositoryResource({ role: 'PRIMARY', pullRequestNumber: 593 })
    expect(result.resolution).toBe('RESOLVED')
    expect(result.repository?.repositoryId).toBe('aera-repo:test-stack')
    expect(result.reference).toEqual({
      kind: 'PROVIDER_RESOLVED',
      reference: 'aera-repo:test-stack#pr/593',
      providerIdentity: 'github:test-owner/test-stack',
      providerUrl: 'https://github.com/test-owner/test-stack/pull/593',
    })
    expect(result.liveState?.kind).toBe('LIVE_PROVIDER_STATE')
    if (result.liveState?.kind === 'LIVE_PROVIDER_STATE') {
      expect(result.liveState.state).toBe('OPEN')
      expect(result.liveState.headRefOid).toBe('3bcaefdaa5a49458a254ecdbe0b65418d3dacc6f')
      expect(result.liveState.baseRefName).toBe('dev')
    }
    // the runner was asked for EXACTLY the canonical provider repository
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('--repo')
    expect(calls[0]?.[calls[0].indexOf('--repo') + 1]).toBe('test-owner/test-stack')
    // by explicit RepositoryId the same reference resolves without a role
    const byId = subject.agentResolveRepositoryResource({ repositoryId: 'aera-repo:test-stack', pullRequestNumber: 593 })
    expect(byId.reference?.reference).toBe('aera-repo:test-stack#pr/593')
    await subject.closeAgentWorkContext()
  })

  it('CASE 10 — when the provider runner fails the RepositoryId is retained and live state is UNAVAILABLE, never guessed', async () => {
    const subject = service({
      runProvider: () => { throw new Error('gh: could not resolve to a Repository (network unavailable)') },
    })
    await subject.openAgentWorkContext(OWNER_WO)
    const result = subject.agentResolveRepositoryResource({ repositoryId: 'aera-repo:test-stack', pullRequestNumber: 593 })
    expect(result.resolution).toBe('RESOLVED')
    expect(result.repository?.repositoryId).toBe('aera-repo:test-stack')
    expect(result.reference?.kind).toBe('PROVIDER_RESOLVED')
    expect(result.liveState?.kind).toBe('LIVE_PROVIDER_STATE_UNAVAILABLE')
    if (result.liveState?.kind === 'LIVE_PROVIDER_STATE_UNAVAILABLE') {
      expect(result.liveState.reason).toContain('github:test-owner/test-stack')
      expect(result.liveState.reason).toContain('not guessed')
    }
    await subject.closeAgentWorkContext()
  })

  it('a resource without provider identity resolves its RepositoryId and reports provider identity unavailable', async () => {
    const subject = service({ runProvider: () => { throw new Error('must not be called') } })
    await subject.openAgentWorkContext(OWNER_WO)
    const result = subject.agentResolveRepositoryResource({ repositoryId: 'aera-repo:test-local-only', branchRef: 'main' })
    expect(result.resolution).toBe('RESOLVED')
    expect(result.reference?.kind).toBe('PROVIDER_IDENTITY_UNAVAILABLE')
    expect(result.liveState?.kind).toBe('LIVE_PROVIDER_STATE_UNAVAILABLE')
    await subject.closeAgentWorkContext()
  })

  it('CASE 8 / 12 — unknown or unbound repositories are refused truthfully; a legacy order is UNBOUND', async () => {
    const subject = service()
    await subject.openAgentWorkContext(OWNER_WO)
    expect(subject.agentResolveRepositoryResource({ repositoryId: 'aera-repo:not-registered' }).resolution).toBe('REPOSITORY_NOT_BOUND')
    expect(subject.agentResolveRepositoryResource({ repositoryId: '/Users/someone/AERA-Workspace/aera-stack' }).resolution).toBe('REPOSITORY_NOT_FOUND')
    await subject.closeAgentWorkContext()
    const legacy = service()
    await legacy.openAgentWorkContext(LEGACY_WO)
    const result = legacy.agentResolveRepositoryResource({ pullRequestNumber: 593 })
    expect(result.resolution).toBe('WORK_ORDER_UNBOUND')
    expect(result.repositories).toEqual([])
    await legacy.closeAgentWorkContext()
  })
})
