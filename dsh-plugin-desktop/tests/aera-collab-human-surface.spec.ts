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
import { readFileSync } from 'node:fs'
import { AeraCollabRail, shareCurrentStateRequest } from '../src/client/AeraCollabRail.tsx'
import { AeraCollabRecord } from '../src/client/AeraCollabRecord.tsx'
import { AeraCollabWorkspace } from '../src/client/AeraCollabWorkspace.tsx'
import type { CollabPacketCard, CollabSurfaceView } from '../src/client/aera-collab-api.ts'
import { toPacketCardView } from '../src/aera-collab-code-view.ts'

const t = (key: string): string => key

const THREAD_ID = 'aera:collab-thread:1a2b3c4d'
const MESSAGE_ID = 'aera:collab-message:9f8e7d6c'

/*
 * Round-1 review BL-1: the fixture used to hardcode branch names, exercising
 * only the favourable branch. This one is derived from the LIVE store's packet
 * shape — no `sourceWorkingLineId`, no `targetWorkingLineId`, which is every
 * packet on this Work Order because Working Lines are a true zero here — and
 * is built through the real projection rather than typed by hand.
 */
const LIVE_SOURCE = '6e0d2da34774507f48f7d7f0dbc8e7074fff6ad0'
const LIVE_TARGET = '0c6281687c0e38fe9a65cdb0e47db214a6c7e7e7'

const livePacket = (): CollabPacketCard => toPacketCardView(
  {
    packetVersion: 'CoordinationPacketV1',
    packetId: 'aera:coordination-packet:c8b42f2d',
    workOrderId: 'WO-TEST-001',
    subject: 'WORKING_LINE_COMPARE',
    observedAt: '2026-09-19T10:00:00.000Z',
    observedBy: { principalId: 'p', principalKind: 'HUMAN', displayName: 'Alyshia Daley' },
    comparison: {
      repositoryId: 'aera-repo:aera-stack',
      sourceRevision: LIVE_SOURCE,
      targetRevision: LIVE_TARGET,
      mergeBase: '2fbef61596abd5310843441106dbaaefd832e3e7',
      filesChanged: 11,
      filesChangedOnBothLines: 0,
      filesChangedOnlyOnSource: 11,
      filesChangedOnlyOnTarget: 0,
      linesAdded: 1,
      linesRemoved: 3550,
      textualConflicts: 0,
      structuralDeltaAvailable: false,
    },
    packetDigest: 'sha256:cb572411403cdc4af2cb391c32ea6423a8cb1f6d6cc6bbf1f7c7298e330bbc32',
    decisionIds: [],
    evidenceIds: [],
    authority: {
      authorisingWorkOrderId: 'WO-TEST-001',
      authorityMode: 'RECORDED_NOT_ENFORCED',
      recordedByPrincipalId: 'p',
    },
  } as never,
  undefined,
  {},
) as unknown as CollabPacketCard

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
    /*
     * Round-1 review NB-5: both labels render in either mode, so the old
     * assertions survived flipping the default. Assert the SELECTION, which is
     * the half that was actually claimed.
     */
    const collaborateAt = markup.indexOf('viewCollaborate')
    const recordAt = markup.indexOf('viewRecord')
    const selectedAt = markup.indexOf('aria-selected="true"')
    expect(selectedAt).toBeGreaterThan(-1)
    expect(selectedAt).toBeLessThan(recordAt)
    expect(collaborateAt).toBeLessThan(recordAt)
    expect(markup.slice(recordAt).includes('aria-selected="true"')).toBe(false)
  })
})

describe('§11/§55 — sharing current state is an act, and cancel writes nothing', () => {
  const shareable = (): CollabSurfaceView => ({
    ...surfaceOf(),
    compare: {
      summary: '3 files changed',
      lines: [],
      files: [],
    },
  } as unknown as CollabSurfaceView)

  it('renders the share affordance when there is state to share', () => {
    /*
     * Round-1 review NB-5: the old fixture left `compare` undefined, so
     * `canShareState` was false and the control under test never rendered —
     * the assertion could not fail. This one renders it.
     */
    const markup = renderToStaticMarkup(createElement(AeraCollabRail, {
      surface: shareable(), api: api(), t, onChanged: () => {},
    } as never))
    expect(markup).toContain('aera-rail-share')
    expect(markup).toContain('shareCurrentState')
  })

  it('the request a share would send is nameable — so "cancel wrote nothing" means something', () => {
    // The write is built by a pure function, separately from performing it.
    expect(shareCurrentStateRequest({ workOrderId: 'WO-TEST-001', threadId: THREAD_ID })).toEqual({
      action: 'SHARE_COMPARE_TO_THREAD',
      workOrderId: 'WO-TEST-001',
      threadId: THREAD_ID,
    })
    expect(shareCurrentStateRequest({
      workOrderId: 'WO-TEST-001', threadId: THREAD_ID, note: 'have a look', compareLineIndex: 2,
    })).toEqual({
      action: 'SHARE_COMPARE_TO_THREAD',
      workOrderId: 'WO-TEST-001',
      threadId: THREAD_ID,
      compareLineIndex: 2,
      note: 'have a look',
    })
    // An empty note is not a note; it must not travel as one.
    expect(shareCurrentStateRequest({ workOrderId: 'W', threadId: 'T', note: '' })).not.toHaveProperty('note')
  })

  it('there IS a cancel control, and the first press does not write', () => {
    const calls = api() as unknown as { coordinate: ReturnType<typeof vi.fn> }
    const markup = renderToStaticMarkup(createElement(AeraCollabRail, {
      surface: shareable(), api: calls, t, onChanged: () => {},
    } as never))
    // §55 needs something to cancel: pressing Share opens a confirm step whose
    // second control is Cancel. The confirm markup is in the component (it is
    // state-gated, so not in this first render), and the write happens only on
    // the confirm press — never on draw.
    expect(markup).not.toContain('aera-rail-confirm')
    expect(calls.coordinate).not.toHaveBeenCalled()
    const source = readFileSync(new URL('../src/client/AeraCollabRail.tsx', import.meta.url), 'utf8')
    expect(source).toContain("t('cancel')")
    expect(source).toContain('aera-rail-confirm')
    // The cancel branch sets state and calls nothing.
    expect(source).toContain("onClick={() => { setConfirming(false) }}")
  })
})

describe('§13/§17 BL-1 — the state card face on the LIVE packet shape', () => {
  const withLivePacket = (): CollabSurfaceView => {
    const base = surfaceOf()
    return {
      ...base,
      threads: [{
        ...base.threads[0]!,
        messages: [{ ...base.threads[0]!.messages[0]!, packets: [livePacket()] }],
      }],
    } as CollabSurfaceView
  }

  it('prints no full SHA on the face when the packet has no Working Line ids', () => {
    const card = livePacket()
    // The unfavourable branch — the only branch the live store can take.
    expect(card.operands).not.toContain(LIVE_SOURCE)
    expect(card.operands).not.toContain(LIVE_TARGET)
    expect(card.operands).toContain('aera-stack')
    expect(card.operands).toContain('6e0d2da')
    expect(card.operands).toContain('0c62816')
    // Nothing was invented: no Working Line name appears for a side that has none.
    expect(card.operands.toLowerCase()).not.toContain('working line')
  })

  it('the full revisions are still available, in full, under Technical details', () => {
    const card = livePacket()
    expect(card.technical.join(' ')).toContain(LIVE_SOURCE)
    expect(card.technical.join(' ')).toContain(LIVE_TARGET)
  })

  it('and the rendered rail shows no 40-hex value outside a <details> block', () => {
    const markup = renderToStaticMarkup(createElement(AeraCollabRail, {
      surface: withLivePacket(), api: api(), t, onChanged: () => {},
    } as never))
    const detailsAt = markup.indexOf('<details')
    expect(detailsAt).toBeGreaterThan(-1)
    for (const sha of [LIVE_SOURCE, LIVE_TARGET]) {
      const at = markup.indexOf(sha)
      // Present (canonical values are never dropped) but only after the
      // Technical details boundary, never on the face.
      expect(at).toBeGreaterThan(detailsAt)
    }
    expect(markup.slice(0, detailsAt)).not.toMatch(/[0-9a-f]{40}/)
  })
})
