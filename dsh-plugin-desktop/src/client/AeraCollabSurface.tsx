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
  type CollabChangedFileRow,
  type CollabLineRow,
  type CollabSurfaceView,
} from './aera-collab-api.ts'
import type { AeraCollabLocaleKey } from './aera-collab-locales.ts'

type Translate = (key: AeraCollabLocaleKey) => string

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

/** One changed file, carrying its kind as a WORD and never colour alone. */
function ChangedFile({ file }: { readonly file: CollabChangedFileRow }) {
  return (
    <li className="aera-collab-file" aria-label={file.accessibleName}>
      <span className="aera-collab-file-kind">{file.kindWord}</span>
      <span className="aera-collab-file-path">
        {file.previousPath === undefined ? file.path : `${file.previousPath} → ${file.path}`}
      </span>
      {file.counts === undefined ? null : <span className="aera-collab-file-counts">{file.counts}</span>}
      {file.conflicted ? <span className="aera-collab-file-flag">Conflicted</span> : null}
      {file.bothLines ? <span className="aera-collab-file-flag">Changed on both</span> : null}
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
      <ul className="aera-collab-files">
        {shown.map(file => <ChangedFile key={`${file.kindWord}:${file.path}`} file={file} />)}
      </ul>
      {compare.files.length > shown.length
        ? (
            <p className="aera-collab-status">
              {`${t('filesShown')}: ${String(shown.length)} / ${String(compare.files.length)}`}
            </p>
          )
        : null}
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
      </button>
      {expanded
        ? (
            <div className="aera-collab-line-body">
              <p className="aera-collab-line-topology">{line.topologySentence}</p>
              {line.conflictSentence === undefined
                ? null
                : <p className="aera-collab-line-conflict">{line.conflictSentence}</p>}
              {line.dirtyMarker === undefined
                ? null
                : <p className="aera-collab-status">{line.dirtyMarker}</p>}
              {line.provenanceNote === undefined
                ? null
                : <p className="aera-collab-status">{line.provenanceNote}</p>}
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

/** The whole read-first surface, inline. */
export function AeraCollabSurface({ api, workOrderId, t }: {
  readonly api: Pick<AeraCollabApi, 'view'>
  readonly workOrderId: string
  readonly t: Translate
}) {
  const [surface, setSurface] = useState<CollabSurfaceView>()
  const [unavailable, setUnavailable] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<number | undefined>(0)
  const [comparing, setComparing] = useState<number>()

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
      </header>

      <Section title={t('participants')} {...railCount('PARTICIPANTS')} defaultOpen>
        <ul className="aera-collab-participants">
          {surface.participants.map(participant => (
            <li key={`${participant.displayName}:${participant.principalKind}`} className="aera-collab-participant">
              <span className="aera-collab-participant-name">{participant.displayName}</span>
              <span className="aera-collab-participant-kind">{participant.principalKind}</span>
              <span className="aera-collab-participant-status">{participant.statusLine}</span>
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
        <ul className="aera-collab-activity">
          {surface.activity.map(row => (
            <li key={`${row.when}:${row.summary}`} className="aera-collab-activity-row">
              <span className="aera-collab-activity-actor">{row.actor}</span>
              <span className="aera-collab-activity-summary">{row.summary}</span>
              <span className="aera-collab-activity-when">{row.when}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t('checkpoints')} {...railCount('CHECKPOINTS')}>
        {surface.checkpoints.length === 0
          ? <p className="aera-collab-status">{surface.checkpointsEmptyReason ?? t('noCheckpoints')}</p>
          : (
              <ul className="aera-collab-checkpoints">
                {surface.checkpoints.map(row => (
                  <li key={`${row.label}:${row.when ?? ''}`}>{row.label}</li>
                ))}
              </ul>
            )}
      </Section>

      <Section title={t('evidence')} {...railCount('EVIDENCE')}>
        <ul className="aera-collab-evidence">
          {surface.evidence.map(row => (
            <li key={row.label}>
              <span>{row.label}</span>
              <span className="aera-collab-evidence-status">{row.status}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t('discussion')} {...railCount('DISCUSSION')}>
        <p className="aera-collab-status">{surface.discussionNote}</p>
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

      <p className="aera-collab-total">{`${t('projectedAt')}: ${surface.projectedAt}`}</p>
    </div>
  )
}
