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

  it('offers Collab from a top-level menu-bar menu in the default owner launch', async () => {
    const contributions = await applyCollabPluginInDefaultConfiguration()
    const additions = desktopApplicationMenuItems(contributions, invoke => () => { void invoke() })
    const template = macApplicationMenuTemplate('Aera Code', 'en', additions)

    // The application menu (template[0]) is NOT a discoverable home: it sits
    // behind the product's own name, below "About". Require a menu whose own
    // label is drawn in the menu bar.
    const topLevel = template.slice(1)
    const carriers = topLevel.filter(menu => submenuOf(menu)
      .some(entry => entry.label === 'Aera: Collab'))

    expect(carriers.map(menu => menu.label)).toEqual(['Tools'])
  })

  it('opens the Collab view when that menu-bar item is activated', async () => {
    const contributions = await applyCollabPluginInDefaultConfiguration()
    const additions = desktopApplicationMenuItems(contributions, invoke => () => { void invoke() })
    const template = macApplicationMenuTemplate('Aera Code', 'en', additions)

    const tools = template.slice(1).find(menu => menu.label === 'Tools')
    expect(tools).toBeDefined()
    const collab = submenuOf(tools!).find(entry => entry.label === 'Aera: Collab')
    expect(collab).toBeDefined()
    expect(collab?.enabled).toBe(true)

    collab?.click?.(undefined as never, undefined as never, undefined as never)
    expect(openView).toHaveBeenCalledWith('COLLAB')
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
      .toEqual(['Aera: Work Context', 'Aera: Collab'])
  })

  it('contributes no menu-bar menu when no Host plugin registered a command', () => {
    const template = macApplicationMenuTemplate('Aera Code', 'en', [])
    expect(template.map(menu => menu.label))
      .toEqual(['Aera Code', 'File', 'Edit', 'View', 'Window'])
  })
})
