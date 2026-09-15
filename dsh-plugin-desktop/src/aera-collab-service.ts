/**
 * Collab Workspace Service — WO-AGC-002 Remit C (desktop retarget).
 *
 * The Aera Code DESKTOP consumer of the harness-native Agent Collaboration
 * client boundary. Reused from the remit A consumer service
 * (`CollabWorkspaceService.ts`) with the proven mechanisms intact: WorkContext
 * operations, honest participant presentation, traversal-hardened source
 * resolution, progress/evidence operations. Runs in the Electron MAIN process
 * — the sandboxed Work Context window never touches graph, store or index
 * files; it only receives the serialised view model (§9, §14).
 *
 * Everything durable is written through the established owners:
 * `ParticipationCollaborationClient` → `ParticipationStore` (canonical JSON +
 * SHA256SUMS custody), then reflected into the rebuildable projection via
 * `buildParticipationProjection` + `mergeProjections`. This service creates NO
 * second harness, store, registry or graph authority (§6/§4).
 *
 * Configuration is environment-driven (no hard-coded configuration; no new
 * Settings implementation under §13):
 *   AERA_COLLAB_STORE_DIR        durable participation store directory
 *   AERA_COLLAB_CORPUS_ROOT      docs corpus root for the graph projection
 *   AERA_COLLAB_STACK_ROOT       stack root for the graph projection
 *   AERA_COLLAB_PRINCIPAL_ID     canonical AeraPrincipalId of the human user
 *   AERA_COLLAB_PRINCIPAL_NAME   display name for that principal
 *   AERA_COLLAB_REPOSITORY_ID    stable RepositoryId of the observed workspace
 *   AERA_COLLAB_WORKSPACE_ROOT   observed worktree root (via the host seam)
 *
 * Missing configuration produces honest UNAVAILABLE states — never fabricated
 * context, never a silently created second store.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { isAbsolute, join, resolve, sep } from 'node:path'
import {
  ContextNavigator,
  EVENTS_FILE,
  PRINCIPALS_FILE,
  ParticipationCollaborationClient,
  ParticipationStore,
  ParticipationStoreError,
  SESSIONS_FILE,
  WORK_ORDERS_FILE,
  buildParticipationProjection,
  mergeProjections,
  resolveRepositoryReference,
  resolveWorkContext,
  resolveWorkOrderRepositories,
  type RepositoryReferenceResolution,
} from '@aera/participation-runtime'
import { buildProjection } from '@aera/evidentiary-work-graph'
import type { EngineeringWorkGraphProjectionV1 } from '@aera/evidentiary-work-graph-contracts'
import {
  isRepositoryId,
  parseGitRemoteUrl,
  providerRepositoryIdentity,
  providerRepositoryKey,
  worktreeInstance,
  type RepositoryBindingRole,
  type RepositoryId,
  type RepositoryProviderCoordinatesV1,
  type WorkContextRepositoryV1,
  type WorktreeInstanceV1,
} from '@aera/participation-contracts'
import {
  isAgentRole,
  isUnattributedChange,
  type AgentRole,
  type ParticipationSession,
} from '@aera/evidentiary-work-graph-contracts'
import { isAeraPrincipalId, type AeraPrincipalId } from '@aera/cis-contracts'
import {
  buildContextView,
  type CollabContextView,
  type CollabNodeDetail,
  type CollabWorkingStateView,
} from './aera-collab-view.ts'

export interface CollabWorkspaceConfig {
  readonly storeDir?: string
  readonly corpusRoot?: string
  readonly stackRoot?: string
  readonly principalId?: string
  readonly principalName?: string
  readonly repositoryId?: string
  /** The observed workspace root (working-state observation target). */
  readonly workspaceRoot?: string
  /** Durable display name of the participating AGENT principal (agent plane). */
  readonly agentName?: string
  /** Declared role of the participating agent (`ORCHESTRATOR` | `IMPLEMENTER` | `REVIEWER` | `NAVIGATOR`). */
  readonly agentRole?: string
  /** Recorded delegation id authorising the agent's participation (never minted silently). */
  readonly delegationId?: string
  /** Advisory provider-class hint for the agent principal (never authority). */
  readonly agentProviderHint?: string
}

/** Resolve configuration from process env + the host-provided workspace root. */
export function resolveCollabConfig(
  env: Readonly<Record<string, string | undefined>>,
  workspaceRoot: string | undefined,
): CollabWorkspaceConfig {
  const pick = (key: string): string | undefined => {
    const value = env[key]
    return value === undefined || value.trim() === '' ? undefined : value
  }
  const storeDir = pick('AERA_COLLAB_STORE_DIR')
  const corpusRoot = pick('AERA_COLLAB_CORPUS_ROOT')
  const stackRoot = pick('AERA_COLLAB_STACK_ROOT')
  const principalId = pick('AERA_COLLAB_PRINCIPAL_ID')
  const principalName = pick('AERA_COLLAB_PRINCIPAL_NAME')
  const repositoryId = pick('AERA_COLLAB_REPOSITORY_ID')
  const agentName = pick('AERA_COLLAB_AGENT_NAME')
  const agentRole = pick('AERA_COLLAB_AGENT_ROLE')
  const delegationId = pick('AERA_COLLAB_DELEGATION_ID')
  const agentProviderHint = pick('AERA_COLLAB_AGENT_PROVIDER_HINT')
  return {
    ...(storeDir === undefined ? {} : { storeDir }),
    ...(corpusRoot === undefined ? {} : { corpusRoot }),
    ...(stackRoot === undefined ? {} : { stackRoot }),
    ...(principalId === undefined ? {} : { principalId }),
    ...(principalName === undefined ? {} : { principalName }),
    ...(repositoryId === undefined ? {} : { repositoryId }),
    ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
    ...(agentName === undefined ? {} : { agentName }),
    ...(agentRole === undefined ? {} : { agentRole }),
    ...(delegationId === undefined ? {} : { delegationId }),
    ...(agentProviderHint === undefined ? {} : { agentProviderHint }),
  }
}

/**
 * Composition-time seams. `runProvider` executes one read-only provider CLI
 * query (`gh …`) and returns its stdout; tests supply a deterministic double.
 * The default runner never receives credentials from this module — it runs
 * the user's own `gh` with whatever authentication the host already holds.
 */
export interface CollabWorkspaceHooks {
  readonly runProvider?: (args: readonly string[]) => string
}

/** Default read-only provider runner: the host's `gh` CLI, bounded by a timeout. */
export function defaultProviderRunner(args: readonly string[]): string {
  return execFileSync('gh', [...args], { encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/** Live provider state for one repository-qualified reference, or its honest absence. */
export type CollabLiveProviderState =
  | {
      readonly kind: 'LIVE_PROVIDER_STATE'
      readonly providerIdentity: string
      readonly observedAt: string
      readonly state?: string
      readonly mergeCommit?: string
      readonly mergedAt?: string
      readonly headRefOid?: string
      readonly baseRefName?: string
      readonly headRefName?: string
      readonly url?: string
    }
  | { readonly kind: 'LIVE_PROVIDER_STATE_UNAVAILABLE', readonly reason: string }

/** The repository resource tool's result shape (see `aera_collab_repository_resource`). */
export interface CollabRepositoryResolution {
  readonly workOrderId: string
  readonly resolution:
    | 'RESOLVED'
    | 'WORK_ORDER_UNBOUND'
    | 'AMBIGUOUS_REPOSITORY'
    | 'REPOSITORY_NOT_BOUND'
    | 'REPOSITORY_NOT_FOUND'
    | 'REPOSITORY_SCOPE_REFUSED'
  readonly reason?: string
  /** Every canonical binding of the Work Order, PRIMARY first. */
  readonly repositories: readonly WorkContextRepositoryV1[]
  /** The selected binding when resolution is RESOLVED. */
  readonly repository?: WorkContextRepositoryV1
  readonly reference?: {
    readonly kind: 'PROVIDER_RESOLVED' | 'PROVIDER_IDENTITY_UNAVAILABLE' | 'REPOSITORY_MISMATCH'
    readonly reference: string
    readonly providerIdentity?: string
    readonly providerUrl?: string
    readonly reason?: string
  }
  readonly liveState?: CollabLiveProviderState
}

/** An honest, typed refusal. The UI shows `reason` verbatim. */
export class CollabHonestError extends Error {
  constructor(
    readonly code:
      | 'STORE_UNAVAILABLE'
      | 'PROJECTION_UNAVAILABLE'
      | 'PRINCIPAL_UNAVAILABLE'
      | 'WORK_ORDER_NOT_FOUND'
      | 'WORK_ORDER_CONFLICT'
      | 'NOT_JOINED'
      | 'AGENT_UNAVAILABLE'
      | 'INVALID_INPUT'
      | 'EVIDENCE_NOT_FOUND'
      | 'SOURCE_ACCESS_REFUSED',
    reason: string,
  ) {
    super(reason)
    this.name = 'CollabHonestError'
  }
}

export interface CollabAvailability {
  readonly store: string
  readonly projection: string
  readonly principal: string
}

/**
 * Host-side service holding one joined WorkContext at a time.
 */
export class CollabWorkspaceService {
  private store: ParticipationStore | null = null
  private baseProjection: EngineeringWorkGraphProjectionV1 | null = null
  private client: ParticipationCollaborationClient | null = null
  private navigator: ContextNavigator | null = null
  private session: ParticipationSession | null = null
  private workOrderId: string | null = null
  // Agent plane (WO-AGC-001 Remit E, §4): a SEPARATE joined state so the human
  // window session and the participating agent's session never share identity.
  private agentClient: ParticipationCollaborationClient | null = null
  private agentSession: ParticipationSession | null = null
  private agentWorkOrderId: string | null = null

  constructor(
    private readonly config: CollabWorkspaceConfig,
    private readonly hooks: CollabWorkspaceHooks = {},
  ) {}

  /**
   * Admit one exact owner-authored formal Work Order into the canonical
   * participation store before execution begins, then bind the configured
   * agent to it. The first accepted source remains its provenance; replaying
   * identical content is idempotent and conflicting content is refused.
   */
  async admitOwnerWorkOrder(input: {
    readonly workOrderId: string
    readonly title: string
    readonly exactPayload: string
    readonly nativeSessionId: string
    readonly messageId: string
    readonly eventSequence: number
    readonly submittedAt: string
  }): Promise<{ workOrderId: string, lifecycleStatus: string, revision: number }> {
    const store = this.requireStore()
    const { principalId, principalName } = this.config
    if (principalId === undefined || principalName === undefined || !isAeraPrincipalId(principalId)) {
      throw new CollabHonestError(
        'PRINCIPAL_UNAVAILABLE',
        'Owner Work Order admission requires the configured canonical human principal.',
      )
    }
    const existed = store.listWorkOrders().some(order => order.workOrderId === input.workOrderId)
    let record
    try {
      record = store.registerWorkOrder({
        workOrderId: input.workOrderId,
        title: input.title,
        exactPayload: input.exactPayload,
        authorityClass: 'OWNER_SUPPLIED',
        lifecycleStatus: 'ACTIVE',
        owner: { principalId, displayName: principalName },
        source: {
          nativeSessionId: input.nativeSessionId,
          messageId: input.messageId,
          eventSequence: input.eventSequence,
          submittedAt: input.submittedAt,
        },
      })
    } catch (error) {
      if (error instanceof ParticipationStoreError
        && error.code === 'WORK_ORDER_REGISTRATION_CONFLICT') {
        throw new CollabHonestError(
          'WORK_ORDER_CONFLICT',
          `Work Order ${input.workOrderId} already exists with different canonical content. The existing record was not overwritten.`,
        )
      }
      throw error
    }
    if (this.agentWorkOrderId !== input.workOrderId) {
      await this.closeAgentWorkContext()
      await this.openAgentWorkContext(input.workOrderId)
    }
    if (!existed) {
      await this.agentRecordProgressNote(
        `Owner-supplied Work Order admitted from native Session ${input.nativeSessionId}; execution remains in progress.`,
      )
    }
    return {
      workOrderId: record.workOrderId,
      lifecycleStatus: record.lifecycleStatus ?? 'ACTIVE',
      revision: record.revision ?? 1,
    }
  }

  /** Restore the WorkContext associated with one native Aera Code Session. */
  async resumeAgentWorkContextForNativeSession(nativeSessionId: string): Promise<{
    workOrderId: string
    lifecycleStatus: string
    revision: number
  } | undefined> {
    if (this.config.storeDir === undefined) return undefined
    if (this.agentWorkOrderId !== null) {
      const current = this.requireStore().listWorkOrders()
        .find(order => order.workOrderId === this.agentWorkOrderId)
      return current === undefined ? undefined : {
        workOrderId: current.workOrderId,
        lifecycleStatus: current.lifecycleStatus ?? 'ACTIVE',
        revision: current.revision ?? 1,
      }
    }
    const record = this.requireStore().listWorkOrders()
      .find(order => order.source?.nativeSessionId === nativeSessionId)
    if (record === undefined) return undefined
    await this.openAgentWorkContext(record.workOrderId)
    return {
      workOrderId: record.workOrderId,
      lifecycleStatus: record.lifecycleStatus ?? 'ACTIVE',
      revision: record.revision ?? 1,
    }
  }

  /** Render a bounded, non-authoritative model context from canonical facts. */
  async agentInstitutionalContext(): Promise<string | undefined> {
    if (this.agentWorkOrderId === null) return undefined
    const record = this.requireStore().listWorkOrders()
      .find(order => order.workOrderId === this.agentWorkOrderId)
    if (record === undefined) return undefined
    const packet = await this.agentContextPacket()
    const { repositories } = resolveWorkOrderRepositories(this.requireStore(), record.workOrderId)
    const repositoryLines = repositories.length === 0
      ? ['Repository bindings: none recorded for this Work Order. Do not infer a repository from the workspace; ask for a bounded resolution.']
      : [
          `Repository bindings: ${repositories.map(row =>
            `${row.repositoryId} (${row.role}${row.providerIdentity === undefined ? '; no verified provider remote' : `; ${row.providerIdentity}`}${row.canonicalBranch === undefined ? '' : `; branch ${row.canonicalBranch}`})`).join('; ')}`,
          'Resolve any PR, commit or branch through aera_collab_repository_resource using these stable RepositoryIds; never infer a repository from the workspace path or name.',
        ]
    return [
      `Current canonical Work Order: ${record.workOrderId}`,
      `Title: ${record.title}`,
      `Authority: ${record.authorityClass ?? 'RECORDED'}`,
      `Status: ${record.lifecycleStatus ?? 'RECORDED'}; revision ${record.revision ?? 1}`,
      `Recorded progress events: ${this.requireStore().listEvents().filter(event =>
        !isUnattributedChange(event.attribution)
        && event.attribution.workOrderId === record.workOrderId).length}`,
      `Context: ${packet.currentCanonicalState.length} current-state item(s), ${packet.governingDecisions.length} governing decision(s), ${packet.knownResiduals.length} unresolved item(s).`,
      ...repositoryLines,
    ].join('\n')
  }

  /**
   * Bounded, non-authoritative orientation for a Session in a process that
   * holds NO joined Work Order: the ACTIVE owner-supplied Work Orders the
   * store knows, newest first, each with its repository bindings. It lists;
   * it never selects. `undefined` when the store is unavailable or empty.
   */
  async agentActiveWorkOrdersContext(): Promise<string | undefined> {
    if (this.config.storeDir === undefined) return undefined
    const store = this.requireStore()
    const active = store.listWorkOrders()
      .filter(order => order.authorityClass === 'OWNER_SUPPLIED' && order.lifecycleStatus === 'ACTIVE')
      .sort((left, right) => (left.registeredAt < right.registeredAt ? 1 : left.registeredAt > right.registeredAt ? -1 : 0))
    if (active.length === 0) return undefined
    const events = store.listEvents()
    const lines = active.map((order) => {
      const progress = events.filter(event =>
        !isUnattributedChange(event.attribution) && event.attribution.workOrderId === order.workOrderId).length
      const { repositories } = resolveWorkOrderRepositories(store, order.workOrderId)
      const bindings = repositories.length === 0
        ? 'no repository binding recorded'
        : repositories.map(row =>
          `${row.repositoryId} (${row.role}${row.providerIdentity === undefined ? '' : `; ${row.providerIdentity}`}${row.canonicalBranch === undefined ? '' : `; branch ${row.canonicalBranch}`})`).join('; ')
      return `- ${order.workOrderId} — ${order.title}; registered ${order.registeredAt}; ${progress} recorded progress event(s); repositories: ${bindings}`
    })
    return [
      'No Work Order is joined in this Session.',
      `Active owner-supplied canonical Work Orders (${active.length}, newest first):`,
      ...lines,
      'Resolve one explicitly with aera_collab_resolve_work_context(work_order_id) before reasoning about its state; then use aera_collab_repository_resource for any repository, PR, commit or branch.',
      'If more than one is active and the request does not identify which, ask rather than choosing. Never infer a Work Order or a repository from the workspace path or name.',
    ].join('\n')
  }

  // ------------------------------------------------------------------
  // Repository resource identity — WO-AERA-COLLAB-STABLE-REPOSITORY-RESOURCE-IDENTITY-001
  //
  // The institutional read plane for repositories: which stable RepositoryIds
  // the joined Work Order is bound to, their verified provider coordinates,
  // and the repository-qualified resolution of a PR / commit / branch. Live
  // provider state is fetched ONLY against the exact provider coordinates the
  // canonical resource carries, through the injectable provider runner; any
  // failure is reported as LIVE_PROVIDER_STATE_UNAVAILABLE, never guessed.
  // Nothing here grants write, push, merge or deployment authority.
  // ------------------------------------------------------------------

  /** The Work Order this service currently observes for (agent plane first). */
  private observedWorkOrderId(): string | null {
    return this.agentWorkOrderId ?? this.workOrderId
  }

  /** The requester's authority scope: the delegating human principal. */
  private requesterScope(): AeraPrincipalId | undefined {
    const { principalId } = this.config
    return principalId !== undefined && isAeraPrincipalId(principalId) ? principalId : undefined
  }

  /** The joined Work Order's canonical repository bindings (PRIMARY first). */
  agentRepositoryResources(): { workOrderId: string, repositories: readonly WorkContextRepositoryV1[] } {
    const { workOrderId } = this.requireAgentJoined()
    const { repositories } = resolveWorkOrderRepositories(this.requireStore(), workOrderId)
    return { workOrderId, repositories }
  }

  /**
   * Resolve a repository (by RepositoryId, by binding role, or the sole
   * binding) and, optionally, one repository-qualified reference, then fetch
   * its live provider state when requested and possible.
   */
  agentResolveRepositoryResource(input: {
    readonly repositoryId?: string
    readonly role?: RepositoryBindingRole
    readonly pullRequestNumber?: number
    readonly commitSha?: string
    readonly branchRef?: string
    readonly live?: boolean
  }): CollabRepositoryResolution {
    const { workOrderId } = this.requireAgentJoined()
    const store = this.requireStore()
    const { repositories } = resolveWorkOrderRepositories(store, workOrderId)
    const scope = this.requesterScope()
    const resolution: RepositoryReferenceResolution = resolveRepositoryReference(store, {
      workOrderId,
      ...(input.repositoryId === undefined ? {} : { repositoryId: input.repositoryId }),
      ...(input.role === undefined ? {} : { role: input.role }),
      ...(input.pullRequestNumber === undefined ? {} : { pullRequestNumber: input.pullRequestNumber }),
      ...(input.commitSha === undefined ? {} : { commitSha: input.commitSha }),
      ...(input.branchRef === undefined ? {} : { branchRef: input.branchRef }),
      ...(scope === undefined ? {} : { requesterScope: scope }),
    })
    if (resolution.kind !== 'RESOLVED') {
      return {
        workOrderId,
        resolution: resolution.kind,
        reason: resolution.reason,
        repositories,
      }
    }
    const reference = resolution.reference === undefined
      ? undefined
      : resolution.reference.kind === 'PROVIDER_RESOLVED'
        ? {
            kind: resolution.reference.kind,
            reference: resolution.reference.reference,
            providerIdentity: resolution.reference.providerIdentity,
            providerUrl: resolution.reference.providerUrl,
          }
        : resolution.reference.kind === 'PROVIDER_IDENTITY_UNAVAILABLE'
          ? { kind: resolution.reference.kind, reference: resolution.reference.reference, reason: resolution.reference.reason }
          : { kind: resolution.reference.kind, reference: `${resolution.reference.referenceRepositoryId}`, reason: resolution.reference.reason }
    const wantLive = input.live ?? resolution.reference !== undefined
    const liveState = !wantLive || resolution.reference === undefined
      ? undefined
      : resolution.reference.kind !== 'PROVIDER_RESOLVED'
        ? { kind: 'LIVE_PROVIDER_STATE_UNAVAILABLE' as const, reason: resolution.reference.reason }
        : this.liveProviderState(resolution.reference.provider, input)
    return {
      workOrderId,
      resolution: 'RESOLVED',
      repositories,
      repository: resolution.repository,
      ...(reference === undefined ? {} : { reference }),
      ...(liveState === undefined ? {} : { liveState }),
    }
  }

  /** Live provider state for one reference against EXACT coordinates; never a guess. */
  private liveProviderState(
    provider: RepositoryProviderCoordinatesV1,
    input: { readonly pullRequestNumber?: number, readonly commitSha?: string, readonly branchRef?: string },
  ): CollabLiveProviderState {
    const repo = `${provider.owner}/${provider.name}`
    const run = this.hooks.runProvider ?? defaultProviderRunner
    try {
      if (input.pullRequestNumber !== undefined) {
        const raw = run(['pr', 'view', String(input.pullRequestNumber), '--repo', repo, '--json', 'state,mergeCommit,mergedAt,headRefOid,baseRefName,headRefName,url'])
        const parsed = JSON.parse(raw) as {
          state?: string, mergeCommit?: { oid?: string } | null, mergedAt?: string | null,
          headRefOid?: string, baseRefName?: string, headRefName?: string, url?: string,
        }
        return {
          kind: 'LIVE_PROVIDER_STATE',
          providerIdentity: providerRepositoryIdentity(provider),
          observedAt: new Date().toISOString(),
          ...(parsed.state === undefined ? {} : { state: parsed.state }),
          ...(parsed.mergeCommit?.oid === undefined ? {} : { mergeCommit: parsed.mergeCommit.oid }),
          ...(parsed.mergedAt === undefined || parsed.mergedAt === null ? {} : { mergedAt: parsed.mergedAt }),
          ...(parsed.headRefOid === undefined ? {} : { headRefOid: parsed.headRefOid }),
          ...(parsed.baseRefName === undefined ? {} : { baseRefName: parsed.baseRefName }),
          ...(parsed.headRefName === undefined ? {} : { headRefName: parsed.headRefName }),
          ...(parsed.url === undefined ? {} : { url: parsed.url }),
        }
      }
      if (input.commitSha !== undefined) {
        const raw = run(['api', `repos/${repo}/commits/${input.commitSha}`, '--jq', '{sha: .sha, url: .html_url}'])
        const parsed = JSON.parse(raw) as { sha?: string, url?: string }
        return {
          kind: 'LIVE_PROVIDER_STATE',
          providerIdentity: providerRepositoryIdentity(provider),
          observedAt: new Date().toISOString(),
          state: 'COMMIT_PRESENT',
          ...(parsed.sha === undefined ? {} : { headRefOid: parsed.sha }),
          ...(parsed.url === undefined ? {} : { url: parsed.url }),
        }
      }
      if (input.branchRef !== undefined) {
        const raw = run(['api', `repos/${repo}/branches/${input.branchRef}`, '--jq', '{name: .name, sha: .commit.sha}'])
        const parsed = JSON.parse(raw) as { name?: string, sha?: string }
        return {
          kind: 'LIVE_PROVIDER_STATE',
          providerIdentity: providerRepositoryIdentity(provider),
          observedAt: new Date().toISOString(),
          state: 'BRANCH_PRESENT',
          ...(parsed.name === undefined ? {} : { headRefName: parsed.name }),
          ...(parsed.sha === undefined ? {} : { headRefOid: parsed.sha }),
        }
      }
      return { kind: 'LIVE_PROVIDER_STATE_UNAVAILABLE', reason: 'No PR number, commit or branch was named to look up.' }
    } catch (error) {
      const detail = error instanceof Error ? error.message.split('\n')[0] : String(error)
      return {
        kind: 'LIVE_PROVIDER_STATE_UNAVAILABLE',
        reason: `Live provider verification against ${providerRepositoryIdentity(provider)} is unavailable (${detail ?? 'provider call failed'}). The repository identity is canonical; its live state was not fetched and is not guessed.`,
      }
    }
  }

  /**
   * §7 + repository identity: the stable RepositoryId a working-state
   * observation is labelled with. The institutional binding of the joined
   * Work Order is sufficient; AERA_COLLAB_REPOSITORY_ID may still select a
   * bound repository (or, for a legacy unbound Work Order, stand alone as it
   * always has) but is never the sole source of institutional identity and
   * never overrides a conflicting binding silently.
   */
  private resolveWorkingStateIdentity(): { repositoryId?: RepositoryId, source: string, reason: string } {
    const envId = this.config.repositoryId
    const envValid = envId !== undefined && isRepositoryId(envId)
    const workOrderId = this.observedWorkOrderId()
    const bindings = workOrderId === null || this.config.storeDir === undefined
      ? []
      : resolveWorkOrderRepositories(this.requireStore(), workOrderId).repositories
    const primary = bindings.find(row => row.role === 'PRIMARY')
    if (envValid) {
      if (bindings.length > 0 && !bindings.some(row => row.repositoryId === envId)) {
        return {
          source: 'CONFLICT',
          reason: `AERA_COLLAB_REPOSITORY_ID names ${envId}, but ${workOrderId} is bound to ${bindings.map(row => row.repositoryId).join(', ')}; the conflict is reported, not resolved silently.`,
        }
      }
      return { repositoryId: envId, source: bindings.length > 0 ? 'ENVIRONMENT_SELECTED_BINDING' : 'ENVIRONMENT_LEGACY', reason: '' }
    }
    if (envId !== undefined) {
      return {
        source: 'INVALID_ENVIRONMENT',
        reason: 'AERA_COLLAB_REPOSITORY_ID is not a stable aera-repo:<slug> RepositoryId; a repository identity is never minted from a local path.',
      }
    }
    if (primary !== undefined) return { repositoryId: primary.repositoryId, source: 'INSTITUTIONAL_BINDING', reason: '' }
    if (bindings.length > 1) {
      return {
        source: 'AMBIGUOUS_BINDING',
        reason: `${workOrderId} binds ${bindings.map(row => `${row.repositoryId} (${row.role})`).join(', ')} with no PRIMARY; set AERA_COLLAB_REPOSITORY_ID to one of them to observe it. Nothing is chosen silently.`,
      }
    }
    if (bindings.length === 1 && bindings[0] !== undefined) {
      return { repositoryId: bindings[0].repositoryId, source: 'INSTITUTIONAL_BINDING', reason: '' }
    }
    return {
      source: 'NONE',
      reason: workOrderId === null
        ? 'No WorkContext is open and AERA_COLLAB_REPOSITORY_ID is not set; a repository identity is never minted from a local path.'
        : `${workOrderId} has no canonical repository binding and AERA_COLLAB_REPOSITORY_ID is not set; a repository identity is never minted from a local path.`,
    }
  }

  /** `undefined` when the workspace is verifiably a checkout of the identified repository. */
  private workspaceIdentityMismatch(repositoryId: RepositoryId, workspaceRoot: string, remoteLines: readonly string[]): string | undefined {
    if (this.config.storeDir === undefined) return undefined
    const resource = this.requireStore().listRepositoryResources().find(row => row.repositoryId === repositoryId)
    if (resource === undefined) return undefined // legacy env-only identity: unchanged behaviour
    const observed = remoteLines
      .map(line => line.split(/\s+/)[1])
      .filter((url): url is string => url !== undefined)
      .map(url => parseGitRemoteUrl(url))
      .filter((coordinates): coordinates is RepositoryProviderCoordinatesV1 => coordinates !== undefined)
    if (resource.provider !== undefined) {
      const wanted = providerRepositoryKey(resource.provider)
      if (observed.some(coordinates => providerRepositoryKey(coordinates) === wanted)) return undefined
      return `The workspace at ${workspaceRoot} is not a checkout of ${repositoryId} (${providerRepositoryIdentity(resource.provider)}): its remotes are ${observed.length === 0 ? 'none' : observed.map(providerRepositoryIdentity).join(', ')}. The working state is not labelled with a repository it does not belong to.`
    }
    let real: string
    try { real = realpathSync(workspaceRoot) } catch { real = workspaceRoot }
    const known = resource.localCheckouts.some(row => {
      try { return realpathSync(row.localPath) === real } catch { return row.localPath === real }
    })
    if (known) return undefined
    return `The workspace at ${workspaceRoot} is not a verified checkout location of ${repositoryId} (no provider remote to match against). The working state is not labelled with a repository it does not belong to.`
  }

  availability(): CollabAvailability {
    return {
      store:
        this.config.storeDir === undefined
          ? 'UNAVAILABLE: AERA_COLLAB_STORE_DIR is not set'
          : `AVAILABLE: ${this.config.storeDir}`,
      projection:
        this.config.corpusRoot === undefined || this.config.stackRoot === undefined
          ? 'UNAVAILABLE: AERA_COLLAB_CORPUS_ROOT / AERA_COLLAB_STACK_ROOT not set'
          : 'AVAILABLE',
      principal:
        this.config.principalId === undefined || this.config.principalName === undefined
          ? 'UNAVAILABLE: AERA_COLLAB_PRINCIPAL_ID / AERA_COLLAB_PRINCIPAL_NAME not set'
          : `AVAILABLE: ${this.config.principalName}`,
    }
  }

  private requireStore(): ParticipationStore {
    if (this.store !== null) return this.store
    if (this.config.storeDir === undefined) {
      throw new CollabHonestError(
        'STORE_UNAVAILABLE',
        'The durable participation store is unavailable: AERA_COLLAB_STORE_DIR is not set. No fallback store is created.',
      )
    }
    this.store = new ParticipationStore(this.config.storeDir)
    return this.store
  }

  private requireBaseProjection(): EngineeringWorkGraphProjectionV1 {
    if (this.baseProjection !== null) return this.baseProjection
    const { corpusRoot, stackRoot } = this.config
    if (corpusRoot === undefined || stackRoot === undefined) {
      throw new CollabHonestError(
        'PROJECTION_UNAVAILABLE',
        'The Evidentiary Work Graph projection is unavailable: AERA_COLLAB_CORPUS_ROOT / AERA_COLLAB_STACK_ROOT are not set.',
      )
    }
    const build = buildProjection({ corpusRoot, stackRoot })
    if (!build.validation.ok) {
      throw new CollabHonestError(
        'PROJECTION_UNAVAILABLE',
        `The rebuilt projection failed validation (${build.validation.violations.length} violation(s)); refusing to present an invalid graph as context.`,
      )
    }
    this.baseProjection = build.projection
    return this.baseProjection
  }

  /**
   * Merge base graph + current participation records (rebuildable, §9).
   *
   * A fresh store that has not yet written all four record files carries no
   * recorded hash for the missing ones, and `buildParticipationProjection`
   * correctly refuses to mint provenance for them. Until custody is complete
   * the base projection alone is used — participants and sessions still reach
   * the packet from the durable store via `resolveWorkContext`, and nothing
   * is fabricated into the graph.
   */
  private mergedNavigator(): ContextNavigator {
    const store = this.requireStore()
    const base = this.requireBaseProjection()
    const custodyComplete = [EVENTS_FILE, PRINCIPALS_FILE, SESSIONS_FILE, WORK_ORDERS_FILE].every(
      file => store.recordedHashFor(file) !== undefined,
    )
    if (!custodyComplete) {
      this.navigator = new ContextNavigator(base)
      return this.navigator
    }
    const participation = buildParticipationProjection({
      store,
      sourcePrefix: 'participation-store',
    })
    this.navigator = new ContextNavigator(mergeProjections(base, participation.projection))
    return this.navigator
  }

  /**
   * §5A/B — open an existing canonical Work Order by WorkOrderId, joining its
   * WorkContext. The Work Order must already exist (in the projection or as a
   * registered store record); an unknown id fails honestly (§15 item 9).
   */
  async openWorkContext(workOrderId: string): Promise<CollabContextView> {
    const store = this.requireStore()
    const { principalId, principalName } = this.config
    if (principalId === undefined || principalName === undefined || !isAeraPrincipalId(principalId)) {
      throw new CollabHonestError(
        'PRINCIPAL_UNAVAILABLE',
        'No canonical participant principal is configured (AERA_COLLAB_PRINCIPAL_ID must be a canonical aera:participant:<uuid> id and AERA_COLLAB_PRINCIPAL_NAME must be set). Participant identities are never invented.',
      )
    }

    const navigator = this.mergedNavigator()
    const inGraph = navigator
      .findWorkOrders(workOrderId)
      .some(node => node.kind === 'WORK_ORDER' && (node as { workOrderId?: string }).workOrderId === workOrderId)
    const inStore = store.listWorkOrders().some(order => order.workOrderId === workOrderId)
    if (!inGraph && !inStore) {
      throw new CollabHonestError(
        'WORK_ORDER_NOT_FOUND',
        `No canonical Work Order ${workOrderId} exists in the graph projection or the durable store. Opening does not create one.`,
      )
    }

    const client = new ParticipationCollaborationClient(navigator, store)
    this.session = await client.joinWorkContext({
      workOrderId: workOrderId as Parameters<ParticipationCollaborationClient['joinWorkContext']>[0]['workOrderId'],
      principal: { principalId, principalKind: 'HUMAN', displayName: principalName },
    })
    this.client = client
    this.workOrderId = workOrderId
    return this.contextView()
  }

  /** §5G — close the context. Durable records survive; the session ends. */
  async closeWorkContext(): Promise<void> {
    if (this.client !== null && this.session !== null) {
      await this.client.leaveWorkContext(this.session.sessionId)
    }
    this.client = null
    this.session = null
    this.workOrderId = null
  }

  isJoined(): boolean {
    return this.client !== null && this.session !== null
  }

  private requireJoined(): { client: ParticipationCollaborationClient, session: ParticipationSession, workOrderId: string } {
    if (this.client === null || this.session === null || this.workOrderId === null) {
      throw new CollabHonestError('NOT_JOINED', 'No WorkContext is open. Open a Work Order by its WorkOrderId first.')
    }
    return { client: this.client, session: this.session, workOrderId: this.workOrderId }
  }

  /** Resolve the current shared context into the presentation view model. */
  async contextView(): Promise<CollabContextView> {
    const { workOrderId } = this.requireJoined()
    // Refresh the merged navigator so writes through the canonical owners are
    // reflected in the (rebuildable) projection before presentation (§9). The
    // packet is resolved through the SAME canonical resolution path every
    // native client uses (`resolveWorkContext`), never a private copy.
    const navigator = this.mergedNavigator()
    const packet = resolveWorkContext({ navigator, store: this.requireStore(), workOrderId })

    const store = this.requireStore()
    const sessions = store.listSessions().filter(s => s.workOrderId === workOrderId)
    const byPrincipal = new Map<string, ParticipationSession[]>()
    for (const session of sessions) {
      const list = byPrincipal.get(session.principalId) ?? []
      list.push(session)
      byPrincipal.set(session.principalId, list)
    }

    const nodeDetail = new Map<string, CollabNodeDetail>()
    const collect = (refs: readonly { nodeId: string }[]): void => {
      for (const ref of refs) {
        const node = navigator.projection.nodes.find(n => n.nodeId === ref.nodeId)
        if (node === undefined) continue
        const capabilityStatus
          = node.kind === 'CAPABILITY' ? (node as { status?: string }).status : undefined
        nodeDetail.set(ref.nodeId, {
          ...(node.assertedBy?.sourcePath === undefined ? {} : { sourcePath: node.assertedBy.sourcePath }),
          ...(capabilityStatus === undefined ? {} : { capabilityStatus }),
        })
      }
    }
    collect(packet.currentCanonicalState)
    collect(packet.governingDecisions)
    collect(packet.evidence)
    collect(packet.knownResiduals)

    const observed = this.observeWorkingState()
    const workOrderNode = navigator
      .findWorkOrders(workOrderId)
      .find(node => node.kind === 'WORK_ORDER')

    return buildContextView({
      packet,
      sessionsByPrincipal: byPrincipal,
      nodeDetail,
      ...(observed.view === undefined ? {} : { workingState: observed.view }),
      ...(observed.unavailableReason === undefined
        ? {}
        : { workingStateUnavailableReason: observed.unavailableReason }),
      ...(workOrderNode?.label === undefined ? {} : { workOrderLabel: workOrderNode.label }),
    })
  }

  /**
   * §7 — observe the workspace's mutable working state. Requires a stable
   * RepositoryId (env; never minted from a path) and a git-custodied
   * workspace; anything else is an explicit unavailable reason.
   */
  observeWorkingState(): { view?: CollabWorkingStateView, unavailableReason?: string, instance?: WorktreeInstanceV1 } {
    const { workspaceRoot } = this.config
    if (workspaceRoot === undefined) return { unavailableReason: 'No workspace root is open to observe.' }
    const identity = this.resolveWorkingStateIdentity()
    if (identity.repositoryId === undefined) return { unavailableReason: identity.reason }
    const repoId = identity.repositoryId
    let head: string, branch: string, dirty: boolean, remotes: string[]
    try {
      const git = (...args: string[]): string =>
        execFileSync('git', ['-C', workspaceRoot, ...args], { encoding: 'utf8', timeout: 10_000 }).trim()
      head = git('rev-parse', 'HEAD')
      branch = git('rev-parse', '--abbrev-ref', 'HEAD')
      dirty = git('status', '--porcelain').length > 0
      remotes = git('remote', '-v').split('\n').map(line => line.trim()).filter(line => line.length > 0)
    } catch {
      return {
        unavailableReason:
          `The workspace at ${workspaceRoot} is not an observable git working tree. Repository identity for the joined Work Order is ${repoId} (${identity.source}); it was not observed here.`,
      }
    }
    // The workspace must be a checkout OF the identified repository. A bound
    // resource with provider coordinates is matched against the workspace's
    // own remotes; a provider-less resource against its verified checkout
    // locations. A workspace that matches neither is never labelled with the
    // repository identity — that would be path-minted identity by another name.
    const mismatch = this.workspaceIdentityMismatch(repoId, workspaceRoot, remotes)
    if (mismatch !== undefined) return { unavailableReason: mismatch }
    const observedAt = new Date().toISOString()
    const base = {
      repositoryId: repoId,
      localPath: workspaceRoot,
      branchRef: branch,
      headRevision: head,
      dirtyState: (dirty ? 'DIRTY' : 'CLEAN') as 'CLEAN' | 'DIRTY',
    }
    const instanceInput
      = this.session === null || this.workOrderId === null
        ? base
        : { ...base, participationSessionId: this.session.sessionId, workOrderId: this.workOrderId }
    return {
      view: {
        ...base,
        observedAt,
        note: 'Observed mutable working state at observation time — not an immutable historical object',
      },
      instance: worktreeInstance(instanceInput),
    }
  }

  /** §5F — record a bounded progress note through the native operation. */
  async recordProgressNote(summary: string): Promise<{ eventId: string, attributed: boolean }> {
    const { client, session } = this.requireJoined()
    const trimmed = summary.trim()
    if (trimmed.length === 0 || trimmed.length > 4000) {
      throw new CollabHonestError('INVALID_INPUT', 'A progress note must be 1–4000 characters.')
    }
    const result = await client.recordChange(session.sessionId, { summary: trimmed })
    return { eventId: result.eventId, attributed: !isUnattributedChange(result.attribution) }
  }

  /**
   * §5F — reference an EXISTING evidence item. The node must already exist in
   * the merged projection; referencing never creates evidence. The navigator
   * is rebuilt unconditionally before the existence check (remit B finding
   * F4: never check against a possibly stale cached navigator).
   */
  async attachEvidenceReference(evidenceNodeId: string, summary: string): Promise<{ eventId: string }> {
    const { client, session } = this.requireJoined()
    const navigator = this.mergedNavigator()
    const exists = navigator.projection.nodes.some(node => node.nodeId === evidenceNodeId)
    if (!exists) {
      throw new CollabHonestError(
        'EVIDENCE_NOT_FOUND',
        `No node ${evidenceNodeId} exists in the projection; an evidence reference must point at an existing item.`,
      )
    }
    const result = await client.attachEvidence(session.sessionId, {
      summary: summary.trim().length === 0 ? `Referenced existing evidence ${evidenceNodeId}` : summary.trim(),
      evidenceIds: [evidenceNodeId],
    })
    return { eventId: result.eventId }
  }

  // ------------------------------------------------------------------
  // Agent plane — WO-AGC-001 Remit E (§4 of the owner objective restoration).
  //
  // The participating agent's operations run through the SAME established
  // owners (`ParticipationCollaborationClient` → `ParticipationStore`,
  // `ContextNavigator`) — no second store, registry or authority. The agent's
  // ParticipationSession is a REAL session opened for a durable AGENT
  // principal (`ensureAgentPrincipal`, never one principal per inference)
  // under a RECORDED delegation from the configured human principal.
  // Missing agent configuration refuses honestly; nothing is minted silently.
  // ------------------------------------------------------------------

  /** The recorded delegation for the agent plane, from configuration only. */
  private requireAgentDelegation(): { delegationId: string, delegatorPrincipalId: string } {
    const { delegationId, principalId } = this.config
    if (delegationId === undefined || principalId === undefined || !isAeraPrincipalId(principalId)) {
      throw new CollabHonestError(
        'AGENT_UNAVAILABLE',
        'Agent participation is unavailable: AERA_COLLAB_DELEGATION_ID and a canonical AERA_COLLAB_PRINCIPAL_ID (the delegator) must be configured. A delegation is never minted silently.',
      )
    }
    return { delegationId, delegatorPrincipalId: principalId }
  }

  /**
   * §4 group 1 — open the agent's WorkContext: durable AGENT principal via the
   * established owner, real ParticipationSession with the recorded delegation.
   */
  async openAgentWorkContext(workOrderId: string): Promise<{
    sessionId: string
    principalId: string
    workOrderId: string
    delegationId: string
    workOrder?: { nodeId: string, label?: string }
  }> {
    const store = this.requireStore()
    const { agentName, agentRole, agentProviderHint } = this.config
    if (agentName === undefined || agentRole === undefined || !isAgentRole(agentRole)) {
      throw new CollabHonestError(
        'AGENT_UNAVAILABLE',
        'Agent participation is unavailable: AERA_COLLAB_AGENT_NAME and a valid AERA_COLLAB_AGENT_ROLE (ORCHESTRATOR | IMPLEMENTER | REVIEWER | NAVIGATOR) must be configured. Agent identities are never invented.',
      )
    }
    const delegation = this.requireAgentDelegation()

    const navigator = this.mergedNavigator()
    const inGraph = navigator
      .findWorkOrders(workOrderId)
      .some(node => node.kind === 'WORK_ORDER' && (node as { workOrderId?: string }).workOrderId === workOrderId)
    const inStore = store.listWorkOrders().some(order => order.workOrderId === workOrderId)
    if (!inGraph && !inStore) {
      throw new CollabHonestError(
        'WORK_ORDER_NOT_FOUND',
        `No canonical Work Order ${workOrderId} exists in the graph projection or the durable store. Opening does not create one.`,
      )
    }

    const principal = store.ensureAgentPrincipal({
      displayName: agentName,
      agentRole: agentRole as AgentRole,
      createdBy: delegation.delegatorPrincipalId as Parameters<ParticipationStore['ensureAgentPrincipal']>[0]['createdBy'],
      ...(agentProviderHint === undefined ? {} : { providerClassHint: agentProviderHint }),
    })
    const client = new ParticipationCollaborationClient(navigator, store)
    this.agentSession = await client.joinWorkContext({
      workOrderId: workOrderId as Parameters<ParticipationCollaborationClient['joinWorkContext']>[0]['workOrderId'],
      principal,
      delegationRef: {
        delegationId: delegation.delegationId,
        delegatorPrincipalId: delegation.delegatorPrincipalId as Parameters<ParticipationStore['ensureAgentPrincipal']>[0]['createdBy'],
        authorityMode: 'RECORDED_NOT_ENFORCED',
      },
    })
    this.agentClient = client
    this.agentWorkOrderId = workOrderId
    const workOrder = await client.getWorkOrder()
    return {
      sessionId: this.agentSession.sessionId,
      principalId: principal.principalId,
      workOrderId,
      delegationId: delegation.delegationId,
      ...(workOrder === undefined
        ? {}
        : { workOrder: { nodeId: workOrder.nodeId as string, ...(workOrder.label === undefined ? {} : { label: workOrder.label as string }) } }),
    }
  }

  /** The agent's joined client + session, or an honest refusal. */
  private requireAgentJoined(): { client: ParticipationCollaborationClient, session: ParticipationSession, workOrderId: string } {
    if (this.agentClient === null || this.agentSession === null || this.agentWorkOrderId === null) {
      throw new CollabHonestError('NOT_JOINED', 'No agent WorkContext is open. Resolve a Work Order by its WorkOrderId first.')
    }
    return { client: this.agentClient, session: this.agentSession, workOrderId: this.agentWorkOrderId }
  }

  /** Source locator for a projected node, when the projection records one. */
  private nodeSourcePath(nodeId: string): string | undefined {
    if (this.navigator === null) return undefined
    const node = this.navigator.projection.nodes.find(n => n.nodeId === nodeId)
    return node?.assertedBy?.sourcePath
  }

  /**
   * §4 groups 2–4 — the agent's context packet, resolved through the SAME
   * canonical resolution path every native client uses, decorated with the
   * projection's recorded source locators.
   */
  async agentContextPacket(): Promise<{
    workOrderId: string
    currentCanonicalState: { nodeId: string, label?: string, sourcePath?: string }[]
    governingDecisions: { nodeId: string, label?: string, sourcePath?: string }[]
    evidence: { nodeId: string, label?: string, sourcePath?: string }[]
    knownResiduals: { nodeId: string, label?: string, sourcePath?: string }[]
  }> {
    const { client, workOrderId } = this.requireAgentJoined()
    const packet = await client.getContextPacket()
    const decorate = (refs: readonly { nodeId: string, label?: string }[]): { nodeId: string, label?: string, sourcePath?: string }[] =>
      refs.map((ref) => {
        const sourcePath = this.nodeSourcePath(ref.nodeId)
        return {
          nodeId: ref.nodeId,
          ...(ref.label === undefined ? {} : { label: ref.label }),
          ...(sourcePath === undefined ? {} : { sourcePath }),
        }
      })
    return {
      workOrderId,
      currentCanonicalState: decorate(packet.currentCanonicalState),
      governingDecisions: decorate(packet.governingDecisions),
      evidence: decorate(packet.evidence),
      knownResiduals: decorate(packet.knownResiduals),
    }
  }

  /**
   * §4 group 4 — evidence attached to one node, via the native operation.
   */
  async agentFindEvidence(nodeId: string): Promise<{ nodeId: string, kind: string, label?: string, sourcePath?: string }[]> {
    const { client } = this.requireAgentJoined()
    const summaries = await client.findEvidence(nodeId) as readonly { nodeId: string, kind: string, label?: string }[]
    return summaries.map((summary) => {
      const sourcePath = this.nodeSourcePath(summary.nodeId)
      return {
        nodeId: summary.nodeId,
        kind: summary.kind,
        ...(summary.label === undefined ? {} : { label: summary.label }),
        ...(sourcePath === undefined ? {} : { sourcePath }),
      }
    })
  }

  /** §4 group 5 — the agent's attributed progress note (authorised write op). */
  async agentRecordProgressNote(summary: string): Promise<{ eventId: string, attributed: boolean }> {
    const { client, session } = this.requireAgentJoined()
    const trimmed = summary.trim()
    if (trimmed.length === 0 || trimmed.length > 4000) {
      throw new CollabHonestError('INVALID_INPUT', 'A progress note must be 1–4000 characters.')
    }
    const result = await client.recordChange(session.sessionId, { summary: trimmed })
    return { eventId: result.eventId as string, attributed: !isUnattributedChange(result.attribution) }
  }

  /**
   * §4 group 5 — the agent's evidence reference to an EXISTING node
   * (authorised write op; referencing never creates evidence).
   */
  async agentAttachEvidenceReference(evidenceNodeId: string, summary: string): Promise<{ eventId: string, attributed: boolean }> {
    const { client, session } = this.requireAgentJoined()
    const navigator = this.mergedNavigator()
    const exists = navigator.projection.nodes.some(node => node.nodeId === evidenceNodeId)
    if (!exists) {
      throw new CollabHonestError(
        'EVIDENCE_NOT_FOUND',
        `No node ${evidenceNodeId} exists in the projection; an evidence reference must point at an existing item.`,
      )
    }
    const result = await client.attachEvidence(session.sessionId, {
      summary: summary.trim().length === 0 ? `Referenced existing evidence ${evidenceNodeId}` : summary.trim(),
      evidenceIds: [evidenceNodeId],
    })
    return { eventId: result.eventId as string, attributed: !isUnattributedChange(result.attribution) }
  }

  /** Close the agent's WorkContext. Durable records survive; the session ends. */
  async closeAgentWorkContext(): Promise<void> {
    if (this.agentClient !== null && this.agentSession !== null) {
      await this.agentClient.leaveWorkContext(this.agentSession.sessionId)
    }
    this.agentClient = null
    this.agentSession = null
    this.agentWorkOrderId = null
  }

  /**
   * §5E/§10 — map a projection sourcePath (`Aera_Studios_Docs/…` or
   * `aera-stack/…`) to a local file, restricted to the configured roots.
   * Anything outside them — or path-escaping input — is refused (§10
   * source-access restrictions). Traversal-hardened resolver reused from
   * remit A (adversarial symlink/encoded-traversal tests carried over).
   */
  resolveSourcePathToLocal(sourcePath: string): string {
    const { corpusRoot, stackRoot } = this.config
    const refuse = (): CollabHonestError =>
      new CollabHonestError(
        'SOURCE_ACCESS_REFUSED',
        `Source ${sourcePath} is outside the authorised corpus/stack roots.`,
      )
    if (isAbsolute(sourcePath) || sourcePath.includes('..')) throw refuse()
    let root: string | undefined
    let rel: string | undefined
    if (sourcePath.startsWith('Aera_Studios_Docs/')) {
      root = corpusRoot
      rel = sourcePath.slice('Aera_Studios_Docs/'.length)
    } else if (sourcePath.startsWith('aera-stack/')) {
      root = stackRoot
      rel = sourcePath.slice('aera-stack/'.length)
    } else if (sourcePath.startsWith('participation-store/')) {
      root = this.config.storeDir
      rel = sourcePath.slice('participation-store/'.length)
    }
    if (root === undefined || rel === undefined) throw refuse()
    const candidate = resolve(join(root, rel))
    if (!existsSync(candidate)) {
      throw new CollabHonestError('SOURCE_ACCESS_REFUSED', `Source ${sourcePath} does not exist locally under its root.`)
    }
    const realRoot = realpathSync(root)
    const real = realpathSync(candidate)
    if (real !== realRoot && !real.startsWith(realRoot + sep)) throw refuse()
    return real
  }
}
