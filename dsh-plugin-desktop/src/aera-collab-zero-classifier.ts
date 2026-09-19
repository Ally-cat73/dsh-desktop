/**
 * §30 — MECHANICAL ZERO CLASSIFICATION.
 *
 * "For every displayed zero: mechanically classify it as TRUE_ZERO,
 * PROJECTION_DEFECT or RECORDING_GAP. Never display a false zero."
 *
 * Until now the surface satisfied the *spirit* of this — every zero carried a
 * specific, accurate sentence, and the §46 review confirmed that no false zero
 * was ever displayed. What it did not have was the *mechanism*: the sentences
 * were prose chosen per category, two of them hardcoding a TRUE_ZERO assertion
 * that could not represent the other two states. A category that grows a
 * projection bug would keep saying "nothing has been recorded yet", which is
 * precisely the failure §30 names.
 *
 * This computes the classification from the store instead of asserting it:
 *
 *   TRUE_ZERO         the store holds no canonical records of that class for
 *                     this Work Order. The zero is the truth.
 *   PROJECTION_DEFECT the store holds records, and the projection is showing
 *                     none of them. The zero is a bug in the view.
 *   RECORDING_GAP     the store holds no typed records of that class, but it
 *                     does hold institutional events that such a record should
 *                     accompany. The zero is honest about the projection and
 *                     dishonest about the work — so it is disclosed by
 *                     reference to the events that prove the gap.
 *
 * The result is surfaced under Technical details rather than in the reader's
 * face: a human wants the sentence, an auditor wants the classification, and
 * §38 says technical detail is preserved without dominating.
 */

/** How a displayed zero relates to the records underneath it. */
export type ZeroClassification = 'TRUE_ZERO' | 'PROJECTION_DEFECT' | 'RECORDING_GAP'

/** One classified zero, ready to render under Technical details. */
export interface ZeroClassificationView {
  readonly category: string
  readonly classification: ZeroClassification
  /** What was counted in the store, so the classification can be checked. */
  readonly storeRecords: number
  /** Events that evidence a recording gap, where there is one. */
  readonly gapEvidence?: readonly string[]
  readonly sentence: string
}

/**
 * The store reads this classifier needs. Read-only by construction: it lists,
 * it never writes.
 *
 * Rows are typed loosely on purpose. The canonical record types do not share a
 * `workOrderId` shape — several carry it on a nested contribution — so this
 * reads the field defensively rather than forcing five different record
 * interfaces to agree for the benefit of a counter.
 */
export interface ZeroClassifierStore {
  listCodeWorkingLines: () => readonly unknown[]
  listCodeCheckpoints: () => readonly unknown[]
  listTypedEvidence: () => readonly unknown[]
  listDecisions: () => readonly unknown[]
  listDiscussions: () => readonly unknown[]
  listCollabThreads: () => readonly unknown[]
  listEvents: () => readonly unknown[]
}

/** Read a record's Work Order id wherever the record happens to carry it. */
function workOrderOf(row: unknown): string | undefined {
  if (typeof row !== 'object' || row === null) return undefined
  const record = row as Record<string, unknown>
  if (typeof record.workOrderId === 'string') return record.workOrderId
  const contribution = record.contribution
  if (typeof contribution === 'object' && contribution !== null) {
    const nested = (contribution as Record<string, unknown>).workOrderId
    if (typeof nested === 'string') return nested
  }
  return undefined
}

/** Read an event's kind, wherever it is carried. */
function kindOf(row: unknown): string | undefined {
  if (typeof row !== 'object' || row === null) return undefined
  const record = row as Record<string, unknown>
  return typeof record.kind === 'string'
    ? record.kind
    : typeof record.eventKind === 'string' ? record.eventKind : undefined
}

/** Counts the projection actually put on the surface. */
export interface ProjectedCounts {
  readonly workingLines: number
  readonly checkpoints: number
  readonly activity: number
  readonly discussionsDecisions: number
  readonly evidence: number
}

const forWorkOrder = (
  rows: readonly unknown[],
  workOrderId: string,
): readonly unknown[] => rows.filter(row => workOrderOf(row) === workOrderId)

function classifyOne(input: {
  readonly category: string
  readonly projected: number
  readonly storeRecords: number
  readonly gapEvidence?: readonly string[]
  readonly trueZeroSentence: string
}): ZeroClassificationView | undefined {
  // Only a DISPLAYED ZERO is classified. A non-zero count speaks for itself.
  if (input.projected !== 0) return undefined

  if (input.storeRecords > 0) {
    return {
      category: input.category,
      classification: 'PROJECTION_DEFECT',
      storeRecords: input.storeRecords,
      sentence:
        `PROJECTION DEFECT: the store holds ${String(input.storeRecords)} `
        + `${input.category} record(s) for this Work Order and this view is showing none of them. `
        + 'The zero above is a defect in the projection, not a fact about the work.',
    }
  }

  const gap = input.gapEvidence ?? []
  if (gap.length > 0) {
    return {
      category: input.category,
      classification: 'RECORDING_GAP',
      storeRecords: 0,
      gapEvidence: gap,
      sentence:
        `RECORDING GAP: no ${input.category} record exists for this Work Order, but `
        + `${String(gap.length)} institutional event(s) that such a record should accompany do. `
        + 'The zero is true of the record and false of the work.',
    }
  }

  return {
    category: input.category,
    classification: 'TRUE_ZERO',
    storeRecords: 0,
    sentence: `TRUE ZERO: ${input.trueZeroSentence}`,
  }
}

/**
 * Classify every displayed zero on one Work Order's Record surface.
 *
 * @param store - read-only store face.
 * @param workOrderId - the Work Order whose zeros are being classified.
 * @param projected - what the projection is actually displaying.
 * @returns one entry per displayed zero; a category with a non-zero count is absent.
 */
export function classifyDisplayedZeros(
  store: ZeroClassifierStore,
  workOrderId: string,
  projected: ProjectedCounts,
): readonly ZeroClassificationView[] {
  const events = forWorkOrder(store.listEvents(), workOrderId)
  const eventRef = (kinds: readonly string[]): readonly string[] =>
    events
      .map(kindOf)
      .filter((kind): kind is string => kind !== undefined && kinds.includes(kind))

  const rows = [
    classifyOne({
      category: 'WORKING_LINES',
      projected: projected.workingLines,
      storeRecords: forWorkOrder(store.listCodeWorkingLines(), workOrderId).length,
      trueZeroSentence:
        'no durable Working Line has been opened on this Work Order, and no checkout could be observed for it.',
    }),
    classifyOne({
      category: 'CHECKPOINTS',
      projected: projected.checkpoints,
      storeRecords: forWorkOrder(store.listCodeCheckpoints(), workOrderId).length,
      trueZeroSentence: 'no checkpoint has been named on this Work Order.',
    }),
    classifyOne({
      category: 'ACTIVITY',
      projected: projected.activity,
      storeRecords: events.length,
      trueZeroSentence: 'no durable event has been recorded against this Work Order.',
    }),
    classifyOne({
      category: 'DISCUSSIONS_DECISIONS',
      projected: projected.discussionsDecisions,
      storeRecords:
        forWorkOrder(store.listDiscussions(), workOrderId).length
        + forWorkOrder(store.listDecisions(), workOrderId).length
        + forWorkOrder(store.listCollabThreads(), workOrderId).length,
      trueZeroSentence: 'no thread, discussion or decision exists on this Work Order.',
    }),
    classifyOne({
      category: 'EVIDENCE',
      projected: projected.evidence,
      storeRecords: forWorkOrder(store.listTypedEvidence(), workOrderId).length,
      /*
       * The one category where a gap is genuinely detectable: verification and
       * acceptance events are recorded as they happen, and a typed Evidence
       * record is what is supposed to accompany them. Events without records
       * is the exact shape the owner acceptance FAIL found in this Work Order's
       * own history, when ACTIVITY and EVIDENCE both read 0 while nine
       * DISCUSSION_POSTED events sat underneath.
       */
      gapEvidence: eventRef(['EVIDENCE_ATTACHED', 'VERIFICATION_RECORDED', 'ACCEPTANCE_RECORDED']),
      trueZeroSentence: 'no typed Evidence has been recorded against this Work Order.',
    }),
  ]
  return rows.filter((row): row is ZeroClassificationView => row !== undefined)
}
