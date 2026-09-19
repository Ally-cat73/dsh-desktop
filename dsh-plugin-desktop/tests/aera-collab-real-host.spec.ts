/**
 * §43 — REAL HOST, NOT A FAKE CTX.
 *
 * A plain-object `ctx` cannot reproduce a cordis service guard, a slot
 * declaration, or a vendor bundle. Every assertion in this file reads the
 * ACTUAL installed host artifacts in `node_modules`, so it fails if the host
 * this product was designed against is not the host it ships against.
 *
 * These are static real-host assertions. They are the cheap half of §43; the
 * other half — real registry, real seat lifecycle, real renderer — is proven by
 * running the product in the isolated dev runtime, and is banked separately
 * with screenshots.
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require_ = createRequire(import.meta.url)
const read = (specifier: string): string =>
  readFileSync(require_.resolve(specifier), 'utf8')

const UI_LAYOUT = '@deepseek-ai/dsh-client-ui-layout/client'
const UI_CONVERSATION = '@deepseek-ai/dsh-client-ui-conversation/client'

describe('§43 the real host declares the seat Collab is hosted on', () => {
  it('ui-layout declares shell.overlay as kind:list, scope:root in the root slot', () => {
    const source = read(UI_LAYOUT)
    /*
     * The whole Option B decision rests on this declaration. A `single` seat
     * would mean Collab displaces whatever else is there (the desktop
     * titlebar); a `session` scope would mean the drawer dies with the Session.
     * Assert the real text rather than trusting the design note.
     */
    const root = source.slice(source.indexOf('name: "root"'))
    const overlay = root.slice(root.indexOf('"shell.overlay"'), root.indexOf('"shell.overlay"') + 120)

    expect(root).toContain('"shell.overlay"')
    expect(overlay).toContain('kind: "list"')
    expect(overlay).toContain('scope: "root"')
  })

  it('ui-layout renders that seat in a click-through overlay layer above the grid', () => {
    const source = read(UI_LAYOUT)

    // The contribution is rendered...
    expect(source).toContain('renderSlot("shell.overlay", {})')
    // ...into a layer that does NOT capture pointer events, while its children
    // do. This is what keeps the centre interactive with Collab open (§18) and
    // what makes "close restores current work" structural (§49C).
    // The CSS-module class is hash-prefixed in the built bundle
    // (e.g. `.pI_x6G_overlayLayer`), so match the suffix rather than a literal.
    expect(source).toMatch(/overlayLayer\{[^}]*pointer-events:none[^}]*\}/)
    expect(source).toMatch(/overlayLayer\s*>\s*\*\{pointer-events:auto\}/)
  })

  it('the centre and the details column are separate seats Collab does not touch', () => {
    const source = read(UI_LAYOUT)

    expect(source).toContain('renderSlot("conversation", {})')
    expect(source).toContain('renderSlot("details", {})')
  })
})

describe('§12 the vendored Details patch no longer hosts Collab', () => {
  it('the installed conversation bundle declares only the stock details child', () => {
    const source = read(UI_CONVERSATION)
    const details = source.slice(source.indexOf('name: "details"'))
    const children = details.slice(0, 400)

    expect(children).toContain('"conversation.details.tool"')
    // The seat our patch used to add. Its absence is the mechanical proof that
    // the Collab-hosting surgery is gone from the artifact the product loads,
    // not merely from the patch file.
    expect(source).not.toContain('conversation.details.collab')
  })

  it('the installed conversation bundle is stock DetailsPanel, with no tab wrapper', () => {
    const source = read(UI_CONVERSATION)

    // Names introduced only by the Collab-hosting hunks.
    expect(source).not.toContain('DetailsToolPanel')
    expect(source).not.toContain('aera:details-tab')
    expect(source).not.toContain('details.collab')
  })

  it('the one surviving patch hunk is the branding string, and it is applied', () => {
    const source = read(UI_CONVERSATION)

    // The 13-line base patch this fork keeps. Its presence proves we reverted
    // to the base rather than dropping the patch altogether.
    expect(source).toContain('Aera Code system context')
  })
})
