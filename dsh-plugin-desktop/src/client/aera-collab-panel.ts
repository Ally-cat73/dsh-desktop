/**
 * Registration of Aera Code's owner-visible Collab entry points.
 *
 * Owner superseding continuation `CONTINUE_HOST_RECOVERY.md`, §13 Option B,
 * selected by §14 and ratified by the §16 architecture review.
 *
 * ## What changed, and why the previous design is gone rather than disabled
 *
 * Collab has had three hosts in this Work Order's history, and the first two
 * are now closed by order rather than by preference:
 *
 * - a `conversation.view` tab rendering the workspace in the CENTRE column —
 *   removed by §4: "COLLAB MUST NO LONGER REPLACE THE MAIN WORK SURFACE";
 * - a Collaborate tab inside the right-hand details column, reached by adding
 *   a `conversation.details.collab` child seat through a patch to
 *   `@deepseek-ai/dsh-client-ui-conversation` — removed by §12, which forbids
 *   any further vendored DSH patch for hosting Collab, and by §14, which found
 *   no clean route to the right region at all: `details` is `kind: 'single'`,
 *   `scope: 'session'`, occupied by the vendor's own panel, whose `chatStore`
 *   is a closure local the package never exports. Co-hosting needed more
 *   vendor surgery; taking the seat would have destroyed ordinary tool Details
 *   (§15). The patch is reverted to its 13-line branding-only base in the same
 *   change as this one, so tool Details is now EXACTLY stock.
 *
 * What remains is two registrations, neither of which touches the centre, the
 * details column, or any vendor package:
 *
 * - `sidebar.footer.action` — the always-present way in. `scope: 'root'`, so it
 *   renders with no Session at all, which is what makes "Open Collab…"
 *   reachable from a cold start. One press opens the drawer; it never closes
 *   it (see the entry controller on open-means-open).
 * - `shell.overlay` — the drawer itself. Declared by
 *   `@deepseek-ai/dsh-client-ui-layout` as `{ kind: 'list', scope: 'root' }`,
 *   rendered into AppFrame's click-through overlay layer, and declared
 *   identically in every shell mode, so Collab does not have to be re-hosted if
 *   the mode ever changes. `kind: 'list'` means it coexists with the desktop
 *   titlebar (`order: -1000`) rather than displacing anything; this drawer
 *   takes `order: 10`, well clear of it.
 *
 * No registration is conditional on configuration. A Collab entry that appears
 * only when a store happens to be configured is an entry point that disappears
 * exactly when the reader most needs to be told why.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { AeraCollabOverlay } from './AeraCollabOverlay.tsx'
import { AeraCollabSidebarAction } from './AeraCollabSidebarAction.tsx'
import {
  createAeraCollabEntryController,
  type AeraCollabEntryController,
} from './aera-collab-entry-controller.ts'
import { createAeraCollabApi, type AeraCollabApi } from './aera-collab-api.ts'
import { en, zh, type AeraCollabLocaleKey } from './aera-collab-locales.ts'
import { installAeraCollabStyles } from './aera-collab-styles.ts'

/** Locale namespace owned by the Aera Collab entry points. */
export const AERA_COLLAB_LOCALE_NAMESPACE = 'aera.collab'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Aera Collab entry-point copy. */
    'aera.collab': AeraCollabLocaleKey
  }
}

/**
 * Register the Collab drawer and the sidebar way in for one client generation.
 *
 * @param ctx - browser Cordis context.
 * @param api - injectable for tests; defaults to the same-origin loopback API.
 * @param controller - injectable for tests; shared open/closed drawer state.
 */
export function applyAeraCollabEntryPoints(
  ctx: ClientContext,
  api: AeraCollabApi = createAeraCollabApi(),
  controller: AeraCollabEntryController = createAeraCollabEntryController(),
): void {
  /*
   * Make a crashed contribution audible (round-1 review NB-14, and §65 run 2).
   *
   * A slot entry that throws during render is retired from its cell by the
   * renderer. For a `kind: 'list'` seat that means the drawer simply stops
   * appearing, with no error anywhere the reader can see — the same silence
   * that cost two acceptance runs. This reports it. It changes no behaviour.
   */
  ctx.effect(
    () => {
      // Guarded for the same reason everything on this path now is: a member
      // that is missing must cost a diagnostic, never the registration itself.
      if (typeof ctx.slots.onEntryError !== 'function') return () => {}
      return ctx.slots.onEntryError((key, entry, error, info) => {
        if (entry.registrant !== 'dsh-plugin-desktop') return
        console.error(
          `[aera-collab] slot entry crashed in ${key}`,
          { abdicated: info.abdicated, registrant: entry.registrant },
          error,
        )
      })
    },
    'dsh-plugin-desktop: Aera Collab slot entry crash reporting',
  )

  ctx.effect(
    () => ctx.locale.register(AERA_COLLAB_LOCALE_NAMESPACE, { zh, en }),
    'dsh-plugin-desktop: Aera Collab dictionaries',
  )
  ctx.effect(
    () => installAeraCollabStyles(),
    'dsh-plugin-desktop: Aera Collab styles',
  )
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'aera-collab',
    order: 10,
    locale: AERA_COLLAB_LOCALE_NAMESPACE,
    inject: () => ({ controller }),
  }, AeraCollabSidebarAction))
  /*
   * The drawer. `order: 10` keeps it clear of the desktop titlebar's -1000, so
   * the titlebar renders first and the drawer never competes with the window
   * controls.
   */
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'aera-collab-drawer',
    order: 10,
    locale: AERA_COLLAB_LOCALE_NAMESPACE,
    inject: () => ({ api, controller }),
  }, AeraCollabOverlay))
}
