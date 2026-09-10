/**
 * View-model honesty tests — WO-AGC-002 Remit C (desktop retarget).
 * Ported from the remit A consumer tests; deterministic TEST fixtures only;
 * no live participant is implied.
 */
import { describe, expect, it } from 'vitest'
import {
  EXECUTION_NOT_RELEASED,
  buildContextView,
  deriveParticipantStatus,
  toNodeRefView,
} from '../src/aera-collab-view.ts'
import type { ParticipationSession } from '@aera/evidentiary-work-graph-contracts'
import type { WorkContextV1 } from '@aera/participation-contracts'

const session = (over: Partial<ParticipationSession>): ParticipationSession =>
  ({
    sessionId: 'psession-0001-testtest',
    principalId: 'aera:participant:11111111-1111-4111-8111-111111111111',
    workOrderId: 'WO-TEST-001',
    startedAt: '2026-09-05T01:00:00.000Z',
    locality: 'LOCAL',
    ...over,
  }) as ParticipationSession

describe('deriveParticipantStatus (§8 honesty)', () => {
  it('reports Status unavailable when no sessions exist', () => {
    expect(deriveParticipantStatus([])).toBe('Status unavailable')
  })

  it('reports Ended with the latest end time when all sessions ended', () => {
    const status = deriveParticipantStatus([
      session({ endedAt: '2026-09-05T02:00:00.000Z' }),
      session({ sessionId: 'psession-0002-testtest', endedAt: '2026-09-05T03:00:00.000Z' }),
    ])
    expect(status).toBe('Ended 2026-09-05T03:00:00.000Z')
  })

  it('never claims a live process from an open session record', () => {
    const status = deriveParticipantStatus([session({})])
    expect(status).toContain('Status unavailable')
    expect(status).toContain('last active 2026-09-05T01:00:00.000Z')
    expect(status).toContain('does not prove a live process')
    expect(status).not.toMatch(/online|editing/i)
  })
})

describe('toNodeRefView (§10 closed vocabulary)', () => {
  it('maps recorded capability statuses and never invents one', () => {
    expect(toNodeRefView({ nodeId: 'n1' }, { capabilityStatus: 'IMPLEMENTED' }).status).toBe('implemented')
    expect(toNodeRefView({ nodeId: 'n1' }, { capabilityStatus: 'PROVEN' }).status).toBe('tested')
    expect(toNodeRefView({ nodeId: 'n1' }, { capabilityStatus: 'OWNER_ACCEPTED' }).status).toBe('owner accepted')
    expect(toNodeRefView({ nodeId: 'n1' }, { capabilityStatus: 'SOMETHING_ELSE' }).status).toBe('unknown')
    expect(toNodeRefView({ nodeId: 'n1' }, undefined).status).toBe('unknown')
  })

  it('carries the recorded source path only where one exists', () => {
    expect(toNodeRefView({ nodeId: 'n1' }, { sourcePath: 'Aera_Studios_Docs/x.md' }).sourcePath).toBe(
      'Aera_Studios_Docs/x.md',
    )
    expect(toNodeRefView({ nodeId: 'n1' }, {}).sourcePath).toBeUndefined()
  })
})

describe('buildContextView (§11/§12 honesty)', () => {
  const packet: WorkContextV1 = {
    contextVersion: 'WorkContextV1',
    workOrderId: 'WO-TEST-001',
    participants: [
      {
        principalId: 'aera:participant:11111111-1111-4111-8111-111111111111',
        principalKind: 'HUMAN',
        displayName: 'TEST Participant',
        activeSessionIds: ['psession-0001-testtest'],
      },
    ],
    resources: [],
    currentCanonicalState: [{ nodeId: 'node-a' as never, label: 'WO-TEST-001' }],
    governingDecisions: [],
    knownResiduals: [],
    evidence: [],
    authority: { mode: 'RECORDED_NOT_ENFORCED', delegations: [] },
    sentinel: { sentinelMandatory: true, executionSeam: 'executeProtected' },
    assembledAt: '2026-09-05T01:02:03.000Z',
  } as unknown as WorkContextV1

  it('shows the authority stamp verbatim and execution as unavailable', () => {
    const view = buildContextView({
      packet,
      sessionsByPrincipal: new Map(),
      nodeDetail: new Map(),
    })
    expect(view.authorityMode).toBe('RECORDED_NOT_ENFORCED')
    expect(view.authorityModeNote).toBe('(recorded, not enforced)')
    expect(view.executionActions).toEqual(EXECUTION_NOT_RELEASED)
    expect(view.executionActions[0]?.state).toBe('UNAVAILABLE')
  })

  it('does not attach the not-enforced disclaimer to a different recorded mode (remit B F2)', () => {
    const enforcing = {
      ...packet,
      authority: { mode: 'ENFORCED_TEST_MODE', delegations: [] },
    } as unknown as WorkContextV1
    const view = buildContextView({
      packet: enforcing,
      sessionsByPrincipal: new Map(),
      nodeDetail: new Map(),
    })
    expect(view.authorityMode).toBe('ENFORCED_TEST_MODE')
    expect(view.authorityModeNote).toBe('')
  })

  it('derives participant status from durable session records only', () => {
    const view = buildContextView({
      packet,
      sessionsByPrincipal: new Map([
        [
          'aera:participant:11111111-1111-4111-8111-111111111111',
          [session({ endedAt: '2026-09-05T04:00:00.000Z' })],
        ],
      ]),
      nodeDetail: new Map(),
    })
    expect(view.participants[0]?.statusLine).toBe('Ended 2026-09-05T04:00:00.000Z')
  })

  it('labels the working state as a mutable observation when present', () => {
    const view = buildContextView({
      packet,
      sessionsByPrincipal: new Map(),
      nodeDetail: new Map(),
      workingState: {
        repositoryId: 'aera-repo:aera-stack',
        localPath: '/tmp/x',
        branchRef: 'dev',
        headRevision: 'abc123',
        dirtyState: 'DIRTY',
        observedAt: '2026-09-05T05:00:00.000Z',
        note: 'Observed mutable working state at observation time — not an immutable historical object',
      },
    })
    expect(view.workingState?.note).toContain('not an immutable historical object')
    expect(view.workingState?.observedAt).toBe('2026-09-05T05:00:00.000Z')
  })
})
