/**
 * Aera collaboration agent tools — WO-AGC-001 Remit E (§4 of the owner
 * objective restoration).
 *
 * The smallest tool-binding adapter that makes the EXISTING native
 * collaboration operations agent-callable through the DSH runtime's own tool
 * registry (`ctx.tools.register(defineTool(...))` — the exact seam every
 * shipped harness tool uses). It wires the five §4 operation groups to the
 * EXISTING `CollabWorkspaceService` / `ParticipationCollaborationClient` /
 * `ParticipationStore` owners:
 *
 *   1. resolve the WorkOrder and WorkContext        → `aera_collab_resolve_work_context`
 *   2. governing decisions + source references      → `aera_collab_governing_decisions`
 *   3. current task / working-state information     → `aera_collab_working_state`
 *   4. evidence and unresolved findings             → `aera_collab_find_evidence`
 *   5. record authorised progress and evidence      → `aera_collab_record`
 *
 * No second store, registry, harness or graph authority; no provider, gateway
 * or credential surface; read operations plus the TWO authorised write
 * operations (progress note, evidence reference) through the established
 * owners with full four-leg attribution. The agent's ParticipationSession is
 * a real session opened for a durable AGENT principal under a RECORDED
 * delegation (see `aera-collab-service.ts` agent plane). Missing
 * configuration yields honest refusals — never fabricated context.
 *
 * This module is Electron-free by design so the binding is provable with the
 * runtime's real agent/session/tool mechanics in a headless test.
 */

import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { CollabHonestError, CollabWorkspaceService, resolveCollabConfig } from './aera-collab-service.ts'

/** Stable Cordis plugin name. */
export const name = 'aera-collab-agent-tools'

/** The native DSH tool registry is the only injected service. */
export const inject = ['tools']

interface OwnerWorkOrderInput {
  readonly workOrderId: string
  readonly title: string
  readonly exactPayload: string
}

/** Recognise only the explicit AERA formal Work Order grammar. */
export function recogniseOwnerWorkOrder(message: {
  readonly source: { readonly kind: string }
  readonly content: readonly { readonly type: string, readonly text?: string }[]
}): OwnerWorkOrderInput | undefined {
  if (message.source.kind !== 'user') return undefined
  const exactPayload = message.content
    .filter((block): block is { readonly type: string, readonly text: string } =>
      block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
  if (!exactPayload.startsWith('AERA-WORK-ORDER-STANDARD-003 v3.0')) return undefined
  const id = exactPayload.match(/^\s*(?:WORK ORDER(?: ID)?|WORK-ORDER ID):\s*(WO-[A-Z0-9][A-Z0-9_-]+)\s*$/imu)?.[1]
  const title = exactPayload.match(/^\s*TITLE:\s*(.+?)\s*$/imu)?.[1]?.trim()
  if (id === undefined || title === undefined || title.length === 0) return undefined
  return { workOrderId: id, title, exactPayload }
}

/** Optional composition-time overrides (tests supply a prepared service). */
export interface Config {
  /** A prepared consumer service; defaults to one resolved from the environment. */
  service?: CollabWorkspaceService
}

/** One node reference row shared by the read tools' outputs. */
const NODE_REF_ITEM = {
  type: 'object',
  additionalProperties: false,
  properties: {
    nodeId: { type: 'string', required: true },
    label: { type: 'string' },
    sourcePath: { type: 'string' },
  },
} as const

/** Render any canonical tool value as pretty JSON for the model. */
const renderJson = (_args: unknown, value: unknown): { type: 'text', text: string }[] =>
  [{ type: 'text', text: JSON.stringify(value, null, 2) }]

/**
 * Convert an honest service refusal into a thrown tool error carrying the
 * verbatim reason — the model sees the same refusal a human window shows.
 */
async function honest<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof CollabHonestError) {
      throw new Error(`${error.code}: ${error.message}`)
    }
    throw error
  }
}

/**
 * Register the five agent-callable collaboration tools for one generation.
 * @param ctx - Host context carrying the native tool registry.
 * @param config - optional prepared service (tests); env-resolved otherwise.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const service = config.service
    ?? new CollabWorkspaceService(
      resolveCollabConfig(process.env, process.env['AERA_COLLAB_WORKSPACE_ROOT']),
    )

  ctx.on('agent/pre-step', async ({ agent, messages }, next): Promise<PreStepDecision> => {
    const hasOwnerInput = messages.some(message => message.source.kind === 'user')
    if (!hasOwnerInput) return next()
    const ownerMessage = messages.find(message => recogniseOwnerWorkOrder(message) !== undefined)
    const formal = ownerMessage === undefined ? undefined : recogniseOwnerWorkOrder(ownerMessage)
    let institutional: { workOrderId: string } | undefined
    if (formal !== undefined && ownerMessage !== undefined) {
      institutional = await service.admitOwnerWorkOrder({
        ...formal,
        nativeSessionId: String(agent.id),
        messageId: String(ownerMessage.id),
        eventSequence: agent.session.seq,
        submittedAt: new Date().toISOString(),
      })
    } else {
      institutional = await service.resumeAgentWorkContextForNativeSession(String(agent.id))
    }
    const decision = await next()
    if (decision.kind === 'reject' || institutional === undefined) return decision
    const text = await service.agentInstitutionalContext()
    if (text === undefined) return decision
    return {
      kind: 'enter',
      messages: [
        ...decision.messages,
        createUserMessage({
          content: [{ type: 'text', text }],
          source: {
            kind: 'plugin', plugin: name, form: 'snapshot',
            sections: [{ name: 'canonical-work-context', text }],
          },
        }),
      ],
    }
  }, { prepend: true })

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'aera_collab_resolve_work_context',
    description:
      'Resolve an authorised Aera Work Order by its WorkOrderId and join its WorkContext as the configured participating agent. Opens a real, delegated ParticipationSession through the durable participation store. An unknown WorkOrderId is refused honestly and never created.',
    parameters: {
      work_order_id: { type: 'string', required: true, description: 'The canonical WorkOrderId to resolve (e.g. WO-…).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessionId: { type: 'string', required: true },
          principalId: { type: 'string', required: true },
          workOrderId: { type: 'string', required: true },
          delegationId: { type: 'string', required: true },
          workOrder: {
            type: 'object',
            additionalProperties: false,
            properties: {
              nodeId: { type: 'string', required: true },
              label: { type: 'string' },
            },
          },
        },
      },
      render: renderJson,
    },
    async execute(args) {
      return honest(() => service.openAgentWorkContext(args.work_order_id))
    },
  })), 'aera-collab-tools: resolve_work_context')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'aera_collab_governing_decisions',
    description:
      'Return the governing architecture decisions of the joined WorkContext with their graph node ids and recorded source locators (projection sourcePath values). Requires a WorkContext resolved with aera_collab_resolve_work_context first.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          workOrderId: { type: 'string', required: true },
          governingDecisions: { type: 'array', required: true, items: NODE_REF_ITEM },
        },
      },
      render: renderJson,
    },
    async execute() {
      const packet = await honest(() => service.agentContextPacket())
      return { workOrderId: packet.workOrderId, governingDecisions: packet.governingDecisions }
    },
  })), 'aera-collab-tools: governing_decisions')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'aera_collab_working_state',
    description:
      'Return the joined WorkContext\'s current canonical state nodes (with source locators) and the honestly observed mutable working state of the configured workspace (branch, head revision, dirty state), or the explicit reason the working state is unavailable. Requires a resolved WorkContext.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          workOrderId: { type: 'string', required: true },
          currentCanonicalState: { type: 'array', required: true, items: NODE_REF_ITEM },
          workingState: {
            type: 'object',
            additionalProperties: false,
            properties: {
              repositoryId: { type: 'string', required: true },
              localPath: { type: 'string', required: true },
              branchRef: { type: 'string', required: true },
              headRevision: { type: 'string', required: true },
              dirtyState: { type: 'string', required: true },
              observedAt: { type: 'string', required: true },
            },
          },
          workingStateUnavailableReason: { type: 'string' },
        },
      },
      render: renderJson,
    },
    async execute() {
      const packet = await honest(() => service.agentContextPacket())
      const observed = service.observeWorkingState()
      return {
        workOrderId: packet.workOrderId,
        currentCanonicalState: packet.currentCanonicalState,
        ...(observed.view === undefined
          ? {}
          : {
              workingState: {
                repositoryId: observed.view.repositoryId,
                localPath: observed.view.localPath,
                branchRef: observed.view.branchRef,
                headRevision: observed.view.headRevision,
                dirtyState: observed.view.dirtyState,
                observedAt: observed.view.observedAt,
              },
            }),
        ...(observed.unavailableReason === undefined
          ? {}
          : { workingStateUnavailableReason: observed.unavailableReason }),
      }
    },
  })), 'aera-collab-tools: working_state')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'aera_collab_find_evidence',
    description:
      'Return the joined WorkContext\'s evidence references and unresolved residual findings, each with graph node id and recorded source locator. Pass node_id to list the evidence attached to one specific node instead. Requires a resolved WorkContext.',
    parameters: {
      node_id: { type: 'string', description: 'Optional graph node id; when given, returns the evidence attached to that node.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          workOrderId: { type: 'string', required: true },
          evidence: { type: 'array', required: true, items: NODE_REF_ITEM },
          unresolvedResiduals: { type: 'array', required: true, items: NODE_REF_ITEM },
        },
      },
      render: renderJson,
    },
    async execute(args) {
      if (args.node_id !== undefined && args.node_id.trim() !== '') {
        const nodeId = args.node_id
        const evidence = await honest(() => service.agentFindEvidence(nodeId))
        const packet = await honest(() => service.agentContextPacket())
        return {
          workOrderId: packet.workOrderId,
          evidence: evidence.map(({ kind: _kind, ...ref }) => ref),
          unresolvedResiduals: packet.knownResiduals,
        }
      }
      const packet = await honest(() => service.agentContextPacket())
      return {
        workOrderId: packet.workOrderId,
        evidence: packet.evidence,
        unresolvedResiduals: packet.knownResiduals,
      }
    },
  })), 'aera-collab-tools: find_evidence')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'aera_collab_record',
    description:
      'Record authorised, attributed progress in the joined WorkContext through the canonical participation operations. kind PROGRESS_NOTE records a bounded progress note (summary, 1–4000 chars). kind EVIDENCE_REFERENCE references an EXISTING evidence node (evidence_node_id required; referencing never creates evidence). Every write carries the full four-leg attribution of the agent\'s delegated session.',
    parameters: {
      kind: {
        type: 'string',
        required: true,
        enum: ['PROGRESS_NOTE', 'EVIDENCE_REFERENCE'],
        description: 'PROGRESS_NOTE or EVIDENCE_REFERENCE.',
      },
      summary: { type: 'string', required: true, description: 'The bounded summary to record.' },
      evidence_node_id: { type: 'string', description: 'The EXISTING evidence node id (EVIDENCE_REFERENCE only).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          eventId: { type: 'string', required: true },
          attributed: { type: 'boolean', required: true },
        },
      },
      render: renderJson,
    },
    async execute(args) {
      if (args.kind === 'PROGRESS_NOTE') {
        return honest(() => service.agentRecordProgressNote(args.summary))
      }
      const nodeId = args.evidence_node_id
      if (nodeId === undefined || nodeId.trim() === '') {
        throw new Error('INVALID_INPUT: evidence_node_id is required for kind EVIDENCE_REFERENCE.')
      }
      return honest(() => service.agentAttachEvidenceReference(nodeId, args.summary))
    },
  })), 'aera-collab-tools: record')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'aera_collab_repository_resource',
    description:
      'Resolve the joined WorkContext\'s canonical repository resources: every bound repository with its stable RepositoryId (aera-repo:<slug>), truthful role (PRIMARY / SOURCE_EVIDENCE / AFFECTED), verified provider identity (e.g. github:Owner/Name) and canonical branch. Optionally repository-qualify one PR number, commit or branch and fetch its live provider state against the EXACT provider repository. With several bindings and no repository_id/role the result is AMBIGUOUS_REPOSITORY listing the bindings — never a silent choice. A repository is never inferred from the workspace path or name; when live provider access fails the result says LIVE_PROVIDER_STATE_UNAVAILABLE rather than guessing. Requires a resolved WorkContext.',
    parameters: {
      repository_id: { type: 'string', description: 'Stable RepositoryId (aera-repo:<slug>) to select. Wins over role.' },
      role: { type: 'string', enum: ['PRIMARY', 'SOURCE_EVIDENCE', 'AFFECTED'], description: 'Select the binding with this role when no repository_id is given.' },
      pull_request_number: { type: 'number', description: 'Pull request number to repository-qualify and look up.' },
      commit_sha: { type: 'string', description: 'Commit SHA to repository-qualify and look up.' },
      branch_ref: { type: 'string', description: 'Branch name to repository-qualify and look up.' },
      live: { type: 'boolean', description: 'Fetch live provider state for the named reference (default: true when a reference is given).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          workOrderId: { type: 'string', required: true },
          resolution: { type: 'string', required: true },
          reason: { type: 'string' },
          repositories: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                repositoryId: { type: 'string', required: true },
                role: { type: 'string', required: true },
                displayName: { type: 'string', required: true },
                verification: { type: 'string', required: true },
                providerIdentity: { type: 'string' },
                canonicalBranch: { type: 'string' },
                note: { type: 'string' },
              },
            },
          },
          repository: {
            type: 'object',
            additionalProperties: false,
            properties: {
              repositoryId: { type: 'string', required: true },
              role: { type: 'string', required: true },
              displayName: { type: 'string', required: true },
              verification: { type: 'string', required: true },
              providerIdentity: { type: 'string' },
              canonicalBranch: { type: 'string' },
              note: { type: 'string' },
            },
          },
          reference: {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true },
              reference: { type: 'string', required: true },
              providerIdentity: { type: 'string' },
              providerUrl: { type: 'string' },
              reason: { type: 'string' },
            },
          },
          liveState: {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true },
              providerIdentity: { type: 'string' },
              observedAt: { type: 'string' },
              state: { type: 'string' },
              mergeCommit: { type: 'string' },
              mergedAt: { type: 'string' },
              headRefOid: { type: 'string' },
              baseRefName: { type: 'string' },
              headRefName: { type: 'string' },
              url: { type: 'string' },
              reason: { type: 'string' },
            },
          },
        },
      },
      render: renderJson,
    },
    async execute(args) {
      const role = args.role
      if (role !== undefined && role !== 'PRIMARY' && role !== 'SOURCE_EVIDENCE' && role !== 'AFFECTED') {
        throw new Error('INVALID_INPUT: role must be PRIMARY, SOURCE_EVIDENCE or AFFECTED.')
      }
      const result = await honest(async () => service.agentResolveRepositoryResource({
        ...(args.repository_id === undefined || args.repository_id.trim() === '' ? {} : { repositoryId: args.repository_id.trim() }),
        ...(role === undefined ? {} : { role }),
        ...(args.pull_request_number === undefined ? {} : { pullRequestNumber: args.pull_request_number }),
        ...(args.commit_sha === undefined || args.commit_sha.trim() === '' ? {} : { commitSha: args.commit_sha.trim() }),
        ...(args.branch_ref === undefined || args.branch_ref.trim() === '' ? {} : { branchRef: args.branch_ref.trim() }),
        ...(args.live === undefined ? {} : { live: args.live }),
      }))
      const strip = (row: { repositoryId: string, role: string, displayName: string, verification: string, providerIdentity?: string, canonicalBranch?: string, note?: string }) => ({
        repositoryId: row.repositoryId,
        role: row.role,
        displayName: row.displayName,
        verification: row.verification,
        ...(row.providerIdentity === undefined ? {} : { providerIdentity: row.providerIdentity }),
        ...(row.canonicalBranch === undefined ? {} : { canonicalBranch: row.canonicalBranch }),
        ...(row.note === undefined ? {} : { note: row.note }),
      })
      return {
        workOrderId: result.workOrderId,
        resolution: result.resolution,
        ...(result.reason === undefined ? {} : { reason: result.reason }),
        repositories: result.repositories.map(strip),
        ...(result.repository === undefined ? {} : { repository: strip(result.repository) }),
        ...(result.reference === undefined ? {} : { reference: result.reference }),
        ...(result.liveState === undefined ? {} : { liveState: result.liveState }),
      }
    },
  })), 'aera-collab-tools: repository_resource')

  ctx.effect(() => () => {
    void service.closeAgentWorkContext().catch(() => {})
  }, 'aera-collab-tools: agent session teardown')
}
