/**
 * The cold-start way into Collab, inside the main shell.
 *
 * WO-AERA-CODE-COLLAB-READ-FIRST-SURFACE-001, review finding D2.
 *
 * The conversation tab strip is `scope: 'session'`: with no Session open, the
 * Collab tab does not exist, and the sidebar is the ONLY way in. That path used
 * to open the native window on an empty WorkOrderId field — a typed route, and
 * the continuation order forbids requiring anyone to type an id.
 *
 * It now opens this. `shell.overlay` is declared by
 * `@deepseek-ai/dsh-client-ui-layout` as `{ kind: 'list', scope: 'root' }` and
 * is rendered by `AppFrame` in the shell's own overlay layer, so it is present
 * with no Session and needs no upstream patch. The overlay lands on the picker
 * with the search field focused and ACTIVE work already listed; choosing a row
 * renders that Work Order's surface in place. At no point is a WorkOrderId
 * typed, and at no point does a separate window open.
 *
 * Read-first throughout: the picker and the surface both project the durable
 * store and join nothing.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AeraCollabApi } from './aera-collab-api.ts'
import type { AeraCollabEntryController } from './aera-collab-entry-controller.ts'
import { AeraCollabPicker } from './AeraCollabPicker.tsx'
import { AeraCollabSurface } from './AeraCollabSurface.tsx'

/** Registration-side capabilities for the shell-level Collab overlay. */
export interface AeraCollabOverlayInjected {
  readonly api: AeraCollabApi
  readonly controller: AeraCollabEntryController
}

/** Renderer-composed props for the shell overlay entry. */
export type AeraCollabOverlayProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<'aera.collab'>
  & InjectFace<AeraCollabOverlayInjected>

/** The shell-level Collab picker, opened from the sidebar. */
export function AeraCollabOverlay({ api, controller, t }: AeraCollabOverlayProps) {
  const open = useSyncExternalStore(
    controller.subscribe,
    controller.isOpen,
    controller.isOpen,
  )
  const [chosen, setChosen] = useState<string>()
  const panel = useRef<HTMLDivElement>(null)

  const close = useCallback(() => {
    controller.close()
    setChosen(undefined)
  }, [controller])

  // Escape closes, as it does for every other transient surface in the shell.
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [open, close])

  // Closed is the default, and closed renders nothing at all: an overlay layer
  // that always occupied the shell would sit over the product.
  if (!open) return null

  return (
    <div className="aera-collab-overlay" role="presentation" onClick={close}>
      <div
        ref={panel}
        className="aera-collab-overlay-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t('overlayTitle')}
        onClick={event => { event.stopPropagation() }}
      >
        <header className="aera-collab-overlay-head">
          <h2 className="aera-collab-overlay-title">{t('overlayTitle')}</h2>
          <button type="button" className="aera-collab-overlay-close" onClick={close}>
            {t('closeOverlay')}
          </button>
        </header>
        <div className="aera-collab-overlay-body">
          {chosen === undefined
            ? <AeraCollabPicker api={api} t={t} onChoose={setChosen} />
            : (
                <>
                  <button
                    type="button"
                    className="aera-collab-change"
                    onClick={() => { setChosen(undefined) }}
                  >
                    {t('changeWorkOrder')}
                  </button>
                  <AeraCollabSurface api={api} workOrderId={chosen} t={t} />
                </>
              )}
        </div>
      </div>
    </div>
  )
}
