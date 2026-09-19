/**
 * The human surface, §8–§14 / §22–§25 / §43–§44 / §61.
 *
 * These render the real components to static markup rather than asserting on
 * helper functions, because the owner's FAIL was about what was on screen. A
 * projection that is correct and a screen that is wrong is exactly the gap
 * this Work Order is repairing, so the assertions are made where the reader
 * actually looks.
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AeraCollabRail } from '../src/client/AeraCollabRail.tsx'
import { AeraCollabRecord } from '../src/client/AeraCollabRecord.tsx'
import { AeraCollabWorkspace } from '../src/client/AeraCollabWorkspace.tsx'
import type { CollabPacketCard, CollabSurfaceView } from '../src/client/aera-collab-api.ts'

const t = (key: string): string => key

const THREAD_ID = 'aera:collab-thread:1a2b3c4d'
const MESSAGE_ID = 'aera:collab-message:9f8e7d6c'

const packet: CollabPacketCard = {
  title: 'Current state',
  operands: 'shared/wo-agc-001-wave0 compared with dev',
  facts: ['3 files changed', '12 added', '4 removed'],
  capturedAt: '2026-09-19T10:00:00.000Z',
  stateNote: 'Nothing has moved since this was shared.',
  stateMoved: false,
  technical: [`packetId ${'aera:coordination-packet:abc12345'}`],
}

function surfaceOf(overrides: Partial<CollabSurfaceView> = {}): CollabSurfaceView {
  return {
    workOrderId: 'WO-TEST-001',
    repositories: ['aera-stack'],
    authorityMode: 'RECORDED_NOT_ENFORCED',
    authorityModeNote: 'Recorded, not enforced.',
    assembledAt: '2026-09-19T10:00:00.000Z',
    participants: [],
    lines: [],
    rail: [],
    activity: [],
    checkpoints: [],
    evidence: [],
    evidenceCards: [],
    activityBlocks: [],
    decisions: [],
    discussions: [],
    threads: [{
      subject: 'Split the work',
      aboutLine: 'About working line Y.',
      participants: ['Alyshia Daley', 'Jordan'],
      messageCount: 1,
      lastMessageAt: '2026-09-19T10:00:00.000Z',
      archived: false,
      messages: [{
        who: 'Alyshia Daley',
        principalKind: 'HUMAN',
        body: 'You take X. Jordan takes Y.',
        when: '2026-09-19T10:00:00.000Z',
        sequence: 1,
        packets: [packet],
        otherReferences: [],
        technical: [`messageId ${MESSAGE_ID}`],
      }],
      decisionSubjects: [],
      technical: [THREAD_ID],
    }],
    coordinationDeliveryNote: 'No live delivery in this version.',
    discussionNote: '',
    archivedCount: 0,
    projectedAt: '2026-09-19T10:00:00.000Z',
    ...overrides,
  } as CollabSurfaceView
}

const api = () => ({
  coordinate: vi.fn(async () => ({ ok: true })),
  packetState: vi.fn(async () => ({ verdict: 'UNCHANGED', humanSummary: 'Unchanged.' })),
  view: vi.fn(async () => surfaceOf()),
}) as never

describe('§9/§43/§44 — what the reader sees first', () => {
  const html = () => renderToStaticMarkup(createElement(AeraCollabRail, {
    surface: surfaceOf(), api: api(), t, onChanged: () => {},
  } as never))

  it('leads with the person and what they said, not an identifier', () => {
    const markup = html()
    expect(markup).toContain('Alyshia Daley')
    expect(markup).toContain('You take X. Jordan takes Y.')
    /*
     * §43: canonical ids remain canonical underneath — the technical block
     * still carries them — but a raw `aera:collab-message:` must not be what
     * the eye lands on. The id appears only inside the collapsed block, so the
     * assertion is positional, not merely "absent".
     */
    const technicalAt = markup.indexOf('aera-rail-technical')
    expect(technicalAt).toBeGreaterThan(-1)
    expect(markup.indexOf(MESSAGE_ID)).toBeGreaterThan(technicalAt)
  })

  it('keeps full ids available under Technical details, never invented or shortened', () => {
    const markup = html()
    // §17: the canonical id is present in full. Truncating it would make the
    // surface lie about the identifier the institution actually holds.
    expect(markup).toContain(MESSAGE_ID)
    expect(markup).toContain(THREAD_ID)
    expect(markup).toContain('<details')
  })
})

describe('§12/§13 — snapshot versus current state', () => {
  it('shows what was captured and says whether it still holds', () => {
    const markup = renderToStaticMarkup(createElement(AeraCollabRail, {
      surface: surfaceOf(), api: api(), t, onChanged: () => {},
    } as never))
    expect(markup).toContain('shared/wo-agc-001-wave0 compared with dev')
    expect(markup).toContain('3 files changed')
    // The distinction §12 insists on: a snapshot is a past reading, and the
    // card says so rather than implying it is live.
    expect(markup).toContain('Nothing has moved since this was shared.')
  })

  it('a moved state is stated as movement, not hidden behind stale numbers', () => {
    const moved: CollabPacketCard = { ...packet, stateMoved: true, stateNote: 'The branch has moved since this was shared.' }
    const surface = surfaceOf()
    const withMoved = {
      ...surface,
      threads: [{
        ...surface.threads[0]!,
        messages: [{ ...surface.threads[0]!.messages[0]!, packets: [moved] }],
      }],
    } as CollabSurfaceView
    const markup = renderToStaticMarkup(createElement(AeraCollabRail, {
      surface: withMoved, api: api(), t, onChanged: () => {},
    } as never))
    expect(markup).toContain('The branch has moved since this was shared.')
  })
})

describe('§22–§25 — Collaborate and Record are different compositions', () => {
  it('Record is not the rail with the messages removed', () => {
    const rail = renderToStaticMarkup(createElement(AeraCollabRail, {
      surface: surfaceOf(), api: api(), t, onChanged: () => {},
    } as never))
    const record = renderToStaticMarkup(createElement(AeraCollabRecord, {
      surface: surfaceOf(), t,
    } as never))
    // Different component trees, and demonstrably so: the rail's message
    // stream and composer exist in one and not the other, and Record brings
    // its own categories rather than reusing the rail's containers.
    expect(rail).toContain('aera-rail-stream')
    expect(rail).toContain('aera-rail-composer')
    expect(record).not.toContain('aera-rail-stream')
    expect(record).not.toContain('aera-rail-composer')
    expect(record).toContain('aera-record-category')
    expect(rail).not.toContain('aera-record-category')
  })

  it('Record states a mechanically-justified reason at zero instead of showing nothing', () => {
    const markup = renderToStaticMarkup(createElement(AeraCollabRecord, {
      surface: surfaceOf({ checkpointsEmptyReason: 'No checkpoints have been minted for this Work Order.' }),
      t,
    } as never))
    // §26/§57: an empty category must say why it is empty. A silent zero is
    // indistinguishable from a broken projection, which is the false-zero
    // failure the owner found.
    expect(markup).toContain('No checkpoints have been minted for this Work Order.')
  })

  it('the workspace offers both modes and starts in Collaborate', () => {
    const markup = renderToStaticMarkup(createElement(AeraCollabWorkspace, {
      api: api(), workOrderId: 'WO-TEST-001', t,
    } as never))
    expect(markup).toContain('viewCollaborate')
    expect(markup).toContain('viewRecord')
    expect(markup).toContain('role="tablist"')
  })
})

describe('§11 — sharing current state is an act, not a side effect', () => {
  it('renders the share affordance without calling any write path', () => {
    const calls = api() as unknown as { coordinate: ReturnType<typeof vi.fn> }
    renderToStaticMarkup(createElement(AeraCollabRail, {
      surface: surfaceOf(), api: calls, t, onChanged: () => {},
    } as never))
    // Drawing the composer must not write. The only thing that writes is the
    // reader pressing the button — which is what "cancel writes nothing" means
    // at this level: nothing happens until the act happens.
    expect(calls.coordinate).not.toHaveBeenCalled()
  })
})
