/**
 * Owner-visible entry point regression — WO-AERA-CODE-COLLAB-READ-FIRST-SURFACE-001.
 *
 * Owner acceptance failed on an installed build whose Collab route was fully
 * present and fully working: every internal gate passed because every internal
 * gate asked whether the route EXISTED. None asked whether a person could see
 * a way in. The only shipped affordances were a macOS tray item — which the
 * system laid out off-screen on a saturated menu bar — and a view switch
 * INSIDE the window that only the tray item opened.
 *
 * These tests therefore assert reachability, not existence. They run the real
 * plugin through the real menu projection in the DEFAULT owner launch
 * configuration (no AERA_COLLAB_* environment), and they fail if the Collab
 * command is not present in a top-level menu-bar menu.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { MenuItemConstructorOptions } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  desktopApplicationMenuItems,
  macApplicationMenuTemplate,
} from '../src/native-menu.ts'
import type { DesktopRuntime, DesktopTrayItem } from '../src/runtime.ts'

const openView = vi.fn()
const openWindow = vi.fn()

vi.mock('electron', () => ({
  dialog: { showMessageBox: vi.fn() },
  shell: { openPath: vi.fn(async () => '') },
  BrowserWindow: class {},
}))

vi.mock('../src/work-context-window.ts', () => ({
  WorkContextWindow: class {
    openView = openView
    open = openWindow
    close = vi.fn()
  },
}))

function submenuOf(item: MenuItemConstructorOptions): MenuItemConstructorOptions[] {
  if (!Array.isArray(item.submenu)) throw new Error(`expected a submenu on ${String(item.label)}`)
  return item.submenu
}

/**
 * Apply the real Collab plugin exactly as the packaged Host does, in the
 * default owner configuration, and return every tray contribution it made.
 */
async function applyCollabPluginInDefaultConfiguration(): Promise<DesktopTrayItem[]> {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('AERA_COLLAB_')) delete process.env[key]
  }
  const { apply } = await import('../src/aera-collab.ts')
  const contributions: DesktopTrayItem[] = []
  const runtime = {
    locale: 'en',
    registerTrayItem: (item: DesktopTrayItem) => {
      contributions.push(item)
      return { refresh: () => {}, dispose: () => {} }
    },
  } as unknown as DesktopRuntime
  const ctx = {
    desktopRuntime: runtime,
    webServer: { port: 51234, register: () => () => {} },
    logger: { error: () => {} },
    effect: (register: () => (() => void)) => register(),
  } as unknown as Context

  apply(ctx)
  return contributions
}

describe('Collab is reachable by a person, not only by a route', () => {
  beforeEach(() => {
    openView.mockClear()
    openWindow.mockClear()
  })

  /*
   * SUPERSEDED, and asserted in the negative rather than deleted.
   *
   * These two tests protected an 'Aera: Collab' menu-bar item that invoked
   * window.openView('COLLAB') — the LEGACY native Collab view. The section 14
   * host decision selected a drawer on shell.overlay instead, and shipping both
   * would leave two unrelated Collab surfaces behind two different controls,
   * which is the 'no route hunting' problem of section 18. The tray item is
   * removed (src/aera-collab.ts), and it is not rewired because tray
   * invocation runs in the Electron main process while the drawer's state lives
   * in the renderer, and ctx.desktopRuntime exposes no main-to-renderer command
   * path.
   *
   * Discoverability — the thing the original acceptance failure was about — is
   * carried by the sidebar affordance, which is scope:'root' and therefore
   * present with no Session at all. That is asserted in
   * tests/aera-collab-tab.spec.ts.
   */
  it('no longer offers the legacy Collab view from the menu bar (section 14, section 18)', async () => {
    const contributions = await applyCollabPluginInDefaultConfiguration()
    const additions = desktopApplicationMenuItems(contributions, invoke => () => { void invoke() })
    const template = macApplicationMenuTemplate('Aera Code', 'en', additions)

    const carriers = template.slice(1).filter(menu => submenuOf(menu)
      .some(entry => entry.label === 'Aera: Collab'))

    expect(carriers).toEqual([])
  })

  it('opens no legacy Collab view from anywhere in the menu bar', async () => {
    const contributions = await applyCollabPluginInDefaultConfiguration()
    const additions = desktopApplicationMenuItems(contributions, invoke => () => { void invoke() })
    const template = macApplicationMenuTemplate('Aera Code', 'en', additions)

    for (const menu of template.slice(1)) {
      for (const entry of submenuOf(menu)) {
        entry.click?.(undefined as never, undefined as never, undefined as never)
      }
    }

    expect(openView).not.toHaveBeenCalledWith('COLLAB')
  })

  it('never lets the tray be the only way in', async () => {
    const contributions = await applyCollabPluginInDefaultConfiguration()
    const additions = desktopApplicationMenuItems(contributions, invoke => () => { void invoke() })
    const template = macApplicationMenuTemplate('Aera Code', 'en', additions)

    const reachable = new Set<string>()
    for (const menu of template.slice(1)) {
      for (const entry of submenuOf(menu)) {
        if (typeof entry.label === 'string') reachable.add(entry.label)
      }
    }

    // Every command the plugin contributed to the tray must also be reachable
    // from the always-visible menu bar.
    for (const item of contributions) {
      expect(reachable).toContain(item.label())
    }
    expect(contributions.map(item => item.label()))
      .toEqual(['Aera: Work Context'])
  })

  it('contributes no menu-bar menu when no Host plugin registered a command', () => {
    const template = macApplicationMenuTemplate('Aera Code', 'en', [])
    expect(template.map(menu => menu.label))
      .toEqual(['Aera Code', 'File', 'Edit', 'View', 'Window'])
  })
})
