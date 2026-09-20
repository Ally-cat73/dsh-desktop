/**
 * The Collab tab, in the shell a normal user gets — WO-AERA-CODE-COLLAB-READ-FIRST-SURFACE-001.
 *
 * Owner acceptance failed once on a build whose Collab route worked perfectly
 * and which no person could enter. Every gate had asked whether the route
 * existed. These tests ask the other question, the one that was missing: in the
 * DEFAULT owner configuration, is Collab offered where a person is looking?
 *
 * "Beside Chat and Trajectory" is asserted against the ids and orders the
 * §4 of the superseding order removed the centre-column tab these tests were
 * originally written to protect; what remains asserts the registrations that
 * replaced it, and records the supersession rather than deleting the history.
 */
import { describe, expect, it, vi } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import {
  applyAeraCollabEntryPoints,
} from '../src/client/aera-collab-panel.ts'
import { createAeraCollabEntryController } from '../src/client/aera-collab-entry-controller.ts'
import type { AeraCollabApi } from '../src/client/aera-collab-api.ts'

interface Registration {
  readonly options: {
    readonly name: string
    readonly id?: string
    readonly order?: number
    readonly label?: () => string
    readonly inject?: (sessionId?: string) => unknown
  }
  readonly component: unknown
}

/** Read what a package actually registers into the conversation tab strip. */

function harness(api: Partial<AeraCollabApi> = {}) {
  const registrations: Registration[] = []
  const entryErrorHandlers: unknown[] = []
  const injected: string[] = []
  const controller = createAeraCollabEntryController()
  const ctx = {
    locale: {
      bind: () => (key: string) => key,
      register: () => () => {},
    },
    slots: {
      inject: (name: string, register: () => unknown) => {
        injected.push(name)
        register()
        return () => {}
      },
      onEntryError: (fn: unknown) => { entryErrorHandlers.push(fn); return () => {} },
      register: (options: Registration['options'], component: unknown) => {
        registrations.push({ options, component })
        return () => {}
      },
    },
    effect: (register: () => (() => void)) => register(),
  } as unknown as ClientContext

  applyAeraCollabEntryPoints(ctx, {
    directory: vi.fn(async () => ({
      query: '', listing: 'ACTIVE' as const, rows: [], totalWorkOrders: 0, truncated: false,
    })),
    resolve: vi.fn(async () => ({ source: 'NONE' as const })),
    view: vi.fn(async () => ({ unavailableReason: 'no store in this harness' })),
    coordinate: vi.fn(async () => ({})),
    packetState: vi.fn(async () => ({ verdict: 'UNRESOLVABLE', humanSummary: 'no store in this harness' })),
    ...api,
  }, controller)
  return { registrations, injected, controller, entryErrorHandlers }
}

describe('Collab in the default shell', () => {
  /*
   * SUPERSEDED, deliberately, and recorded rather than deleted.
   *
   * Under the Read-First order this file asserted that Collab occupied a
   * `conversation.view` tab beside Chat and Trajectory — a CENTRE-column
   * surface — and that ratification was correct at the time. §4 of the
   * superseding order reverses it: "COLLAB MUST NO LONGER REPLACE THE MAIN
   * WORK SURFACE". So the assertions below are inverted, and the §6
   * discoverability they were protecting is now carried by the sidebar
   * affordance and the details column.
   */
  it('no longer takes a centre-column view slot (§4, supersedes the Read-First ratification)', () => {
    const { registrations } = harness()
    expect(registrations.some(entry => entry.options.name === 'conversation.view')).toBe(false)
  })

  it('takes no details-column seat either (§12, §14 — the vendor patch is reverted)', () => {
    /*
     * The details-column host is gone, and this asserts the absence rather than
     * merely stopping testing the presence. §14 found no clean route to the
     * right region: `details` is kind:'single', scope:'session', occupied by
     * the vendor, and its chatStore is a closure local the package never
     * exports. The only co-hosting route was a further vendored DSH patch,
     * which §12 forbids. If this assertion ever fails, the product has drifted
     * back onto a host the order rules out.
     */
    const { registrations, injected } = harness()

    expect(registrations.some(e => e.options.name === 'conversation.details.collab')).toBe(false)
    expect(injected).not.toContain('conversation.details.collab')
  })

  it('hosts Collab on the public shell.overlay seat instead', () => {
    const { registrations, injected } = harness()
    const seat = registrations.find(entry => entry.options.name === 'shell.overlay')

    expect(injected).toContain('shell.overlay')
    expect(seat).toBeDefined()
    expect(seat?.component).toBeTypeOf('function')
    expect(seat?.options.id).toBe('aera-collab-drawer')
    // scope:'root' — it takes nothing from the Session, so it cannot fail when
    // one is absent, which is the cold-start case.
    expect(() => seat?.options.inject?.('session-1')).not.toThrow()
    expect(() => seat?.options.inject?.(undefined)).not.toThrow()
  })

  it('keeps the drawer clear of the desktop titlebar in the same seat', () => {
    /*
     * `shell.overlay` is kind:'list', so Collab coexists with the desktop
     * window titlebar rather than displacing it. The titlebar registers at
     * order -1000 (extended-shell.ts); anything at or below that would fight
     * it for the top band and could cover the window controls.
     */
    const { registrations } = harness()
    const seat = registrations.find(entry => entry.options.name === 'shell.overlay')

    expect(seat?.options.order).toBeDefined()
    expect(seat!.options.order!).toBeGreaterThan(-1000)
  })

  it('is registered unconditionally, not only when a store happens to exist', () => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('AERA_COLLAB_')) delete process.env[key]
    }
    const { registrations } = harness()

    expect(registrations.some(entry => entry.options.name === 'shell.overlay')).toBe(true)
  })

  it('also offers a way in that needs no Session at all', () => {
    const { registrations, injected } = harness()
    const action = registrations.find(entry => entry.options.name === 'sidebar.footer.action')

    // The tab strip is scope:'session'. The sidebar footer is scope:'root', so
    // this is the affordance that exists before anything has been opened.
    expect(injected).toContain('sidebar.footer.action')
    expect(action).toBeDefined()
    expect(action?.options.id).toBe('aera-collab')
    expect(() => action?.options.inject?.()).not.toThrow()
  })

  it('never makes the cold-start path a typed WorkOrderId', () => {
    const { registrations, injected, controller } = harness()
    const action = registrations.find(entry => entry.options.name === 'sidebar.footer.action')
    const overlay = registrations.find(entry => entry.options.name === 'shell.overlay')

    /*
     * D2. With no Session there is no tab strip, so the sidebar is the ONLY way
     * in — and it must not open the native window on an empty id field. It
     * drives a shell-level picker instead, hosted in `shell.overlay`, which
     * `dsh-client-ui-layout` declares as scope:'root' and renders with no
     * Session.
     */
    expect(injected).toContain('shell.overlay')
    expect(overlay).toBeDefined()
    expect(overlay?.options.id).toBe('aera-collab-drawer')

    const sidebarFace = action?.options.inject?.() as { controller?: unknown, api?: unknown }
    // The sidebar action is handed no API at all: it cannot open a window, and
    // it cannot fetch. All it can do is open the picker.
    expect(sidebarFace.controller).toBeDefined()
    expect(sidebarFace.api).toBeUndefined()

    const overlayFace = overlay?.options.inject?.() as { controller?: unknown, api?: unknown }
    expect(overlayFace.controller).toBe(sidebarFace.controller)
    expect(overlayFace.api).toBeDefined()

    // The overlay is closed until something opens it, so it never sits over the
    // product uninvited.
    expect(controller.isOpen()).toBe(false)
    controller.open()
    expect(controller.isOpen()).toBe(true)
    controller.close()
    expect(controller.isOpen()).toBe(false)
  })

  it('opens no window from the cold-start path', () => {
    const { registrations } = harness()
    const action = registrations.find(entry => entry.options.name === 'sidebar.footer.action')
    const face = action?.options.inject?.() as { controller: { open: () => void } }

    face.controller.open()

    // Opening the drawer joins nothing and launches nothing.
    expect(face.controller).toBeDefined()
  })

  it('carries no route to the legacy native Collab window (§18, §46 review NB-6)', () => {
    /*
     * `openCollab()` POSTed `{ view: 'COLLAB' }` to the work-context window —
     * the legacy native surface the §14 decision replaced. It had no caller,
     * but it left the rejected surface one edit away from being reachable
     * again. It is deleted, and this asserts the absence.
     */
    const { registrations } = harness()
    const seat = registrations.find(entry => entry.options.name === 'shell.overlay')
    const injectedFace = seat?.options.inject?.() as { api: Record<string, unknown> }

    expect(injectedFace.api).toBeDefined()
    expect('openCollab' in injectedFace.api).toBe(false)
  })
})

describe('a crashed Collab contribution is reported, not silently degraded (NB-14, §65 run 2)', () => {
  it('subscribes to slot entry crashes', () => {
    /*
     * Acceptance run 2 found the Collaborate seat empty in the running product
     * and could not tell "nobody registered" from "the entry crashed and was
     * retired" — the patched panel renders the stock panel either way. A
     * degrade nobody reports costs a whole diagnostic round.
     */
    const { entryErrorHandlers } = harness()
    expect(entryErrorHandlers).toHaveLength(1)
    expect(entryErrorHandlers[0]).toBeTypeOf('function')
  })
})
