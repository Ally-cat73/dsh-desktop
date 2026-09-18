/**
 * §37 product tests for the read-first Code Collab surface —
 * WO-AERA-CODE-COLLAB-READ-FIRST-SURFACE-001.
 *
 * Deterministic fixtures only. No live participant is implied, no repository
 * is observed here, and no model is called.
 */
import { describe, expect, it } from 'vitest'
import {
  CHANGED_FILES_NOT_COMPUTED,
  COLLAB_RAIL_SECTIONS,
  COLLAB_VIEWS,
  NO_DISCUSSIONS_OR_DECISIONS,
  DISCUSSION_NOTE,
  buildRail,
  toActivityRowView,
  toCheckpointRowView,
  toCompareView,
  toLineRowView,
  toParticipantRowView,
} from '../src/aera-collab-code-view.ts'
import { parseWorkContextAction } from '../src/work-context-window.ts'
import type { CodeCompareSummaryV1, CodeTopologyV1 } from '@aera/participation-contracts'

const topology = (over: Partial<CodeTopologyV1> = {}, facts: Partial<CodeTopologyV1['facts']> = {}): CodeTopologyV1 => ({
  topologyVersion: 'CodeTopologyV1',
  state: 'BEHIND',
  facts: {
    lineRevision: 'a'.repeat(40),
    targetRevision: 'b'.repeat(40),
    expectedTargetRevision: 'b'.repeat(40),
    mergeBase: 'c'.repeat(40),
    aheadCount: 0,
    behindCount: 3,
    pathsChangedOnLine: [],
    pathsChangedOnTarget: ['src/a.ts'],
    overlappingPaths: [],
    textuallyConflictedPaths: [],
    dirtyState: 'CLEAN',
    observedAt: '2026-09-17T00:00:00.000Z',
    ...facts,
  },
  humanSummary: 'Your Working Line is 3 changes behind Integration.',
  ...over,
})

describe('the Collab entry point and its two views', () => {
  it('offers exactly two views of one window', () => {
    expect([...COLLAB_VIEWS]).toEqual(['CONTEXT', 'COLLAB'])
  })

  it('the page can request the Collab view, and nothing else', () => {
    expect(parseWorkContextAction('aera-work-context://view?view=COLLAB'))
      .toEqual({ action: 'view', view: 'COLLAB' })
    expect(parseWorkContextAction('aera-work-context://view?view=CONTEXT'))
      .toEqual({ action: 'view', view: 'CONTEXT' })
    // Anything outside the closed set is ignored rather than guessed at.
    expect(parseWorkContextAction('aera-work-context://view?view=EDITOR')).toBeUndefined()
    expect(parseWorkContextAction('aera-work-context://view')).toBeUndefined()
  })

  it('the page can request a Compare by line index only — never by path or ref', () => {
    expect(parseWorkContextAction('aera-work-context://compare?line=0'))
      .toEqual({ action: 'compare', line: '0' })
    expect(parseWorkContextAction('aera-work-context://close-compare'))
      .toEqual({ action: 'close-compare' })
    // A ref, a path or a command can never be smuggled through this channel.
    expect(parseWorkContextAction('aera-work-context://compare?line=origin/dev')).toBeUndefined()
    expect(parseWorkContextAction('aera-work-context://compare?line=../../etc')).toBeUndefined()
    expect(parseWorkContextAction('aera-work-context://compare?line=0&extra=1')).toBeUndefined()
  })

  it('there is NO action that could mutate source', () => {
    for (const forbidden of ['merge', 'rebase', 'apply', 'commit', 'accept', 'resolve', 'cherry-pick', 'push']) {
      expect(parseWorkContextAction(`aera-work-context://${forbidden}?line=0`)).toBeUndefined()
    }
  })
})

describe('the Working Line row — §12, §13, §38', () => {
  it('renders ONE human sentence and keeps every sha behind disclosure', () => {
    const row = toLineRowView({
      label: "Opus child's line",
      participant: 'Opus 5',
      topology: topology(),
      checkpointCount: 4,
      provenance: 'DURABLE',
      codeWorkingLineId: 'aera:code_working_line:1111',
    })

    expect(row.topologySentence).toBe('Your Working Line is 3 changes behind Integration.')
    // No sha, no ref, no rev-list count on the default row.
    expect(row.topologySentence).not.toMatch(/[0-9a-f]{40}/)
    expect(row.topologySentence).not.toContain('merge-base')
    expect(row.topologySentence).not.toContain('origin/')
    // All of it IS available, one level away.
    expect(row.technical.join(' ')).toContain('a'.repeat(40))
    expect(row.technical.join(' ')).toContain('merge base')
    expect(row.technical.join(' ')).toContain('observed 2026-09-17T00:00:00.000Z')
    expect(row.technical).toContain('aera:code_working_line:1111')
  })

  it('renders the textual-conflict fact SEPARATELY and never inside the topology sentence', () => {
    const row = toLineRowView({
      label: "Ally's line",
      participant: 'Alyshia Daley',
      topology: topology(
        { state: 'RECONCILIATION_REQUIRED', humanSummary: 'Both Working Lines have moved, and 2 files changed on both.' },
        { overlappingPaths: ['a.ts', 'b.ts'], textuallyConflictedPaths: ['a.ts', 'b.ts'], aheadCount: 2, behindCount: 2 },
      ),
      checkpointCount: 0,
      provenance: 'DURABLE',
    })

    expect(row.topologyState).toBe('RECONCILIATION_REQUIRED')
    expect(row.conflictSentence).toBe('Git cannot merge 2 of these files automatically.')
    // The two claims never share a sentence.
    expect(row.topologySentence).not.toContain('cannot merge')
  })

  it('offers no Compare on an UNRESOLVED line — never offered and then refused', () => {
    const row = toLineRowView({
      label: 'Retired line',
      participant: 'Alyshia Daley',
      topology: topology({
        state: 'UNRESOLVED',
        unresolvedReason: 'LINE_REF_UNRESOLVED',
        unresolvedCommand: 'git rev-parse --verify gone^{commit}',
        humanSummary: 'This Working Line’s location could not be read: the branch `gone` no longer exists.',
      }),
      checkpointCount: 0,
      provenance: 'DURABLE',
    })

    expect(row.compareAvailable).toBe(false)
    expect(row.topologySentence).toContain('no longer exists')
    // The exact failing command is recorded, at the deepest level only.
    expect(row.technical.join(' ')).toContain('git rev-parse --verify')
  })

  it('an observed line says it is observed and carries NO minted identity', () => {
    const row = toLineRowView({
      label: 'This checkout · codex/wo-x',
      participant: 'Alyshia Daley',
      topology: topology(),
      checkpointCount: 0,
      provenance: 'OBSERVED',
      provenanceNote: 'Observed from this checkout. No durable Working Line record has been minted for it.',
    })

    expect(row.provenance).toBe('OBSERVED')
    expect(row.codeWorkingLineId).toBeUndefined()
    expect(row.provenanceNote).toContain('No durable Working Line record has been minted')
  })

  it('a DURABLE Working Line row never offers Compare in this slice (review finding 2)', () => {
    /*
     * Every Compare fact in this slice comes from the OBSERVED checkout. A
     * durable row is an institutional record this slice cannot observe, so
     * offering Compare on it could only produce another line's diff under this
     * line's name. Never offered, rather than offered and then refused.
     */
    const durable = toLineRowView({
      label: "Opus child's line",
      participant: 'Opus 5',
      topology: topology(),                 // a perfectly readable topology
      checkpointCount: 4,
      provenance: 'DURABLE',
      codeWorkingLineId: 'aera:code_working_line:1111',
    })
    expect(durable.topologyState).toBe('BEHIND')
    expect(durable.compareAvailable).toBe(false)

    // The observed row, with the same topology, DOES offer it.
    const observed = toLineRowView({
      label: 'This checkout · codex/wo-x',
      participant: 'Alyshia Daley',
      topology: topology(),
      checkpointCount: 0,
      provenance: 'OBSERVED',
    })
    expect(observed.compareAvailable).toBe(true)
  })

  it('states an unreadable topology rather than drawing a state', () => {
    const row = toLineRowView({
      label: 'Unreadable',
      participant: 'Alyshia Daley',
      topologyUnavailableReason: 'This checkout’s position against Integration could not be read.',
      checkpointCount: 0,
      provenance: 'OBSERVED',
    })
    expect(row.topologyState).toBe('UNREADABLE')
    expect(row.compareAvailable).toBe(false)
  })
})

describe('the Compare reading — §17, §18, §23, §24', () => {
  const summary = (over: Partial<CodeCompareSummaryV1> = {}): CodeCompareSummaryV1 => ({
    summaryVersion: 'CodeCompareSummaryV1',
    from: { kind: 'REVISION', revision: 'a'.repeat(40) },
    to: { kind: 'REVISION', revision: 'b'.repeat(40) },
    fromRevision: 'a'.repeat(40),
    toRevision: 'b'.repeat(40),
    mergeBase: 'c'.repeat(40),
    totals: {
      filesAdded: 1, filesRemoved: 0, filesRenamed: 1, filesModified: 1,
      linesAdded: 40, linesRemoved: 7,
      filesChangedOnBothLines: 1, filesChangedOnlyOnSource: 2, filesChangedOnlyOnTarget: 0,
    },
    files: [
      { kind: 'MODIFIED', path: 'src/shared.ts', linesAdded: 10, linesRemoved: 7, changedOnBothLines: true, textuallyConflicted: true },
      { kind: 'ADDED', path: 'src/new.ts', linesAdded: 30, linesRemoved: 0, changedOnBothLines: false, textuallyConflicted: false,
        structuralDelta: [{ kind: 'FUNCTION_ADDED', name: 'arrives' }] },
      { kind: 'RENAMED', path: 'src/after.ts', previousPath: 'src/before.ts', linesAdded: 0, linesRemoved: 0, changedOnBothLines: false, textuallyConflicted: false },
    ],
    unrepresentable: [{ path: 'assets/logo.png', reason: 'BINARY_CONTENT', humanSummary: 'assets/logo.png changed; this build cannot show you how (binary content).' }],
    structuralDeltaUnsupported: [],
    structuralDeltaAvailable: true,
    topology: topology({ state: 'RECONCILIATION_REQUIRED' }, { textuallyConflictedPaths: ['src/shared.ts'], overlappingPaths: ['src/shared.ts'] }),
    isCanonical: false,
    computedAt: '2026-09-17T00:00:00.000Z',
    ...over,
  })

  it('labels FROM and TO explicitly and spells out the direction', () => {
    const view = toCompareView({ summary: summary(), fromName: "Ally's line", toName: 'Accepted v7' })

    expect(view.heading).toBe('Read-only comparison of two states')
    expect(view.banner).toBe("Compare Ally's line with Accepted v7")
    expect(view.from.side).toBe('FROM')
    expect(view.to.side).toBe('TO')
    expect(view.directionSentence).toBe(
      "Additions are present in Accepted v7 and absent from Ally's line; removals are present in Ally's line and absent from Accepted v7.",
    )
  })

  it('carries the universal facts in the headline and the sha behind disclosure', () => {
    const view = toCompareView({ summary: summary(), fromName: 'mine', toName: 'Integration' })

    expect(view.headline).toContain('3 files')
    expect(view.headline).toContain('+40 / −7')
    expect(view.headline).toContain('1 file changed on both lines')
    expect(view.headline).toContain('Git cannot merge automatically')
    expect(view.headline).not.toMatch(/[0-9a-f]{40}/)
    expect(view.technical.join(' ')).toContain('merge base')
    // CMP-1, said in words where a human can read it.
    expect(view.technical.join(' ')).toContain('not canonical authority')
  })

  it('renders the change kind as a WORD and repeats every fact in the accessible name', () => {
    const view = toCompareView({ summary: summary(), fromName: 'mine', toName: 'Integration' })
    const shared = view.files.find((file) => file.path === 'src/shared.ts')

    expect(shared?.kindWord).toBe('Modified')
    expect(shared?.accessibleName).toContain('Modified')
    expect(shared?.accessibleName).toContain('changed on both lines')
    expect(shared?.accessibleName).toContain('Git cannot merge this file automatically')

    const renamed = view.files.find((file) => file.kindWord === 'Renamed')
    expect(renamed?.previousPath).toBe('src/before.ts')
    expect(renamed?.accessibleName).toContain('src/before.ts to src/after.ts')
  })

  it('reports an unrepresentable change rather than showing nothing (CMP-4)', () => {
    const view = toCompareView({ summary: summary(), fromName: 'mine', toName: 'Integration' })
    expect(view.unrepresentable).toEqual([
      'assets/logo.png changed; this build cannot show you how (binary content).',
    ])
  })

  it('states structural delta as a FACT and says so when it is unavailable', () => {
    const withDelta = toCompareView({ summary: summary(), fromName: 'mine', toName: 'Integration' })
    expect(withDelta.files.find((file) => file.path === 'src/new.ts')?.structuralDelta)
      .toEqual(['Function added: arrives'])
    expect(withDelta.structuralDeltaNote).toBeUndefined()

    const withoutDelta = toCompareView({
      summary: summary({ structuralDeltaAvailable: false }),
      fromName: 'mine', toName: 'Integration',
    })
    expect(withoutDelta.structuralDeltaNote).toContain('unavailable in this build')
    expect(withoutDelta.structuralDeltaNote).toContain('the file facts above are complete')
    // Tier 1 is unaffected.
    expect(withoutDelta.files).toHaveLength(3)
  })

  it('never claims impact, risk or meaning', () => {
    const view = toCompareView({ summary: summary(), fromName: 'mine', toName: 'Integration' })
    const everything = JSON.stringify(view).toLowerCase()
    for (const forbidden of ['risk', 'likely', 'probably', 'suggest', 'impact', 'breaking', 'semantic analysis']) {
      expect(everything).not.toContain(forbidden)
    }
  })
})

describe('participants, activity, checkpoints and the rail', () => {
  it('moves the raw principal id behind Technical details (§38, BUILD_NOTES D-4)', () => {
    const row = toParticipantRowView(
      {
        principalId: 'aera:participant:11111111-1111-4111-8111-111111111111',
        principalKind: 'AGENT',
        displayName: 'Opus 5',
        statusLine: 'Ended 2026-09-16T00:00:00.000Z',
        codeWorkingLineIds: ['aera:code_working_line:1111'],
        meaningfulActivityCount: 3,
      },
      new Map([['aera:code_working_line:1111', "Opus child's line"]]),
    )

    expect(row.displayName).toBe('Opus 5')
    expect(row.lineLabels).toEqual(["Opus child's line"])
    // The id is present, but only at disclosure level 5.
    expect(row.technical).toContain('aera:participant:11111111-1111-4111-8111-111111111111')
    expect(row.statusLine).not.toMatch(/Online|Editing/)
  })

  it('an activity row is an act, with its raw ids one level away', () => {
    const row = toActivityRowView({
      rowId: 'event:pevent-1',
      kind: 'CHANGE',
      at: '2026-09-17T00:00:00.000Z',
      actor: 'Opus 5',
      summary: 'Implemented the topology derivation',
      technical: 'pevent-1 · CHANGE_RECORDED',
    })
    expect(row.summary).toBe('Implemented the topology derivation')
    expect(row.technical).toBe('pevent-1 · CHANGE_RECORDED')
  })

  it('a checkpoint row states verifiability rather than implying it (CP-5)', () => {
    const verifiable = toCheckpointRowView({
      checkpointId: 'aera:code_checkpoint:1', codeWorkingLineId: 'aera:code_working_line:1',
      lineSequence: 8, label: 'router ported', origin: 'MANUAL_CHECKPOINT',
      createdAt: '2026-09-17T00:00:00.000Z', createdBy: 'Opus 5', verifiable: true, evidenceCount: 2,
    })
    expect(verifiable.origin).toBe('Named checkpoint')
    expect(verifiable.verifiabilityNote).toBeUndefined()

    const tested = toCheckpointRowView({
      checkpointId: 'aera:code_checkpoint:2', codeWorkingLineId: 'aera:code_working_line:1',
      lineSequence: 9, label: 'A9', origin: 'MANUAL_CHECKPOINT',
      createdAt: '2026-09-17T00:00:00.000Z', createdBy: 'Opus 5', verifiable: false, evidenceCount: 0,
    })
    expect(tested.verifiabilityNote).toBe('Not digest-verifiable — a tested working state')
  })

  it('the rail carries the counts, and the counts live only there', () => {
    const rail = buildRail({
      activity: 12, checkpoints: 4, changedFiles: 3, evidence: 2, discussionsDecisions: 5, coordination: 2, archived: 1,
    })
    expect(rail.map((tab) => tab.section)).toEqual([...COLLAB_RAIL_SECTIONS])
    expect(rail.map((tab) => tab.label)).toEqual([
      'Activity', 'Checkpoints', 'Changed files', 'Evidence', 'Discussions & decisions', 'Messages', 'Archived',
    ])
    expect(rail.find((tab) => tab.section === 'DISCUSSIONS_DECISIONS')?.count).toBe(5)
    expect(rail.find((tab) => tab.section === 'ACTIVITY')?.count).toBe(12)
    expect(rail.find((tab) => tab.section === 'ARCHIVED')?.count).toBe(1)
    expect(rail.find((tab) => tab.section === 'CHANGED_FILES')?.count).toBe(3)
    expect(rail.find((tab) => tab.section === 'COORDINATION')?.count).toBe(2)
  })

  it('an uncomputed count is ABSENT with a stated reason — never a zero that means "unknown"', () => {
    // No Compare has been opened, so there is no changed-file count to give.
    const rail = buildRail({
      activity: 4, checkpoints: 0, evidence: 4, discussionsDecisions: 0, coordination: 0, archived: 0,
    })
    const changed = rail.find((tab) => tab.section === 'CHANGED_FILES')

    expect(changed?.count).toBeUndefined()
    expect(changed?.countUnavailableReason).toBe(CHANGED_FILES_NOT_COMPUTED)
    expect(changed?.countUnavailableReason).toContain('Not computed until Compare is opened')

    /*
     * Discussions & decisions now HAS a count, and that is the change.
     *
     * The read-first slice withheld one on purpose: `0` would have read as
     * "nobody has said anything" when the truth was "this build cannot show
     * you", and a count that means "unknown" is exactly what this test exists
     * to forbid. Durable Discussions and Decisions exist now, so zero is a
     * true statement about the collaboration rather than about the build, and
     * withholding it would itself be the dishonest option.
     */
    const discussion = rail.find((tab) => tab.section === 'DISCUSSIONS_DECISIONS')
    expect(discussion?.count).toBe(0)
    expect(discussion?.countUnavailableReason).toBeUndefined()

    // A genuine zero is still a zero: nothing is archived, and that IS known.
    const archived = rail.find((tab) => tab.section === 'ARCHIVED')
    expect(archived?.count).toBe(0)
    expect(archived?.countUnavailableReason).toBeUndefined()
  })

  it('discussion is offered as an entry point and never as history authority', () => {
    expect(DISCUSSION_NOTE).toContain('never advances a Work Order’s state')
    expect(DISCUSSION_NOTE).toContain('talking about work is not doing it')
  })

  it('an empty Discussions & decisions section says why, and says a chat turn is not a decision', () => {
    expect(NO_DISCUSSIONS_OR_DECISIONS).toContain('explicit decision act')
    expect(NO_DISCUSSIONS_OR_DECISIONS).toContain('never becomes one')
  })
})
