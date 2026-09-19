/**
 * The always-present way into Collab, in the sidebar footer.
 *
 * WO-AERA-CODE-COLLAB-READ-FIRST-SURFACE-001, review finding D2.
 *
 * The conversation tab strip is `scope: 'session'`, so it exists only where a
 * Session is open. `sidebar.footer.action` is `scope: 'root'` and renders with
 * no Session at all — which makes this the ONLY cold-start path, and therefore
 * the one that must not ask anyone to type a WorkOrderId.
 *
 * It used to open the native window on an empty id field. It now asks the
 * controller to reveal Collab by the best route available: the details column
 * on its Collaborate tab where the shell has one, and the shell-level picker
 * on a cold start, where there is no Session and therefore no column.
 */

import { useSyncExternalStore } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AeraCollabEntryController } from './aera-collab-entry-controller.ts'

/** Registration-side capabilities for the sidebar Collab action. */
export interface AeraCollabSidebarActionInjected {
  readonly controller: AeraCollabEntryController
}

/** Renderer-composed props for the sidebar Collab action. */
export type AeraCollabSidebarActionProps =
  PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<'aera.collab'>
  & InjectFace<AeraCollabSidebarActionInjected>

/** Open the Collab picker from the sidebar, with no Session and no id typed. */
export function AeraCollabSidebarAction({ controller, t }: AeraCollabSidebarActionProps) {
  const open = useSyncExternalStore(
    controller.subscribe,
    controller.isOpen,
    controller.isOpen,
  )
  return (
    <div className="aera-collab-sidebar-action">
      <button
        type="button"
        className="aera-collab-sidebar-button"
        aria-expanded={open}
        onClick={() => { controller.reveal() }}
      >
        {t('nav')}
      </button>
    </div>
  )
}
