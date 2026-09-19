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

/** Strip comments — a member named in prose is not a read. */
function codeOf(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/**
 * Collect service names reached from `ctx`, by all three routes.
 *
 * The first version matched only `ctx.<name>`. A mutation test in the §46
 * review found the two ways round it, and both are ordinary TypeScript that a
 * future author would write without meaning to evade anything:
 *
 *   const { layout } = ctx          // destructuring
 *   const c = ctx; c.layout         // aliasing
 *
 * Neither was caught, so the guard closed only the direct-member class. It now
 * follows all three. Aliases are resolved one hop — `const c = ctx` then
 * `c.<name>` — which is the shape that actually occurs; deeper chains are not
 * modelled, and that limit is stated rather than left to be discovered.
 */
function ctxMembers(): Map<string, string[]> {
  const found = new Map<string, string[]>()
  const note = (name: string, file: string): void => {
    const sites = found.get(name) ?? []
    if (!sites.includes(file)) sites.push(file)
    found.set(name, sites)
  }
  for (const { file, text } of clientSources()) {
    const code = codeOf(text)

    // 1. direct member reads: ctx.layout
    for (const m of code.matchAll(/\bctx\.([a-zA-Z_][a-zA-Z0-9_]*)/g)) note(m[1]!, file)

    // 2. destructuring: const { layout, slots: s } = ctx
    for (const m of code.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*ctx\b/g)) {
      for (const part of m[1]!.split(',')) {
        const name = part.split(':')[0]!.trim().replace(/^\.\.\./, '')
        if (name !== '') note(name, file)
      }
    }

    // 3. one-hop aliases: const c = ctx  →  c.layout
    for (const m of code.matchAll(/(?:const|let|var)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*ctx\b(?![.(])/g)) {
      const alias = m[1]!
      if (alias === 'ctx') continue
      const re = new RegExp(`\\b${alias}\\.([a-zA-Z_][a-zA-Z0-9_]*)`, 'g')
      for (const hit of code.matchAll(re)) note(hit[1]!, file)
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

  it('follows destructuring and one-hop aliases, not just direct member reads', () => {
    /*
     * The §46 review mutation-tested the first version of this check and found
     * both escapes. This asserts the collector itself on the two shapes, so the
     * closure is exercised rather than assumed.
     */
    const collect = (src: string): string[] => {
      const found: string[] = []
      const code = codeOf(src)
      for (const m of code.matchAll(/\bctx\.([a-zA-Z_][a-zA-Z0-9_]*)/g)) found.push(m[1]!)
      for (const m of code.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*ctx\b/g)) {
        for (const part of m[1]!.split(',')) {
          const name = part.split(':')[0]!.trim().replace(/^\.\.\./, '')
          if (name !== '') found.push(name)
        }
      }
      for (const m of code.matchAll(/(?:const|let|var)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*ctx\b(?![.(])/g)) {
        const alias = m[1]!
        if (alias === 'ctx') continue
        for (const hit of code.matchAll(new RegExp(`\\b${alias}\\.([a-zA-Z_][a-zA-Z0-9_]*)`, 'g'))) {
          found.push(hit[1]!)
        }
      }
      return found
    }
    expect(collect('const { layout } = ctx')).toContain('layout')
    expect(collect('const { slots: s, layout } = ctx')).toContain('layout')
    expect(collect('const c = ctx;\nc.layout')).toContain('layout')
    // The cast form is how this is actually written in TypeScript.
    expect(collect('const c = ctx as Face\nc.layout')).toContain('layout')
    // An assignment OF a member is not an alias of ctx itself.
    expect(collect('const c = ctx.slots\nc.register')).not.toContain('register')
    expect(collect('ctx.layout')).toContain('layout')
    // Prose must not count as a read.
    expect(collect('// we removed ctx.layout on purpose')).not.toContain('layout')
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
