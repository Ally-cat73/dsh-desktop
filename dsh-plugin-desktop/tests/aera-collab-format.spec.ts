import { describe, expect, it } from 'vitest'
import { displayTime, splitCounts } from '../src/client/aera-collab-format.ts'

describe('Collab surface formatting', () => {
  it('renders a recorded instant for reading, and keeps the exact value', () => {
    const shown = displayTime('2026-09-17T13:22:17.700Z')
    expect(shown?.label).toBe('17 Sep 2026, 13:22:17 UTC')
    // The exact recorded value stays reachable: the surface is checked against
    // Git and the durable store, and a rounded time cannot be checked.
    expect(shown?.exact).toBe('2026-09-17T13:22:17.700Z')
  })

  it('passes an unparseable time through rather than guessing', () => {
    expect(displayTime('not a date')).toEqual({ label: 'not a date', exact: 'not a date' })
    expect(displayTime(undefined)).toBeUndefined()
    expect(displayTime('   ')).toBeUndefined()
  })

  it('splits line counts so each half can carry its own colour', () => {
    expect(splitCounts('+395 −0')).toEqual({ added: '395', removed: '0' })
    expect(splitCounts('+12 -7')).toEqual({ added: '12', removed: '7' })
  })

  it('shows a count it cannot parse rather than dropping it', () => {
    expect(splitCounts('binary')).toEqual({ raw: 'binary' })
    expect(splitCounts(undefined)).toBeUndefined()
  })
})
