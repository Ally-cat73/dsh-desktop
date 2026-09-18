/**
 * Product tests for the institutional refinement of the Code Collab surface —
 * WO-AERA-COLLAB-DURABLE-WORKING-LINE-LINEAGE-DECISIONS-AND-CHECKPOINTS-001
 * §39–§47.
 *
 * Deterministic fixtures only. No live participant is implied, no repository
 * is observed, and no model is called.
 */
import { describe, expect, it } from 'vitest'
import {
  toActivityBlockView,
  toDecisionView,
  toEvidenceCardView,
  toLineRowView,
  toParticipantRowView,
} from '../src/aera-collab-code-view.ts'
import type {
  ActivityBlockV1,
  DecisionContextV1,
  LineageTrailV1,
  ParticipantContributionV1,
  TypedEvidenceCardV1,
} from '@aera/participation-runtime'

const lineage = (over: Partial<LineageTrailV1> = {}): LineageTrailV1 => ({
  codeWorkingLineId: 'aera:code_working_line:b',
  ancestors: [{
    codeWorkingLineId: 'aera:code_working_line:a',
    label: 'Authentication',
    forkedAtCheckpointId: 'aera:code_checkpoint:3',
    forkedAtRevision: 'abc1234567',
  }],
  rootAcceptedStateId: 'aera:accepted_integration_state:dev-v1',
  rootRevision: 'root12345',
  sentence: 'Derived from Authentication at checkpoint abc1234567.',
  integrationTargetSentence: 'Targets Accepted Integration — `dev`.',
  ...over,
})

describe('§40, §41 — a Working Line says where it came from and where it is going', () => {
  it('shows lineage and target as two separate sentences', () => {
    const row = toLineRowView({
      label: 'Session refresh',
      participant: 'Alyshia Daley',
      checkpointCount: 3,
      codeWorkingLineId: 'aera:code_working_line:b',
      provenance: 'DURABLE',
      lineage: lineage(),
      latestCheckpoint: 'B3 — review corrections',
      lifecycle: 'OPEN',
    })
    expect(row.lineageSentence).toContain('Derived from Authentication')
    expect(row.integrationTargetSentence).toContain('Accepted Integration')
    // §11: the two relationships never collapse into one sentence.
    expect(row.lineageSentence).not.toBe(row.integrationTargetSentence)
    expect(row.latestCheckpoint).toBe('B3 — review corrections')
    // OPEN is the default and is not worth a badge; anything else is.
    expect(row.lifecycleWord).toBeUndefined()
  })

  it('marks a line that is no longer open', () => {
    const row = toLineRowView({
      label: 'Old line', participant: 'X', checkpointCount: 0,
      provenance: 'DURABLE', lifecycle: 'ARCHIVED',
    })
    expect(row.lifecycleWord).toBe('ARCHIVED')
  })

  it('§40 — an OBSERVED checkout carries NO lineage rather than an invented one', () => {
    const row = toLineRowView({
      label: 'This checkout · feature/x',
      participant: 'You',
      checkpointCount: 0,
      provenance: 'OBSERVED',
      provenanceNote: 'Observed from this checkout.',
    })
    expect(row.provenance).toBe('OBSERVED')
    expect(row.lineageSentence).toBeUndefined()
    expect(row.integrationTargetSentence).toBeUndefined()
    expect(row.codeWorkingLineId).toBeUndefined()
  })
})

describe('§32, §34 — participant contribution', () => {
  const contribution = (over: Partial<ParticipantContributionV1> = {}): ParticipantContributionV1 => ({
    principalId: 'aera:participant:1',
    displayName: 'Alyshia Daley',
    principalKind: 'HUMAN',
    decisions: 8, authorisations: 3, verifications: 1, discussions: 12,
    checkpoints: 0, integrationReceipts: 0, recordedActs: 0,
    meaningfulActivityCount: 0,
    lastContributionAt: '2026-09-17T17:35:00.000Z',
    summarySentence: '8 decisions · 3 authorisations · 1 verification · 12 discussions',
    ...over,
  })

  it('shows governance contribution rather than a recorder count', () => {
    const row = toParticipantRowView(
      {
        principalId: 'aera:participant:1', principalKind: 'HUMAN', displayName: 'Alyshia Daley',
        statusLine: 'Status unavailable', codeWorkingLineIds: [], meaningfulActivityCount: 0,
      },
      new Map(),
      contribution(),
    )
    expect(row.contributionSentence).toContain('8 decisions')
    // §34: "Last contribution" replaces a prominent STATUS UNAVAILABLE.
    expect(row.statusLine).toBe('Last contribution 2026-09-17T17:35:00.000Z')
    expect(row.statusLine).not.toContain('Status unavailable')
  })

  it('§34 — with no contribution recorded, the honest original status line stands', () => {
    const row = toParticipantRowView(
      {
        principalId: 'aera:participant:9', principalKind: 'AGENT', displayName: 'Worker',
        statusLine: 'Status unavailable', codeWorkingLineIds: [], meaningfulActivityCount: 0,
      },
      new Map(),
    )
    expect(row.statusLine).toBe('Status unavailable')
    expect(row.contributionSentence).toBeUndefined()
  })

  it('never shows a contribution sentence that reads as zero', () => {
    const row = toParticipantRowView(
      {
        principalId: 'aera:participant:2', principalKind: 'AGENT', displayName: 'Worker',
        statusLine: 'Ended', codeWorkingLineIds: [], meaningfulActivityCount: 0,
      },
      new Map(),
      contribution({
        summarySentence: 'No contributions recorded against this participant yet.',
        lastContributionAt: undefined,
      }),
    )
    expect(row.contributionSentence).toBeUndefined()
  })
})

describe('§46 — typed evidence cards', () => {
  const card = (over: Partial<TypedEvidenceCardV1> = {}): TypedEvidenceCardV1 => ({
    evidenceId: 'aera:evidence:1',
    classWord: 'Verification',
    evidenceClass: 'VERIFICATION_EVIDENCE',
    subject: 'Independent review',
    outcome: 'PASS',
    actor: 'Opus Reviewer',
    at: '2026-09-17T17:34:00.000Z',
    supportsFactualClaim: true,
    technical: ['aera:evidence:1'],
    ...over,
  })

  it('leads with the class and carries the outcome', () => {
    const view = toEvidenceCardView(card())
    expect(view.classWord).toBe('Verification')
    expect(view.outcome).toBe('PASS')
    expect(view.factualNote).toBeUndefined()
  })

  it('an analytical card states its producer AND that it is an interpretation', () => {
    const view = toEvidenceCardView(card({
      classWord: 'Model analysis',
      evidenceClass: 'ANALYTICAL_EVIDENCE',
      subject: 'Merge risk assessment',
      supportsFactualClaim: false,
      analyticalNote: 'Produced by Execution Child (claude-opus-5) at 2026-09-17T12:00:00.000Z. This is an interpretation, not a source record.',
    }))
    expect(view.analyticalNote).toContain('claude-opus-5')
    // §21/§57 visible on the card, not left to the reader to work out.
    expect(view.factualNote).toContain('not an established fact')
  })

  it('a decision record is marked as not establishing a fact', () => {
    const view = toEvidenceCardView(card({
      classWord: 'Decision record', evidenceClass: 'DECISION_EVIDENCE', supportsFactualClaim: false,
    }))
    expect(view.factualNote).toContain('not an established fact')
  })
})

describe('§43 — Activity Blocks', () => {
  const block = (over: Partial<ActivityBlockV1> = {}): ActivityBlockV1 => ({
    blockId: 'DECISION:aera:decision:1',
    keyKind: 'DECISION',
    title: 'Decision and its records — 3 acts',
    from: '2026-09-17T17:34:00.000Z',
    to: '2026-09-17T17:35:00.000Z',
    participants: ['Alyshia Daley', 'Execution Child'],
    decisionIds: ['aera:decision:1'],
    discussionIds: [],
    evidenceIds: ['aera:evidence:1', 'aera:evidence:2'],
    effects: [],
    verification: [],
    eventIds: ['pevent-0001', 'pevent-0002', 'pevent-0003'],
    members: [],
    ...over,
  })

  it('carries counts on the block and keeps every event id reachable', () => {
    const view = toActivityBlockView(block(), [])
    expect(view.counts).toContain('Decisions 1')
    expect(view.counts).toContain('Evidence 2')
    expect(view.counts).toContain('Events 3')
    expect(view.technical.join(' ')).toContain('pevent-0001')
    expect(view.legacyNote).toBeUndefined()
  })

  it('§38 — the legacy block says, in words, that it is not grouped', () => {
    const view = toActivityBlockView(block({
      keyKind: 'LEGACY',
      title: 'Earlier activity, ungrouped',
      legacyNote: 'These acts predate correlated recording…',
      decisionIds: [], evidenceIds: [],
    }), [])
    expect(view.legacyNote).toContain('predate correlated recording')
    expect(view.counts).not.toContain('Decisions 0')
  })

  it('renders its member rows rather than summarising them away', () => {
    const view = toActivityBlockView(block(), [
      { actor: 'Alyshia Daley', summary: 'Chose the inline composition', when: '2026-09-17T17:34:00.000Z' },
      { actor: 'Execution Child', summary: 'Recorded the decision', when: '2026-09-17T17:35:00.000Z' },
    ])
    expect(view.members).toHaveLength(2)
    expect(view.members[0]?.summary).toBe('Chose the inline composition')
  })
})

describe('§44, §45 — decision context', () => {
  const context = (over: Partial<DecisionContextV1> = {}): DecisionContextV1 => ({
    decisionId: 'aera:decision:1',
    subject: 'Read-First layout',
    decidedBy: 'Alyshia Daley',
    recordedBy: 'Execution Child',
    authorisedBy: 'Alyshia Daley',
    decidedAt: '2026-09-17T17:34:00.000Z',
    status: 'RECORDED',
    inForce: true,
    selectedOptionLabel: 'Inline Working-Lines-first composition',
    rationale: 'The reader should not have to navigate.',
    alternatives: [{ label: 'A separate Working Lines tab', rationale: 'More room' }],
    evidence: [{
      evidenceId: 'aera:evidence:1', evidenceClass: 'ANALYTICAL_EVIDENCE',
      subject: 'Layout comparison', supportsFactualClaim: false,
    }],
    discussionSubjects: ['Which layout?'],
    authorisedEffects: ['Ship the inline composition'],
    resultingEffects: ['Read-First V1 shipped inline'],
    notAFactNote: 'This records that the decision was made, under this authority, on this basis. It is not evidence that the proposition behind it was true.',
    ...over,
  })

  it('answers every §45 question on one card', () => {
    const view = toDecisionView(context())
    expect(view.subject).toBe('Read-First layout')
    expect(view.alternatives[0]).toContain('A separate Working Lines tab')
    expect(view.discussions).toEqual(['Which layout?'])
    expect(view.resultingEffects).toEqual(['Read-First V1 shipped inline'])
    // §31: decider and recorder are two different displayed facts.
    expect(view.decidedBy).toBe('Alyshia Daley')
    expect(view.recordedBy).toBe('Execution Child')
    expect(view.decidedBy).not.toBe(view.recordedBy)
  })

  it('the evidence line carries the CLASS, so reliance is judgeable', () => {
    const view = toDecisionView(context())
    expect(view.evidence[0]).toContain('analytical')
  })

  it('§21 — every decision carries the not-a-fact sentence', () => {
    expect(toDecisionView(context()).notAFactNote).toContain('not evidence that the proposition')
    expect(toDecisionView(context({ status: 'SUPERSEDED', inForce: false })).notAFactNote)
      .toContain('not evidence that the proposition')
  })

  it('§22 — a superseded decision says so and names its successor', () => {
    const view = toDecisionView(context({
      status: 'SUPERSEDED', inForce: false, supersededBySubject: 'Editor engine, revisited',
    }))
    expect(view.statusWord).toBe('Superseded')
    expect(view.supersededByNote).toContain('Editor engine, revisited')
    // Its own substance is still rendered: history is preserved, not hidden.
    expect(view.selectedOption).toBe('Inline Working-Lines-first composition')
    expect(view.rationale).toBe('The reader should not have to navigate.')
  })

  it('an unrecorded decider is stated as unrecorded, never replaced by the recorder', () => {
    const view = toDecisionView(context({ decidedBy: 'Decider not recorded' }))
    expect(view.decidedBy).toBe('Decider not recorded')
    expect(view.recordedBy).toBe('Execution Child')
  })
})
