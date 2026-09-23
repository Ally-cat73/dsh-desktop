/**
 * Product composition of the governed Claude worker —
 * WO-AERA-CODE-CLAUDE-CODE-GOVERNED-WORKER-INTEGRATION-001 §7/§9/§15.
 *
 * Environment-driven, like every other Collab setting (no new Settings
 * implementation). Missing configuration is an honest UNAVAILABLE state —
 * never a fallback binary, never an invented principal, never a second store:
 *
 *   AERA_COLLAB_STORE_DIR        the durable participation store (shared with Collab)
 *   AERA_COLLAB_PRINCIPAL_ID     the human this desktop speaks for
 *   AERA_COLLAB_DELEGATION_ID    the recorded delegation for Aera Code's agents
 *   AERA_GATEWAY_AGC_ENVIRONMENT_ID  the bound environment (AERA_DEV | CANARY)
 *   AERA_CLAUDE_WORKER_{BINARY,SHA256,VERSION,MODEL}  the pinned local CLI
 *
 * V1 binds the truthfully-labelled local execution policy as the Sentinel
 * seam (see `aera-worker-effect-broker.ts`); no remote endpoint is contacted.
 */

import { ParticipationStore } from '@aera/participation-runtime'
import { isAeraPrincipalId } from '@aera/cis-contracts'
import { resolveAgcGovernedGatewayRuntime } from './aera-gateway-agc-binding.ts'
import { ClaudeCodeWorkerAdapter, resolveClaudeWorkerPin } from './aera-claude-worker-host.ts'
import { LocalExecutionPolicyGate } from './aera-worker-effect-broker.ts'
import { AeraWorkerSessionManager } from './aera-worker-session.ts'
import type { AeraWorkerActionRequest } from './aera-worker-route.ts'

export type AeraWorkerRuntime =
  | { readonly kind: 'AVAILABLE', readonly manager: AeraWorkerSessionManager }
  | { readonly kind: 'UNAVAILABLE', readonly reason: string }

export function composeAeraWorker(env: Readonly<Record<string, string | undefined>>): AeraWorkerRuntime {
  const pick = (key: string): string | undefined => {
    const value = env[key]?.trim()
    return value === undefined || value === '' ? undefined : value
  }
  const storeDir = pick('AERA_COLLAB_STORE_DIR')
  const principalId = pick('AERA_COLLAB_PRINCIPAL_ID')
  const delegationId = pick('AERA_COLLAB_DELEGATION_ID')
  if (storeDir === undefined) return { kind: 'UNAVAILABLE', reason: 'No durable participation store is configured (AERA_COLLAB_STORE_DIR); a worker is never run without one.' }
  if (principalId === undefined || !isAeraPrincipalId(principalId)) return { kind: 'UNAVAILABLE', reason: 'No canonical human principal is configured (AERA_COLLAB_PRINCIPAL_ID).' }
  if (delegationId === undefined) return { kind: 'UNAVAILABLE', reason: 'No recorded delegation is configured (AERA_COLLAB_DELEGATION_ID); agent participation is never self-authorised.' }
  let environmentId: string
  try {
    environmentId = resolveAgcGovernedGatewayRuntime(env).environmentId
  } catch (cause) {
    return { kind: 'UNAVAILABLE', reason: `The bound Aera environment cannot be resolved: ${cause instanceof Error ? cause.message : String(cause)}` }
  }
  const pin = resolveClaudeWorkerPin(env)
  if (pin.kind === 'UNAVAILABLE') return { kind: 'UNAVAILABLE', reason: pin.reason }
  return {
    kind: 'AVAILABLE',
    manager: new AeraWorkerSessionManager({
      store: new ParticipationStore(storeDir),
      adapter: new ClaudeCodeWorkerAdapter(pin.pin, { parentEnv: env }),
      gate: new LocalExecutionPolicyGate(),
      config: { humanPrincipalId: principalId, delegationId, environmentId },
      broker: { parentEnv: env },
    }),
  }
}

/** Status for the renderer, or an honest unavailable reason. */
export function aeraWorkerStatus(runtime: AeraWorkerRuntime, workOrderId: string): unknown {
  if (runtime.kind === 'UNAVAILABLE') return { workOrderId, unavailableReason: runtime.reason }
  return runtime.manager.status(workOrderId)
}

/**
 * Perform one owner action. START_EPOCH resolves once the worker process has
 * started (or rejects with the typed refusal that prevented it); the Epoch
 * itself continues in the main process and is observed through status.
 */
export async function performAeraWorkerAction(
  runtime: AeraWorkerRuntime,
  request: AeraWorkerActionRequest,
  reportError: (operation: string, cause: unknown) => void,
): Promise<unknown> {
  if (runtime.kind === 'UNAVAILABLE') throw Object.assign(new Error(runtime.reason), { code: 'WORKER_UNAVAILABLE' })
  const { manager } = runtime
  switch (request.action) {
    case 'START_EPOCH':
      return await new Promise((resolve, reject) => {
        let started = false
        manager.runEpoch({
          workOrderId: request.workOrderId,
          codeWorkingLineId: request.codeWorkingLineId,
          task: request.task,
          onEvent: (event) => {
            if (event.kind === 'PROCESS_STARTED' && !started) {
              started = true
              resolve({ accepted: true, pid: event.pid })
            }
          },
        }).then(
          (result) => { if (!started) { started = true; resolve({ accepted: true, terminal: result.terminal.status }) } },
          (cause: unknown) => {
            if (!started) { started = true; reject(cause instanceof Error ? cause : new Error(String(cause))); return }
            reportError('run worker epoch', cause)
          },
        )
      })
    case 'CANCEL': {
      const terminal = await manager.cancel(request.workOrderId)
      return { cancelled: terminal !== undefined, ...(terminal === undefined ? {} : { status: terminal.status }) }
    }
    case 'GRANT': {
      const decision = manager.grantAuthority({
        workOrderId: request.workOrderId,
        codeWorkingLineId: request.codeWorkingLineId,
        grants: request.classes.map(effectClass => ({ effectClass })),
      })
      return { decisionId: decision.decisionId }
    }
    case 'REVOKE': {
      const decision = manager.revokeAuthority({ workOrderId: request.workOrderId, decisionId: request.decisionId })
      return { decisionId: decision.decisionId, status: decision.status }
    }
  }
}
