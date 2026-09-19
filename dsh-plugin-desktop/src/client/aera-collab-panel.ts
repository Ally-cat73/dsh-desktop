/**
 * Registration of Aera Code's owner-visible Collab entry points.
 *
 * Read-First order, revised by §4 of the superseding order (R2-NB-A: this
 * header described the registration that §4 removed).
 *
 * Owner acceptance once failed on a build whose Collab route was complete and
 * whose only affordances were a macOS tray item the system laid out off-screen
 * and a view switch inside the window that tray item opened. The answer then
 * was to register Collab into the SAME slots the product's own views use,
 * including a `conversation.view` tab beside Chat and Trajectory.
 *
 * §4 reverses that half: "COLLAB MUST NO LONGER REPLACE THE MAIN WORK
 * SURFACE". The centre belongs to the work. Discoverability is still the
 * governing constraint — it is what the earlier failure was about — so it is
 * carried by three registrations that do not take the centre:
 *
 * - `conversation.details.collab` — the Collaborate tab of the right-hand
 *   details column, beside tool inspection rather than over it. Declared by
 *   this fork's patch to `dsh-client-ui-conversation`; `scope: 'session'`.
 * - `sidebar.footer.action` — the always-present way in. That slot is
 *   `scope: 'root'`, so unlike the details column it renders with no Session at
 *   all, which is what makes "Open Collab…" reachable from a cold start. It
 *   opens the column AND selects Collaborate.
 * - `shell.overlay` — the cold-start picker, for the case where there is no
 *   Session and therefore no column to open.
 *
 * No registration is conditional on configuration. A Collab entry that appears
 * only when a store happens to be configured is an entry point that disappears
 * exactly when the reader most needs to be told why.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { AeraCollabOverlay } from './AeraCollabOverlay.tsx'
import { AeraCollabDetailsTab } from './AeraCollabPanel.tsx'
import { AeraCollabSidebarAction } from './AeraCollabSidebarAction.tsx'
import {
  createAeraCollabEntryController,
  type AeraCollabColumn,
  type AeraCollabEntryController,
} from './aera-collab-entry-controller.ts'
import { createAeraCollabApi, type AeraCollabApi } from './aera-collab-api.ts'
import { en, zh, type AeraCollabLocaleKey } from './aera-collab-locales.ts'
import { installAeraCollabStyles } from './aera-collab-styles.ts'

/** Locale namespace owned by the Aera Collab entry points. */
export const AERA_COLLAB_LOCALE_NAMESPACE = 'aera.collab'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  /**
   * The Collaborate seat inside the details column.
   *
   * Declared at runtime by our patch to `@deepseek-ai/dsh-client-ui-conversation`
   * (`.yarn/patches/…-941ef6a7f5.patch`), which leaves the stock DetailsPanel
   * intact and merely gives it a second tab. The patch cannot ship types into
   * the package's own `.d.ts`, so the declaration lives here — beside the only
   * registration that fills it — and must be deleted in the same change that
   * ever removes the patch.
   */
  interface SlotMap {
    'conversation.details.collab': {
      kind: 'single'
      scope: 'session'
      owner: Record<string, never>
    }
  }

  interface LocaleNamespaceMap {
    /** Aera Collab entry-point copy. */
    'aera.collab': AeraCollabLocaleKey
  }
}

/**
 * Register the Collab tab and the sidebar way in for one client generation.
 *
 * @param ctx - browser Cordis context.
 * @param api - injectable for tests; defaults to the same-origin loopback API.
 */
/**
 * The shell's details column, as an affordance target.
 *
 * Resolved lazily, at press time rather than at apply time, because the shell
 * that provides `ctx.layout` is installed after the entry points are.
 *
 * `isOpen` is only answered where the layout exposes its own state — which is
 * the desktop-owned `DesktopLayoutState` in advanced mode. Where it does not,
 * this reports closed, so the button opens and never guesses that it should
 * close. A button that closes a column the reader did not know was open is
 * worse than a button that only ever opens one.
 */
/** Ask the details column to show Collaborate. Safe to call when it is closed. */
export const AERA_DETAILS_TAB_EVENT = 'aera:details-tab'

export function selectCollaborateTab(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(AERA_DETAILS_TAB_EVENT, { detail: { tab: 'collab' } }))
}

export function shellDetailsColumn(ctx: ClientContext): AeraCollabColumn {
  type LayoutFace = {
    openDetails?: () => void
    closeDetails?: () => void
    getSnapshot?: () => { details?: number }
  }
  /*
   * Defensive on top of the `layout` declaration in the plugin's inject list.
   *
   * cordis THROWS for an undeclared service — `cannot get property "layout"
   * without inject` — and §65 acceptance caught exactly that escaping the click
   * handler, leaving the affordance inert with no error anywhere a reader could
   * see. A button that silently does nothing is the worst failure an affordance
   * can have, so if the service is ever unavailable again the reader gets the
   * cold-start picker instead of nothing at all.
   */
  const face = (): LayoutFace | undefined => {
    try {
      return (ctx as { layout?: unknown }).layout as LayoutFace | undefined
    } catch {
      return undefined
    }
  }

  return Object.freeze({
    isOpen: () => {
      const snapshot = face()?.getSnapshot?.()
      return snapshot !== undefined && snapshot.details !== 0
    },
    open: () => {
      const open = face()?.openDetails
      if (open === undefined) return false
      open()
      /*
       * Round-1 review BL-3: opening the column landed the reader on tool
       * inspection and asked them to find the second tab. The patched panel
       * listens for this event and selects the tab; it is a plain DOM event so
       * neither side depends on the other's module.
       */
      selectCollaborateTab()
      return true
    },
    close: () => { face()?.closeDetails?.() },
  })
}

export function applyAeraCollabEntryPoints(
  ctx: ClientContext,
  api: AeraCollabApi = createAeraCollabApi(),
  controller: AeraCollabEntryController = createAeraCollabEntryController(),
): void {
  controller.attachColumn(shellDetailsColumn(ctx))

  ctx.effect(
    () => ctx.locale.register(AERA_COLLAB_LOCALE_NAMESPACE, { zh, en }),
    'dsh-plugin-desktop: Aera Collab dictionaries',
  )
  ctx.effect(
    () => installAeraCollabStyles(),
    'dsh-plugin-desktop: Aera Collab styles',
  )
  /*
   * §4 — COLLAB MUST NO LONGER REPLACE THE MAIN WORK SURFACE.
   *
   * A `conversation.view` tab rendering the whole workspace in the CENTRE
   * column used to be registered here at order 20. It was ratified under the
   * earlier Read-First order, and the superseding order supersedes that
   * ratification: the centre belongs to the work, and Collab belongs beside
   * it. The registration is gone rather than hidden behind a flag, because a
   * disabled centre-replacing surface is still a centre-replacing surface
   * waiting to be re-enabled.
   *
   * Discoverability (§6) is not lost: the sidebar affordance below opens the
   * right-hand column directly on Collaborate, and the cold-start picker still
   * serves the no-Session case.
   */
  /*
   * The Collaborate tab of the right-hand details column (controller ruling,
   * Option B / path 2). It sits BESIDE tool inspection rather than over it:
   * the Details tab still renders the stock panel, reading the same private
   * chatStore it always did, so a tool selection behaves exactly as before.
   * A selection arriving while Collaborate is showing marks the Details tab
   * and does not steal it.
   */
  ctx.slots.inject('conversation.details.collab', () => ctx.slots.register({
    name: 'conversation.details.collab',
    locale: AERA_COLLAB_LOCALE_NAMESPACE,
    inject: () => ({ api }),
  }, AeraCollabDetailsTab))
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'aera-collab',
    order: 10,
    locale: AERA_COLLAB_LOCALE_NAMESPACE,
    inject: () => ({ controller }),
  }, AeraCollabSidebarAction))
  /*
   * The cold-start surface (D2). `shell.overlay` is declared by
   * `dsh-client-ui-layout` as `{ kind: 'list', scope: 'root' }` and rendered by
   * AppFrame's overlay layer, so it exists with no Session — which is exactly
   * the case the sidebar has to serve. It renders nothing until opened.
   */
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'aera-collab-picker',
    order: 10,
    locale: AERA_COLLAB_LOCALE_NAMESPACE,
    inject: () => ({ api, controller }),
  }, AeraCollabOverlay))
}
