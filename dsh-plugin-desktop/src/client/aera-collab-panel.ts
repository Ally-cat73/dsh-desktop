/**
 * Registration of Aera Code's owner-visible Collab entry points.
 *
 * WO-AERA-CODE-COLLAB-READ-FIRST-SURFACE-001, owner entry-point direction.
 *
 * Owner acceptance failed on a build whose Collab route was complete and whose
 * only affordances were a macOS tray item the system laid out off-screen and a
 * view switch inside the window that tray item opened. The lesson is recorded
 * in the shape of this file: Collab is registered into the SAME slots the
 * product's own views use, so it is as discoverable as Chat and Trajectory and
 * cannot drift out of the shell without a test noticing.
 *
 * Two registrations, deliberately:
 *
 * - `conversation.view` — the tab strip beside Chat and Trajectory. This is
 *   where the owner asked for it and where a person looks for another view of
 *   the work in front of them. The slot is declared `scope: 'session'` by
 *   `dsh-client-ui-conversation`, so the strip exists wherever a Session is
 *   open; the tab is registered unconditionally so that it is present for every
 *   one of them.
 * - `sidebar.footer.action` — the always-present way in. That slot is
 *   `scope: 'root'`, so unlike the tab strip it renders with no Session at all,
 *   which is what makes "Open Collab…" reachable from a cold start.
 *
 * Neither registration is conditional on configuration. A Collab entry that
 * appears only when a store happens to be configured is an entry point that
 * disappears exactly when the reader most needs to be told why.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { AeraCollabOverlay } from './AeraCollabOverlay.tsx'
import { AeraCollabPanel } from './AeraCollabPanel.tsx'
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

/** Position in the conversation tab strip: after Chat (0) and Trajectory (10). */
export const AERA_COLLAB_VIEW_ORDER = 20

/** Stable slot id for the Collab tab. */
export const AERA_COLLAB_VIEW_ID = 'collab'

declare module '@deepseek-ai/dsh-client-ui-slots' {
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
export function applyAeraCollabEntryPoints(
  ctx: ClientContext,
  api: AeraCollabApi = createAeraCollabApi(),
  controller: AeraCollabEntryController = createAeraCollabEntryController(),
): void {
  const t = ctx.locale.bind(AERA_COLLAB_LOCALE_NAMESPACE)

  ctx.effect(
    () => ctx.locale.register(AERA_COLLAB_LOCALE_NAMESPACE, { zh, en }),
    'dsh-plugin-desktop: Aera Collab dictionaries',
  )
  ctx.effect(
    () => installAeraCollabStyles(),
    'dsh-plugin-desktop: Aera Collab styles',
  )
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: AERA_COLLAB_VIEW_ID,
    order: AERA_COLLAB_VIEW_ORDER,
    locale: AERA_COLLAB_LOCALE_NAMESPACE,
    label: () => t('tab'),
    /*
     * The tab takes NOTHING from the Session. Collab is a viewpoint over
     * durable work, not over this conversation's record stream, so `inject`
     * cannot fail the way a session-derived view can — which is exactly why
     * the tab can promise never to throw and never to disappear.
     */
    inject: () => ({ api }),
  }, AeraCollabPanel))
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
