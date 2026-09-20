import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only service and SlotMap convergence for the Desktop settings section.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { applyAdvancedShell } from './advanced-shell.ts'
import { applyAeraBrand } from './aera-brand.tsx'
import { startRendererBootReporter } from './boot-health.ts'
import type { CurrentSessionSource } from './gateway-readiness.ts'
import { applyAeraCollabEntryPoints } from './aera-collab-panel.ts'
import { applyDesktopSettings } from './desktop-settings.ts'
import { installDesktopDirectoryPickerBridge, requestDesktopDirectoryValidation } from './directory-picker.ts'
import { parseDesktopClientEnvironment } from './environment.ts'
import { applyExtendedShell, applyFramedShell } from './extended-shell.ts'
import { installWorkspaceFolderDrop } from './workspace-folder-drop.ts'
import { desktopWindowService, provideDesktopWindow } from './window-service.ts'
import { installAeraGatewayReadinessClient } from './gateway-readiness.ts'

export { applyAdvancedShell } from './advanced-shell.ts'
export { applyDesktopSettings } from './desktop-settings.ts'
export { applyExtendedShell, applyFramedShell } from './extended-shell.ts'
export {
  createDesktopSettingsApi,
  desktopSettingsPaths,
  parseDesktopActionAcceptance,
  parseDesktopRestartAcceptance,
  parseDesktopSettingsView,
} from './desktop-settings-api.ts'
export type {
  DesktopMarketProvider,
  DesktopMarketView,
  DesktopProfileView,
  DesktopRestartAcceptance,
  DesktopSettingsApi,
  DesktopSettingsView,
} from './desktop-settings-api.ts'
export { DesktopSettingsSection } from './DesktopSettingsSection.tsx'
export { DesktopTerminalSettingsAction } from './DesktopTerminalSettingsAction.tsx'
export type {
  DesktopTerminalSettingsActionInjected,
  DesktopTerminalSettingsActionProps,
} from './DesktopTerminalSettingsAction.tsx'
export type {
  DesktopNotificationSettings,
  DesktopSettingsSectionInjected,
  DesktopSettingsSectionProps,
  DesktopShellSettings,
} from './DesktopSettingsSection.tsx'
export {
  RENDERER_BOOT_REPORT_PATH,
  rendererBootReport,
  sendRendererBootReport,
  startRendererBootReporter,
} from './boot-health.ts'
export type { RendererBootLoader, RendererBootReport } from './boot-health.ts'
export { parseDesktopClientEnvironment } from './environment.ts'
export type {
  DesktopClientEnvironment,
  DesktopClientMaterial,
  DesktopClientMode,
  DesktopClientPlatform,
} from './environment.ts'
export { desktopWindowService, provideDesktopWindow } from './window-service.ts'
export type {
  DesktopWindowDragRegion,
  DesktopWindowInsets,
  DesktopWindowService,
} from './contracts.ts'

/** Services required by Desktop settings and Desktop-owned presentations. */
export const inject = [
  'slots',
  'locale',
  'connection',
  'conversation',
  /*
   * `layout` is deliberately NOT declared any more.
   *
   * It was added after §65 acceptance found the Collab affordance inert: the
   * old details-column host read `ctx.layout` at press time, cordis refuses any
   * service a plugin has not declared, and the read threw out of the click
   * handler with no visible symptom. The declaration was the correct fix for
   * that host.
   *
   * The §14 decision removed that host. Collab now lives on `shell.overlay` and
   * opens by flipping a plain observable, so nothing in this client graph reads
   * `ctx.layout` at all — verified by the static service-contract check in
   * `tests/aera-collab-service-contract.spec.ts`. Keeping a REQUIRED inject
   * nothing reads is not free: cordis will not run `apply` for a plugin whose
   * required service is unprovided, so this would turn "ui-layout absent" into
   * "no desktop client surfaces at all" for a dependency this plugin no longer
   * has.
   *
   * Note for the record: round 4 reported that declaring `layout` was what made
   * TypeScript resolve `ctx.sessions` to ui-layout's `SessionStore`, forcing a
   * cast at the readiness call site. Removing the declaration proved that
   * wrong — the cast is still required. See the corrected note there.
   */
  'remote',
  'settingsScope',
  'sessions',
  'theme',
  'workspaces',
  'uiRenderer',
]

/** Register desktop-owned client surfaces for the current BrowserWindow mode. @param ctx - browser Cordis context. */
export function apply(ctx: ClientContext): void {
  const environment = parseDesktopClientEnvironment(window.location.search)
  if (!environment) return
  applyAeraBrand(ctx)
  ctx.effect(
    () => provideDesktopWindow(ctx, desktopWindowService(environment)),
    'dsh-plugin-desktop: native window geometry service',
  )
  const desktopSettings = applyDesktopSettings(ctx, environment)
  /*
   * The owner-visible way into Collab (WO-AERA-CODE-COLLAB-READ-FIRST-SURFACE-001).
   * Registered unconditionally and before any mode-specific shell, so the tab
   * and the sidebar action exist in every presentation the desktop can render.
   */
  applyAeraCollabEntryPoints(ctx)
  ctx.effect(
    () => startRendererBootReporter(ctx.loader),
    'dsh-plugin-desktop: renderer boot health report',
  )
  ctx.effect(
    () => installAeraGatewayReadinessClient({
      /*
       * `ctx.sessions` is typed as ui-layout's `SessionStore`, which does not
       * declare this member; the RUNTIME value is the sessions service, which
       * does. There is exactly one runtime provider of the name —
       * `dsh-client-runtime/lib/client.js:8948`,
       * `rootCtx.reflect.provide("sessions", this, void 0)` — so no typing
       * change can alter which object this resolves to, and the cast erases to
       * the same property read.
       *
       * CORRECTED: review round 4 attributed this conflict to declaring
       * `layout` in `inject`. That is not the cause. `layout` has now been
       * removed from `inject` entirely (see the note above) and `tsc` still
       * resolves `ctx.sessions` to `SessionStore` — the augmentation arrives
       * with ui-layout's types regardless of what this plugin declares. The
       * cast is therefore load-bearing on its own account, not a side effect of
       * a declaration that could be dropped to remove it.
       */
      current: (ctx.sessions as unknown as { currentProvideInfo: CurrentSessionSource }).currentProvideInfo,
      blocks: ctx.conversation.blocks,
    }),
    'dsh-plugin-desktop: Aera Gateway Session readiness',
  )
  ctx.effect(
    () => installWorkspaceFolderDrop({
      create: input => ctx.workspaces.create(input),
      startSession: workspaceId => { ctx.workspaces.startSession(workspaceId) },
      ...(environment.platform === 'win32'
        ? { validateDirectory: (path: string) => requestDesktopDirectoryValidation(path) }
        : {}),
    }),
    'dsh-plugin-desktop: workspace folder drop',
  )
  if (environment.platform === 'win32') {
    ctx.effect(
      () => installDesktopDirectoryPickerBridge(),
      'dsh-plugin-desktop: native directory picker bridge',
    )
  }
  if (environment.mode === 'advanced') applyAdvancedShell(ctx, environment)
  if (environment.mode === 'extended') applyExtendedShell(ctx, environment, desktopSettings)
  if (environment.platform !== 'linux' && environment.mode === 'compatibility') {
    applyFramedShell(ctx, environment, desktopSettings)
  }
}
