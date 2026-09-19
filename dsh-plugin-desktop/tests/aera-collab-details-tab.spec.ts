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
    expect(Object.keys(layout.getSnapshot()).some(key => key.toLowerCase().includes('thread'))).toBe(false)
  })
})
