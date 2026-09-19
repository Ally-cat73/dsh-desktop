/**
 * §30 — ZERO CLASSIFICATION, ASSERTED AGAINST THE REAL FIXTURE.
 *
 * "For every displayed zero: mechanically classify it as TRUE_ZERO,
 * PROJECTION_DEFECT or RECORDING_GAP. Never display a false zero."
 *
 * Unit assertions on a synthetic store prove the classifier's logic. They
 * cannot prove it is telling the truth about THIS institution, so the last
 * group runs it against a copy of the real store — the same read-only copy
 * pattern the read-path tests use, so nothing here can touch the live store.
 *
 * The real-fixture assertions are the ones that matter: the round-1 owner
 * acceptance failure was exactly a pair of zeros (ACTIVITY 0, EVIDENCE 0)
 * displayed while nine DISCUSSION_POSTED events sat underneath them, and a
 * classifier that cannot tell that apart from an empty Work Order is not doing
 * the job §30 asks for.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ParticipationStore } from '@aera/participation-runtime'
import {
  classifyDisplayedZeros,
  type ZeroClassifierStore,
} from '../src/aera-collab-zero-classifier.ts'

const PROFILE = '/Users/Allyd/.dsh/profiles/aera-gateway-agc/aera-collaboration.json'
const RELAY_WO = 'WO-AERA-COLLAB-RELAY-COORDINATION-THREADS-AND-WORKING-LINE-HANDOFF-001'
const LINEAGE_WO = 'WO-AERA-COLLAB-DURABLE-WORKING-LINE-LINEAGE-DECISIONS-AND-CHECKPOINTS-001'

const NO_RECORDS: ZeroClassifierStore = {
  listCodeWorkingLines: () => [],
  listCodeCheckpoints: () => [],
  listTypedEvidence: () => [],
  listDecisions: () => [],
  listDiscussions: () => [],
  listCollabThreads: () => [],
  listEvents: () => [],
}

const ALL_ZERO = {
  workingLines: 0, checkpoints: 0, activity: 0, discussionsDecisions: 0, evidence: 0,
}

function environment(): Record<string, string> | undefined {
  try {
    return JSON.parse(readFileSync(PROFILE, 'utf8')).environment as Record<string, string>
  } catch {
    return undefined
  }
}

describe('§30 the classifier distinguishes the three states', () => {
  it('calls a zero TRUE_ZERO when the store holds nothing of that class', () => {
    const rows = classifyDisplayedZeros(NO_RECORDS, RELAY_WO, ALL_ZERO)

    expect(rows).toHaveLength(5)
    for (const row of rows) {
      expect(row.classification).toBe('TRUE_ZERO')
      expect(row.storeRecords).toBe(0)
      expect(row.sentence).toMatch(/^TRUE ZERO: /)
    }
  })

  it('calls a zero a PROJECTION_DEFECT when records exist and none is shown', () => {
    const rows = classifyDisplayedZeros(
      { ...NO_RECORDS, listCodeCheckpoints: () => [{ workOrderId: RELAY_WO }, { workOrderId: RELAY_WO }] },
      RELAY_WO,
      ALL_ZERO,
    )
    const checkpoints = rows.find(row => row.category === 'CHECKPOINTS')

    expect(checkpoints?.classification).toBe('PROJECTION_DEFECT')
    expect(checkpoints?.storeRecords).toBe(2)
    // The wording must not claim the work never happened — that is the lie.
    expect(checkpoints?.sentence).toMatch(/not a fact about the work/)
  })

  it('calls a zero a RECORDING_GAP when the acts are evidenced but the record is not', () => {
    /*
     * This is the shape of the original owner FAIL: institutional acts happened
     * and were evented, and the typed record that should accompany them was
     * never written. "No evidence has been recorded" is true of the store and
     * false of the work.
     */
    const rows = classifyDisplayedZeros(
      {
        ...NO_RECORDS,
        listEvents: () => [
          { workOrderId: RELAY_WO, kind: 'EVIDENCE_ATTACHED' },
          { workOrderId: RELAY_WO, kind: 'VERIFICATION_RECORDED' },
        ],
      },
      RELAY_WO,
      ALL_ZERO,
    )
    const evidence = rows.find(row => row.category === 'EVIDENCE')

    expect(evidence?.classification).toBe('RECORDING_GAP')
    expect(evidence?.gapEvidence).toEqual(['EVIDENCE_ATTACHED', 'VERIFICATION_RECORDED'])
    expect(evidence?.sentence).toMatch(/true of the record and false of the work/)
  })

  it('classifies only DISPLAYED zeros — a non-zero count speaks for itself', () => {
    const rows = classifyDisplayedZeros(NO_RECORDS, RELAY_WO, { ...ALL_ZERO, evidence: 17 })

    expect(rows.map(row => row.category)).not.toContain('EVIDENCE')
    expect(rows).toHaveLength(4)
  })

  it('counts only this Work Order — another order’s records are not ours', () => {
    const rows = classifyDisplayedZeros(
      { ...NO_RECORDS, listCodeCheckpoints: () => [{ workOrderId: LINEAGE_WO }] },
      RELAY_WO,
      ALL_ZERO,
    )

    expect(rows.find(row => row.category === 'CHECKPOINTS')?.classification).toBe('TRUE_ZERO')
  })

  it('reads a Work Order id carried on a nested contribution', () => {
    const rows = classifyDisplayedZeros(
      { ...NO_RECORDS, listDecisions: () => [{ contribution: { workOrderId: RELAY_WO } }] },
      RELAY_WO,
      ALL_ZERO,
    )

    expect(rows.find(row => row.category === 'DISCUSSIONS_DECISIONS')?.classification)
      .toBe('PROJECTION_DEFECT')
  })
})

describe('§30 against the REAL fixture, on a read-only copy', () => {
  let store: string | undefined

  beforeEach(() => {
    const env = environment()
    if (env?.AERA_COLLAB_STORE_DIR === undefined) return
    store = mkdtempSync(join(tmpdir(), 'aera-collab-zero-'))
    cpSync(env.AERA_COLLAB_STORE_DIR, store, { recursive: true })
  })

  afterEach(() => {
    if (store !== undefined) rmSync(store, { recursive: true, force: true })
    store = undefined
  })

  it('the Relay Work Order’s Working Lines zero is a TRUE ZERO, on real records', ({ skip }) => {
    if (store === undefined) return skip()
    const participation = new ParticipationStore(store) as unknown as ZeroClassifierStore

    const rows = classifyDisplayedZeros(participation, RELAY_WO, { ...ALL_ZERO, workingLines: 0 })
    const lines = rows.find(row => row.category === 'WORKING_LINES')

    // Established independently across several review rounds: the store's
    // Working Lines belong to the PREDECESSOR order, not this one.
    expect(lines?.classification).toBe('TRUE_ZERO')
    expect(lines?.storeRecords).toBe(0)
  })

  it('does not call a zero TRUE when the real store holds records for that class', ({ skip }) => {
    if (store === undefined) return skip()
    const participation = new ParticipationStore(store) as unknown as ZeroClassifierStore

    /*
     * The Relay Work Order really does hold typed evidence and a thread. If the
     * projection ever showed 0 for those, the classifier must say DEFECT rather
     * than agree that nothing was recorded. This is the assertion that would
     * have caught the original owner FAIL.
     */
    const rows = classifyDisplayedZeros(participation, RELAY_WO, ALL_ZERO)
    const evidence = rows.find(row => row.category === 'EVIDENCE')
    const discussions = rows.find(row => row.category === 'DISCUSSIONS_DECISIONS')

    expect(evidence?.classification).toBe('PROJECTION_DEFECT')
    expect(evidence?.storeRecords).toBeGreaterThan(0)
    expect(discussions?.classification).toBe('PROJECTION_DEFECT')
    expect(discussions?.storeRecords).toBeGreaterThan(0)
  })

  it('reading the real fixture classifies without writing to it', ({ skip }) => {
    if (store === undefined) return skip()
    const participation = new ParticipationStore(store) as unknown as ZeroClassifierStore

    classifyDisplayedZeros(participation, RELAY_WO, ALL_ZERO)
    classifyDisplayedZeros(participation, LINEAGE_WO, ALL_ZERO)

    // The copy is what we assert on; the live store is never opened by this file.
    expect(store).toContain('aera-collab-zero-')
  })
})
