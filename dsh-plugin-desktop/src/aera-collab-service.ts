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

import { classifyDisplayedZeros, countsAsRendered } from './aera-collab-zero-classifier.ts'
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
  deriveCodeCompareSummary,
  deriveCodeTopology,
  projectCodeCollabSurface,
  type CodeCollabSurfaceV1,
  type RepositoryReferenceResolution,
} from '@aera/participation-runtime'
import {
  COORDINATION_DELIVERY_NOTE,
  DISCUSSION_NOTE,
  NO_COORDINATION_THREADS,
  NO_DISCUSSIONS_OR_DECISIONS,
  buildRail,
  toMessageRowView,
  toPacketCardView,
  toThreadRowView,
  toActivityBlockView,
  toDecisionView,
  toEvidenceCardView,
  toActivityRowView,
  toCheckpointRowView,
  toCompareView,
  toLineRowView,
  toParticipantRowView,
  type CollabCodeView,
  type CollabCompareView,
  type CollabDiscussionView,
  type CollabThreadRowView,
  type CollabLineRowView,
  type CollabLiveProviderStateView,
} from './aera-collab-code-view.ts'
import {
  assessPacketState,
  type CodeCompareSummaryV1,
  type CodeTopologyV1,
  type CollabThreadAnchorV1,
  type CoordinationIntent,
  type PacketStateAssessmentV1,
} from '@aera/participation-contracts'
import { buildProjection } from '@aera/evidentiary-work-graph'
import type { EngineeringWorkGraphProjectionV1 } from '@aera/evidentiary-work-graph-contracts'
import {
  discoverRepositoryCandidate,
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
  projectCollabDirectory,
  type CollabDirectoryView,
} from './aera-collab-directory.ts'
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
      | 'SOURCE_ACCESS_REFUSED'
      /* Coordination threads (§21, §20). */
      | 'COMPARE_UNAVAILABLE'
      | 'PACKET_NOT_FOUND',
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
/**
 * §36 — how many per-file comparison rows the service puts on the wire.
 *
 * 200 matches the client's own render cap (`MAX_RENDERED_FILES`), so nothing
 * that would have been drawn is lost; above it the rows are withheld at the
 * source and the true total is sent in their place. Before this, a 2003-entry
 * array was shipped so the surface could draw three numbers.
 */
const COMPARE_FILE_WIRE_BUDGET = 200

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
  /**
   * WO-AERA-COLLAB-INSTITUTIONAL-ORIENTATION-AND-WORKORDER-STATE-RECONCILIATION-001
   * §19: which native Aera Code Session joined which Work Order IN THIS PROCESS.
   *
   * This service is a per-PROCESS singleton, but a joined Work Order belongs to
   * a SESSION. Without this map, `resumeAgentWorkContextForNativeSession` used
   * to return whatever the process last joined, so a brand-new Session opened in
   * a warm app inherited a stale Work Order and was handed its context as if it
   * had joined it. A Session now only resumes what that Session itself joined.
   */
  private readonly nativeSessionWorkOrders = new Map<string, string>()

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
      await this.openAgentWorkContext(input.workOrderId, input.nativeSessionId)
    } else {
      this.nativeSessionWorkOrders.set(input.nativeSessionId, input.workOrderId)
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
    const store = this.requireStore()
    // 1. This Session joined a Work Order earlier in this process.
    const joined = this.nativeSessionWorkOrders.get(nativeSessionId)
    if (joined !== undefined) {
      const current = store.listWorkOrders().find(order => order.workOrderId === joined)
      if (current !== undefined) {
        if (this.agentWorkOrderId !== joined) {
          await this.closeAgentWorkContext()
          await this.openAgentWorkContext(joined, nativeSessionId)
        }
        return {
          workOrderId: current.workOrderId,
          lifecycleStatus: current.lifecycleStatus ?? 'ACTIVE',
          revision: current.revision ?? 1,
        }
      }
    }
    // 2. This Session is the one that ADMITTED a Work Order (durable evidence
    //    of the join, surviving a process restart).
    const record = store.listWorkOrders()
      .find(order => order.source?.nativeSessionId === nativeSessionId)
    if (record === undefined) {
      // 3. A Session that joined nothing is UNJOINED, even in a warm process
      //    that holds another Session's Work Order. Inheriting it was the
      //    defect: a fresh Session receives institutional ORIENTATION instead.
      return undefined
    }
    await this.openAgentWorkContext(record.workOrderId, nativeSessionId)
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
   * Bounded, non-authoritative INSTITUTIONAL ORIENTATION for a fresh, UNJOINED
   * Session — WO-AERA-COLLAB-INSTITUTIONAL-ORIENTATION-AND-WORKORDER-STATE-RECONCILIATION-001.
   *
   * What changed, and why. The previous shape listed every OWNER_SUPPLIED +
   * ACTIVE Work Order ordered by REGISTRATION TIME, and told the model to ask
   * the owner which one they meant whenever more than one existed. Three things
   * were wrong with that (§8, §9, §16, §17, §28):
   *
   *   - registration time is not recency. The order registered EARLIEST ranked
   *     alongside the one worked on five minutes ago;
   *   - a Work Order admitted in the MINIMAL shape carries no authorityClass and
   *     no lifecycleStatus, so the two most recently worked orders were filtered
   *     out of the owner's own orientation entirely;
   *   - "multiple active orders, therefore ask" is not how human temporal intent
   *     works. "What am I working on?" has a truthful answer.
   *
   * It is now the bounded recent frontier from durable institutional facts:
   * what is resumable now, what was just completed, and the recent
   * predecessors — ranked by the latest MEANINGFUL attributed activity, with
   * effective lifecycle state from the append-only Work Order state series.
   * Reads never move this ranking; only recorded work does.
   *
   * ORIENTATION ONLY. Nothing here joins a Work Order or grants any authority
   * to write, merge or deploy: §7 keeps JOINED work and RECENT work separate.
   * `undefined` when the store is unavailable or nothing has been worked on.
   */
  async agentOrientationContext(): Promise<string | undefined> {
    if (this.config.storeDir === undefined) return undefined
    const store = this.requireStore()
    if (typeof store.orientationFrontier !== 'function') return undefined
    const frontier = store.orientationFrontier()
    const describe = (entry: {
      workOrderId: string
      title: string
      effectiveState: { lifecycleState: string, source: string, evidence?: string }
      lastMeaningfulActivityAt?: string
      meaningfulActivityCount: number
    }): string => {
      const { repositories } = resolveWorkOrderRepositories(store, entry.workOrderId)
      const state = entry.effectiveState.lifecycleState === 'UNRECORDED'
        ? 'state not yet reconciled'
        : `${entry.effectiveState.lifecycleState} (from ${entry.effectiveState.source === 'STATE_RECORD' ? 'a recorded state transition' : 'its admission'})`
      return [
        `- ${entry.workOrderId} — ${entry.title}`,
        `  state: ${state}`,
        `  last meaningful activity: ${entry.lastMeaningfulActivityAt ?? 'none recorded'}`
          + `; ${entry.meaningfulActivityCount} recorded activity event(s)`,
        entry.effectiveState.evidence === undefined ? undefined : '  closure evidence: recorded; retrieve on demand',
        repositories.length === 0
          ? '  repository bindings: none recorded'
          : `  repository bindings: ${String(repositories.length)} recorded; retrieve live state on demand`,
      ].filter((line): line is string => line !== undefined).join('\n')
    }
    const sections: string[] = []
    if (frontier.currentResumable.length > 0) {
      sections.push(frontier.contemporaneous
        ? 'Current / resumable work (two workstreams appear concurrently active; their latest recorded activity is indistinguishable, so neither is ranked above the other):'
        : 'Current / resumable work (most recent meaningful activity first):')
      sections.push(...frontier.currentResumable.map(describe))
    }
    if (frontier.recentlyCompleted.length > 0) {
      sections.push('Recently completed (the last thing finished — recent, but no longer unfinished work):')
      sections.push(...frontier.recentlyCompleted.map(describe))
    }
    if (sections.length === 0) return undefined
    return [
      'No Work Order is joined in this Session. The following is institutional ORIENTATION from the durable participation store — it reflects recorded work, not this conversation, and it grants no authority to write, merge or deploy anything.',
      '',
      ...sections,
      '',
      'Answer this orientation question directly from the frontier without calling collaboration tools. Name current/resumable work, distinguish recently COMPLETED work, and state only the next action the recorded lifecycle supports. Do NOT ask which Work Order is meant merely because more than one is listed — ask only when a requested ACTION cannot be truthfully tied to one of them.',
      'Use aera_collab_resolve_work_context(work_order_id) only when the owner requests detail absent from this snapshot. Retrieve working state, decisions, evidence, residuals or live repository state lazily after that explicit resolution; recorded evidence says what was true then and the provider says what is true now.',
      'Never infer a Work Order or a repository from the workspace path or name.',
    ].join('\n')
  }

  /** @deprecated Retained for compatibility; prefer `agentOrientationContext`. */
  async agentActiveWorkOrdersContext(): Promise<string | undefined> {
    return this.agentOrientationContext()
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
  private resolveWorkingStateIdentity(explicitWorkOrderId?: string): { repositoryId?: RepositoryId, source: string, reason: string } {
    const envId = this.config.repositoryId
    const envValid = envId !== undefined && isRepositoryId(envId)
    const workOrderId = explicitWorkOrderId ?? this.observedWorkOrderId()
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
    // Only `(fetch)` rows: `git remote -v` lists each remote twice.
    const remotes = remoteLines
      .filter(line => line.endsWith('(fetch)'))
      .map(line => { const [name, url] = line.split(/\s+/); return { name: name ?? '', url: url ?? '' } })
      .filter(remote => remote.name.length > 0 && remote.url.length > 0)
    let real: string
    try { real = realpathSync(workspaceRoot) } catch { real = workspaceRoot }
    const knownLocation = resource.localCheckouts.some(row => {
      try { return realpathSync(row.localPath) === real } catch { return row.localPath === real }
    })
    if (resource.provider !== undefined) {
      const wanted = providerRepositoryKey(resource.provider)
      // The workspace's remotes must identify ONE provider repository (or the
      // caller-neutral `origin` must), and it must be the identified one. A
      // checkout carrying several provider remotes (e.g. a Modulop checkout
      // that also tracks Aera-Stack) is labelled only when it is a verified
      // location of the resource or its `origin` is that repository — never
      // because some secondary remote happens to match.
      const discovery = discoverRepositoryCandidate({ remotes, localPath: workspaceRoot })
      const observed = remotes
        .map(remote => parseGitRemoteUrl(remote.url))
        .filter((coordinates): coordinates is RepositoryProviderCoordinatesV1 => coordinates !== undefined)
      const origin = remotes.find(remote => remote.name === 'origin')
      const originCoordinates = origin === undefined ? undefined : parseGitRemoteUrl(origin.url)
      const matches
        = (discovery.kind === 'REPOSITORY_CANDIDATE' && providerRepositoryKey(discovery.provider) === wanted)
          || (discovery.kind === 'AMBIGUOUS_PROVIDER_REMOTES'
            && (knownLocation || (originCoordinates !== undefined && providerRepositoryKey(originCoordinates) === wanted)))
      if (matches) return undefined
      const observedText = observed.length === 0 ? 'none' : observed.map(providerRepositoryIdentity).join(', ')
      return discovery.kind === 'AMBIGUOUS_PROVIDER_REMOTES'
        ? `The workspace at ${workspaceRoot} carries several provider remotes (${observedText}) and is neither a verified checkout location of ${repositoryId} nor has it as origin; it is not labelled ${repositoryId} on the strength of a secondary remote.`
        : `The workspace at ${workspaceRoot} is not a checkout of ${repositoryId} (${providerRepositoryIdentity(resource.provider)}): its remotes are ${observedText}. The working state is not labelled with a repository it does not belong to.`
    }
    if (knownLocation) return undefined
    return `The workspace at ${workspaceRoot} is not a verified checkout location of ${repositoryId} (no provider remote to match against). The working state is not labelled with a repository it does not belong to.`
  }

  // ------------------------------------------------------------------
  // Collab directory — finding a way in without knowing a WorkOrderId.
  //
  // WO-AERA-CODE-COLLAB-READ-FIRST-SURFACE-001, owner entry-point direction.
  // Both operations are strictly read-only: they open no WorkContext, join
  // nothing, and record nothing. Opening a Collab surface stays an explicit
  // act performed later, by the reader.
  // ------------------------------------------------------------------

  /**
   * Find Work Orders by title, id or repository; an empty query lists ACTIVE.
   * @param input - the typed query.
   */
  collabDirectory(input: { readonly query?: string } = {}): CollabDirectoryView {
    return projectCollabDirectory(this.requireStore(), input)
  }

  /**
   * Which Work Order this workspace is about, when that can be said honestly.
   *
   * A repository is never minted from a local path (the rule the working-state
   * identity already follows): the workspace's own remotes must identify a
   * registered repository resource, or the workspace must be one of that
   * resource's verified checkout locations. The Work Order is then the ACTIVE
   * one bound to that repository as PRIMARY. Anything less certain — no
   * identifiable repository, no bound order, or several equally good ones —
   * resolves to the picker WITH THE REASON SAID, never to a guess.
   */
  resolveDefaultWorkOrder(): {
    readonly workOrderId?: string
    readonly repositoryId?: string
    readonly source: 'ENVIRONMENT' | 'WORKSPACE_REMOTE' | 'VERIFIED_CHECKOUT' | 'NONE'
    readonly reason?: string
  } {
    if (this.config.storeDir === undefined) {
      return { source: 'NONE', reason: 'AERA_COLLAB_STORE_DIR is not set, so no Work Order can be resolved.' }
    }
    const identity = this.workspaceRepositoryIdentity()
    if (identity.repositoryId === undefined) return { source: 'NONE', ...(identity.reason === undefined ? {} : { reason: identity.reason }) }
    const { repositoryId } = identity
    const store = this.requireStore()
    const bound = store.listRepositoryBindings()
      .filter(row => row.repositoryId === repositoryId && row.role === 'PRIMARY')
      .map(row => row.workOrderId)
    const active = [...new Set(bound)]
      .filter(workOrderId => store.effectiveWorkOrderState(workOrderId)?.lifecycleState === 'ACTIVE')
      .sort()
    if (active.length === 1 && active[0] !== undefined) {
      return { workOrderId: active[0], repositoryId, source: identity.source }
    }
    return {
      repositoryId,
      source: identity.source,
      reason: active.length === 0
        ? `${repositoryId} has no ACTIVE Work Order bound to it as PRIMARY; choose one instead.`
        : `${repositoryId} has ${String(active.length)} ACTIVE Work Orders bound as PRIMARY (${active.join(', ')}); nothing is chosen silently.`,
    }
  }

  /** Identify the workspace's repository without ever minting one from a path. */
  private workspaceRepositoryIdentity(): {
    readonly repositoryId?: RepositoryId
    readonly source: 'ENVIRONMENT' | 'WORKSPACE_REMOTE' | 'VERIFIED_CHECKOUT' | 'NONE'
    readonly reason?: string
  } {
    const envId = this.config.repositoryId
    if (envId !== undefined && isRepositoryId(envId)) return { repositoryId: envId, source: 'ENVIRONMENT' }
    const workspaceRoot = this.config.workspaceRoot
    if (workspaceRoot === undefined || !existsSync(workspaceRoot)) {
      return { source: 'NONE', reason: 'No workspace root is configured, so this workspace identifies no repository.' }
    }
    let remoteLines: readonly string[]
    try {
      remoteLines = execFileSync('git', ['-C', workspaceRoot, 'remote', '-v'], { encoding: 'utf8', timeout: 10_000 })
        .split('\n').map(line => line.trim()).filter(line => line.length > 0)
    } catch {
      remoteLines = []
    }
    const remotes = remoteLines
      .filter(line => line.endsWith('(fetch)'))
      .map(line => { const [name, url] = line.split(/\s+/); return { name: name ?? '', url: url ?? '' } })
      .filter(remote => remote.name.length > 0 && remote.url.length > 0)
    const resources = this.requireStore().listRepositoryResources()
    let real: string
    try { real = realpathSync(workspaceRoot) } catch { real = workspaceRoot }

    const verified = resources.find(resource => resource.localCheckouts.some(row => {
      try { return realpathSync(row.localPath) === real } catch { return row.localPath === real }
    }))
    const discovery = discoverRepositoryCandidate({ remotes, localPath: workspaceRoot })
    if (discovery.kind === 'REPOSITORY_CANDIDATE') {
      const wanted = providerRepositoryKey(discovery.provider)
      const matched = resources.find(resource =>
        resource.provider !== undefined && providerRepositoryKey(resource.provider) === wanted)
      if (matched !== undefined) return { repositoryId: matched.repositoryId, source: 'WORKSPACE_REMOTE' }
    }
    if (verified !== undefined) return { repositoryId: verified.repositoryId, source: 'VERIFIED_CHECKOUT' }
    return {
      source: 'NONE',
      reason: `The workspace at ${workspaceRoot} does not identify a registered repository resource, and a repository identity is never minted from a local path.`,
    }
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

  /**
   * Which Work Order a READ is about.
   *
   * WO-AERA-CODE-COLLAB-READ-FIRST-SURFACE-001, owner entry-point direction.
   * A read-first surface should not have to write to be read. Naming the order
   * explicitly projects it without joining; omitting the name keeps the
   * original behaviour, where the joined context is the subject. Joining still
   * writes a session record, so it remains something the reader asks for.
   */
  private viewWorkOrderId(explicit?: string): string {
    if (explicit === undefined) return this.requireJoined().workOrderId
    const trimmed = explicit.trim()
    if (trimmed === '') {
      throw new CollabHonestError('WORK_ORDER_NOT_FOUND', 'No Work Order was named, and none is joined.')
    }
    const known = this.requireStore().listWorkOrders().some(order => order.workOrderId === trimmed)
      || this.mergedNavigator().findWorkOrders(trimmed)
        .some(node => node.kind === 'WORK_ORDER' && (node as { workOrderId?: string }).workOrderId === trimmed)
    if (!known) {
      throw new CollabHonestError(
        'WORK_ORDER_NOT_FOUND',
        `No canonical Work Order ${trimmed} exists in the graph projection or the durable store. Reading does not create one.`,
      )
    }
    return trimmed
  }

  private requireJoined(): { client: ParticipationCollaborationClient, session: ParticipationSession, workOrderId: string } {
    if (this.client === null || this.session === null || this.workOrderId === null) {
      throw new CollabHonestError('NOT_JOINED', 'No WorkContext is open. Open a Work Order by its WorkOrderId first.')
    }
    return { client: this.client, session: this.session, workOrderId: this.workOrderId }
  }

  /** Resolve the current shared context into the presentation view model. */
  async contextView(explicitWorkOrderId?: string): Promise<CollabContextView> {
    const workOrderId = this.viewWorkOrderId(explicitWorkOrderId)
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

    const observed = this.observeWorkingState(workOrderId)
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
   * The read-first Code Collab view — WO-AERA-CODE-COLLAB-READ-FIRST-SURFACE-001.
   *
   * Assembled from the SAME joined context the compact Context view uses: one
   * service, one store, one session, one authority stamp. Collab is a
   * viewpoint over the work, not a second collaboration universe (§6).
   *
   * ## What a "line" is here, stated honestly
   *
   * This slice has no write path (§25), so nothing in the product can yet MINT
   * a durable `CodeWorkingLineV1`. The surface therefore shows:
   *
   *   - every durable Working Line the store holds (none until the writing
   *     slice ships), and
   *   - the line OBSERVED from this checkout, marked `OBSERVED` and carrying a
   *     note saying no durable record has been minted for it.
   *
   * An observed line deliberately carries **no** `codeWorkingLineId`. Minting
   * one from the repository, the Work Order and the branch would be deriving
   * institutional identity from a location, which CWL-1 exists to refuse. An
   * honest absence beats an invented id.
   */
  // ------------------------------------------------------------------
  // Coordination threads (WO-AERA-COLLAB-RELAY-COORDINATION-THREADS-AND-
  // WORKING-LINE-HANDOFF-001, §35–§41)
  //
  // These are the FIRST renderer-originated writes into the durable Collab
  // store. Everything the Read-First slice exposed was a projection; sending a
  // message is not. Each one therefore requires a real joined agent session
  // under a recorded delegation, exactly as every other write in this service
  // does — the surface never gets a store handle or a write capability.
  // ------------------------------------------------------------------

  /**
   * Project this Work Order's coordination threads for the surface (§35–§40).
   *
   * A pure read. Packet movement (§19) is assessed here on each read rather
   * than stored, which is the whole point: the snapshot in the packet never
   * changes, and the "has it moved?" line is recomputed every time the reader
   * looks.
   */
  private projectCoordinationThreads(workOrderId: string): readonly CollabThreadRowView[] {
    const store = this.requireStore()
    const threads = store.listCollabThreads(workOrderId)
    if (threads.length === 0) return []
    const packets = store.listCoordinationPackets(workOrderId)
    const decisions = store.listDecisions(workOrderId)
    const workingLineLabels: Record<string, string> = {}
    for (const line of store.listCodeWorkingLines(workOrderId)) {
      if (line.label !== undefined) workingLineLabels[line.codeWorkingLineId] = line.label
    }
    /*
     * Assess each packet once per read, not once per message that references
     * it: a packet shared five times is one comparison, and five identical git
     * reads would be five times the cost for the same answer.
     */
    const assessments = new Map(packets.map(packet => {
      try {
        return [packet.packetId, this.assessPacket(packet.packetId)]
      } catch {
        // An unresolvable assessment is silence about movement, never a claim
        // that nothing moved. The card simply omits its state line.
        return [packet.packetId, undefined]
      }
    }))
    return threads.map(thread => {
      const messages = store.listCollabMessages(thread.threadId).map(message => toMessageRowView(
        message,
        message.references.flatMap(reference => {
          if (reference.kind !== 'PACKET') return []
          const packet = packets.find(row => row.packetId === reference.packetId)
          if (packet === undefined) return []
          const assessment = assessments.get(packet.packetId)
          // §56: name the Working Lines the packet cites, where they have names.
          const names = {
            ...(packet.sourceWorkingLineId === undefined
              ? {}
              : { source: workingLineLabels[packet.sourceWorkingLineId] }),
            ...(packet.targetWorkingLineId === undefined
              ? {}
              : { target: workingLineLabels[packet.targetWorkingLineId] }),
          }
          return [toPacketCardView(packet, assessment, names)]
        }),
      ))
      return toThreadRowView({
        thread,
        messages,
        decisionSubjects: thread.decisionIds.flatMap(decisionId => {
          const decision = decisions.find(row => row.decisionId === decisionId)
          return decision === undefined ? [] : [decision.subject]
        }),
        workingLineLabels,
      })
    })
  }

  /**
   * The joined session every coordination write runs under, **joining on
   * demand** when the surface has not joined yet.
   *
   * MECHANICAL GUI ACCEPTANCE found this the hard way: the Read-First surface
   * projects a Work Order WITHOUT joining it (deliberately — a read should not
   * have to write in order to be read), so every coordination control was
   * visible, reachable, and refused with "No agent WorkContext is open" the
   * moment it was pressed. A feature that is present and inert is worse than
   * one that is absent, because the absent one promises nothing.
   *
   * Joining here does not blur the verb boundary the predecessor order drew —
   * it honours it. That boundary exists because joining writes `sessions.json`
   * and a GET must not mutate. Every caller of this method is already an
   * explicit POST about to write durable records, so the session write it
   * implies is exactly as authorised as the message write it carries.
   *
   * The Work Order is taken from the caller where stated, because the renderer
   * may be looking at an order other than this workspace's default, and a
   * message must land on the order the sender was actually reading.
   */
  private async requireCoordinationAuthority(workOrderId?: string): Promise<{
    readonly store: ParticipationStore
    readonly sessionId: string
    readonly workOrderId: string
  }> {
    const store = this.requireStore()
    const target = workOrderId ?? this.agentWorkOrderId ?? this.resolveDefaultWorkOrder().workOrderId
    if (target === undefined) {
      throw new CollabHonestError(
        'WORK_ORDER_NOT_FOUND',
        'No Work Order was named and none could be resolved for this workspace, so there is nothing to coordinate about.',
      )
    }
    // Re-join when the surface moved to a different order: a session opened
    // under one Work Order is not authority over another.
    if (this.agentSession === null || this.agentClient === null || this.agentWorkOrderId !== target) {
      await this.openAgentWorkContext(target)
    }
    const { session, workOrderId: joined } = this.requireAgentJoined()
    return { store, sessionId: session.sessionId, workOrderId: joined }
  }

  /**
   * The human principal this desktop speaks for, from configuration only.
   *
   * §10: a message sent from the product's composer is the PERSON speaking,
   * not the agent that carried it. The store stamps the kind from its own
   * registry, so a misconfiguration produces an honest refusal rather than an
   * agent quietly posing as the owner.
   */
  private requireHumanPrincipal(): string {
    const { principalId } = this.config
    if (principalId === undefined || !isAeraPrincipalId(principalId)) {
      throw new CollabHonestError(
        'AGENT_UNAVAILABLE',
        'Sending a message needs a canonical AERA_COLLAB_PRINCIPAL_ID for the person sending it. A human sender is never invented.',
      )
    }
    return principalId
  }

  /** Open a coordination thread (§8, §35). */
  async openCoordinationThread(input: {
    readonly subject: string
    readonly anchors?: readonly CollabThreadAnchorV1[]
    readonly participantPrincipalIds?: readonly string[]
    readonly workOrderId?: string
  }): Promise<{ readonly threadId: string, readonly outcome: string }> {
    const { store, sessionId, workOrderId } = await this.requireCoordinationAuthority(input.workOrderId)
    const human = this.requireHumanPrincipal()
    const result = store.openCollabThread({
      sessionId,
      authorisingWorkOrderId: workOrderId,
      workOrderId,
      subject: input.subject,
      anchors: input.anchors ?? [{ kind: 'WORK_ORDER', workOrderId }],
      participantPrincipalIds: [
        ...(input.participantPrincipalIds ?? []),
        human,
      ] as unknown as Parameters<ParticipationStore['openCollabThread']>[0]['participantPrincipalIds'],
      openedByPrincipalId: human as Parameters<ParticipationStore['openCollabThread']>[0]['openedByPrincipalId'],
    })
    return { threadId: result.thread.threadId, outcome: result.outcome }
  }

  /**
   * Send one message (§9, §31).
   *
   * `requestId` comes from the renderer and is the idempotency key: a
   * double-clicked Send, or a retried request after a dropped response,
   * resolves to the SAME message rather than a second one.
   */
  async postCoordinationMessage(input: {
    readonly threadId: string
    readonly body: string
    readonly intent?: CoordinationIntent
    readonly packetId?: string
    readonly parentMessageId?: string
    readonly requestId: string
    readonly workOrderId?: string
  }): Promise<{ readonly messageId: string, readonly outcome: string, readonly sequence: number }> {
    const { store, sessionId, workOrderId } = await this.requireCoordinationAuthority(input.workOrderId)
    const human = this.requireHumanPrincipal()
    const result = store.postCollabMessage({
      sessionId,
      authorisingWorkOrderId: workOrderId,
      threadId: input.threadId as Parameters<ParticipationStore['postCollabMessage']>[0]['threadId'],
      senderPrincipalId: human as Parameters<ParticipationStore['postCollabMessage']>[0]['senderPrincipalId'],
      body: input.body,
      ...(input.intent === undefined ? {} : { intent: input.intent }),
      ...(input.packetId === undefined
        ? {}
        : { references: [{ kind: 'PACKET' as const, packetId: input.packetId as never }] }),
      ...(input.parentMessageId === undefined
        ? {}
        : { parentMessageId: input.parentMessageId as NonNullable<Parameters<ParticipationStore['postCollabMessage']>[0]['parentMessageId']> }),
      requestId: input.requestId,
    })
    return {
      messageId: result.message.messageId,
      outcome: result.outcome,
      sequence: result.message.sequence,
    }
  }

  /**
   * §21 — SHARE FROM COMPARE.
   *
   * The packet is built from the EXACT operands of a Compare that has already
   * been computed for this surface, not from a fresh recomputation: sharing
   * "what I am looking at" must send what the sender was actually looking at.
   * No model call is involved (§41); this is arithmetic over a diff summary.
   */
  /**
   * Resolve the comparison a share would send. **A PURE READ: it computes,
   * validates and refuses, and writes nothing.**
   *
   * Extracted so that every refusal a share can hit — no comparison open, an
   * unresolvable target, a line that cannot be observed — fires BEFORE any
   * record is created. Independent review R5-3 found the sequencing defect
   * this closes: `shareCompareToThread` created a brand-new thread at step 1
   * and only then called into the packet path, so a share with no comparison
   * left an empty orphan thread behind. That is the same write-before-validate
   * shape that produced the orphan packet `a02ba81a`, one level up.
   */
  private async resolveCompareForShare(input: {
    readonly workOrderId: string
    readonly compareLineIndex?: number
  }): Promise<{
    readonly comparison: NonNullable<Parameters<ParticipationStore['recordCoordinationPacket']>[0]['comparison']>
    readonly sourceWorkingLineId?: string
  }> {
    const view = await this.collabView({
      workOrderId: input.workOrderId,
      ...(input.compareLineIndex === undefined ? {} : { compareLineIndex: input.compareLineIndex }),
    })
    const observed = this.observeWorkingState(input.workOrderId)
    const topology = await this.deriveObservedTopology(observed)
    const computed = await this.computeObservedCompare({
      ...(input.compareLineIndex === undefined ? {} : { compareLineIndex: input.compareLineIndex }),
      lines: view.lines,
      ...(observed.view === undefined ? {} : { workspaceRoot: observed.view.localPath }),
      ...(topology === undefined ? {} : { topology }),
    })
    const summary = computed.summary
    if (summary === undefined) {
      throw new CollabHonestError(
        'COMPARE_UNAVAILABLE',
        computed.compareUnavailableReason
        ?? view.compareUnavailableReason
        ?? 'There is no computed comparison to share. Open a Compare first \u2014 a packet is a snapshot of a real comparison, never a fabricated one.',
      )
    }
    /*
     * §17/§56: record which Working Line the SOURCE side was, where the
     * compared row actually has a durable Working Line record.
     *
     * Only the source, deliberately. The target of this comparison is an
     * accepted integration ref, not a Working Line, so `targetWorkingLineId`
     * stays absent rather than being filled with something that is not a
     * Working Line (independent review R2, finding 2).
     *
     * The id is read from the row rather than resolved from the branch on
     * purpose — CWL-1 forbids resolving a Working Line by its branch, label or
     * path, and a convenient lookup here would be exactly that violation.
     */
    const sourceWorkingLineId = input.compareLineIndex === undefined
      ? undefined
      : view.lines[input.compareLineIndex]?.codeWorkingLineId
    /*
     * §17 lists RepositoryId among the packet's minimum content. Validated
     * rather than cast: a configured value that is not a canonical
     * RepositoryId is omitted, because a packet that names the wrong
     * repository is worse than one that names none (R2, finding 1).
     */
    const observedRepositoryId = observed.view !== undefined
      && isRepositoryId(observed.view.repositoryId)
      ? observed.view.repositoryId
      : undefined
    return {
      comparison: {
        ...(observedRepositoryId === undefined ? {} : { repositoryId: observedRepositoryId }),
        sourceRevision: summary.fromRevision,
        targetRevision: summary.toRevision,
        ...(summary.mergeBase === undefined ? {} : { mergeBase: summary.mergeBase }),
        filesChanged: summary.files.length,
        filesChangedOnBothLines: summary.totals.filesChangedOnBothLines,
        filesChangedOnlyOnSource: summary.totals.filesChangedOnlyOnSource,
        filesChangedOnlyOnTarget: summary.totals.filesChangedOnlyOnTarget,
        textualConflicts: summary.files.filter(file => file.textuallyConflicted).length,
        linesAdded: summary.totals.linesAdded,
        linesRemoved: summary.totals.linesRemoved,
        structuralDeltaAvailable: false,
      },
      ...(sourceWorkingLineId === undefined ? {} : { sourceWorkingLineId }),
    }
  }

  /**
   * §21 — record a Compare packet. The comparison is resolved first and the
   * packet is written only if that succeeded.
   */
  async shareComparePacket(input: {
    readonly compareLineIndex?: number
    readonly workOrderId?: string
  } = {}): Promise<{ readonly packetId: string, readonly outcome: string }> {
    const { store, sessionId, workOrderId } = await this.requireCoordinationAuthority(input.workOrderId)
    const human = this.requireHumanPrincipal()
    const resolved = await this.resolveCompareForShare({
      workOrderId: input.workOrderId ?? workOrderId,
      ...(input.compareLineIndex === undefined ? {} : { compareLineIndex: input.compareLineIndex }),
    })
    const result = store.recordCoordinationPacket({
      sessionId,
      authorisingWorkOrderId: workOrderId,
      workOrderId,
      subject: 'WORKING_LINE_COMPARE',
      ...(resolved.sourceWorkingLineId === undefined
        ? {}
        : { sourceWorkingLineId: resolved.sourceWorkingLineId as NonNullable<Parameters<ParticipationStore['recordCoordinationPacket']>[0]['sourceWorkingLineId']> }),
      comparison: resolved.comparison,
      observedByPrincipalId: human as Parameters<ParticipationStore['recordCoordinationPacket']>[0]['observedByPrincipalId'],
    })
    return { packetId: result.packet.packetId, outcome: result.outcome }
  }

  /**
   * §21 / §35 — SHARE / SEND TO COLLABORATOR, from Compare, with a recipient.
   *
   * **Confirm before write, and resolve the recipient FIRST.**
   *
   * The first version of this created the packet the moment the button was
   * pressed and only then looked for somewhere to put it. Mechanical
   * acceptance duly produced `aera:coordination-packet:a02ba81a` — a real
   * 2,003-file snapshot, written durably, referenced by nothing, visible to
   * nobody. It is still in the store, because the store is append-only and
   * deleting institutional records to tidy an evidence trail is the habit
   * these orders exist to prevent.
   *
   * So the order of operations here is load-bearing, not incidental:
   *
   *   1. check the recipient SPEC — exactly one of a thread or a new subject;
   *   2. validate an EXISTING thread (exists, active, sender in scope);
   *   3. **resolve the comparison** — a pure read that refuses if there is
   *      none to send;
   *   4. only now create a NEW thread, if that is what was asked for;
   *   5. write the packet;
   *   6. post the message that references it.
   *
   * Steps 1–3 touch nothing, so a cancelled share, a share with no recipient
   * and a share with no comparison all leave the store exactly as they found
   * it. Step 3 sits before step 4 because of independent review R5-3: the
   * previous version created the new thread first and left an empty orphan
   * thread behind whenever the comparison turned out to be unavailable.
   *
   * Full honesty about the residual: this is not a database transaction, and
   * `requestId` does not make it one. If the process died between 5 and 6 the
   * packet would survive unreferenced. What reduces that risk is step 2/4 —
   * by the time the packet is written the only remaining work is an append to
   * a thread already proven writable.
   *
   * `requestId` binds a retry only within the same observation: `observedAt`
   * is retaken on each share, so pressing Send twice at different times is
   * deliberately two observations and mints two packets and two messages. That
   * is intended — each packet is an honest record of what the sender saw at
   * that moment — and it is not an idempotency guarantee.
   */
  async shareCompareToThread(input: {
    readonly workOrderId?: string
    readonly compareLineIndex?: number
    /** An existing thread to send into. */
    readonly threadId?: string
    /** Or a subject, to open a thread for this Work Order and send into that. */
    readonly newThreadSubject?: string
    /** §21: "the sender may add a human note." */
    readonly note?: string
  }): Promise<{
    readonly packetId: string
    readonly threadId: string
    readonly messageId: string
    readonly outcome: string
  }> {
    const { store, sessionId, workOrderId } = await this.requireCoordinationAuthority(input.workOrderId)
    const human = this.requireHumanPrincipal()

    // ---- 1 · the recipient SPEC, checked without writing anything
    const namedThreadId = input.threadId?.trim() ?? ''
    const newSubject = input.newThreadSubject?.trim() ?? ''
    if (namedThreadId === '' && newSubject === '') {
      throw new CollabHonestError(
        'INVALID_INPUT',
        'A comparison is shared WITH someone. Choose a thread to send it to, or name a new one — nothing is written until you do.',
      )
    }
    if (namedThreadId !== '' && newSubject !== '') {
      throw new CollabHonestError(
        'INVALID_INPUT',
        'Name either an existing thread or a new one, not both — it is not clear where this should land, so nothing was written.',
      )
    }

    /*
     * ---- 2 · an EXISTING recipient is validated before anything is written.
     * A new one is not created yet: see step 3.
     */
    const requireWritableThread = (threadId: string): void => {
      const thread = store.listCollabThreads(workOrderId).find(row => row.threadId === threadId)
      if (thread === undefined) {
        throw new CollabHonestError(
          'WORK_ORDER_NOT_FOUND',
          `No coordination thread ${threadId} exists on this Work Order, so there is nobody to share the comparison with. Nothing was written.`,
        )
      }
      if (thread.lifecycle === 'ARCHIVED') {
        throw new CollabHonestError(
          'INVALID_INPUT',
          'That thread is archived. Reopen it before sharing into it — nothing was written.',
        )
      }
      if (!thread.accessScope.authorisedPrincipalIds.includes(human as never)) {
        throw new CollabHonestError(
          'INVALID_INPUT',
          'You are not within that thread\u2019s access scope, so the comparison was not shared and nothing was written.',
        )
      }
    }
    if (namedThreadId !== '') requireWritableThread(namedThreadId)

    /*
     * ---- 3 · RESOLVE THE COMPARISON BEFORE CREATING ANYTHING.
     *
     * This ordering is the whole finding of independent review R5-3. The
     * previous version created a brand-new thread first and only then went
     * looking for a comparison, so a share with nothing to send left an empty
     * orphan thread in the durable store — the same write-before-validate
     * shape that produced the orphan packet `a02ba81a`, one level up. Every
     * refusal a share can hit now fires while the store is still untouched.
     */
    const resolved = await this.resolveCompareForShare({
      workOrderId,
      ...(input.compareLineIndex === undefined ? {} : { compareLineIndex: input.compareLineIndex }),
    })

    // ---- 4 · only now is a new recipient created
    const threadId = namedThreadId !== ''
      ? namedThreadId
      : (await this.openCoordinationThread({ workOrderId, subject: newSubject })).threadId
    if (namedThreadId === '') requireWritableThread(threadId)

    // ---- 5 · the packet, from the comparison resolved at step 3
    const packet = store.recordCoordinationPacket({
      sessionId,
      authorisingWorkOrderId: workOrderId,
      workOrderId,
      subject: 'WORKING_LINE_COMPARE',
      ...(resolved.sourceWorkingLineId === undefined
        ? {}
        : { sourceWorkingLineId: resolved.sourceWorkingLineId as NonNullable<Parameters<ParticipationStore['recordCoordinationPacket']>[0]['sourceWorkingLineId']> }),
      comparison: resolved.comparison,
      observedByPrincipalId: human as Parameters<ParticipationStore['recordCoordinationPacket']>[0]['observedByPrincipalId'],
    }).packet

    // ---- 6 · the message that makes it visible to the recipient
    const note = input.note?.trim() ?? ''
    const posted = store.postCollabMessage({
      sessionId,
      authorisingWorkOrderId: workOrderId,
      threadId: threadId as Parameters<ParticipationStore['postCollabMessage']>[0]['threadId'],
      senderPrincipalId: human as Parameters<ParticipationStore['postCollabMessage']>[0]['senderPrincipalId'],
      body: note === '' ? 'Sharing the comparison I am looking at.' : note,
      intent: 'REVIEW_REQUEST',
      references: [{ kind: 'PACKET', packetId: packet.packetId as never }],
      requestId: `share-compare-${packet.packetId}`,
    })
    return {
      packetId: packet.packetId,
      threadId,
      messageId: posted.message.messageId,
      outcome: posted.outcome,
    }
  }

  /**
   * §20 — VIEW CURRENT STATE.
   *
   * Resolves the live revisions and compares them against the packet's frozen
   * snapshot. This is a READ: it returns a fresh assessment and writes nothing,
   * least of all into the packet.
   */
  assessPacket(packetId: string): PacketStateAssessmentV1 {
    const store = this.requireStore()
    const packet = store.listCoordinationPackets().find(row => row.packetId === packetId)
    if (packet === undefined) {
      throw new CollabHonestError('PACKET_NOT_FOUND', `No packet ${packetId} exists in the durable store.`)
    }
    const observed = this.observeWorkingState(packet.workOrderId)
    const head = observed.view?.headRevision
    const targetRef = observed.view === undefined
      ? undefined
      : this.integrationTargetRef(observed.view.repositoryId)
    const targetHead = observed.view === undefined || targetRef === undefined
      ? undefined
      : this.observedRevision(observed.view.localPath, targetRef)
    return assessPacketState({
      packet,
      ...(head === undefined ? {} : { currentSourceRevision: head }),
      ...(targetHead === undefined ? {} : { currentTargetRevision: targetHead }),
      assessedAt: new Date().toISOString(),
    })
  }

  /** §29 — acknowledge one message, explicitly. */
  async acknowledgeCoordinationMessage(input: {
    readonly threadId: string
    readonly messageId: string
    readonly kind: 'READ' | 'ACKNOWLEDGED'
    readonly workOrderId?: string
  }): Promise<{ readonly outcome: string }> {
    const { store, sessionId, workOrderId } = await this.requireCoordinationAuthority(input.workOrderId)
    const human = this.requireHumanPrincipal()
    const result = store.acknowledgeCollabMessage({
      sessionId,
      authorisingWorkOrderId: workOrderId,
      threadId: input.threadId as Parameters<ParticipationStore['acknowledgeCollabMessage']>[0]['threadId'],
      messageId: input.messageId as Parameters<ParticipationStore['acknowledgeCollabMessage']>[0]['messageId'],
      byPrincipalId: human as Parameters<ParticipationStore['acknowledgeCollabMessage']>[0]['byPrincipalId'],
      kind: input.kind,
    })
    return { outcome: result.outcome }
  }

  /** §33 — archive or reopen. Nothing is erased. */
  async setCoordinationThreadLifecycle(input: {
    readonly threadId: string
    readonly lifecycle: 'ACTIVE' | 'ARCHIVED'
    readonly workOrderId?: string
  }): Promise<{ readonly outcome: string }> {
    const { store, sessionId, workOrderId } = await this.requireCoordinationAuthority(input.workOrderId)
    const result = store.setCollabThreadLifecycle({
      sessionId,
      authorisingWorkOrderId: workOrderId,
      threadId: input.threadId as Parameters<ParticipationStore['setCollabThreadLifecycle']>[0]['threadId'],
      lifecycle: input.lifecycle,
    })
    return { outcome: result.outcome }
  }

  /**
   * §13/§39 — RECORD DECISION FROM DISCUSSION.
   *
   * An EXPLICIT act with an explicit option set and an explicit selection.
   * Nothing here reads message text, and there is deliberately no variant of
   * this that infers a decision from what was said (§14). The caller states
   * the alternatives that genuinely existed; the canonical `DecisionV1` is
   * what gets written (§49).
   */
  async recordDecisionFromThread(input: {
    readonly threadId: string
    readonly subject: string
    readonly options: readonly { readonly optionId: string, readonly label: string }[]
    readonly selectedOptionId: string
    readonly rationale?: string
    readonly messageIds?: readonly string[]
    readonly workOrderId?: string
  }): Promise<{ readonly decisionId: string, readonly outcome: string }> {
    const { store, sessionId, workOrderId } = await this.requireCoordinationAuthority(input.workOrderId)
    const human = this.requireHumanPrincipal()
    const decision = store.recordDecision({
      sessionId,
      authorisingWorkOrderId: workOrderId,
      workOrderId,
      subject: input.subject,
      options: input.options,
      selectedOptionId: input.selectedOptionId,
      ...(input.rationale === undefined ? {} : { rationale: input.rationale }),
      threadId: input.threadId as NonNullable<Parameters<ParticipationStore['recordDecision']>[0]['threadId']>,
      ...(input.messageIds === undefined
        ? {}
        : { messageIds: input.messageIds as NonNullable<Parameters<ParticipationStore['recordDecision']>[0]['messageIds']> }),
      /*
       * §49/§31: the PERSON decided; this agent session only typed it in. The
       * store refuses an agent that names itself as decider, so this is the
       * only honest value here.
       */
      decidedBy: human as NonNullable<Parameters<ParticipationStore['recordDecision']>[0]['decidedBy']>,
    }).decision
    store.linkThreadDecision({
      sessionId,
      authorisingWorkOrderId: workOrderId,
      threadId: input.threadId as Parameters<ParticipationStore['linkThreadDecision']>[0]['threadId'],
      decisionId: decision.decisionId,
    })
    return { decisionId: decision.decisionId, outcome: 'RECORDED' }
  }

  /**
   * The observed checkout's position against Integration.
   *
   * Extracted so SHARE (§21) derives the topology through the SAME path the
   * surface drew from. `expectedTargetRevision` is the seed of
   * target-movement detection: the durable seed is
   * `WorktreeInstanceV1.expectedBase`, and where the worktree carries none the
   * observed merge base is used, with the topology facts saying so rather than
   * pretending a recorded expectation exists.
   */
  private async deriveObservedTopology(
    observed: ReturnType<CollabWorkspaceService['observeWorkingState']>,
  ): Promise<CodeTopologyV1 | undefined> {
    if (observed.view === undefined) return undefined
    const targetRef = this.integrationTargetRef(observed.view.repositoryId)
    // No recorded canonical branch means no target. Refuse rather than guess.
    if (targetRef === undefined) return undefined
    const expected = observed.instance?.expectedBase
      ?? this.observedMergeBase(observed.view.localPath, observed.view.branchRef, targetRef)
      ?? observed.view.headRevision
    try {
      return await deriveCodeTopology({
        repositoryRoot: observed.view.localPath,
        branchRef: observed.view.branchRef,
        targetRef,
        expectedTargetRevision: expected,
        targetName: 'Integration',
        lineIsMine: true,
      })
    } catch {
      return undefined
    }
  }

  /**
   * The one place a Compare is derived for this surface.
   *
   * Extracted so that SHARE (§21) sends the EXACT operands the reader is
   * looking at. Two derivations, however carefully written, drift; one
   * derivation with two callers cannot. It returns the raw
   * `CodeCompareSummaryV1` alongside the view precisely so the packet is built
   * from the measured facts rather than re-measured at share time.
   *
   * COMPARE IS ONLY EVER THE OBSERVED LINE — finding 2 of the independent
   * review of the predecessor order. Every fact comes from `topology`, an
   * observation of THIS checkout, so the FROM label is taken from the row that
   * actually produced the facts. A request for any other row is refused with a
   * stated reason rather than answered with the wrong diff.
   */
  private async computeObservedCompare(input: {
    readonly compareLineIndex?: number
    readonly lines: readonly CollabLineRowView[]
    readonly workspaceRoot?: string
    readonly topology?: CodeTopologyV1
  }): Promise<{
    summary?: CodeCompareSummaryV1
    compare?: CollabCompareView
    compareUnavailableReason?: string
  }> {
    if (input.compareLineIndex === undefined) return {}
    const requested = input.lines[input.compareLineIndex]
    if (requested === undefined) {
      return { compareUnavailableReason: 'That Working Line is no longer on this surface.' }
    }
    if (requested.provenance !== 'OBSERVED') {
      return {
        compareUnavailableReason:
          `Compare is only available for the checkout this window can observe. \`${requested.label}\` is a durable Working Line record, and this slice cannot observe its checkout.`,
      }
    }
    const { workspaceRoot, topology } = input
    if (
      workspaceRoot === undefined
      || topology === undefined
      || topology.state === 'UNRESOLVED'
      || topology.facts.lineRevision === undefined
      || topology.facts.targetRevision === undefined
    ) {
      return {
        compareUnavailableReason:
          'These two states cannot be compared: this Working Line\u2019s position could not be read.',
      }
    }
    const summary = await deriveCodeCompareSummary({
      repositoryRoot: workspaceRoot,
      from: { kind: 'REVISION', revision: topology.facts.lineRevision },
      to: { kind: 'REVISION', revision: topology.facts.targetRevision },
      fromRevision: topology.facts.lineRevision,
      toRevision: topology.facts.targetRevision,
      topology,
    })
    return {
      summary,
      compare: toCompareView({
        /*
         * §36 — the surface renders at most a couple of hundred rows and shows
         * a bounded summary by default, so sending thousands is pure waste.
         * The aggregate counts are unaffected; only the per-file rows are held
         * back, and the reader is told the true total.
         */
        fileBudget: COMPARE_FILE_WIRE_BUDGET,
        summary,
        fromName: requested.label,
        toName: 'Accepted integration \u2014 Integration',
      }),
    }
  }

  async collabView(input: {
    readonly compareLineIndex?: number
    readonly workOrderId?: string
  } = {}): Promise<CollabCodeView> {
    const workOrderId = this.viewWorkOrderId(input.workOrderId)
    const store = this.requireStore()
    const context = await this.contextView(workOrderId)
    const observed = this.observeWorkingState(workOrderId)

    const { repositories } = resolveWorkOrderRepositories(store, workOrderId)
    const surface: CodeCollabSurfaceV1 = projectCodeCollabSurface({ store, workOrderId })

    const lines: CollabLineRowView[] = []
    let topology: CodeTopologyV1 | undefined
    let workspaceRoot: string | undefined

    if (observed.view === undefined) {
      lines.length = 0
    } else {
      workspaceRoot = observed.view.localPath
      topology = await this.deriveObservedTopology(observed)
      lines.push(toLineRowView({
        label: `This checkout · ${observed.view.branchRef}`,
        participant: this.config.principalName ?? 'You',
        ...(topology === undefined ? {} : { topology }),
        topologyUnavailableReason:
          'This checkout’s position against Integration could not be read.',
        checkpointCount: 0,
        provenance: 'OBSERVED',
        provenanceNote:
          'Observed from this checkout. No durable Working Line record has been minted for it — minting arrives with the writing slice.',
      }))
    }

    const lineLabelsById = new Map<string, string>()
    for (const projection of surface.lines) {
      const label = projection.line.label ?? projection.line.codeWorkingLineId
      lineLabelsById.set(projection.line.codeWorkingLineId, label)
      /*
       * §40, §41, §42: a durable line now shows where it CAME FROM, where it
       * is GOING, and the last meaningful state it reached. Each is read off a
       * real record — `lineage` is absent rather than invented when the
       * projection has none, and `latestCheckpoint` is absent when no
       * checkpoint has been named, which is the honest answer and the one that
       * keeps the §15 rule visible: a checkpoint is not a commit, so a line
       * with commits and no checkpoints truthfully has none.
       */
      const lineage = surface.institutional.lineageByLineId.get(projection.line.codeWorkingLineId)
      const lineCorrection = surface.institutional.correctionNotes
        .find(note => note.subjectRecordId === projection.line.codeWorkingLineId)
      const latest = projection.checkpoints.at(-1)
      lines.push(toLineRowView({
        label,
        participant: projection.participantDisplayName ?? 'Participant unresolved',
        ...(projection.topology === undefined ? {} : { topology: projection.topology }),
        checkpointCount: projection.checkpoints.length,
        codeWorkingLineId: projection.line.codeWorkingLineId,
        provenance: 'DURABLE',
        ...(lineage === undefined ? {} : { lineage }),
        ...(latest === undefined
          ? {}
          : { latestCheckpoint: `${latest.label ?? `Checkpoint ${String(latest.lineSequence)}`}${latest.summary === undefined ? '' : ` — ${latest.summary}`}` }),
        lifecycle: projection.line.lifecycle,
        ...(lineCorrection === undefined ? {} : { correction: lineCorrection }),
      }))
    }

    /*
     * COMPARE IS ONLY EVER THE OBSERVED LINE — finding 2 of the independent
     * review, fixed at both layers.
     *
     * Every fact below comes from `topology`, which is an observation of THIS
     * checkout. The earlier code took the FROM label from
     * `lines[compareLineIndex]`, so a durable Working Line row at that index
     * would have put its own name on the observed checkout's diff. It was
     * unreachable in practice — the projection passes no durable lines yet —
     * but a latent mislabel in a surface whose entire claim is truthful
     * attribution is not something to leave sitting there.
     *
     * The guard is now explicit and the name is taken from the row that
     * actually produced the facts. A request for any other row is refused with
     * a stated reason rather than answered with the wrong diff.
     */
    const computed = await this.computeObservedCompare({
      ...(input.compareLineIndex === undefined ? {} : { compareLineIndex: input.compareLineIndex }),
      lines,
      ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
      ...(topology === undefined ? {} : { topology }),
    })
    const compare = computed.compare
    const compareUnavailableReason = computed.compareUnavailableReason

    const liveProviderState = this.collabLiveProviderState(workOrderId)
    /*
     * §35: threads are PROJECTED here, on the same joinless read as everything
     * else on this surface. Reading them mutates nothing — the packet movement
     * assessment in particular is computed fresh and written nowhere.
     */
    const threads = this.projectCoordinationThreads(workOrderId)

    /*
     * §30 / §46 review BL-2 — build the view FIRST, then derive the counts and
     * the classification from it. The classifier used to be handed numbers
     * assembled here while Record rendered its own expressions, and the two
     * disagreed on three of five categories. One object, one derivation, no
     * second opinion.
     */
    const view = {
      workOrderId: context.workOrderId,
      ...(context.workOrderLabel === undefined ? {} : { workOrderTitle: context.workOrderLabel }),
      repositories: repositories.map(repository => `${repository.displayName} (${repository.role})`),
      authorityMode: context.authorityMode,
      authorityModeNote: context.authorityModeNote,
      assembledAt: context.assembledAt,
      participants: surface.participants.map(row => {
        const contribution = surface.institutional.contributions
          .find(entry => entry.principalId === row.principalId)
        return toParticipantRowView(row, lineLabelsById, contribution)
      }),
      lines,
      ...(lines.length === 0
        ? {
            linesEmptyReason:
              observed.unavailableReason
              ?? 'No Working Lines have been opened on this Work Order yet, and no checkout is open to observe.',
          }
        : {}),
      rail: buildRail({
        activity: surface.activity.length,
        checkpoints: surface.checkpoints.length,
        /*
         * ABSENT, not zero, until a Compare has actually been computed —
         * finding 4 of the independent review. The changed-file inventory is
         * the diff between a line and its target; until that diff is computed
         * there is no count, and a `0` badge would tell the reader that
         * nothing changed.
         */
        ...(compare === undefined ? {} : { changedFiles: compare.files.length }),
        evidence: context.evidence.length + surface.institutional.evidenceCards.length,
        discussionsDecisions:
          surface.institutional.discussions.length
          + surface.institutional.threadDiscussions.length
          + surface.institutional.decisionContexts.length,
        coordination: threads.length,
        archived: surface.archivedLineIds.length,
      }),
      activity: surface.activity.map(toActivityRowView),
      checkpoints: surface.checkpoints.map(row => toCheckpointRowView(
        row,
        surface.institutional.correctionNotes.find(note => note.subjectRecordId === row.checkpointId),
      )),
      ...(surface.checkpoints.length === 0
        ? {
            checkpointsEmptyReason:
              'No checkpoints have been named on this Work Order yet. The truthful underlying state is the head of each line’s branch, shown above.',
          }
        : {}),
      evidence: context.evidence.map(node => ({
        label: node.label,
        status: node.status,
        ...(node.sourcePath === undefined ? {} : { technical: node.sourcePath }),
      })),
      // §46: typed cards are what the surface draws; the prose list above
      // stays as the raw layer beneath them (§47).
      evidenceCards: surface.institutional.evidenceCards.map(toEvidenceCardView),
      /*
       * §43: blocks sit ABOVE the raw rows, which remain in `activity`
       * untouched. A member row is matched back to its raw row by rowId so the
       * block shows exactly the acts it groups and invents no prose of its own.
       */
      activityBlocks: surface.institutional.activityBlocks.map(block => {
        const byRowId = new Map(surface.activity.map(row => [row.rowId, row]))
        return toActivityBlockView(
          block,
          block.members.map(member => {
            const raw = byRowId.get(member.rowId)
            return raw === undefined
              ? { actor: member.actor, summary: member.summary, when: member.at }
              : toActivityRowView(raw)
          }),
        )
      }),
      decisions: surface.institutional.decisionContexts.map(toDecisionView),
      discussions: [
        /*
         * §3: threads first — they are the live conversation, and a reader
         * looking at "Discussions & decisions" wants the thing currently being
         * talked about before the archive of what was. By reference: the
         * counts come from the projection, the messages stay in the thread.
         */
        ...surface.institutional.threadDiscussions.map((thread): CollabDiscussionView => ({
          kind: 'THREAD' as const,
          subject: thread.subject,
          entryCount: thread.messageCount,
          participants: [...thread.participants],
          updatedAt: thread.lastMessageAt ?? thread.firstMessageAt ?? '',
          ...(thread.aboutLine === '' ? {} : { latestEntry: thread.aboutLine }),
          technical: [
            thread.threadId,
            ...(thread.packetCount === 0 ? [] : [`${String(thread.packetCount)} shared comparison(s)`]),
            ...thread.decisionIds,
          ],
        })),
        ...surface.institutional.discussions.map(discussion => {
        const latest = discussion.entries.at(-1)
        return {
          kind: 'DISCUSSION' as const,
          subject: discussion.subject,
          entryCount: discussion.entries.length,
          participants: [...discussion.participants],
          updatedAt: discussion.updatedAt,
          ...(latest === undefined ? {} : { latestEntry: latest.text }),
          technical: [discussion.discussionId],
        }
        }),
      ],
      ...(surface.institutional.discussions.length === 0
        && surface.institutional.threadDiscussions.length === 0
        && surface.institutional.decisionContexts.length === 0
        ? { discussionsDecisionsEmptyReason: NO_DISCUSSIONS_OR_DECISIONS }
        : {}),
      threads,
      ...(threads.length === 0 ? { threadsEmptyReason: NO_COORDINATION_THREADS } : {}),
      coordinationDeliveryNote: COORDINATION_DELIVERY_NOTE,
      ...(liveProviderState === undefined ? {} : { liveProviderState }),
      discussionNote: DISCUSSION_NOTE,
      archivedCount: surface.archivedLineIds.length,
      ...(compare === undefined ? {} : { compare }),
      ...(compareUnavailableReason === undefined ? {} : { compareUnavailableReason }),
      projectedAt: surface.projectedAt,
    }

    /*
     * The counts Record will display, computed once. Both the view and the
     * classifier read this same object, so "displayed zero" and "classified
     * zero" are the same set by construction rather than by agreement between
     * two call sites.
     */
    const recordCounts = countsAsRendered(view)

    return {
      ...view,
      recordCounts,
      zeroClassifications: classifyDisplayedZeros(store, workOrderId, recordCounts),
    }
  }

  /**
   * The integration target ref for the observed repository: the resource's
   * recorded canonical branch where one exists, never a guess from a naming
   * convention. Falls back to the local `HEAD` of `origin` only when the
   * resource records nothing, and that fallback is visible in the topology
   * facts.
   */
  /**
   * The integration target ref for a repository, or **undefined** when the
   * resource records no canonical branch.
   *
   * It used to fall back to `origin/HEAD`, which is whatever a local clone's
   * remote head happens to point at — on this machine, `origin/main`, nine
   * thousand files from the integration line. A comparison against an
   * accidental ref is not a comparison; it is a confident wrong answer. The
   * caller now says it could not resolve the target instead (§21: a Compare
   * the surface cannot ground must be refused, not guessed).
   */
  private integrationTargetRef(repositoryId: string): string | undefined {
    const store = this.requireStore()
    const resource = store.listRepositoryResources().find(entry => entry.repositoryId === repositoryId)
    const branch = resource?.canonicalBranch
    if (branch === undefined || branch.trim() === '') return undefined
    // Prefer the remote-tracking ref: the local branch may be stale or absent,
    // and "where Integration is" means where the shared line is, not where a
    // local copy of it happens to sit.
    return `origin/${branch}`
  }

  /**
   * Read-only revision observation for one ref.
   *
   * Used by §20's "view current state": resolving where a line is NOW, to set
   * against where the packet says it was. Failure returns undefined, which the
   * assessment reports as UNRESOLVABLE — never as "unchanged".
   */
  private observedRevision(root: string, ref: string): string | undefined {
    try {
      return execFileSync('git', ['-C', root, 'rev-parse', ref], {
        encoding: 'utf8', timeout: 10_000,
      }).trim()
    } catch {
      return undefined
    }
  }

  /** Read-only merge base observation, used only as a last-resort seed. */
  private observedMergeBase(root: string, branchRef: string, targetRef: string): string | undefined {
    try {
      return execFileSync('git', ['-C', root, 'merge-base', branchRef, targetRef], {
        encoding: 'utf8', timeout: 10_000,
      }).trim()
    } catch {
      return undefined
    }
  }

  /**
   * §27 — live provider state, resolved through the EXISTING repository-
   * resource architecture, and presented beside (never merged into) what the
   * historical evidence recorded. Historical evidence says what was true then;
   * the provider says what is true now.
   */
  private collabLiveProviderState(explicitWorkOrderId?: string): CollabLiveProviderStateView | undefined {
    const workOrderId = this.viewWorkOrderId(explicitWorkOrderId)
    const store = this.requireStore()
    try {
      const resolution: RepositoryReferenceResolution = resolveRepositoryReference(store, {
        workOrderId,
        role: 'PRIMARY',
      })
      if (resolution.kind !== 'RESOLVED' || resolution.reference === undefined) {
        return { unavailableReason: resolution.kind === 'RESOLVED'
          ? 'No pull request or commit reference is bound to this Work Order yet.'
          : resolution.reason }
      }
      if (resolution.reference.kind !== 'PROVIDER_RESOLVED') {
        const recorded = resolution.reference.kind === 'PROVIDER_IDENTITY_UNAVAILABLE'
          ? `Recorded reference: ${resolution.reference.reference}`
          : `Recorded reference in ${resolution.reference.referenceRepositoryId}`
        return { recorded, unavailableReason: resolution.reference.reason }
      }
      const live = this.liveProviderState(resolution.reference.provider, {})
      return {
        recorded: `Recorded at submission: ${String(resolution.reference.reference)}`,
        ...(live === undefined
          ? { unavailableReason: 'Live provider state was not read.' }
          : live.kind === 'LIVE_PROVIDER_STATE_UNAVAILABLE'
            ? { unavailableReason: live.reason }
            : { live: `Now: ${JSON.stringify(live)} (read ${new Date().toISOString()})` }),
      }
    } catch (cause) {
      return { unavailableReason: cause instanceof Error ? cause.message : String(cause) }
    }
  }

  /**
   * §7 — observe the workspace's mutable working state. Requires a stable
   * RepositoryId (env; never minted from a path) and a git-custodied
   * workspace; anything else is an explicit unavailable reason.
   */
  observeWorkingState(explicitWorkOrderId?: string): { view?: CollabWorkingStateView, unavailableReason?: string, instance?: WorktreeInstanceV1 } {
    const { workspaceRoot } = this.config
    if (workspaceRoot === undefined) return { unavailableReason: 'No workspace root is open to observe.' }
    const identity = this.resolveWorkingStateIdentity(explicitWorkOrderId)
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
  async openAgentWorkContext(workOrderId: string, nativeSessionId?: string): Promise<{
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
    // §19: a join belongs to the SESSION that made it, not to the process.
    if (nativeSessionId !== undefined && nativeSessionId.trim() !== '') {
      this.nativeSessionWorkOrders.set(nativeSessionId, workOrderId)
    }
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
