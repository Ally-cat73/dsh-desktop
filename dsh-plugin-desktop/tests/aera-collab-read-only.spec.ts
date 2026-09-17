/**
 * Reading is not writing — WO-AERA-CODE-COLLAB-READ-FIRST-SURFACE-001.
 *
 * The surface renders inline now, under the Collab tab, so it is projected
 * every time a reader opens that tab. A read-first surface that had to mint a
 * session record in order to be read would write to the durable store simply
 * because somebody looked at it. These tests hold the boundary: naming a Work
 * Order projects it and joins nothing, and the store is byte-identical
 * afterwards.
 */
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CollabWorkspaceService, resolveCollabConfig } from '../src/aera-collab-service.ts'
import { parseCollabViewQuery } from '../src/aera-collab-route.ts'
import { parseCollabSurface } from '../src/client/aera-collab-api.ts'

const PROFILE = '/Users/Allyd/.dsh/profiles/aera-gateway-agc/aera-collaboration.json'
const WORK_ORDER = 'WO-AERA-CODE-COLLAB-READ-FIRST-SURFACE-001'

function digest(dir: string): string {
  return readdirSync(dir)
    .filter(entry => statSync(join(dir, entry)).isFile())
    .sort()
    .map(entry => `${entry}:${createHash('sha256').update(readFileSync(join(dir, entry))).digest('hex')}`)
    .join('\n')
}

function environment(): Record<string, string> | undefined {
  try {
    return JSON.parse(readFileSync(PROFILE, 'utf8')).environment as Record<string, string>
  } catch {
    return undefined
  }
}

describe('the Collab surface read path', () => {
  let store: string | undefined

  beforeEach(() => {
    const env = environment()
    if (env?.AERA_COLLAB_STORE_DIR === undefined) return
    store = mkdtempSync(join(tmpdir(), 'aera-collab-read-'))
    cpSync(env.AERA_COLLAB_STORE_DIR, store, { recursive: true })
  })

  afterEach(() => {
    if (store !== undefined) rmSync(store, { recursive: true, force: true })
    store = undefined
  })

  it('projects a named Work Order without joining it or writing a byte', async ({ skip }) => {
    const env = environment()
    if (env === undefined || store === undefined) return skip()

    const service = new CollabWorkspaceService(
      resolveCollabConfig({ ...env, AERA_COLLAB_STORE_DIR: store }, env.AERA_COLLAB_WORKSPACE_ROOT),
    )
    const before = digest(store)
    const view = await service.collabView({ workOrderId: WORK_ORDER })

    expect(view.workOrderId).toBe(WORK_ORDER)
    expect(view.participants.length).toBeGreaterThan(0)
    // The whole point: looking did not join, and looking did not write.
    expect(service.isJoined()).toBe(false)
    expect(digest(store)).toBe(before)
  }, 120_000)

  it('survives the wire: the real projection parses in the renderer', async ({ skip }) => {
    const env = environment()
    if (env === undefined || store === undefined) return skip()

    const service = new CollabWorkspaceService(
      resolveCollabConfig({ ...env, AERA_COLLAB_STORE_DIR: store }, env.AERA_COLLAB_WORKSPACE_ROOT),
    )
    // Serialise exactly as the loopback route does. The renderer validates
    // everything it is handed, so a field the main process can produce but the
    // parser rejects shows the reader an error instead of the surface - which
    // is precisely what a bound that was too tight for a real "changed on
    // both" disclosure did.
    const wire: unknown = JSON.parse(JSON.stringify(
      await service.collabView({ workOrderId: WORK_ORDER }),
    ))
    const parsed = parseCollabSurface(wire)

    expect('workOrderId' in parsed ? parsed.workOrderId : undefined).toBe(WORK_ORDER)
    expect('rail' in parsed ? parsed.rail.length : 0).toBeGreaterThan(0)
  }, 120_000)

  it('projects a Compare for the accordion, and still writes nothing', async ({ skip }) => {
    const env = environment()
    if (env === undefined || store === undefined) return skip()

    const service = new CollabWorkspaceService(
      resolveCollabConfig({ ...env, AERA_COLLAB_STORE_DIR: store }, env.AERA_COLLAB_WORKSPACE_ROOT),
    )
    const before = digest(store)
    // The Compare accordion under a Working Line asks for exactly this.
    const view = await service.collabView({ workOrderId: WORK_ORDER, compareLineIndex: 0 })

    if (view.lines.length === 0) return skip()
    expect(view.lines[0]?.compareAvailable).toBe(true)

    const compare = view.compare
    expect(compare).toBeDefined()
    // FROM and TO are named and the direction is spelled out - a comparison
    // that does not say which way round it is, is not a comparison.
    expect(compare?.from.name).toBeTruthy()
    expect(compare?.to.name).toBeTruthy()
    expect(compare?.directionSentence).toBeTruthy()
    expect(compare?.headline).toBeTruthy()
    expect(compare?.files.length ?? 0).toBeGreaterThan(0)
    for (const file of compare?.files.slice(0, 20) ?? []) {
      // The kind is a WORD, never colour alone, and the accessible name
      // repeats every fact the eye is given.
      expect(['Added', 'Removed', 'Renamed', 'Modified']).toContain(file.kindWord)
      expect(file.accessibleName).toContain(file.path)
    }

    // The renderer must be able to accept what the main process produced.
    const parsed = parseCollabSurface(JSON.parse(JSON.stringify(view)) as unknown)
    expect('compare' in parsed ? parsed.compare?.files.length : 0).toBe(compare?.files.length)

    expect(digest(store)).toBe(before)
  }, 180_000)

  it('composes the CONTEXT packet alongside the surface, joining nothing', async ({ skip }) => {
    const env = environment()
    if (env === undefined || store === undefined) return skip()

    const service = new CollabWorkspaceService(
      resolveCollabConfig({ ...env, AERA_COLLAB_STORE_DIR: store }, env.AERA_COLLAB_WORKSPACE_ROOT),
    )
    const before = digest(store)

    // D4: the route composes these two joinless projections, so the inline
    // surface can show the CONTEXT section the compact view used to carry.
    const [collab, context] = await Promise.all([
      service.collabView({ workOrderId: WORK_ORDER }),
      service.contextView(WORK_ORDER),
    ])
    const wire: unknown = JSON.parse(JSON.stringify({
      ...collab,
      context: {
        currentCanonicalState: context.currentCanonicalState,
        governingDecisions: context.governingDecisions,
        knownResiduals: context.knownResiduals,
      },
    }))
    const parsed = parseCollabSurface(wire)

    expect(context.workOrderId).toBe(WORK_ORDER)
    expect('context' in parsed ? parsed.context : undefined).toBeDefined()
    expect(service.isJoined()).toBe(false)
    expect(digest(store)).toBe(before)
  }, 120_000)

  it('refuses to read a Work Order that does not exist, rather than inventing one', async ({ skip }) => {
    const env = environment()
    if (env === undefined || store === undefined) return skip()

    const service = new CollabWorkspaceService(
      resolveCollabConfig({ ...env, AERA_COLLAB_STORE_DIR: store }, env.AERA_COLLAB_WORKSPACE_ROOT),
    )
    const before = digest(store)

    await expect(service.collabView({ workOrderId: 'WO-DOES-NOT-EXIST-999' }))
      .rejects.toThrow(/Reading does not create one/u)
    expect(digest(store)).toBe(before)
  }, 120_000)
})

describe('the Collab surface read route', () => {
  it('accepts only the parameters it documents', () => {
    expect(parseCollabViewQuery('/desktop/aera/collab/view')).toEqual({})
    expect(parseCollabViewQuery('/desktop/aera/collab/view?workOrderId=WO-1'))
      .toEqual({ workOrderId: 'WO-1' })
    expect(parseCollabViewQuery('/desktop/aera/collab/view?workOrderId=WO-1&compareLineIndex=2'))
      .toEqual({ workOrderId: 'WO-1', compareLineIndex: 2 })
  })

  it('refuses anything it cannot vouch for rather than coercing it', () => {
    for (const url of [
      '/desktop/aera/collab/view?workOrderId=',
      '/desktop/aera/collab/view?compareLineIndex=abc',
      '/desktop/aera/collab/view?compareLineIndex=-1',
      '/desktop/aera/collab/view?compareLineIndex=9999',
      '/desktop/aera/collab/view?unexpected=1',
    ]) {
      expect(parseCollabViewQuery(url)).toBeUndefined()
    }
  })
})
