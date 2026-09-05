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
  SESSIONS_FILE,
  WORK_ORDERS_FILE,
  buildParticipationProjection,
  mergeProjections,
  resolveWorkContext,
} from '@aera/participation-runtime'
import { buildProjection } from '@aera/evidentiary-work-graph'
import type { EngineeringWorkGraphProjectionV1 } from '@aera/evidentiary-work-graph-contracts'
import {
  isRepositoryId,
  worktreeInstance,
  type WorktreeInstanceV1,
} from '@aera/participation-contracts'
import { isUnattributedChange, type ParticipationSession } from '@aera/evidentiary-work-graph-contracts'
import { isAeraPrincipalId } from '@aera/cis-contracts'
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
  return {
    ...(storeDir === undefined ? {} : { storeDir }),
    ...(corpusRoot === undefined ? {} : { corpusRoot }),
    ...(stackRoot === undefined ? {} : { stackRoot }),
    ...(principalId === undefined ? {} : { principalId }),
    ...(principalName === undefined ? {} : { principalName }),
    ...(repositoryId === undefined ? {} : { repositoryId }),
    ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
  }
}

/** An honest, typed refusal. The UI shows `reason` verbatim. */
export class CollabHonestError extends Error {
  constructor(
    readonly code:
      | 'STORE_UNAVAILABLE'
      | 'PROJECTION_UNAVAILABLE'
      | 'PRINCIPAL_UNAVAILABLE'
      | 'WORK_ORDER_NOT_FOUND'
      | 'NOT_JOINED'
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

  constructor(private readonly config: CollabWorkspaceConfig) {}

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
    const { repositoryId: repoId, workspaceRoot } = this.config
    if (workspaceRoot === undefined) return { unavailableReason: 'No workspace root is open to observe.' }
    if (repoId === undefined || !isRepositoryId(repoId)) {
      return {
        unavailableReason:
          'AERA_COLLAB_REPOSITORY_ID is not set to a stable aera-repo:<slug> RepositoryId; a repository identity is never minted from a local path.',
      }
    }
    let head: string, branch: string, dirty: boolean
    try {
      const git = (...args: string[]): string =>
        execFileSync('git', ['-C', workspaceRoot, ...args], { encoding: 'utf8', timeout: 10_000 }).trim()
      head = git('rev-parse', 'HEAD')
      branch = git('rev-parse', '--abbrev-ref', 'HEAD')
      dirty = git('status', '--porcelain').length > 0
    } catch {
      return { unavailableReason: `The workspace at ${workspaceRoot} is not an observable git working tree.` }
    }
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
