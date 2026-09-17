/**
 * Presentation helpers for the Collab surface.
 *
 * WO-AERA-CODE-COLLAB-READ-FIRST-SURFACE-001, owner feedback on the inline
 * surface: *"we don't know provenance and attribution of that data, we don't
 * know when it happened… it's hard to then tease apart if something is actually
 * wrong, if data is being rendered incorrectly."*
 *
 * So a time is never dropped and never shortened away. It is shown in a form a
 * person can read, and the exact recorded instant stays reachable on the same
 * element, because the two jobs are different: reading the surface, and
 * checking the surface against the record.
 */

/** A recorded instant, in both the form a person reads and the form recorded. */
export interface DisplayTime {
  /** Human-readable, e.g. "17 Sep 2026, 13:22:17 UTC". */
  readonly label: string
  /** The recorded value, verbatim, for `title`/`datetime`. */
  readonly exact: string
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function pad(value: number): string {
  return value < 10 ? `0${String(value)}` : String(value)
}

/**
 * Render a recorded timestamp for reading, keeping the exact value beside it.
 *
 * UTC deliberately, and labelled as such: these instants are compared against
 * Git and against the durable store, both of which record UTC. Quietly
 * localising them would make two records of the same act look like two acts.
 *
 * An unparseable value is returned untouched rather than guessed at.
 */
export function displayTime(value: string | undefined): DisplayTime | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const when = new Date(value)
  if (Number.isNaN(when.getTime())) return { label: value, exact: value }
  const label = `${String(when.getUTCDate())} ${MONTHS[when.getUTCMonth()] ?? '?'} `
    + `${String(when.getUTCFullYear())}, `
    + `${pad(when.getUTCHours())}:${pad(when.getUTCMinutes())}:${pad(when.getUTCSeconds())} UTC`
  return { label, exact: value }
}

/** The two halves of a changed-file line count, so each can be coloured. */
export interface LineCounts {
  readonly added?: string
  readonly removed?: string
  /** The original string, when it is not the shape this understands. */
  readonly raw?: string
}

/**
 * Split `"+395 −0"` into its added and removed halves.
 *
 * Owner feedback asked for these in colour and aligned in one column, which
 * needs the two numbers separately. Anything that is not that exact shape is
 * passed through as `raw` rather than reshaped into something it is not — a
 * count this cannot parse is still a fact the reader is entitled to see.
 */
export function splitCounts(counts: string | undefined): LineCounts | undefined {
  if (counts === undefined || counts.trim() === '') return undefined
  // The projection writes U+2212 MINUS SIGN; tolerate a hyphen too.
  const match = /^\+(\d+)\s*[−-]\s*(\d+)$/u.exec(counts.trim())
  if (match?.[1] === undefined || match[2] === undefined) return { raw: counts }
  return { added: match[1], removed: match[2] }
}
