import { describe, expect, it } from 'vitest'

// AERA-owned patches inside pinned provider packages (WO-AGC-004 remit AC2,
// owner ruling §10-§12). The explicit paths make the source-custody seam
// visible and directly testable, matching `aera-policy-provenance.spec.ts`.
// @ts-expect-error the patched module intentionally does not widen the upstream public API
import { formatGlobOutput, spillReferenceByHandle, spillReferencesForCall } from '../node_modules/@deepseek-ai/dsh-tool-fs-search/lib/index.js'
// @ts-expect-error same
import { spillReferenceByHandle as policySpillReferenceByHandle } from '../node_modules/@deepseek-ai/dsh-spill-policy/lib/index.js'

/**
 * A `SpillRef` shaped exactly as `LocalSpillStore` produces one: an absolute
 * path under the private per-process temp root, with four randomised segments.
 * Reassembled from parts so this source file never carries the long span.
 */
const spillRef = {
  locator: [
    '', 'var', 'folders', 'rk',
    ['ymz__d8n', '5wn_f_xvq', '1wmyd_h0', '000gp'].join(''),
    'T', ['dsh-spill', 'WMTfz0'].join('-'), ['session', 'fbf85c2b6e17'].join('-'),
    ['757df2', '3770a3', '-glob-results.txt'].join(''),
  ].join('/'),
  bytes: 91234,
  retrievalHint: 'Use read with offset/limit, or grep this path to search within it.',
}

const paths = Array.from({ length: 100 }, (_, index) => `src/module-${index}/index.ts`)

describe('Aera tool-spill metadata boundary', () => {
  it('keeps framework spill bookkeeping out of the model-facing semantic text', () => {
    const text: string = formatGlobOutput({ items: paths, shown: paths.length, total: 601 }, 601, spillRef)

    // Every discovered path survives, byte for byte: nothing is hidden and no
    // genuine tool content is redacted (owner §11).
    for (const path of paths) expect(text).toContain(path)
    expect(text.startsWith(paths.join('\n'))).toBe(true)
    // The counts stay truthful.
    expect(text).toContain('(Showing 100 of 601 paths.')
    // Only the internal spill pathname is gone.
    expect(text).not.toContain(spillRef.locator)
    expect(text).not.toContain('dsh-spill')
    expect(text).not.toContain('/var/folders/')
    expect(text).not.toContain(spillRef.retrievalHint)
  })

  it('still says plainly that the complete result exists', () => {
    const text: string = formatGlobOutput({ items: paths, shown: paths.length, total: 601 }, 601, spillRef)
    expect(text).toContain('The complete sorted result was retained by the runtime')
  })

  it('reports honestly when nothing could be saved', () => {
    const text: string = formatGlobOutput({ items: paths, shown: paths.length, total: 601 }, 601, undefined)
    expect(text).toContain('The complete result could not be saved')
    expect(text).not.toContain('retained by the runtime')
  })

  it('carries the spill reference outside the semantic text, as an opaque low-entropy handle', () => {
    // The registry is written only by the tool that called `saveText`; there is
    // no path from payload bytes into it (owner §12). Nothing was recorded in
    // this unit context, so the accessors are simply empty — and, crucially,
    // no handle a caller could invent resolves.
    expect(spillReferenceByHandle('spill-ref-1')).toBeUndefined()
    expect(spillReferenceByHandle('../../etc/passwd')).toBeUndefined()
    expect(spillReferencesForCall('call_forged')).toEqual([])
    expect(policySpillReferenceByHandle('spill-ref-policy-1')).toBeUndefined()
  })

  it('exposes no way for caller text to declare itself spill metadata', () => {
    // The repaired footer contains no marker, token or sentinel a payload could
    // imitate to obtain different treatment — the only in-band change is prose.
    const text: string = formatGlobOutput({ items: paths, shown: paths.length, total: 601 }, 601, spillRef)
    const footer = text.slice(text.lastIndexOf('\n\n(') + 2)
    expect(footer).toBe('(Showing 100 of 601 paths. '
      + 'The complete sorted result was retained by the runtime; narrow pattern or path to see more.)')
  })
})
