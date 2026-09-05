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

import { dialog } from 'electron'
import type { Context } from '@deepseek-ai/cordis'
import type {} from './runtime.ts'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { createDesktopCollabHostSeam } from './aera-collab-seam.ts'
import { AERA_WORK_CONTEXT_OPEN_PATH, handleAeraWorkContextOpenRequest } from './aera-collab-route.ts'
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
    void dialog.showMessageBox({ type: 'warning', message })
  })
  const service = new CollabWorkspaceService(
    resolveCollabConfig(process.env, seam.resolveWorkspaceRoot()),
  )
  const window = new WorkContextWindow({ service, seam })
  const rendererOrigin = `http://127.0.0.1:${String(ctx.webServer.port)}`
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: AERA_WORK_CONTEXT_OPEN_PATH,
      handler: (req, res) => handleAeraWorkContextOpenRequest(
        req,
        res,
        rendererOrigin,
        () => { window.open() },
        (operation, cause) => {
          ctx.logger.error(
            `aera-collab: failed to ${operation}: ${cause instanceof Error ? cause.message : String(cause)}`,
          )
        },
      ),
    }),
    'aera-collab: work context open route',
  )
  ctx.effect(() => {
    const registration = ctx.desktopRuntime.registerTrayItem({
      group: 'tools',
      order: 20,
      label: () => 'Aera: Work Context',
      invoke: () => { window.open() },
    })
    return () => {
      registration.dispose()
      window.close()
      void service.closeWorkContext().catch(() => {})
    }
  }, 'aera-collab: work context tray command')
}
