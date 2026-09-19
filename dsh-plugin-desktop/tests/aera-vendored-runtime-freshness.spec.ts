/**
 * The vendored participation packages must be the ones this candidate was
 * written against.
 *
 * Round-1 review BL-2: they were two commits stale, so the desktop suite's
 * 1279 passes were obtained against a superseded runtime — §29's deterministic
 * activity naming and the whole §32–§36 admission path were absent from the
 * artifact the product actually loads, while the source said otherwise. A
 * staleness that silent needs a test, not a habit.
 *
 * This asserts on the INSTALLED vendored dist, not on the source tree.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** The dist the product actually loads, in the installed vendored package. */
const RUNTIME_DIST = join(
  dirname(fileURLToPath(import.meta.url)),
  '../node_modules/@aera/participation-runtime/dist/index.js',
)

/**
 * Symbols this candidate depends on. Each entry names the finding or section
 * that made it load-bearing, so a future failure says why it matters.
 */
const RUNTIME_SYMBOLS: readonly (readonly [string, string])[] = [
  ['projectThreadActivityBlocks', '§28 thread activity block'],
  ['collabThreadOpenedSummary', 'R7-3 exact-match event summaries'],
  ['collabMessagePostedSummaryPrefix', 'R7-3 exact-match event summaries'],
  ['projectCodeCollabSurface', 'the Collaborate projection'],
  ['projectInstitutionalMemory', 'the Record projection'],
]

const CONTRACTS_SYMBOLS: readonly (readonly [string, string])[] = [
  ['draftExecutionCommitment', '§33 admission spec'],
  ['classifyCoordinationStatement', '§32 chatter vs execution commitment'],
  ['executionCommitmentSubject', 'shared subject format'],
  ['projectThreadForAgent', '§45 bounded agent projection'],
  ['DELIVERY_ATTACH_POINTS', 'owner Option A attach points'],
]

describe('the vendored participation packages', () => {
  it('export every runtime symbol this candidate depends on', async () => {
    const runtime = await import('@aera/participation-runtime') as Record<string, unknown>
    const missing = RUNTIME_SYMBOLS
      .filter(([name]) => runtime[name] === undefined)
      .map(([name, why]) => `${name} (${why})`)
    expect(missing).toEqual([])
  })

  it('carry the §32–§36 admission method on the store class itself', async () => {
    const runtime = await import('@aera/participation-runtime') as Record<string, unknown>
    const store = runtime['ParticipationStore'] as { prototype: Record<string, unknown> } | undefined
    expect(store).toBeDefined()
    // A method, not a free function: absence here is exactly the BL-2 shape.
    expect(typeof store?.prototype['admitCoordinationExecution']).toBe('function')
  })

  it('export every contracts symbol this candidate depends on', async () => {
    const contracts = await import('@aera/participation-contracts') as Record<string, unknown>
    const missing = CONTRACTS_SYMBOLS
      .filter(([name]) => contracts[name] === undefined)
      .map(([name, why]) => `${name} (${why})`)
    expect(missing).toEqual([])
  })

  it('carry the §29 naming, which lives inside the projection rather than on the export face', () => {
    const source = readFileSync(RUNTIME_DIST, 'utf8')
    // `evidenceClassBlockTitle` is module-private, so its presence is asserted
    // through the strings it produces — which is what a reader would see.
    expect(source).toContain('Independent verification and acceptance')
    expect(source).toContain('function evidenceClassBlockTitle')
  })

  it('no longer carry the strings the superseded runtime produced', () => {
    const source = readFileSync(RUNTIME_DIST, 'utf8')
    /*
     * "Status unavailable" (§21) and the SESSION_MINUTE-only naming were the
     * two visible symptoms of the stale artifact. Their absence is a cheap,
     * specific staleness canary.
     */
    expect(source).toContain('Independent verification and acceptance')
    expect(source).not.toContain('Status unavailable')
  })
})
