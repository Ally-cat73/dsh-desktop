/**
 * The Collab drawer — Aera Collab's V1 host surface.
 *
 * Owner superseding continuation `CONTINUE_HOST_RECOVERY.md` §13 Option B,
 * selected by the §14 decision rule and ratified by the §16 architecture
 * review (`AERA_COLLAB_HOST_ARCHITECTURE_PASS`).
 *
 * ## Where this sits, and why it is safe
 *
 * `shell.overlay` is declared by `@deepseek-ai/dsh-client-ui-layout` as
 * `{ kind: 'list', scope: 'root' }` and rendered by `AppFrame` into its own
 * overlay layer, whose stylesheet is:
 *
 *     .overlayLayer { z-index: 20; pointer-events: none; position: absolute; inset: 0 }
 *     .overlayLayer > *  { pointer-events: auto }
 *
 * A full-bleed, CLICK-THROUGH layer above the three-column grid whose children
 * are individually interactive. Three consequences this component is built to
 * exploit, rather than work around:
 *
 * 1. Anchoring to the right edge of `inset: 0` puts Collab exactly where the
 *    owner asked a rail to be (§13's "RIGHT: who am I working with?"), while
 *    remaining the pre-authorised Option B drawer.
 * 2. Because the layer is click-through and this drawer paints ONLY its own
 *    band, the centre work surface stays visible AND interactive the whole time
 *    Collab is open. There is deliberately NO backdrop: a full-bleed scrim
 *    would re-enable pointer events across the shell and make the drawer modal,
 *    which is precisely the centre-blocking §18 forbids. The earlier picker had
 *    one; it is gone.
 * 3. The centre is never unmounted or re-laid-out, so §49C ("close restores
 *    current work") holds structurally — closing removes an absolutely
 *    positioned box and nothing else. Collaboration state survives too: the
 *    reader's chosen Work Order is held here, above the mount/unmount of the
 *    body, so reopening returns them where they were.
 *
 * `order` is 10. The desktop window titlebar is the other contributor to this
 * seat at `order: -1000` (`extended-shell.ts`), so it renders first and this
 * drawer never competes with it; the drawer's own top inset clears the
 * titlebar band rather than covering the window controls.
 *
 * ## One surface, two projections
 *
 * The body is `AeraCollabWorkspace` — Collaborate and Record as two separate
 * component trees over one `CollabSurfaceView` read once. The legacy
 * `AeraCollabSurface` is not used here; it is the pre-split surface.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AeraCollabApi } from './aera-collab-api.ts'
import type { AeraCollabEntryController } from './aera-collab-entry-controller.ts'
import { AeraCollabPicker } from './AeraCollabPicker.tsx'
import { AeraCollabWorkspace, type CollabMode } from './AeraCollabWorkspace.tsx'

/** Registration-side capabilities for the shell-level Collab drawer. */
export interface AeraCollabOverlayInjected {
  readonly api: AeraCollabApi
  readonly controller: AeraCollabEntryController
}

/** Renderer-composed props for the shell overlay entry. */
export type AeraCollabOverlayProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<'aera.collab'>
  & InjectFace<AeraCollabOverlayInjected>

/** Drawer width bounds, in px. Narrow enough to leave the centre usable. */
const MIN_WIDTH = 320
const MAX_WIDTH = 720
const DEFAULT_WIDTH = 420

/** The Collab drawer, opened from the sidebar and closed from its own header. */
export function AeraCollabOverlay({ api, controller, t }: AeraCollabOverlayProps) {
  const open = useSyncExternalStore(
    controller.subscribe,
    controller.isOpen,
    controller.isOpen,
  )
  /*
   * Held ABOVE the early return, so the reader's Work Order and drawer width
   * survive close/reopen. §45 asks that close/reopen work and that
   * collaboration state is not lost; keeping this here is what makes that true
   * rather than merely tested.
   */
  const [chosen, setChosen] = useState<string>()
  /*
   * The Collaborate/Record choice lives here for the same reason the Work
   * Order does: closing on Record and reopening used to drop the reader back
   * on Collaborate (§46 review NB-7). Both are collaboration state, and §45
   * asks that close/reopen not lose it.
   */
  const [mode, setMode] = useState<CollabMode>('COLLABORATE')
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const dragging = useRef(false)

  const close = useCallback(() => { controller.close() }, [controller])

  // Escape closes, as it does for every other transient surface in the shell.
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [open, close])

  /*
   * Resize by dragging the drawer's left edge. Listeners live on `window` for
   * the duration of the drag so the pointer may leave the 12px handle — and,
   * more importantly, may cross OVER the centre column, which is exactly where
   * a leftward drag goes.
   */
  useEffect(() => {
    if (!open) return undefined
    const onMove = (event: MouseEvent): void => {
      if (!dragging.current) return
      const next = window.innerWidth - event.clientX
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next)))
    }
    const onUp = (): void => { dragging.current = false }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [open])

  // Closed renders nothing at all — not a hidden box. An overlay contribution
  // that always occupied the layer would sit over the product forever.
  if (!open) return null

  return (
    <aside
      className="aera-collab-drawer"
      style={{ width: `${width}px` }}
      role="complementary"
      aria-label={t('overlayTitle')}
    >
      <div
        className="aera-collab-drawer-grip"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('resizeDrawer')}
        onMouseDown={event => {
          event.preventDefault()
          dragging.current = true
        }}
      />
      <header className="aera-collab-drawer-head">
        <h2 className="aera-collab-drawer-title">{t('overlayTitle')}</h2>
        {/*
          * No `aria-label` here on purpose. Carrying BOTH an aria-label and the
          * same visible text left the button with an EMPTY accessible name in
          * the real renderer — found by walking the live AX tree of the dev
          * runtime, where this control reported `label: ""` while the other
          * drawer controls named themselves correctly. The visible text is the
          * accessible name; adding the attribute only competed with it.
          */}
        <button
          type="button"
          className="aera-collab-drawer-close"
          onClick={close}
        >
          {t('closeOverlay')}
        </button>
      </header>
      <div className="aera-collab-drawer-body">
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
                <AeraCollabWorkspace
                  api={api}
                  workOrderId={chosen}
                  t={t}
                  mode={mode}
                  onModeChange={setMode}
                />
              </>
            )}
      </div>
    </aside>
  )
}
