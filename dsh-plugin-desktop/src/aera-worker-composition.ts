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
 * D-0d2 (review M-3, U8 N-6, CD-2): the ONLY worker this composes is the
 * governed one. It is AVAILABLE only with the D-0c local-effect session, the
 * U8 attestor and the governed effect plane (AUTHORITY = CAS through the
 * Router; `createGovernedEffectPlane`). Without any of them — including when
 * installation-key custody is unavailable, or `aera-claude-worker.json` (with
 * its pinned effect catalog) is absent or broken — it is UNAVAILABLE. There is
 * no legacy direct, local-grant or local-policy worker: no local gate is bound
 * (`NO_LOCAL_AUTHORITY_GATE`), and the GRANT / REVOKE actions refuse
 * (`AUTHORITY_IS_CAS`; the owner revokes with CAS `act revoke`).
 *
 * U8 D-3: when the D-0c local-effect session is composed (the host builds it
 * whenever installation-key custody is available), the worker is governed:
 * it is AVAILABLE only with the model-invocation attestor, which needs the
 * session's governed Connection id (AERA_CLAUDE_WORKER_CONNECTION_ID) to pass
 * the Gateway Connection grammar. Otherwise it is UNAVAILABLE — never an
 * ungated fallback. (D-0d2 retired the composition without D-0c: M-3.)
 */

import { ParticipationStore } from '@aera/participation-runtime'
import { isAeraPrincipalId } from '@aera/cis-contracts'
import { resolveAgcGovernedGatewayRuntime } from './aera-gateway-agc-binding.ts'
import { ClaudeCodeWorkerAdapter, resolveClaudeWorkerPin } from './aera-claude-worker-host.ts'
import { NO_LOCAL_AUTHORITY_GATE, type GovernedEffectPlane } from './aera-worker-effect-broker.ts'
import { AeraWorkerSessionManager } from './aera-worker-session.ts'
import { createModelInvocationAttestor, type ModelInvocationAttestor } from './aera-worker-model-attest.ts'
import { isGatewayConnectionId } from '@aera/local-effect-authority'
import type { AeraWorkerActionRequest } from './aera-worker-route.ts'
import type { WorkerInstallationKeyCustody } from './aera-worker-installation-key.ts'
import type { WorkerLocalEffectSession } from './aera-worker-le-session.ts'

/**
 * The installation-key custody (D-0b) is carried on BOTH runtime kinds: the
 * owner enrols the key (OA-1) before the worker is configured, while the
 * worker itself is still honestly UNAVAILABLE. The local-effect session (D-0c)
 * likewise: the owner begins the Worker Epoch for the window before the worker
 * is otherwise composed.
 */
export type AeraWorkerRuntime =
  | { readonly kind: 'AVAILABLE', readonly manager: AeraWorkerSessionManager, readonly installationKey?: WorkerInstallationKeyCustody, readonly localEffect?: WorkerLocalEffectSession, readonly modelAttest?: ModelInvocationAttestor }
  | { readonly kind: 'UNAVAILABLE', readonly reason: string, readonly installationKey?: WorkerInstallationKeyCustody, readonly localEffect?: WorkerLocalEffectSession }

export interface AeraWorkerCompositionOptions {
  readonly installationKey?: WorkerInstallationKeyCustody
  readonly localEffect?: WorkerLocalEffectSession
  /** D-0d2: the governed effect plane (built by the host from the same loaded config and session). */
  readonly effectPlane?: GovernedEffectPlane
  /** Ids and codes only (the attestor never logs a body, nonce or token). */
  readonly log?: (line: string) => void
}

export function composeAeraWorker(
  env: Readonly<Record<string, string | undefined>>,
  options: AeraWorkerCompositionOptions = {},
): AeraWorkerRuntime {
  const runtime = composeWorkerRuntime(env, options.localEffect, options.effectPlane, options.log)
  return {
    ...runtime,
    ...(options.installationKey === undefined ? {} : { installationKey: options.installationKey }),
    ...(options.localEffect === undefined ? {} : { localEffect: options.localEffect }),
  }
}

function composeWorkerRuntime(
  env: Readonly<Record<string, string | undefined>>,
  localEffect: WorkerLocalEffectSession | undefined,
  effectPlane: GovernedEffectPlane | undefined,
  log: ((line: string) => void) | undefined,
): AeraWorkerRuntime {
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
  if (localEffect === undefined) {
    return { kind: 'UNAVAILABLE', reason: 'The governed local-effect session is not composed (installation-key custody or aera-claude-worker.json is unavailable); there is no ungated worker.' }
  }
  if (!isGatewayConnectionId(localEffect.connectionId)) {
    return { kind: 'UNAVAILABLE', reason: 'The governed Connection id (AERA_CLAUDE_WORKER_CONNECTION_ID in aera-claude-worker.json) is missing or is not a Gateway Connection id; the worker never runs without the model-invocation attestation.' }
  }
  if (effectPlane === undefined) {
    return { kind: 'UNAVAILABLE', reason: 'The governed effect plane (CAS through the Router, with the pinned effect catalog in aera-claude-worker.json) is not composed; there is no local-authority worker.' }
  }
  const modelAttest = createModelInvocationAttestor({ session: localEffect, ...(log === undefined ? {} : { log }) })
  return {
    kind: 'AVAILABLE',
    manager: new AeraWorkerSessionManager({
      store: new ParticipationStore(storeDir),
      adapter: new ClaudeCodeWorkerAdapter(pin.pin, { parentEnv: env }),
      gate: NO_LOCAL_AUTHORITY_GATE,
      config: { humanPrincipalId: principalId, delegationId, environmentId },
      broker: { parentEnv: env },
      modelAttest,
      effectPlane,
    }),
    modelAttest,
  }
}

/** Status for the renderer, or an honest unavailable reason. */
export function aeraWorkerStatus(runtime: AeraWorkerRuntime, workOrderId: string): unknown {
  // Public projection only: status, scope, x, installationKeyId, JWK sha256, hand-over path.
  const installationKey = runtime.installationKey === undefined ? {} : { installationKey: runtime.installationKey.view() }
  // Public ids, codes and expiry only (never the AGENT session token).
  const localEffect = runtime.localEffect === undefined ? {} : { localEffect: runtime.localEffect.status() }
  if (runtime.kind === 'UNAVAILABLE') return { workOrderId, unavailableReason: runtime.reason, ...installationKey, ...localEffect }
  // U8: the attest state (state, code, heartbeat, receipt id and times; never a body or nonce).
  const modelAttest = runtime.modelAttest === undefined ? {} : { modelAttest: runtime.modelAttest.status() }
  return { ...runtime.manager.status(workOrderId), ...installationKey, ...localEffect, ...modelAttest }
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
  if (request.action === 'ENROL_WORKER_KEY') {
    if (runtime.installationKey === undefined) {
      throw Object.assign(new Error('The worker installation-key custody is not available in this process.'), { code: 'WORKER_KEY_CUSTODY_UNAVAILABLE' })
    }
    const enrolled = await runtime.installationKey.enrol()
    return {
      installationKeyId: enrolled.installationKeyId,
      x: enrolled.publicJwk.x,
      publicJwkSha256: enrolled.publicJwkSha256,
      publicHandOverPath: enrolled.publicHandOverPath,
    }
  }
  if (request.action === 'BEGIN_AGENT_EPOCH') {
    if (runtime.localEffect === undefined) {
      throw Object.assign(new Error('The worker local-effect session is not available in this process.'), { code: 'WORKER_LOCAL_EFFECT_UNAVAILABLE' })
    }
    return await runtime.localEffect.beginEpoch()
  }
  if (request.action === 'GRANT' || request.action === 'REVOKE') {
    // CD-2: local grants are not an authority path; authority is CAS (the owner revokes with `act revoke`).
    throw Object.assign(new Error('Authority is CAS: local grants are not an authority path. Use the owner\'s CAS `act revoke` to revoke.'), { code: 'AUTHORITY_IS_CAS' })
  }
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
  }
}
