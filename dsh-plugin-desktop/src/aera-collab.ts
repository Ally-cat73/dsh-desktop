/**
 * Aera collaboration workspace Host plugin — WO-AGC-002 Remit C.
 *
 * Wires the native collaboration workspace consumer into the DSH-derived Aera
 * Code desktop through the established Host-plugin seam: one tray command
 * opens the isolated Work Context window. Configuration is environment-driven
 * (see `aera-collab-service.ts`); missing configuration yields honest
 * UNAVAILABLE states in the window, never a fabricated context.
 *
 * This plugin introduces NO second harness, store, registry, graph authority,
 * provider selector or Gateway Session manager, and does not touch the
 * desktop's existing Gateway/Sentinel integration. ParticipationSession and
 * GatewaySession remain distinct identities; nothing here reads or writes
 * gateway credentials.
 */

// Namespace import: see the note in `electron-reveal.ts`.
import * as electron from 'electron'
import type { Context } from '@deepseek-ai/cordis'
import type {} from './runtime.ts'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { createDesktopCollabHostSeam } from './aera-collab-seam.ts'
import {
  AERA_COLLAB_DIRECTORY_PATH,
  AERA_COLLAB_RESOLVE_PATH,
  AERA_COLLAB_VIEW_PATH,
  AERA_WORK_CONTEXT_OPEN_PATH,
  handleAeraCollabDirectoryRequest,
  handleAeraCollabResolveRequest,
  handleAeraCollabViewRequest,
  handleAeraWorkContextOpenRequest,
} from './aera-collab-route.ts'
import {
  AERA_COLLAB_COORDINATION_PATH,
  AERA_COLLAB_PACKET_STATE_PATH,
  handleAeraCollabCoordinationRequest,
  handleAeraCollabPacketStateRequest,
} from './aera-collab-coordination-route.ts'
import { CollabWorkspaceService, resolveCollabConfig } from './aera-collab-service.ts'
import { WorkContextWindow } from './work-context-window.ts'

/** Stable Cordis plugin name. */
export const name = 'aera-collab-workspace'

/** Native adapter and loopback web server required by the consumer surface. */
export const inject = ['desktopRuntime', 'webServer']

/**
 * Register the Work Context command for one Host generation.
 * @param ctx - Host context carrying the Electron adapter.
 */
export function apply(ctx: Context): void {
  const seam = createDesktopCollabHostSeam(process.env, (message) => {
    void electron.dialog.showMessageBox({ type: 'warning', message })
  })
  const service = new CollabWorkspaceService(
    resolveCollabConfig(process.env, seam.resolveWorkspaceRoot()),
  )
  const window = new WorkContextWindow({ service, seam })
  const rendererOrigin = `http://127.0.0.1:${String(ctx.webServer.port)}`
  const reportError = (operation: string, cause: unknown): void => {
    ctx.logger.error(
      `aera-collab: failed to ${operation}: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: AERA_WORK_CONTEXT_OPEN_PATH,
      handler: (req, res) => handleAeraWorkContextOpenRequest(
        req,
        res,
        rendererOrigin,
        (selection) => { window.openSelection(selection) },
        reportError,
      ),
    }),
    'aera-collab: work context open route',
  )
  /*
   * READ ROUTES (WO-AERA-CODE-COLLAB-READ-FIRST-SURFACE-001, owner entry-point
   * direction). They let the ordinary product shell offer a Collab tab and a
   * Collab picker without handing the renderer a store path or any write
   * capability. Both project the durable store and join nothing: joining writes
   * `sessions.json`, which is why it stays behind the POST above.
   */
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: AERA_COLLAB_DIRECTORY_PATH,
      handler: (req, res) => {
        handleAeraCollabDirectoryRequest(
          req,
          res,
          rendererOrigin,
          query => service.collabDirectory({ query }),
          reportError,
        )
      },
    }),
    'aera-collab: collab directory read route',
  )
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: AERA_COLLAB_RESOLVE_PATH,
      handler: (req, res) => {
        handleAeraCollabResolveRequest(
          req,
          res,
          rendererOrigin,
          () => service.resolveDefaultWorkOrder(),
          reportError,
        )
      },
    }),
    'aera-collab: workspace Work Order resolve route',
  )
  /*
   * COORDINATION ROUTES (WO-AERA-COLLAB-RELAY-COORDINATION-THREADS-AND-
   * WORKING-LINE-HANDOFF-001 §35). The first writes this surface has ever
   * offered. They stay behind POST for the same reason joining does: they
   * change durable institutional records. The packet-state read below is a
   * GET, because resolving where the world is now changes nothing.
   */
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: AERA_COLLAB_COORDINATION_PATH,
      handler: (req, res) => {
        void handleAeraCollabCoordinationRequest(
          req,
          res,
          rendererOrigin,
          async (request) => {
            switch (request.action) {
              case 'OPEN_THREAD':
                return await service.openCoordinationThread({
                  subject: request.subject ?? '',
                  ...(request.workOrderId === undefined ? {} : { workOrderId: request.workOrderId }),
                })
              case 'POST_MESSAGE':
                return await service.postCoordinationMessage({
                  threadId: request.threadId ?? '',
                  body: request.body ?? '',
                  requestId: request.requestId ?? '',
                  ...(request.workOrderId === undefined ? {} : { workOrderId: request.workOrderId }),
                  ...(request.intent === undefined ? {} : { intent: request.intent }),
                  ...(request.packetId === undefined ? {} : { packetId: request.packetId }),
                  ...(request.parentMessageId === undefined ? {} : { parentMessageId: request.parentMessageId }),
                })
              case 'SHARE_COMPARE':
                return await service.shareComparePacket({
                  ...(request.compareLineIndex === undefined ? {} : { compareLineIndex: request.compareLineIndex }),
                  ...(request.workOrderId === undefined ? {} : { workOrderId: request.workOrderId }),
                })
              case 'ACKNOWLEDGE':
                return await service.acknowledgeCoordinationMessage({
                  threadId: request.threadId ?? '',
                  messageId: request.messageId ?? '',
                  kind: request.kind ?? 'READ',
                  ...(request.workOrderId === undefined ? {} : { workOrderId: request.workOrderId }),
                })
              case 'SET_LIFECYCLE':
                return await service.setCoordinationThreadLifecycle({
                  threadId: request.threadId ?? '',
                  lifecycle: request.lifecycle ?? 'ACTIVE',
                  ...(request.workOrderId === undefined ? {} : { workOrderId: request.workOrderId }),
                })
              case 'RECORD_DECISION':
                return await service.recordDecisionFromThread({
                  threadId: request.threadId ?? '',
                  subject: request.subject ?? '',
                  options: request.options ?? [],
                  selectedOptionId: request.selectedOptionId ?? '',
                  ...(request.rationale === undefined ? {} : { rationale: request.rationale }),
                  ...(request.messageIds === undefined ? {} : { messageIds: request.messageIds }),
                  ...(request.workOrderId === undefined ? {} : { workOrderId: request.workOrderId }),
                })
            }
          },
          reportError,
        )
      },
    }),
    'aera-collab: coordination write route',
  )
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: AERA_COLLAB_PACKET_STATE_PATH,
      handler: (req, res) => {
        handleAeraCollabPacketStateRequest(
          req,
          res,
          rendererOrigin,
          packetId => service.assessPacket(packetId),
          reportError,
        )
      },
    }),
    'aera-collab: coordination packet state read route',
  )
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: AERA_COLLAB_VIEW_PATH,
      handler: (req, res) => {
        void handleAeraCollabViewRequest(
          req,
          res,
          rendererOrigin,
          async (input) => {
            /*
             * D4: the CONTEXT section restored to the inline surface. The
             * Collab view and the Work Context packet are two projections of
             * the same joinless read, composed here rather than folded into
             * the frozen `CollabCodeView` model.
             */
            const [collab, context] = await Promise.all([
              service.collabView(input),
              service.contextView(input.workOrderId),
            ])
            return {
              ...collab,
              context: {
                currentCanonicalState: context.currentCanonicalState,
                governingDecisions: context.governingDecisions,
                knownResiduals: context.knownResiduals,
              },
            }
          },
          reportError,
        )
      },
    }),
    'aera-collab: collab surface read route',
  )
  ctx.effect(() => {
    /*
     * TWO ENTRY POINTS, ONE WINDOW (WO-AERA-CODE-COLLAB-READ-FIRST-SURFACE-001,
     * owner decision OD-7 default (c), controller-approved).
     *
     * The compact Context view and the read-first Collab view are two
     * renderings of ONE joined Work Context: one service, one store, one
     * session, one authority stamp, one set of honesty rules. A second window
     * would have had to re-decide those rules, and §32 forbids a second Collab
     * host. The tray is used because it is the shipping product's only entry to
     * institutional surfaces — §7 forbids redesigning the Aera Code shell.
     */
    const workContext = ctx.desktopRuntime.registerTrayItem({
      group: 'tools',
      order: 20,
      label: () => 'Aera: Work Context',
      invoke: () => { window.openView('CONTEXT') },
    })
    const collab = ctx.desktopRuntime.registerTrayItem({
      group: 'tools',
      order: 21,
      label: () => 'Aera: Collab',
      invoke: () => { window.openView('COLLAB') },
    })
    return () => {
      workContext.dispose()
      collab.dispose()
      window.close()
      void service.closeWorkContext().catch(() => {})
    }
  }, 'aera-collab: work context and collab tray commands')
}
