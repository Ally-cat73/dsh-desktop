/**
 * The Collab surface, rendered inline in the panel.
 *
 * WO-AERA-CODE-COLLAB-READ-FIRST-SURFACE-001, owner direction: "instead of
 * collab opening in the pop up modal why don't you use a split screen or an
 * accordion view under the selected workline".
 *
 * So the surface is no longer a separate window. Working Lines are the spine:
 * each one expands in place, and its Compare opens as an accordion UNDER the
 * line it belongs to, where the reader is already looking. Nothing jumps to
 * another window, and the reader never loses the list they were reading.
 *
 * Read-first all the way down. Projecting a Work Order does not join it and
 * writes nothing, so opening a line, expanding a Compare and closing it again
 * leave the durable store byte-identical.
 *
 * The honesty rules of the surface are preserved exactly as the native window
 * stated them: a rail count that is ABSENT means "not computed", never "none";
 * an OBSERVED line says it is observed rather than posing as a durable record;
 * a Compare names its FROM and TO and spells out the direction; and a refused
 * Compare says why instead of disappearing.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  MAX_RENDERED_FILES,
  type AeraCollabApi,
  type CollabActivityBlock,
  type CollabActivityRow,
  type CollabChangedFileRow,
  type CollabDecision,
  type CollabEvidenceCard,
  type CollabLineRow,
  type CollabMessageRow,
  type CollabNodeRef,
  type CollabPacketCard,
  type CollabPacketState,
  type CollabSurfaceView,
  type CollabThreadRow,
} from './aera-collab-api.ts'
import type { AeraCollabLocaleKey } from './aera-collab-locales.ts'
import { displayTime, splitCounts } from './aera-collab-format.ts'

type Translate = (key: AeraCollabLocaleKey) => string

/**
 * A recorded instant, readable, with the exact value on the element.
 *
 * Owner feedback: data without provenance cannot be checked. Every fact the
 * surface draws that has a recorded time now shows it.
 */
function Recorded({ value, className = 'aera-collab-when' }: {
  readonly value: string | undefined
  readonly className?: string
}) {
  const shown = displayTime(value)
  if (shown === undefined) return null
  return <time className={className} dateTime={shown.exact} title={shown.exact}>{shown.label}</time>
}

/** A disclosure block: the reader asks for detail, it is never forced on them. */
function Technical({ lines, label }: { readonly lines: readonly string[], readonly label: string }) {
  if (lines.length === 0) return null
  return (
    <details className="aera-collab-technical">
      <summary>{label}</summary>
      <ul>
        {lines.map(line => <li key={line}>{line}</li>)}
      </ul>
    </details>
  )
}

/**
 * One changed file: kind, path, and its line counts in a fixed right column.
 *
 * Owner feedback asked for the counts aligned in one column on the right rather
 * than scattered along each line, and for added and removed to read green and
 * red. Colour is an addition, never the carrier: the kind is still a WORD, the
 * counts are still signed, and `accessibleName` still repeats every fact — a
 * reader who cannot see colour loses nothing.
 */
function ChangedFile({ file }: { readonly file: CollabChangedFileRow }) {
  const counts = splitCounts(file.counts)
  const kindClass = `aera-collab-file-kind aera-collab-kind-${file.kindWord.toLowerCase()}`
  return (
    <li className="aera-collab-file" aria-label={file.accessibleName}>
      <span className={kindClass}>{file.kindWord}</span>
      <span className="aera-collab-file-path">
        {file.previousPath === undefined
          ? file.path
          : (
              <>
                <span className="aera-collab-file-previous">{file.previousPath}</span>
                <span className="aera-collab-file-arrow" aria-hidden="true">→</span>
                {file.path}
              </>
            )}
        {file.conflicted ? <span className="aera-collab-file-flag aera-collab-flag-conflict">Conflicted</span> : null}
        {file.bothLines ? <span className="aera-collab-file-flag">Changed on both</span> : null}
      </span>
      <span className="aera-collab-file-counts">
        {counts === undefined
          ? null
          : counts.raw !== undefined
            ? <span className="aera-collab-count-raw">{counts.raw}</span>
            : (
                <>
                  <span className="aera-collab-count-added">{`+${counts.added ?? '0'}`}</span>
                  <span className="aera-collab-count-removed">{`−${counts.removed ?? '0'}`}</span>
                </>
              )}
      </span>
    </li>
  )
}

/** The Compare accordion, rendered under the line whose states it compares. */
function CompareAccordion({ surface, t }: { readonly surface: CollabSurfaceView, readonly t: Translate }) {
  const { compare } = surface
  if (compare === undefined) {
    return surface.compareUnavailableReason === undefined
      ? <p className="aera-collab-status">{t('comparing')}</p>
      : <p className="aera-collab-status">{surface.compareUnavailableReason}</p>
  }
  const shown = compare.files.slice(0, MAX_RENDERED_FILES)
  return (
    <div className="aera-collab-compare">
      <h5 className="aera-collab-compare-heading">{compare.heading}</h5>
      <p className="aera-collab-compare-banner">{compare.banner}</p>
      <p className="aera-collab-compare-direction">{compare.directionSentence}</p>
      <p className="aera-collab-compare-headline">{compare.headline}</p>
      {compare.unrepresentable.length === 0
        ? null
        : (
            <ul className="aera-collab-unrepresentable">
              {compare.unrepresentable.map(line => <li key={line}>{line}</li>)}
            </ul>
          )}
      {/*
        * A comparison too large to list is still a comparison. The counts
        * above are complete; saying why the rows are absent beats an empty
        * list, and beats the panel deleting itself, which is what used to
        * happen.
        */}
      {compare.filesUnavailableReason === undefined
        ? null
        : <p className="aera-collab-status">{compare.filesUnavailableReason}</p>}
      <ul className="aera-collab-files">
        {shown.map(file => <ChangedFile key={`${file.kindWord}:${file.path}`} file={file} />)}
      </ul>
      {/*
        * Owner feedback: "files shown, but it didn't mean no provenance on the
        * data. It should always be timestamped on everything." A count of rows
        * on screen out of rows computed says nothing about WHEN they were
        * computed, and without that a stale comparison is indistinguishable
        * from a wrong one.
        */}
      <p className="aera-collab-compare-provenance">
        {compare.files.length > shown.length
          ? `${t('filesShown')}: ${String(shown.length)} / ${String(compare.files.length)}`
          : `${t('filesShown')}: ${String(compare.files.length)}`}
        <span className="aera-collab-provenance-sep" aria-hidden="true">·</span>
        {`${t('computedAt')} `}
        <Recorded value={compare.computedAt} className="aera-collab-when" />
      </p>
      {compare.structuralDeltaNote === undefined
        ? null
        : <p className="aera-collab-status">{compare.structuralDeltaNote}</p>}
      <Technical lines={compare.technical} label={t('technicalDetails')} />
    </div>
  )
}

/** One Working Line, expandable in place, with its Compare underneath. */
function WorkingLine({ line, index, expanded, comparing, surface, t, onToggle, onCompare, onCloseCompare }: {
  readonly line: CollabLineRow
  readonly index: number
  readonly expanded: boolean
  readonly comparing: boolean
  readonly surface: CollabSurfaceView
  readonly t: Translate
  readonly onToggle: (index: number) => void
  readonly onCompare: (index: number) => void
  readonly onCloseCompare: () => void
}) {
  return (
    <li className="aera-collab-line">
      <button
        type="button"
        className="aera-collab-line-head"
        aria-expanded={expanded}
        onClick={() => { onToggle(index) }}
      >
        <span className="aera-collab-line-caret" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        <span className="aera-collab-line-label">{line.label}</span>
        <span className="aera-collab-line-participant">{line.participant}</span>
        {/* An observed line says so. It never poses as a durable record. */}
        <span className="aera-collab-line-provenance">{line.provenance}</span>
        {line.lifecycleWord === undefined
          ? null
          : <span className="aera-collab-line-lifecycle">{line.lifecycleWord}</span>}
      </button>
      {expanded
        ? (
            <div className="aera-collab-line-body">
              {/*
                * §41: WHERE IT CAME FROM and WHERE IT IS GOING, as two
                * separate sentences, because they are two different
                * relationships (§11). Absent on an OBSERVED row, which has no
                * recorded lineage to show.
                */}
              {/*
                * `role="note"` + `aria-label` is not decoration. A bare <p> is
                * invisible to the macOS accessibility API, so the lineage and
                * the integration target — the two facts §41 and §11 exist to
                * put in front of the reader — could be SEEN but not HEARD, and
                * could not be mechanically observed either (§64). A screen
                * reader user would have been told this line's name and its
                * provenance would have been silent.
                */}
              {line.lineageSentence === undefined
                ? null
                : (
                    <p className="aera-collab-line-lineage" role="note" aria-label={line.lineageSentence}>
                      {line.lineageSentence}
                    </p>
                  )}
              {line.integrationTargetSentence === undefined
                ? null
                : (
                    <p className="aera-collab-line-target" role="note" aria-label={line.integrationTargetSentence}>
                      {line.integrationTargetSentence}
                    </p>
                  )}
              <p className="aera-collab-line-topology" role="note" aria-label={line.topologySentence}>
                {line.topologySentence}
              </p>
              {line.latestCheckpoint === undefined
                ? null
                : (
                    <p
                      className="aera-collab-line-checkpoint"
                      role="note"
                      aria-label={`${t('latestCheckpoint')}: ${line.latestCheckpoint}`}
                    >
                      {`${t('latestCheckpoint')}: ${line.latestCheckpoint}`}
                    </p>
                  )}
              {line.conflictSentence === undefined
                ? null
                : <p className="aera-collab-line-conflict">{line.conflictSentence}</p>}
              {line.dirtyMarker === undefined
                ? null
                : <p className="aera-collab-status">{line.dirtyMarker}</p>}
              {line.provenanceNote === undefined
                ? null
                : <p className="aera-collab-status">{line.provenanceNote}</p>}
              {/*
                * §47: the stored record still says what it said. The correction
                * is a separate record, and the reader can see both.
                */}
              {line.attributionNote === undefined
                ? null
                : (
                    <div className="aera-collab-corrected">
                      <p className="aera-collab-corrected-note" role="note" aria-label={line.attributionNote}>
                        {line.attributionNote}
                      </p>
                      {line.attributionOriginalClaim === undefined
                        ? null
                        : (
                            <details className="aera-collab-corrected-original">
                              <summary>{t('originalRecord')}</summary>
                              <p>{line.attributionOriginalClaim}</p>
                            </details>
                          )}
                    </div>
                  )}
              <Technical lines={line.technical} label={t('technicalDetails')} />
              {line.compareAvailable
                ? (
                    <div className="aera-collab-line-actions">
                      <button
                        type="button"
                        className="aera-collab-compare-toggle"
                        aria-expanded={comparing}
                        onClick={() => { comparing ? onCloseCompare() : onCompare(index) }}
                      >
                        {comparing ? t('closeCompare') : t('compare')}
                      </button>
                    </div>
                  )
                : null}
              {comparing ? <CompareAccordion surface={surface} t={t} /> : null}
            </div>
          )
        : null}
    </li>
  )
}

/** Notes longer than this are clamped until the reader asks for the rest. */
const ACTIVITY_CLAMP_CHARS = 420

/**
 * One recorded act.
 *
 * Owner feedback on the first inline surface: *"that just looks like a wall of
 * light… you can't even read it… it's very hard to differentiate what's
 * actually going on."* These entries are progress notes written by the
 * participants, and some run to several hundred words, so the previous layout —
 * actor, note and time all inline in one wrapping flex row at 12px — ran them
 * together into exactly that.
 *
 * Now each act is a block: who and when on their own line, then the note as
 * prose at a readable size and measure, clamped until asked to open. Attribution
 * and time are never the thing that gets squeezed out.
 */
function ActivityRow({ row, t }: {
  readonly row: CollabActivityRow
  readonly t: Translate
}) {
  const [expanded, setExpanded] = useState(false)
  const long = row.summary.length > ACTIVITY_CLAMP_CHARS
  const shown = long && !expanded
    ? `${row.summary.slice(0, ACTIVITY_CLAMP_CHARS).trimEnd()}…`
    : row.summary
  return (
    <li className="aera-collab-activity-row">
      <div className="aera-collab-activity-head">
        <span className="aera-collab-activity-actor">{row.actor}</span>
        <Recorded value={row.when} className="aera-collab-activity-when" />
      </div>
      <p className="aera-collab-activity-summary">{shown}</p>
      {long
        ? (
            <button
              type="button"
              className="aera-collab-activity-more"
              aria-expanded={expanded}
              onClick={() => { setExpanded(current => !current) }}
            >
              {expanded ? t('showLess') : t('showMore')}
            </button>
          )
        : null}
      {row.detail === undefined ? null : <p className="aera-collab-activity-detail">{row.detail}</p>}
      {row.technical === undefined
        ? null
        : <Technical lines={[row.technical]} label={t('technicalDetails')} />}
    </li>
  )
}


/**
 * §43: one Activity Block. The block says WHAT happened as a unit; its members
 * stay individually readable underneath, because grouping must never be a way
 * of hiding an act (§47, §58).
 */
function ActivityBlock({ block, t }: {
  readonly block: CollabActivityBlock
  readonly t: Translate
}) {
  return (
    <li className="aera-collab-block">
      <details className="aera-collab-block-details">
        <summary className="aera-collab-block-head">
          <span className="aera-collab-block-title">{block.title}</span>
          <span className="aera-collab-block-range">
            <Recorded value={block.from} />
            {block.from === block.to ? null : <span aria-hidden="true">{' – '}</span>}
            {block.from === block.to ? null : <Recorded value={block.to} />}
          </span>
          {block.counts.map(count => (
            <span key={count} className="aera-collab-block-count">{count}</span>
          ))}
        </summary>
        {block.participants.length === 0
          ? null
          : <p className="aera-collab-block-participants">{block.participants.join(' · ')}</p>}
        {/* §38: the legacy block says why it is not grouped, in words. */}
        {block.legacyNote === undefined
          ? null
          : <p className="aera-collab-status">{block.legacyNote}</p>}
        <ul className="aera-collab-activity">
          {block.members.map(member => (
            <ActivityRow key={`${member.when}:${member.summary.slice(0, 64)}`} row={member} t={t} />
          ))}
        </ul>
        <Technical lines={block.technical} label={t('technicalDetails')} />
      </details>
    </li>
  )
}

/**
 * §46: a typed evidence card.
 *
 * The CLASS leads, because "the provider's receipt says X" and "a model thinks
 * X" are different kinds of claim and the reader must be able to tell them
 * apart before reading anything else. An analytical card carries its producer
 * inline and says, in words, that it is an interpretation.
 */
function EvidenceCard({ card, t }: {
  readonly card: CollabEvidenceCard
  readonly t: Translate
}) {
  return (
    <li className="aera-collab-evidence-card">
      <div className="aera-collab-evidence-card-head">
        <span className="aera-collab-evidence-class">{card.classWord}</span>
        {card.outcome === undefined
          ? null
          : <span className="aera-collab-evidence-outcome">{card.outcome}</span>}
      </div>
      <p className="aera-collab-evidence-subject">{card.subject}</p>
      <p className="aera-collab-evidence-actor">
        <span>{card.actor}</span>
        <Recorded value={card.when} />
      </p>
      {card.analyticalNote === undefined
        ? null
        : <p className="aera-collab-evidence-analytical">{card.analyticalNote}</p>}
      {card.factualNote === undefined
        ? null
        : <p className="aera-collab-status">{card.factualNote}</p>}
      {card.body === undefined
        ? null
        : (
            <details className="aera-collab-evidence-body">
              <summary>{t('showMore')}</summary>
              <p>{card.body}</p>
            </details>
          )}
      <Technical lines={card.technical} label={t('technicalDetails')} />
    </li>
  )
}

/** One list of labelled strings, drawn only when there is something to draw. */
function DecisionFacts({ label, values }: {
  readonly label: string
  readonly values: readonly string[]
}) {
  if (values.length === 0) return null
  return (
    <div className="aera-collab-decision-facts">
      <span className="aera-collab-decision-facts-label">{label}</span>
      <ul>
        {values.map(value => <li key={value}>{value}</li>)}
      </ul>
    </div>
  )
}

/**
 * §44 / §45: a decision the reader can actually understand later.
 *
 * Shut by default with the subject, the decider and the choice; opening it
 * answers every question §45 asks — what alternatives existed, what evidence
 * was considered, what was discussed, under what authority, what followed, and
 * whether it has since been superseded.
 *
 * The §21 sentence is on every decision, always: this proves the choice was
 * made, not that the choice was right.
 */
function DecisionCard({ decision, t }: {
  readonly decision: CollabDecision
  readonly t: Translate
}) {
  return (
    <li className="aera-collab-decision">
      <details className="aera-collab-decision-details">
        <summary className="aera-collab-decision-head">
          <span className="aera-collab-decision-subject">{decision.subject}</span>
          <span className="aera-collab-decision-selected">{decision.selectedOption}</span>
          <span className="aera-collab-decision-status">{decision.statusWord}</span>
        </summary>
        <p className="aera-collab-decision-actors">
          <span>{`${t('decidedBy')}: ${decision.decidedBy}`}</span>
          {/* §31: who decided and who typed it are shown as different facts. */}
          <span>{`${t('recordedBy')}: ${decision.recordedBy}`}</span>
          {decision.authorisedBy === undefined
            ? null
            : <span>{`${t('authorisedBy')}: ${decision.authorisedBy}`}</span>}
          {decision.verifiedBy === undefined
            ? null
            : <span>{`${t('verifiedBy')}: ${decision.verifiedBy}`}</span>}
          <Recorded value={decision.when} />
        </p>
        {decision.rationale === undefined
          ? null
          : <p className="aera-collab-decision-rationale">{decision.rationale}</p>}
        <DecisionFacts label={t('alternatives')} values={decision.alternatives} />
        <DecisionFacts label={t('evidenceConsidered')} values={decision.evidence} />
        <DecisionFacts label={t('discussedIn')} values={decision.discussions} />
        <DecisionFacts label={t('authorisedEffects')} values={decision.authorisedEffects} />
        <DecisionFacts label={t('resultingEffects')} values={decision.resultingEffects} />
        {decision.supersededByNote === undefined
          ? null
          : <p className="aera-collab-decision-superseded">{decision.supersededByNote}</p>}
        <p className="aera-collab-decision-not-a-fact">{decision.notAFactNote}</p>
        <Technical lines={decision.technical} label={t('technicalDetails')} />
      </details>
    </li>
  )
}

/** A collapsible section of the surface. */
function Section({ title, count, reason, children, defaultOpen = false }: {
  readonly title: string
  readonly count?: number
  readonly reason?: string
  readonly children?: ReactNode
  readonly defaultOpen?: boolean
}) {
  return (
    <details className="aera-collab-section" open={defaultOpen}>
      <summary>
        <span className="aera-collab-section-title">{title}</span>
        {/* ABSENT means NOT COMPUTED. A 0 badge over an uncomputed section
            would tell the reader something false. */}
        {count === undefined
          ? null
          : <span className="aera-collab-section-count">{String(count)}</span>}
      </summary>
      {reason === undefined ? null : <p className="aera-collab-status">{reason}</p>}
      {children}
    </details>
  )
}

/** One group of Work Context references. */
function ContextGroup({ title, rows, t }: {
  readonly title: string
  readonly rows: readonly CollabNodeRef[]
  readonly t: Translate
}) {
  if (rows.length === 0) return null
  return (
    <div className="aera-collab-context-group">
      <h5 className="aera-collab-context-title">{title}</h5>
      <ul className="aera-collab-context-rows">
        {rows.map(row => (
          <li key={row.nodeId} className="aera-collab-context-row">
            <span className="aera-collab-context-label">{row.label}</span>
            <span className="aera-collab-context-status">{row.status}</span>
            {row.sourcePath === undefined
              ? null
              : <span className="aera-collab-context-source">{row.sourcePath}</span>}
          </li>
        ))}
      </ul>
      <span className="aera-collab-context-note">{t('contextNote')}</span>
    </div>
  )
}

/** The whole read-first surface, inline. */
/**
 * §35–§40 — the coordination surface.
 *
 * Deliberately lightweight, and deliberately inside the existing rail rather
 * than beside it: the order says extend the Read-First surface, not redesign
 * it. Thread identity is never bound to any window or component (§36) — the
 * component holds a thread id and nothing else, so closing the panel closes
 * nothing.
 */
function PacketCardView({ card, api, t }: {
  readonly card: CollabPacketCard
  readonly api: Pick<AeraCollabApi, 'packetState'>
  readonly t: Translate
}) {
  const [live, setLive] = useState<CollabPacketState>()
  const [busy, setBusy] = useState(false)
  const packetId = card.technical[0]

  return (
    <div className="aera-collab-packet-card">
      <span className="aera-collab-packet-title">{card.title}</span>
      <span className="aera-collab-packet-operands">{card.operands}</span>
      {card.facts.length === 0
        ? null
        : <p className="aera-collab-packet-facts">{card.facts.join(' · ')}</p>}
      <p className="aera-collab-packet-captured">
        {`${t('capturedAt')} `}
        <Recorded value={card.capturedAt} className="aera-collab-when" />
      </p>
      {/*
        * §19: the movement line. It describes the world, not the packet — the
        * packet above is the snapshot and has not changed.
        */}
      {card.stateNote === undefined
        ? null
        : (
            <p className={card.stateMoved ? 'aera-collab-packet-moved' : 'aera-collab-status'}>
              {card.stateNote}
            </p>
          )}
      {packetId === undefined
        ? null
        : (
            <button
              type="button"
              className="aera-collab-packet-action"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                void api.packetState(packetId)
                  .then(setLive)
                  .catch(() => { setLive(undefined) })
                  .finally(() => { setBusy(false) })
              }}
            >
              {t('viewCurrentState')}
            </button>
          )}
      {/*
        * §20: resolved separately and shown BESIDE the snapshot, never in
        * place of it. Both are on screen at once, which is the whole point.
        */}
      {live === undefined
        ? null
        : (
            <p className="aera-collab-packet-live">
              {live.humanSummary}
              {live.currentSourceRevision === undefined
                ? null
                : <span className="aera-collab-when">{` (${live.currentSourceRevision} → ${live.currentTargetRevision ?? '?'})`}</span>}
            </p>
          )}
      <Technical lines={card.technical} label={t('technicalDetails')} />
    </div>
  )
}

function MessageRowView({ message, api, t }: {
  readonly message: CollabMessageRow
  readonly api: Pick<AeraCollabApi, 'packetState'>
  readonly t: Translate
}) {
  return (
    <li className={`aera-collab-message aera-collab-message-${message.principalKind.toLowerCase()}`}>
      <span className="aera-collab-message-who">{message.who}</span>
      {/* §10: the kind is drawn, always. An agent can never look like a person. */}
      <span className="aera-collab-message-kind">{message.principalKind}</span>
      {message.intentLabel === undefined
        ? null
        : <span className="aera-collab-message-intent">{message.intentLabel}</span>}
      <Recorded value={message.when} className="aera-collab-when" />
      {/* §40: an agent's words are labelled as interpretation, above the words. */}
      {message.authorshipNote === undefined
        ? null
        : <p className="aera-collab-message-analysis">{message.authorshipNote}</p>}
      <p className="aera-collab-message-body">{message.body}</p>
      {message.packets.map(card => (
        <PacketCardView key={card.technical[0] ?? card.capturedAt} card={card} api={api} t={t} />
      ))}
      {message.otherReferences.length === 0
        ? null
        : (
            <ul className="aera-collab-message-refs">
              {message.otherReferences.map(reference => <li key={reference}>{reference}</li>)}
            </ul>
          )}
      <Technical lines={message.technical} label={t('technicalDetails')} />
    </li>
  )
}

function DecisionFromThread({ threadId, workOrderId, onDone, api, t }: {
  readonly threadId: string
  readonly workOrderId: string
  readonly onDone: () => void
  readonly api: Pick<AeraCollabApi, 'coordinate'>
  readonly t: Translate
}) {
  const [subject, setSubject] = useState('')
  const [optionText, setOptionText] = useState('')
  const [selected, setSelected] = useState('')
  const [rationale, setRationale] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  /*
   * §14, in the shape of the form: the alternatives are TYPED BY A PERSON and
   * the selection is CHOSEN BY A PERSON. Nothing reads the conversation to
   * guess either. A decision that cannot name its alternatives is not a
   * decision, so the submit stays disabled until both exist.
   */
  const options = optionText
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '')
    .map((label, index) => ({ optionId: `option-${String(index + 1)}`, label }))

  return (
    <form
      className="aera-collab-decision-form"
      onSubmit={(event) => {
        event.preventDefault()
        setBusy(true)
        setError(undefined)
        void api.coordinate({
          action: 'RECORD_DECISION',
          threadId,
          workOrderId,
          subject: subject.trim(),
          options,
          selectedOptionId: selected,
          ...(rationale.trim() === '' ? {} : { rationale: rationale.trim() }),
        })
          .then(() => { onDone() })
          .catch((cause: unknown) => {
            setError(cause instanceof Error ? cause.message : String(cause))
          })
          .finally(() => { setBusy(false) })
      }}
    >
      <label>
        {t('decisionSubject')}
        <input value={subject} onChange={event => { setSubject(event.target.value) }} />
      </label>
      <label>
        {t('decisionOptions')}
        <textarea rows={3} value={optionText} onChange={event => { setOptionText(event.target.value) }} />
      </label>
      <label>
        {t('decisionSelected')}
        <select value={selected} onChange={event => { setSelected(event.target.value) }}>
          <option value="">—</option>
          {options.map(option => (
            <option key={option.optionId} value={option.optionId}>{option.label}</option>
          ))}
        </select>
      </label>
      <label>
        {t('decisionRationale')}
        <textarea rows={2} value={rationale} onChange={event => { setRationale(event.target.value) }} />
      </label>
      {error === undefined ? null : <p className="aera-collab-status">{error}</p>}
      <button
        type="submit"
        disabled={busy || subject.trim() === '' || options.length === 0 || selected === ''}
      >
        {t('recordIt')}
      </button>
    </form>
  )
}

function ThreadCard({ thread, workOrderId, api, onChanged, t }: {
  readonly thread: CollabThreadRow
  readonly workOrderId: string
  readonly api: Pick<AeraCollabApi, 'coordinate' | 'packetState'>
  readonly onChanged: () => void
  readonly t: Translate
}) {
  const [draft, setDraft] = useState('')
  const [intent, setIntent] = useState('GENERAL')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const threadId = thread.technical[0]

  const act = (request: Record<string, unknown>, after: () => void): void => {
    if (threadId === undefined) return
    setBusy(true)
    setError(undefined)
    void api.coordinate({ ...request, workOrderId })
      .then(() => { after(); onChanged() })
      .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : String(cause)) })
      .finally(() => { setBusy(false) })
  }

  return (
    <li className="aera-collab-thread">
      <span className="aera-collab-thread-subject">{thread.subject}</span>
      {/* §37: what it is about, before what was said. */}
      <p className="aera-collab-thread-about">{thread.aboutLine}</p>
      <p className="aera-collab-thread-participants">{thread.participants.join(' · ')}</p>
      {thread.decisionSubjects.length === 0
        ? null
        : (
            <p className="aera-collab-thread-decisions">
              {thread.decisionSubjects.join(' · ')}
            </p>
          )}
      <ul className="aera-collab-messages">
        {thread.messages.map(message => (
          <MessageRowView key={message.technical[0] ?? String(message.sequence)} message={message} api={api} t={t} />
        ))}
      </ul>
      {error === undefined ? null : <p className="aera-collab-status">{error}</p>}
      {thread.archived
        ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => { act({ action: 'SET_LIFECYCLE', threadId, lifecycle: 'ACTIVE' }, () => undefined) }}
            >
              {t('reopenThread')}
            </button>
          )
        : (
            <>
              <form
                className="aera-collab-composer"
                onSubmit={(event) => {
                  event.preventDefault()
                  const body = draft.trim()
                  if (body === '') return
                  act({
                    action: 'POST_MESSAGE',
                    threadId,
                    body,
                    intent,
                    /*
                     * §31: the idempotency key. A double-clicked Send, or a
                     * retry after a dropped response, resolves to the SAME
                     * message rather than posting twice.
                     */
                    requestId: `${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
                  }, () => { setDraft('') })
                }}
              >
                <textarea
                  rows={2}
                  value={draft}
                  placeholder={t('messagePlaceholder')}
                  aria-label={t('messagePlaceholder')}
                  onChange={(event) => { setDraft(event.target.value) }}
                />
                <label>
                  {t('intent')}
                  <select value={intent} onChange={(event) => { setIntent(event.target.value) }}>
                    {['GENERAL', 'REVIEW_REQUEST', 'RECONCILIATION_REQUEST',
                      'PAUSE_REQUEST', 'RESUME_NOTICE', 'DECISION_REQUEST'].map(value => (
                        <option key={value} value={value}>{value}</option>
                      ))}
                  </select>
                </label>
                <button type="submit" disabled={busy || draft.trim() === ''}>{t('send')}</button>
              </form>
              <button
                type="button"
                disabled={busy}
                onClick={() => { act({ action: 'SET_LIFECYCLE', threadId, lifecycle: 'ARCHIVED' }, () => undefined) }}
              >
                {t('archiveThread')}
              </button>
              {/* §39: the entry point from a discussion to a DECISION, explicit. */}
              <button type="button" onClick={() => { setRecording(value => !value) }}>
                {t('recordDecision')}
              </button>
              {recording && threadId !== undefined
                ? (
                    <DecisionFromThread
                      threadId={threadId}
                      workOrderId={workOrderId}
                      api={api}
                      t={t}
                      onDone={() => { setRecording(false); onChanged() }}
                    />
                  )
                : null}
            </>
          )}
      <Technical lines={thread.technical} label={t('technicalDetails')} />
    </li>
  )
}

export function AeraCollabSurface({ api, workOrderId, t }: {
  readonly api: Pick<AeraCollabApi, 'view' | 'coordinate' | 'packetState'>
  readonly workOrderId: string
  readonly t: Translate
}) {
  const [surface, setSurface] = useState<CollabSurfaceView>()
  const [unavailable, setUnavailable] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<number | undefined>(0)
  const [comparing, setComparing] = useState<number>()
  const [newThreadSubject, setNewThreadSubject] = useState('')
  const [coordinationError, setCoordinationError] = useState<string>()

  const read = useCallback(async (compareLineIndex?: number) => {
    setLoading(true)
    try {
      const result = await api.view({
        workOrderId,
        ...(compareLineIndex === undefined ? {} : { compareLineIndex }),
      })
      if ('unavailableReason' in result && !('workOrderId' in result)) {
        setUnavailable(result.unavailableReason)
        setSurface(undefined)
      } else {
        setSurface(result as CollabSurfaceView)
        setUnavailable(undefined)
      }
    } catch (cause) {
      setUnavailable(cause instanceof Error ? cause.message : t('unavailable'))
      setSurface(undefined)
    } finally {
      setLoading(false)
    }
  }, [api, workOrderId, t])

  useEffect(() => {
    // Open the first Working Line by default. The line is the spine of this
    // surface, and a reader who opens Collab to see where the work stands
    // should not have to hunt for that; a collapsed-by-default spine repeats,
    // in miniature, the mistake this Work Order exists to fix.
    setExpanded(0)
    setComparing(undefined)
    void read()
  }, [read])

  const onCompare = useCallback((index: number) => {
    setComparing(index)
    void read(index)
  }, [read])

  const onCloseCompare = useCallback(() => {
    setComparing(undefined)
    void read()
  }, [read])

  if (loading && surface === undefined) return <p className="aera-collab-status">{t('loading')}</p>
  if (unavailable !== undefined) return <p className="aera-collab-status" role="alert">{unavailable}</p>
  if (surface === undefined) return null

  const railCount = (section: string): { count?: number, reason?: string } => {
    const tab = surface.rail.find(entry => entry.section === section)
    return {
      ...(tab?.count === undefined ? {} : { count: tab.count }),
      ...(tab?.countUnavailableReason === undefined ? {} : { reason: tab.countUnavailableReason }),
    }
  }

  return (
    <div className="aera-collab-surface">
      <header className="aera-collab-surface-head">
        <h3 className="aera-collab-surface-title">{surface.workOrderTitle ?? surface.workOrderId}</h3>
        <p className="aera-collab-surface-id">{surface.workOrderId}</p>
        {surface.repositories.length === 0
          ? null
          : <p className="aera-collab-surface-repos">{surface.repositories.join(' · ')}</p>}
        <p className="aera-collab-surface-authority">
          {`${surface.authorityMode} — ${surface.authorityModeNote}`}
        </p>
        <p className="aera-collab-surface-provenance">
          {`${t('assembledAt')} `}
          <Recorded value={surface.assembledAt} className="aera-collab-when" />
        </p>
      </header>

      {/*
        * D4: CONTEXT restored. The Work Context packet is what the compact
        * CONTEXT view showed, and dropping it when the surface moved inline
        * would have quietly removed a whole section of the frozen composition.
        */}
      {surface.context === undefined
        ? null
        : (
            <Section title={t('context')}>
              <ContextGroup title={t('currentCanonicalState')} rows={surface.context.currentCanonicalState} t={t} />
              <ContextGroup title={t('governingDecisions')} rows={surface.context.governingDecisions} t={t} />
              <ContextGroup title={t('knownResiduals')} rows={surface.context.knownResiduals} t={t} />
              {surface.context.currentCanonicalState.length === 0
                && surface.context.governingDecisions.length === 0
                && surface.context.knownResiduals.length === 0
                ? <p className="aera-collab-status">{t('contextEmpty')}</p>
                : null}
            </Section>
          )}

      <Section title={t('participants')} {...railCount('PARTICIPANTS')} defaultOpen>
        <ul className="aera-collab-participants">
          {surface.participants.map(participant => (
            <li key={`${participant.displayName}:${participant.principalKind}`} className="aera-collab-participant">
              <span className="aera-collab-participant-name">{participant.displayName}</span>
              <span className="aera-collab-participant-kind">{participant.principalKind}</span>
              <span className="aera-collab-participant-status">{participant.statusLine}</span>
              {/*
                * §32/§33: what they contributed, counted by governance leg. A
                * human who decided and authorised is not "0 acts" because an
                * agent typed the events. Navigation aid, never a score (§60).
                */}
              {participant.contributionSentence === undefined
                ? null
                : <span className="aera-collab-participant-contribution">{participant.contributionSentence}</span>}
              <Technical lines={participant.technical} label={t('technicalDetails')} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t('workingLines')} {...railCount('WORKING_LINES')} defaultOpen>
        {surface.lines.length === 0
          ? <p className="aera-collab-status">{surface.linesEmptyReason ?? t('noLines')}</p>
          : (
              <ul className="aera-collab-lines">
                {surface.lines.map((line, index) => (
                  <WorkingLine
                    key={line.codeWorkingLineId ?? `observed:${line.label}`}
                    line={line}
                    index={index}
                    expanded={expanded === index}
                    comparing={comparing === index}
                    surface={surface}
                    t={t}
                    onToggle={next => { setExpanded(current => (current === next ? undefined : next)) }}
                    onCompare={onCompare}
                    onCloseCompare={onCloseCompare}
                  />
                ))}
              </ul>
            )}
      </Section>

      <Section title={t('activity')} {...railCount('ACTIVITY')}>
        {/*
          * §43: blocks sit ABOVE the raw rows and never replace them. §47 is
          * the reason the raw list is still here in full — the human-readable
          * projection sits over the canonical history, it does not stand in
          * for it, and a reader who wants the forensic view can still have it.
          */}
        {surface.activityBlocks.length === 0
          ? null
          : (
              <ul className="aera-collab-blocks">
                {surface.activityBlocks.map(block => (
                  <ActivityBlock key={`${block.title}:${block.from}`} block={block} t={t} />
                ))}
              </ul>
            )}
        <details className="aera-collab-raw-activity">
          <summary>{t('rawActivity')}</summary>
          <ul className="aera-collab-activity">
            {surface.activity.map(row => (
              <ActivityRow key={`${row.when}:${row.summary.slice(0, 64)}`} row={row} t={t} />
            ))}
          </ul>
        </details>
      </Section>

      <Section title={t('checkpoints')} {...railCount('CHECKPOINTS')}>
        {surface.checkpoints.length === 0
          ? <p className="aera-collab-status">{surface.checkpointsEmptyReason ?? t('noCheckpoints')}</p>
          : (
              <ul className="aera-collab-checkpoints">
                {surface.checkpoints.map(row => (
                  <li key={`${row.name}:${row.when}`} className="aera-collab-checkpoint-row">
                    <div className="aera-collab-checkpoint-head">
                      <span className="aera-collab-checkpoint-label">{row.name}</span>
                      <span className="aera-collab-checkpoint-origin">{row.origin}</span>
                      <span className="aera-collab-checkpoint-who">{row.who}</span>
                      <Recorded value={row.when} />
                    </div>
                    {/* §42: the summary is the point of a checkpoint card; the
                        underlying commit stays progressive disclosure. */}
                    {row.summary === undefined
                      ? null
                      : <p className="aera-collab-checkpoint-summary">{row.summary}</p>}
                    {/* CP-5: the weakest arm says so, on every row that uses it. */}
                    {row.verifiabilityNote === undefined
                      ? null
                      : <p className="aera-collab-status">{row.verifiabilityNote}</p>}
                    {row.attributionNote === undefined
                      ? null
                      : (
                          <div className="aera-collab-corrected">
                            <p className="aera-collab-corrected-note">{row.attributionNote}</p>
                            {row.attributionOriginalClaim === undefined
                              ? null
                              : (
                                  <details className="aera-collab-corrected-original">
                                    <summary>{t('originalRecord')}</summary>
                                    <p>{row.attributionOriginalClaim}</p>
                                  </details>
                                )}
                          </div>
                        )}
                    <Technical lines={[row.technical]} label={t('technicalDetails')} />
                  </li>
                ))}
              </ul>
            )}
      </Section>

      <Section title={t('evidence')} {...railCount('EVIDENCE')}>
        {/* §46: typed cards first. The prose list stays beneath, disclosed. */}
        {surface.evidenceCards.length === 0
          ? null
          : (
              <ul className="aera-collab-evidence-cards">
                {surface.evidenceCards.map(card => (
                  <EvidenceCard key={`${card.classWord}:${card.subject}:${card.when}`} card={card} t={t} />
                ))}
              </ul>
            )}
        {surface.evidence.length === 0
          ? null
          : (
              <details className="aera-collab-evidence-raw">
                <summary>{t('technicalDetails')}</summary>
                <ul className="aera-collab-evidence">
                  {surface.evidence.map(row => (
                    <li key={row.label}>
                      <span>{row.label}</span>
                      <span className="aera-collab-evidence-status">{row.status}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
      </Section>

      {/*
        * §44: DISCUSSIONS & DECISIONS. They remain distinct RECORDS (§18) and
        * are presented together because a decision is very hard to understand
        * later without the discussion that produced it.
        */}
      <Section title={t('discussionsDecisions')} {...railCount('DISCUSSIONS_DECISIONS')}>
        <p className="aera-collab-status">{surface.discussionNote}</p>
        {surface.discussionsDecisionsEmptyReason === undefined
          ? null
          : <p className="aera-collab-status">{surface.discussionsDecisionsEmptyReason}</p>}
        {surface.decisions.length === 0
          ? null
          : (
              <ul className="aera-collab-decisions">
                {surface.decisions.map(decision => (
                  <DecisionCard key={`${decision.subject}:${decision.when}`} decision={decision} t={t} />
                ))}
              </ul>
            )}
        {surface.discussions.length === 0
          ? null
          : (
              <ul className="aera-collab-discussions">
                {surface.discussions.map(discussion => (
                  <li key={`${discussion.subject}:${discussion.updatedAt}`} className="aera-collab-discussion">
                    <span className="aera-collab-discussion-subject">{discussion.subject}</span>
                    <span className="aera-collab-discussion-count">
                      {`${String(discussion.entryCount)} ${discussion.entryCount === 1 ? 'entry' : 'entries'}`}
                    </span>
                    <Recorded value={discussion.updatedAt} />
                    {discussion.latestEntry === undefined
                      ? null
                      : <p className="aera-collab-discussion-entry">{discussion.latestEntry}</p>}
                    <Technical lines={discussion.technical} label={t('technicalDetails')} />
                  </li>
                ))}
              </ul>
            )}
      </Section>

      {/*
        * §35/§36 — COORDINATION. A lightweight section, not a second product.
        * §30/§55: the delivery note is the FIRST thing in it, because a reader
        * who is not told will assume live push that does not exist yet.
        */}
      <Section title={t('coordination')} {...railCount('COORDINATION')}>
        <p className="aera-collab-status">{surface.coordinationDeliveryNote}</p>
        {surface.threadsEmptyReason === undefined
          ? null
          : <p className="aera-collab-status">{surface.threadsEmptyReason}</p>}
        <form
          className="aera-collab-new-thread"
          onSubmit={(event) => {
            event.preventDefault()
            const subject = newThreadSubject.trim()
            if (subject === '') return
            setCoordinationError(undefined)
            void api.coordinate({ action: 'OPEN_THREAD', subject, workOrderId })
              .then(() => { setNewThreadSubject(''); void read(comparing) })
              .catch((cause: unknown) => {
                setCoordinationError(cause instanceof Error ? cause.message : String(cause))
              })
          }}
        >
          <input
            value={newThreadSubject}
            placeholder={t('threadSubject')}
            aria-label={t('threadSubject')}
            onChange={(event) => { setNewThreadSubject(event.target.value) }}
          />
          <button type="submit" disabled={newThreadSubject.trim() === ''}>{t('startThread')}</button>
        </form>
        {/*
          * §21 — SHARE FROM COMPARE. Offered only while a comparison is
          * actually on screen, because a packet is a snapshot of a real
          * comparison and there is nothing honest to share without one.
          */}
        {surface.compare === undefined
          ? null
          : (
              <button
                type="button"
                className="aera-collab-share-compare"
                onClick={() => {
                  setCoordinationError(undefined)
                  void api.coordinate({
                    action: 'SHARE_COMPARE',
                    workOrderId,
                    ...(comparing === undefined ? {} : { compareLineIndex: comparing }),
                  })
                    .then(() => { void read(comparing) })
                    .catch((cause: unknown) => {
                      setCoordinationError(cause instanceof Error ? cause.message : String(cause))
                    })
                }}
              >
                {t('shareCompare')}
              </button>
            )}
        {coordinationError === undefined
          ? null
          : <p className="aera-collab-status">{coordinationError}</p>}
        {surface.threads.length === 0
          ? null
          : (
              <ul className="aera-collab-threads">
                {surface.threads.map(thread => (
                  <ThreadCard
                    key={thread.technical[0] ?? thread.subject}
                    thread={thread}
                    workOrderId={workOrderId}
                    api={api}
                    t={t}
                    onChanged={() => { void read(comparing) }}
                  />
                ))}
              </ul>
            )}
      </Section>

      <Section title={t('archived')} count={surface.archivedCount} />

      {surface.liveProviderState === undefined
        ? null
        : (
            <Section title={t('liveProviderState')} defaultOpen>
              {/* Historical evidence says what was true then; the provider says
                  what is true now. They are never merged. */}
              {surface.liveProviderState.recorded === undefined
                ? null
                : <p className="aera-collab-status">{`${t('recorded')}: ${surface.liveProviderState.recorded}`}</p>}
              {surface.liveProviderState.live === undefined
                ? null
                : <p className="aera-collab-status">{`${t('live')}: ${surface.liveProviderState.live}`}</p>}
              {surface.liveProviderState.unavailableReason === undefined
                ? null
                : <p className="aera-collab-status">{surface.liveProviderState.unavailableReason}</p>}
            </Section>
          )}

      <p className="aera-collab-total">
        {`${t('projectedAt')} `}
        <Recorded value={surface.projectedAt} className="aera-collab-when" />
      </p>
    </div>
  )
}
