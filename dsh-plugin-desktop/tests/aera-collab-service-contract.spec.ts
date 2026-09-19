/**
 * §44 — STATIC SERVICE CONTRACT CHECK.
 *
 * Every `ctx.<identifier>` reachable in the client graph must classify as one
 * of three things, or this suite fails:
 *
 *   1. a cordis CORE member, reached through `Reflect.has(target, prop)` and
 *      therefore never subject to the service guard;
 *   2. a KNOWN ROOT-PROVIDED service — provided on the root context, and so
 *      reachable without declaration;
 *   3. a service DECLARED in the plugin's own `inject` list.
 *
 * ## Why this exists, and why a unit test could not replace it
 *
 * cordis enforces a TWO-TIER rule, established by experiment against the real
 * runtime in review round 4: a service provided on the ROOT context is
 * reachable without `inject`; a service provided from a PLUGIN fiber is
 * guarded and throws `cannot get property "<name>" without inject`.
 *
 * §65 acceptance failed on exactly that. The Collab affordance read
 * `ctx.layout` — plugin-provided by `@deepseek-ai/dsh-client-ui-layout` — which
 * was not declared. The read threw inside a click handler, so the button was
 * silently inert: no column, no picker, no error the reader or the log could
 * see. It survived three rounds of independent source review and 1,294 passing
 * tests, because EVERY unit test substitutes a plain object for `ctx`, and a
 * plain object cannot reproduce a service guard.
 *
 * A per-service assertion closes the instance. This closes the CLASS: it needs
 * no runtime, it cannot be bypassed by a code path the tests do not execute
 * (which is the property that actually failed), and it fails on the NEXT
 * undeclared service rather than on the last one.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { inject } from '../src/client/index.ts'

const CLIENT_DIR = join(import.meta.dirname, '../src/client')

/**
 * cordis core members, reached via `Reflect.has(target, prop)` in
 * `@deepseek-ai/cordis/src/reflect.ts` and returned before the fiber store
 * chain is walked. These never enter the guard.
 */
const CORDIS_CORE = new Set([
  'effect', 'on', 'off', 'once', 'emit', 'parallel', 'serial', 'bail',
  'reflect', 'plugin', 'inject', 'scope', 'fiber', 'get', 'set', 'provide',
  'mixin', 'extend', 'root', 'name', 'registry', 'events', 'start', 'stop',
])

/**
 * Services provided on the ROOT context, and therefore reachable with no
 * declaration. Each entry names the provider that makes it root-provided —
 * this list may only grow with evidence, never by assumption.
 */
const ROOT_PROVIDED = new Map([
  // Loader constructor: ctx.reflect.provide('loader', …) on the root it boots.
  ['loader', 'cordis-plugin-loader'],
])

/** Read every source file in the client graph. */
function clientSources(): { file: string, text: string }[] {
  const out: { file: string, text: string }[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) { walk(path); continue }
      if (!/\.tsx?$/.test(entry.name)) continue
      out.push({ file: path, text: readFileSync(path, 'utf8') })
    }
  }
  walk(CLIENT_DIR)
  return out
}

/**
 * Collect `ctx.<identifier>` reads, ignoring comments — a member named only in
 * a prose explanation is not a read, and treating it as one would make the
 * check punish documentation.
 */
function ctxMembers(): Map<string, string[]> {
  const found = new Map<string, string[]>()
  for (const { file, text } of clientSources()) {
    const code = text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
    for (const match of code.matchAll(/\bctx\.([a-zA-Z_][a-zA-Z0-9_]*)/g)) {
      const name = match[1]!
      const sites = found.get(name) ?? []
      if (!sites.includes(file)) sites.push(file)
      found.set(name, sites)
    }
  }
  return found
}

describe('§44 static ctx service contract', () => {
  it('every ctx.<service> read is cordis core, root-provided, or declared in inject', () => {
    const declared = new Set<string>(inject)
    const undeclared: string[] = []
    for (const [name, files] of ctxMembers()) {
      if (CORDIS_CORE.has(name)) continue
      if (ROOT_PROVIDED.has(name)) continue
      if (declared.has(name)) continue
      undeclared.push(`ctx.${name} — read in ${files.map(f => f.replace(`${CLIENT_DIR}/`, '')).join(', ')}`)
    }
    expect(
      undeclared,
      'Undeclared service read. cordis guards any service provided from a plugin '
      + 'fiber, so this throws at runtime — and inside a click handler it throws '
      + 'invisibly (§65). Declare it in src/client/index.ts `inject`, or add it to '
      + 'ROOT_PROVIDED with the provider that makes it root-provided.',
    ).toEqual([])
  })

  it('detects an undeclared service — the check can actually fail', () => {
    /*
     * A guard whose failure path is never exercised is the kind of assertion
     * round 2 caught being vacuous. This runs the same classification over a
     * synthetic read and proves it is rejected.
     */
    const declared = new Set<string>(inject)
    const classify = (name: string): boolean =>
      CORDIS_CORE.has(name) || ROOT_PROVIDED.has(name) || declared.has(name)
    expect(classify('layout')).toBe(false)
    expect(classify('somethingNobodyProvides')).toBe(false)
    expect(classify('slots')).toBe(true)
    expect(classify('effect')).toBe(true)
    expect(classify('loader')).toBe(true)
  })

  it('the Collab host reads no layout service at all', () => {
    /*
     * The §14 decision's mechanical consequence. If a future change reaches for
     * ctx.layout again, that is a signal the host is drifting back toward the
     * details column, and it should be a deliberate decision rather than a
     * quiet reintroduction.
     */
    expect(ctxMembers().has('layout')).toBe(false)
    expect(inject).not.toContain('layout')
  })
})
