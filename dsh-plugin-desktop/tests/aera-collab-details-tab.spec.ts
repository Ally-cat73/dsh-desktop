/**
 * The Collaborate tab of the details column, and the patch that makes room for
 * it (controller ruling, Option B, path 2).
 *
 * The rule the controller set is that tool inspection must behave EXACTLY as
 * before. So these tests do not re-implement the patched panel and assert
 * against the re-implementation — that would prove only that I can write the
 * same bug twice. They read the installed bundle, lift the patched wrapper out
 * of it, and run the real function over a deterministic hook harness.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createAeraCollabEntryController } from '../src/client/aera-collab-entry-controller.ts'
import { AERA_DETAILS_TAB_EVENT, selectCollaborateTab } from '../src/client/aera-collab-panel.ts'
import {
  CENTER_MIN,
  DETAILS_DEFAULT,
  DesktopLayoutState,
  computeDesktopColumns,
} from '../src/client/layout-state.ts'

const require_ = createRequire(import.meta.url)
const BUNDLE = join(
  dirname(require_.resolve('@deepseek-ai/dsh-client-ui-conversation/package.json')),
  'lib/client.js',
)
const source = readFileSync(BUNDLE, 'utf8')

/** Lift `function DetailsPanel(props) { … }` out of the installed bundle. */
function patchedWrapperSource(): string {
  const start = source.indexOf('function DetailsPanel(props) {')
  const end = source.indexOf('function DetailsToolPanel(', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

/**
 * A hook runtime small enough to be obviously correct: state cells in order,
 * effects queued during render and flushed after it, re-render until the state
 * stops moving. Enough for a component whose whole job is two booleans.
 */
function harness(render: (props: Record<string, unknown>) => unknown) {
  const cells: unknown[] = []
  const deps: (readonly unknown[] | undefined)[] = []
  let cursor = 0
  let effectSlot = 0
  let dirty = true
  let tree: unknown

  const react = {
    useState(initial: unknown) {
      const slot = cursor++
      if (!(slot in cells)) cells[slot] = initial
      return [cells[slot], (next: unknown) => {
        const value = typeof next === 'function' ? (next as (p: unknown) => unknown)(cells[slot]) : next
        if (!Object.is(cells[slot], value)) { cells[slot] = value; dirty = true }
      }]
    },
    useRef(initial: unknown) {
      const slot = cursor++
      if (!(slot in cells)) cells[slot] = { current: initial }
      return cells[slot]
    },
    useEffect(fn: () => void, next?: readonly unknown[]) {
      const slot = effectSlot++
      const previous = deps[slot]
      const changed = previous === undefined || next === undefined
        || next.length !== previous.length || next.some((value, i) => !Object.is(value, previous[i]))
      deps[slot] = next
      if (changed) pending.push(fn)
    },
  }
  let pending: (() => void)[] = []

  /*
   * The patched wrapper subscribes to the selection channel in an effect, so
   * the harness supplies the minimum window that needs. Handlers are kept so a
   * test can drive the channel the way the affordance does.
   */
  const handlers = new Map<string, ((event: unknown) => void)[]>()
  const fakeWindow = {
    addEventListener: (name: string, fn: (event: unknown) => void) => {
      handlers.set(name, [...(handlers.get(name) ?? []), fn])
    },
    removeEventListener: (name: string, fn: (event: unknown) => void) => {
      handlers.set(name, (handlers.get(name) ?? []).filter(entry => entry !== fn))
    },
  }
  const scope = globalThis as unknown as { window?: unknown }
  const hadWindow = 'window' in scope
  const previousWindow = scope.window
  // Always ours for the harness's lifetime: the environment may already define
  // a partial `window`, and the listener must land where the test can reach it.
  scope.window = fakeWindow

  const jsx = (type: unknown, props: unknown) => ({ type, props })
  const runtime = { jsx, jsxs: jsx, Fragment: 'Fragment' }

  const DetailsToolPanel = Object.assign(
    (props: unknown) => ({ type: 'DetailsToolPanel', props }),
    { displayName: 'DetailsToolPanel' },
  )
  const css = new Proxy({}, { get: (_t, key) => String(key) })

  const factory = new Function(
    'react', 'react_jsx_runtime', 'DetailsPanel_module_css_default', 'DetailsToolPanel',
    `${patchedWrapperSource()}\nreturn DetailsPanel;`,
  ) as (...args: unknown[]) => (props: Record<string, unknown>) => unknown
  const component = factory(react, runtime, css, DetailsToolPanel)

  return {
    render(props: Record<string, unknown>) {
      dirty = true
      let guard = 0
      while (dirty) {
        if (guard++ > 20) throw new Error('render did not settle')
        dirty = false
        cursor = 0
        effectSlot = 0
        pending = []
        tree = component(props)
        for (const effect of pending) effect()
      }
      return tree
    },
    component,
    stock: DetailsToolPanel,
    /** Drive the external selection channel, as the affordance does. */
    selectTab(tab: string) {
      for (const fn of handlers.get('aera:details-tab') ?? []) fn({ detail: { tab } })
    },
    dispose() {
      if (hadWindow) scope.window = previousWindow
      else delete scope.window
    },
  }
  void render
}

/** Walk the rendered object tree collecting every node's props. */
function nodes(tree: unknown): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (node === null || typeof node !== 'object') return
    const record = node as { props?: Record<string, unknown> }
    if (record.props !== undefined) {
      found.push({ ...record.props, __type: (node as { type?: unknown }).type })
      walk(record.props['children'])
    }
  }
  walk(tree)
  return found
}

describe('the patched details column', () => {
  it('declares the Collaborate seat beside the tool seat, not instead of it', () => {
    expect(source).toContain('"conversation.details.tool"')
    expect(source).toContain('"conversation.details.collab"')
    // The stock panel survives under its own name: the patch renames, it does
    // not rewrite. Its chatStore read is the line the controller cares about.
    expect(source).toContain('function DetailsToolPanel({ useSession, useSessions, sessionId, useStore, renderSlot, closeDetails, t })')
    expect(source).toContain('const selection = useStore((s) => s.selection);')
  })

  it('renders the stock panel alone when nothing occupies the Collaborate seat', () => {
    const h = harness(() => undefined)
    const tree = h.render({
      useStore: () => null,
      renderSlot: () => ({ type: 'Fragment', props: { children: null } }),
      t: (key: string) => key,
    }) as { type?: unknown }
    /*
     * A build with no Collab plugin must be indistinguishable from an
     * unpatched one — no stray tab strip, no wrapper div. The wrapper returns
     * the stock panel itself.
     */
    expect(tree.type).toBe(h.stock)
  })

  it('a tool selection arriving on the Collaborate tab marks Details and does NOT steal it', () => {
    const h = harness(() => undefined)
    const collab = { type: 'Fragment', props: { children: { type: 'Collab', props: {} } } }
    const props = (callId: string | undefined) => ({
      useStore: () => (callId === undefined ? null : { callId }),
      renderSlot: () => collab,
      t: (key: string) => key,
    })

    // Start on Details with nothing selected, then switch to Collaborate.
    h.render(props(undefined))
    const tabs = nodes(h.render(props(undefined))).filter(node => node['role'] === 'tab')
    expect(tabs).toHaveLength(2)
    const collabTab = tabs[1] as { onClick: () => void }
    collabTab.onClick()

    // Now a tool call is selected while Collaborate is showing.
    const after = h.render(props('call-1'))
    const shown = nodes(after)
    const detailsTab = shown.find(node => node['role'] === 'tab')
    expect(detailsTab?.['aria-selected']).toBe(false)
    // The indicator is set…
    expect(detailsTab?.['data-details-pending']).toBe(true)
    // …and the reader was not yanked out of what they were doing: the stock
    // panel is not mounted, because the Collaborate tab is still the one showing.
    expect(shown.some(node => node['__type'] === h.stock)).toBe(false)
  })

  it('looking at Details clears the indicator and mounts the stock panel unchanged', () => {
    const h = harness(() => undefined)
    const collab = { type: 'Fragment', props: { children: { type: 'Collab', props: {} } } }
    const props = (callId: string | undefined) => ({
      useStore: () => (callId === undefined ? null : { callId }),
      renderSlot: () => collab,
      t: (key: string) => key,
      sessionId: 'session-1',
    })
    h.render(props(undefined))
    const tabs = nodes(h.render(props(undefined))).filter(node => node['role'] === 'tab')
    ;(tabs[1] as { onClick: () => void }).onClick()
    h.render(props('call-1'))
    const detailsTab = nodes(h.render(props('call-1'))).find(node => node['role'] === 'tab') as { onClick: () => void }
    detailsTab.onClick()

    const shown = nodes(h.render(props('call-1')))
    const tab = shown.find(node => node['role'] === 'tab')
    expect(tab?.['aria-selected']).toBe(true)
    expect(tab?.['data-details-pending']).toBeUndefined()
    // The stock panel receives the panel's own props, untouched.
    const stock = shown.find(node => node['__type'] === h.stock)
    expect(stock).toBeDefined()
    expect(stock?.['sessionId']).toBe('session-1')
  })
})

describe('§61 host tests — the three rails, and what opening Collab costs the centre', () => {
  it('opens and closes the details column without disturbing the other two rails', () => {
    const layout = new DesktopLayoutState()
    const before = layout.getSnapshot()
    expect(before.details).toBe(0)

    layout.openDetails()
    const open = layout.getSnapshot()
    expect(open.details).toBe(DETAILS_DEFAULT)
    // The sidebar is untouched by a details transition, in both directions.
    expect(open.sidebar).toBe(before.sidebar)

    layout.closeDetails()
    const closed = layout.getSnapshot()
    expect(closed.details).toBe(0)
    expect(closed.sidebar).toBe(before.sidebar)
  })

  it('the centre surface is preserved when the column opens, and restored when it closes', () => {
    const viewport = 1600
    const layout = new DesktopLayoutState()
    const columns = () => {
      const snapshot = layout.getSnapshot()
      return computeDesktopColumns(viewport, snapshot.sidebar, snapshot.details)
    }
    const before = columns()
    layout.openDetails()
    const during = columns()

    // §7: the centre stays usable — it narrows, it does not disappear, and it
    // never crosses its floor. That floor is the whole reason Collab moved out
    // of the centre in the first place.
    expect(during.center).toBeGreaterThanOrEqual(CENTER_MIN)
    expect(during.center).toBeLessThan(before.center)
    expect(during.details).toBe(DETAILS_DEFAULT)

    layout.closeDetails()
    expect(columns()).toEqual(before)
  })

  it('a narrow viewport gives the centre its floor rather than the column its width', () => {
    // Width the details column cannot have in full without starving the centre.
    const columns = computeDesktopColumns(1000, 280, DETAILS_DEFAULT)
    expect(columns.center).toBeGreaterThanOrEqual(Math.min(CENTER_MIN, 1000 - 280))
    expect(columns.sidebar + columns.center + columns.details).toBeLessThanOrEqual(1000)
  })

  it('the affordance opens the column, and pressing it again closes it', () => {
    const controller = createAeraCollabEntryController()
    const layout = new DesktopLayoutState()
    controller.attachColumn({
      isOpen: () => layout.getSnapshot().details !== 0,
      open: () => { layout.openDetails(); return true },
      close: () => { layout.closeDetails() },
    })

    expect(controller.reveal()).toBe('COLUMN')
    expect(layout.getSnapshot().details).toBe(DETAILS_DEFAULT)
    expect(controller.reveal()).toBe('COLUMN')
    expect(layout.getSnapshot().details).toBe(0)
    // The picker was never involved: a column exists, so it is the way in.
    expect(controller.isOpen()).toBe(false)
  })

  it('with no column — the cold start — the affordance falls back to the picker', () => {
    const controller = createAeraCollabEntryController()
    // `details` is session-scoped, so with no Session there is no column.
    controller.attachColumn({ isOpen: () => false, open: () => false, close: () => {} })
    expect(controller.reveal()).toBe('PICKER')
    expect(controller.isOpen()).toBe(true)
  })

  it('column state is not thread state: closing the column decides nothing about a thread', () => {
    /*
     * Thread identity lives in the durable store and in the rail's own
     * selection, never in the container. This is the assertion that the two
     * are not entangled: the controller can open and close the column all day
     * and there is no thread state anywhere in it to lose.
     */
    const controller = createAeraCollabEntryController()
    const layout = new DesktopLayoutState()
    controller.attachColumn({
      isOpen: () => layout.getSnapshot().details !== 0,
      open: () => { layout.openDetails(); return true },
      close: () => { layout.closeDetails() },
    })
    controller.reveal()
    controller.reveal()
    /*
     * Round-1 review NB-5: the old assertion was a substring scan for `thread`,
     * which only fails if someone adds a key literally named that. State the
     * real invariant instead — the column snapshot carries GEOMETRY and
     * nothing else, so there is no seat in it for conversation state to hide.
     */
    expect(Object.keys(layout.getSnapshot()).sort())
      .toEqual(['details', 'narrow', 'narrowExpanded', 'sidebar'])
    // And the controller's own surface offers no thread operation to entangle.
    expect(Object.keys(controller).sort())
      .toEqual(['attachColumn', 'close', 'isOpen', 'open', 'reveal', 'subscribe', 'toggle'])
  })
})

describe('BL-3 — the affordance lands on Collaborate, not on tool inspection', () => {
  it('the wrapper subscribes to the selection channel and switches on it', () => {
    /*
     * Round-1 review BL-3: opening the column left the reader on Details and
     * asked them to find the second tab. The patched wrapper now listens for a
     * plain DOM event; this asserts against the REAL patched source, lifted
     * from the installed bundle, not against a description of it.
     */
    const wrapper = patchedWrapperSource()
    expect(wrapper).toContain('window.addEventListener("aera:details-tab"')
    expect(wrapper).toContain('window.removeEventListener("aera:details-tab"')
    // It only honours the two real tabs, and it uses the same `show` that
    // clears the indicator — a selection is a look.
    expect(wrapper).toContain('if (next !== "details" && next !== "collab") return;')
    expect(wrapper).toContain('show(next);')
  })

  it('the label is translated, not hardcoded English (NB-13)', () => {
    expect(patchedWrapperSource()).toContain('t("details.collab")')
    expect(patchedWrapperSource()).not.toContain('children: "Collaborate"')
    // Both dictionaries carry the key.
    expect(source).toContain('"details.collab": "Collaborate"')
    expect(source).toContain('"details.collab": "协作"')
  })

  it('opening the column emits the Collaborate selection, and the real wrapper switches on it', () => {
    const scope = globalThis as unknown as { window?: unknown }
    const had = 'window' in scope
    const previous = scope.window
    // The harness environment already defines a partial `window`; swap in a
    // real EventTarget for the duration and put the original back after.
    scope.window = new EventTarget()
    const seen: unknown[] = []
    const listener = (event: Event): void => { seen.push((event as CustomEvent).detail) }
    try {
      ;(scope.window as EventTarget).addEventListener(AERA_DETAILS_TAB_EVENT, listener)
      selectCollaborateTab()
      expect(seen).toEqual([{ tab: 'collab' }])
    } finally {
      ;(scope.window as EventTarget).removeEventListener(AERA_DETAILS_TAB_EVENT, listener)
      if (had) scope.window = previous
      else delete scope.window
    }

    // And the patched panel acts on it: the column lands on Collaborate
    // without the reader pressing a second tab.
    const h = harness(() => undefined)
    const collab = { type: 'Fragment', props: { children: { type: 'Collab', props: {} } } }
    const props = {
      useStore: () => null,
      renderSlot: () => collab,
      t: (key: string) => key,
    }
    h.render(props)
    h.selectTab('collab')
    const shown = nodes(h.render(props))
    const tabs = shown.filter(node => node['role'] === 'tab')
    expect(tabs[0]?.['aria-selected']).toBe(false)
    expect(tabs[1]?.['aria-selected']).toBe(true)
    expect(shown.some(node => node['__type'] === h.stock)).toBe(false)
    h.dispose()
  })
})
