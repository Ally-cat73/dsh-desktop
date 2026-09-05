/**
 * WO-AGC-002 REMIT D — INDEPENDENT REVIEW TESTS (reviewer-owned, not part of
 * the implementation). Adversarial re-run of the remit B source-access attacks
 * against the DESKTOP resolver, plus action-scheme and loopback-route abuse
 * cases. One clearly-marked commit; no implementation file is modified.
 */

import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { CollabWorkspaceService } from '../src/aera-collab-service.ts'
import { parseWorkContextAction } from '../src/work-context-window.ts'

const base = mkdtempSync(join(tmpdir(), 'remitD-review-'))
const corpusRoot = join(base, 'corpus')
const stackRoot = join(base, 'stack')
const storeDir = join(base, 'store')
const outside = join(base, 'outside')
for (const dir of [corpusRoot, stackRoot, storeDir, outside]) mkdirSync(dir, { recursive: true })
writeFileSync(join(corpusRoot, 'ok.md'), 'inside\n')
writeFileSync(join(outside, 'secret.txt'), 'outside\n')
// symlinked FILE escape: corpus/link.md -> outside/secret.txt
symlinkSync(join(outside, 'secret.txt'), join(corpusRoot, 'link.md'))
// symlinked DIR escape: corpus/dirlink -> outside
symlinkSync(outside, join(corpusRoot, 'dirlink'))
// prefix-sibling root: base/corpus-sibling must not satisfy a corpus containment check
mkdirSync(`${corpusRoot}-sibling`, { recursive: true })
writeFileSync(join(`${corpusRoot}-sibling`, 'x.md'), 'sibling\n')

afterAll(() => { rmSync(base, { recursive: true, force: true }) })

const service = new CollabWorkspaceService({ corpusRoot, stackRoot, storeDir })

describe('remit D — desktop source resolver adversarial re-run', () => {
  it('resolves an authorised in-root file', () => {
    expect(service.resolveSourcePathToLocal('Aera_Studios_Docs/ok.md')).toContain('ok.md')
  })
  it('refuses absolute paths', () => {
    expect(() => service.resolveSourcePathToLocal(join(outside, 'secret.txt')))
      .toThrowError(/SOURCE_ACCESS_REFUSED|outside the authorised/i)
  })
  it('refuses dot-dot traversal', () => {
    expect(() => service.resolveSourcePathToLocal('Aera_Studios_Docs/../outside/secret.txt'))
      .toThrowError(/outside the authorised/i)
  })
  it('refuses percent-encoded traversal (undecoded segment must not exist)', () => {
    expect(() => service.resolveSourcePathToLocal('Aera_Studios_Docs/%2e%2e/outside/secret.txt'))
      .toThrowError(/outside the authorised|does not exist/i)
  })
  it('refuses a symlinked-file escape via realpath containment', () => {
    expect(() => service.resolveSourcePathToLocal('Aera_Studios_Docs/link.md'))
      .toThrowError(/outside the authorised/i)
  })
  it('refuses a symlinked-directory escape via realpath containment', () => {
    expect(() => service.resolveSourcePathToLocal('Aera_Studios_Docs/dirlink/secret.txt'))
      .toThrowError(/outside the authorised/i)
  })
  it('refuses unknown prefixes (no root fallthrough)', () => {
    expect(() => service.resolveSourcePathToLocal('etc/passwd')).toThrowError(/outside the authorised/i)
    expect(() => service.resolveSourcePathToLocal('Aera_Studios_Docs_evil/ok.md'))
      .toThrowError(/outside the authorised/i)
  })
  it('refuses the store prefix when no store is configured', () => {
    const noStore = new CollabWorkspaceService({ corpusRoot, stackRoot })
    expect(() => noStore.resolveSourcePathToLocal('participation-store/events.json'))
      .toThrowError(/outside the authorised/i)
  })
  it('refuses empty and bare-prefix inputs', () => {
    expect(() => service.resolveSourcePathToLocal('')).toThrowError(/outside the authorised/i)
    // 'Aera_Studios_Docs/' alone resolves to the root itself; the root is
    // permitted by the containment check but exists — assert it never returns
    // anything OUTSIDE the root.
    const resolved = service.resolveSourcePathToLocal('Aera_Studios_Docs/')
    expect(resolved.startsWith(realpathSync(base))).toBe(true)
  })
})

describe('remit D — action scheme abuse', () => {
  it('rejects userinfo, ports, paths, hashes and foreign schemes', () => {
    expect(parseWorkContextAction('aera-work-context://user:pw@open?workOrderId=x')).toBeUndefined()
    expect(parseWorkContextAction('aera-work-context://open:8080?workOrderId=x')).toBeUndefined()
    expect(parseWorkContextAction('aera-work-context://open/extra?workOrderId=x')).toBeUndefined()
    expect(parseWorkContextAction('aera-work-context://open?workOrderId=x#frag')).toBeUndefined()
    expect(parseWorkContextAction('file:///etc/passwd')).toBeUndefined()
    expect(parseWorkContextAction('javascript:alert(1)')).toBeUndefined()
  })
  it('rejects unknown actions and extra keys', () => {
    expect(parseWorkContextAction('aera-work-context://exec?cmd=rm')).toBeUndefined()
    expect(parseWorkContextAction('aera-work-context://open?workOrderId=x&extra=1')).toBeUndefined()
    expect(parseWorkContextAction('aera-work-context://open-source?path=a&path2=b')).toBeUndefined()
  })
  it('rejects oversized query payloads', () => {
    const big = 'a'.repeat(9000)
    expect(parseWorkContextAction(`aera-work-context://note?text=${big}`)).toBeUndefined()
  })
  it('accepts only the documented shapes', () => {
    expect(parseWorkContextAction('aera-work-context://refresh')).toEqual({ action: 'refresh' })
    expect(parseWorkContextAction('aera-work-context://open?workOrderId=WO-1'))
      .toEqual({ action: 'open', workOrderId: 'WO-1' })
  })
})
