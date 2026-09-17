/**
 * The always-present way into Collab, in the sidebar footer.
 *
 * WO-AERA-CODE-COLLAB-READ-FIRST-SURFACE-001, owner entry-point direction.
 *
 * The conversation tab strip is `scope: 'session'`, so it exists only where a
 * Session is open. `sidebar.footer.action` is `scope: 'root'` and renders with
 * no Session at all — which is what makes Collab reachable from a cold start,
 * before the reader has opened anything. Activating it opens the Collab
 * surface on the picker, so no one ever has to know a WorkOrderId.
 */

import { useCallback, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AeraCollabApi } from './aera-collab-api.ts'

/** Registration-side business face for the sidebar Collab action. */
export interface AeraCollabSidebarActionInjected {
  readonly api: Pick<AeraCollabApi, 'openCollab'>
}

/** Renderer-composed props for the sidebar Collab action. */
export type AeraCollabSidebarActionProps =
  PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<'aera.collab'>
  & InjectFace<AeraCollabSidebarActionInjected>

/** Open Collab from the sidebar, with no Session and no WorkOrderId required. */
export function AeraCollabSidebarAction({ api, t }: AeraCollabSidebarActionProps) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const onOpen = useCallback(() => {
    setBusy(true)
    setFailed(false)
    void (async () => {
      try {
        await api.openCollab()
      } catch {
        setFailed(true)
      } finally {
        setBusy(false)
      }
    })()
  }, [api])

  return (
    <div className="aera-collab-sidebar-action">
      <button
        type="button"
        className="aera-collab-sidebar-button"
        disabled={busy}
        onClick={onOpen}
      >
        {busy ? t('openingCollab') : t('nav')}
      </button>
      {failed ? <p className="aera-collab-error" role="alert">{t('openCollabError')}</p> : null}
    </div>
  )
}
