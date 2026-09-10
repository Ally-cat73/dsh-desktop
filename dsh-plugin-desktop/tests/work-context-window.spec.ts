/**
 * Work Context window action-scheme tests — WO-AGC-002 Remit C.
 *
 * The private `aera-work-context:` scheme is the ONLY channel through which
 * the sandboxed page can request actions; the parser must accept exactly the
 * documented shapes and nothing else.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: class {} }))

const { parseWorkContextAction } = await import('../src/work-context-window.ts')

describe('parseWorkContextAction', () => {
  it('parses the open action with a WorkOrderId', () => {
    expect(parseWorkContextAction('aera-work-context://open?workOrderId=WO-TEST-001')).toEqual({
      action: 'open',
      workOrderId: 'WO-TEST-001',
    })
  })

  it('parses bare refresh and close-context actions', () => {
    expect(parseWorkContextAction('aera-work-context://refresh')).toEqual({ action: 'refresh' })
    expect(parseWorkContextAction('aera-work-context://close-context')).toEqual({ action: 'close-context' })
  })

  it('parses note, evidence and open-source actions', () => {
    expect(parseWorkContextAction('aera-work-context://note?text=hello%20world')).toEqual({
      action: 'note',
      text: 'hello world',
    })
    expect(parseWorkContextAction('aera-work-context://evidence?nodeId=ewg%3Ax&summary=s')).toEqual({
      action: 'evidence',
      nodeId: 'ewg:x',
      summary: 's',
    })
    expect(parseWorkContextAction('aera-work-context://open-source?path=Aera_Studios_Docs%2Fx.md')).toEqual({
      action: 'open-source',
      path: 'Aera_Studios_Docs/x.md',
    })
  })

  it('rejects foreign protocols, extra parameters and malformed URLs', () => {
    expect(parseWorkContextAction('https://example.com/open?workOrderId=x')).toBeUndefined()
    expect(parseWorkContextAction('aera-work-context://open')).toBeUndefined()
    expect(parseWorkContextAction('aera-work-context://open?workOrderId=x&extra=1')).toBeUndefined()
    expect(parseWorkContextAction('aera-work-context://unknown-action')).toBeUndefined()
    expect(parseWorkContextAction('not a url')).toBeUndefined()
    expect(parseWorkContextAction('aera-work-context://refresh?x=1')).toBeUndefined()
  })

  it('rejects credentialed, port-bearing, path-bearing and fragment-bearing URLs', () => {
    expect(parseWorkContextAction('aera-work-context://user:pass@refresh')).toBeUndefined()
    expect(parseWorkContextAction('aera-work-context://refresh:9999')).toBeUndefined()
    expect(parseWorkContextAction('aera-work-context://refresh/path')).toBeUndefined()
    expect(parseWorkContextAction('aera-work-context://refresh#frag')).toBeUndefined()
  })

  it('rejects oversized action queries', () => {
    const huge = 'x'.repeat(9000)
    expect(parseWorkContextAction(`aera-work-context://note?text=${huge}`)).toBeUndefined()
  })

  it('trims and requires non-empty identifiers', () => {
    expect(parseWorkContextAction('aera-work-context://open?workOrderId=%20%20')).toBeUndefined()
    expect(parseWorkContextAction('aera-work-context://evidence?nodeId=%20')).toBeUndefined()
    expect(parseWorkContextAction('aera-work-context://open-source?path=')).toBeUndefined()
  })
})
