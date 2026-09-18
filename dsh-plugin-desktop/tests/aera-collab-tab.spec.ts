/**
 * The Collab tab, in the shell a normal user gets — WO-AERA-CODE-COLLAB-READ-FIRST-SURFACE-001.
 *
 * Owner acceptance failed once on a build whose Collab route worked perfectly
 * and which no person could enter. Every gate had asked whether the route
 * existed. These tests ask the other question, the one that was missing: in the
 * DEFAULT owner configuration, is Collab offered where a person is looking?
 *
 * "Beside Chat and Trajectory" is asserted against the ids and orders the
 * upstream packages actually register, read out of the installed bundles, so
 * the guarantee survives upstream renumbering its own tabs instead of quietly
 * decaying into a hard-coded number that used to be true.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import {
  AERA_COLLAB_VIEW_ID,
  AERA_COLLAB_VIEW_ORDER,
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
function upstreamTab(packageName: string): { id: string, order: number } {
  const source = readFileSync(`node_modules/@deepseek-ai/${packageName}/lib/client.js`, 'utf8')
  const match = /name:\s*"conversation\.view",\s*id:\s*"([a-z-]+)",\s*order:\s*(\d+)/.exec(source)
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error(`${packageName} no longer registers a conversation.view tab`)
  }
  return { id: match[1], order: Number(match[2]) }
}

function harness(api: Partial<AeraCollabApi> = {}) {
  const registrations: Registration[] = []
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
    openCollab: vi.fn(async () => {}),
    coordinate: vi.fn(async () => ({})),
    packetState: vi.fn(async () => ({ verdict: 'UNRESOLVABLE', humanSummary: 'no store in this harness' })),
    ...api,
  }, controller)
  return { registrations, injected, controller }
}

describe('Collab in the default shell', () => {
  it('offers a Collab tab in the same strip as Chat and Trajectory', () => {
    const { registrations, injected } = harness()
    const tab = registrations.find(entry => entry.options.name === 'conversation.view')

    expect(injected).toContain('conversation.view')
    expect(tab).toBeDefined()
    expect(tab?.options.id).toBe(AERA_COLLAB_VIEW_ID)
    expect(tab?.options.label?.()).toBe('tab')
    expect(tab?.component).toBeTypeOf('function')
  })

  it('sits beside Chat and Trajectory, after both, as upstream numbers them', () => {
    const chat = upstreamTab('dsh-client-ui-conversation')
    const trajectory = upstreamTab('dsh-client-ui-trajectory')

    expect(chat.id).toBe('chat')
    expect(trajectory.id).toBe('trajectory')
    // One strip, one ordering: the tab is a peer of the product's own views.
    expect(AERA_COLLAB_VIEW_ORDER).toBeGreaterThan(chat.order)
    expect(AERA_COLLAB_VIEW_ORDER).toBeGreaterThan(trajectory.order)
  })

  it('never throws when the strip renders it, with or without a Session', () => {
    const { registrations } = harness()
    const tab = registrations.find(entry => entry.options.name === 'conversation.view')

    // A view that reads the Session can fail when the Session is gone. Collab
    // is a viewpoint over durable work and takes nothing from it, so this
    // cannot throw - which is what lets the tab promise never to disappear.
    expect(() => tab?.options.inject?.('session-1')).not.toThrow()
    expect(() => tab?.options.inject?.(undefined)).not.toThrow()
    expect(() => tab?.options.inject?.('no-such-session')).not.toThrow()
  })

  it('is registered unconditionally, not only when a store happens to exist', () => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('AERA_COLLAB_')) delete process.env[key]
    }
    const { registrations } = harness()

    expect(registrations.some(entry => entry.options.name === 'conversation.view')).toBe(true)
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
    expect(overlay?.options.id).toBe('aera-collab-picker')

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
    controller.toggle()
    expect(controller.isOpen()).toBe(true)
    controller.close()
    expect(controller.isOpen()).toBe(false)
  })

  it('opens no window from the cold-start path', () => {
    const openCollab = vi.fn(async () => {})
    const { registrations } = harness({ openCollab })
    const action = registrations.find(entry => entry.options.name === 'sidebar.footer.action')
    const face = action?.options.inject?.() as { controller: { open: () => void } }

    face.controller.open()

    // Opening the picker joins nothing and launches nothing.
    expect(openCollab).not.toHaveBeenCalled()
  })

  it('opens the Collab view when the reader asks, and not before', async () => {
    const openCollab = vi.fn(async () => {})
    const { registrations } = harness({ openCollab })
    const tab = registrations.find(entry => entry.options.name === 'conversation.view')
    const injectedFace = tab?.options.inject?.() as { api: AeraCollabApi }

    // Rendering the tab joins nothing: joining writes a session record, so it
    // must be an explicit act, never a side effect of a tab being drawn.
    expect(openCollab).not.toHaveBeenCalled()
    await injectedFace.api.openCollab('WO-TEST-001')
    expect(openCollab).toHaveBeenCalledWith('WO-TEST-001')
  })
})
