/**
 * The Record projection — §23–§25 of the superseding order.
 *
 * §24 is the constraint that shaped this file: Record is NOT Collaborate with
 * the messages hidden. The previous attempt was exactly that — one component
 * tree with sections shown or suppressed by a flag — and the owner rejected it
 * as "too similar between Collaborate and Record".
 *
 * So these are different components answering a different question. Collaborate
 * asks *who am I working with and what are we saying*; Record asks *what
 * happened, why, who decided, and what proves it*. Nothing here composes a
 * message, and there is no composer (§23).
 *
 * Both read the SAME `CollabSurfaceView` from the same joinless projection
 * (§48). One substrate, two purpose-built renderings.
 */
import type { AeraCollabApi, CollabSurfaceView } from './aera-collab-api.ts'
import type { AeraCollabLocaleKey } from './aera-collab-locales.ts'
import { displayTime } from './aera-collab-format.ts'

/** Timestamps are subordinate (§9): rendered small, exact value on hover. */
function When({ value }: { readonly value: string | undefined }) {
  const shown = displayTime(value)
  if (shown === undefined) return null
  return <time className="aera-rail-when" dateTime={shown.exact} title={shown.exact}>{shown.label}</time>
}

type Translate = (key: AeraCollabLocaleKey) => string

function Technical({ lines, label }: { readonly lines: readonly string[], readonly label: string }) {
  if (lines.length === 0) return null
  return (
    <details className="aera-rail-technical">
      <summary>{label}</summary>
      <ul>{lines.map(line => <li key={line}><code>{line}</code></li>)}</ul>
    </details>
  )
}

/**
 * One institutional category.
 *
 * §25 lists the categories Record must carry, and adds: "If a category
 * genuinely has zero records, show zero truthfully. But zero must be
 * mechanically justified." So an empty category renders its reason rather than
 * an empty box — and the reason is supplied by the caller from the projection,
 * never invented here.
 */
function Category({ title, count, emptyReason, children }: {
  readonly title: string
  readonly count: number
  readonly emptyReason?: string
  readonly children?: import('react').ReactNode
}) {
  return (
    <section className="aera-record-category">
      <h4 className="aera-record-category-head">
        <span>{title}</span>
        <span className="aera-record-count">{String(count)}</span>
      </h4>
      {count === 0
        ? <p className="aera-record-empty">{emptyReason ?? ''}</p>
        : children}
    </section>
  )
}

export function AeraCollabRecord({ surface, t }: {
  readonly surface: CollabSurfaceView
  readonly api?: Pick<AeraCollabApi, 'packetState'>
  readonly t: Translate
}) {
  /*
   * §39/§40 — durable Working Lines are the institutional record; an observed
   * checkout is a runtime observation of this machine. The durable ones come
   * first and the observation is demoted to its own subordinate block, because
   * "This checkout · shared/wo-agc-001-wave0" was dominating a surface about
   * collaboration it has nothing to do with.
   */
  const durable = surface.lines.filter(line => line.provenance === 'DURABLE')
  const observed = surface.lines.filter(line => line.provenance !== 'DURABLE')

  return (
    <div className="aera-record">
      <p className="aera-record-lede">{t('recordLede')}</p>

      <Category
        title={t('workingLines')}
        count={durable.length}
        emptyReason={surface.linesEmptyReason ?? t('noDurableLines')}
      >
        <ul className="aera-record-list">
          {durable.map(line => (
            <li key={line.label}>
              <span className="aera-record-name">{line.label}</span>
              <span className="aera-record-sub">{line.participant}</span>
              {line.lineageSentence === undefined
                ? null
                : <p className="aera-record-note">{line.lineageSentence}</p>}
              <Technical lines={line.technical} label={t('technicalDetails')} />
            </li>
          ))}
        </ul>
      </Category>

      {/* §40: present, but visibly a runtime observation rather than the record. */}
      {observed.length === 0
        ? null
        : (
            <section className="aera-record-observed">
              <h4 className="aera-record-category-head">{t('currentLocalObservation')}</h4>
              <ul className="aera-record-list">
                {observed.map(line => (
                  <li key={line.label}>
                    <span className="aera-record-name">{line.label}</span>
                    {line.provenanceNote === undefined
                      ? null
                      : <p className="aera-record-note">{line.provenanceNote}</p>}
                    <Technical lines={line.technical} label={t('technicalDetails')} />
                  </li>
                ))}
              </ul>
            </section>
          )}

      {/* §28/§29 — grouped acts with deterministic names, not a message log. */}
      <Category
        title={t('activity')}
        count={surface.activityBlocks.length}
        emptyReason={t('noActivityBlocks')}
      >
        <ul className="aera-record-list">
          {surface.activityBlocks.map(block => (
            <li key={block.title}>
              <span className="aera-record-name">{block.title}</span>
              <span className="aera-record-sub">
                <><When value={block.from} />{' – '}<When value={block.to} /></>
              </span>
              {block.participants.length === 0
                ? null
                : <p className="aera-record-note">{block.participants.join(' · ')}</p>}
              <details className="aera-rail-technical">
                <summary>{t('underlyingActs')}</summary>
                <ul>
                  {block.members.map(member => (
                    <li key={`${member.when}:${member.summary}`}>
                      <span className="aera-record-sub"><When value={member.when} /></span>
                      {` ${member.actor} — ${member.summary}`}
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      </Category>

      <Category
        title={t('checkpoints')}
        count={surface.checkpoints.length}
        emptyReason={surface.checkpointsEmptyReason ?? t('noCheckpoints')}
      >
        <ul className="aera-record-list">
          {surface.checkpoints.map(point => (
            <li key={`${point.name}:${point.when}`}>
              <span className="aera-record-name">{point.name}</span>
              <span className="aera-record-sub"><>{point.who}{' · '}<When value={point.when} /></></span>
              <Technical lines={[point.technical]} label={t('technicalDetails')} />
            </li>
          ))}
        </ul>
      </Category>

      {/* §31 — discussions and the decisions they produced, together. */}
      <Category
        title={t('discussionsDecisions')}
        count={surface.discussions.length + surface.decisions.length}
        emptyReason={surface.discussionsDecisionsEmptyReason ?? ''}
      >
        <ul className="aera-record-list">
          {surface.discussions.map(discussion => (
            <li key={`${discussion.kind}:${discussion.subject}`}>
              <span className="aera-record-name">{discussion.subject}</span>
              <span className="aera-record-sub">
                {discussion.kind === 'THREAD' ? t('threadBadge') : t('discussion')}
                {` · ${String(discussion.entryCount)} `}
                {discussion.entryCount === 1 ? t('entry') : t('entries')}
              </span>
              {discussion.latestEntry === undefined
                ? null
                : <p className="aera-record-note">{discussion.latestEntry}</p>}
              <Technical lines={discussion.technical} label={t('technicalDetails')} />
            </li>
          ))}
          {surface.decisions.map(decision => (
            <li key={`${decision.subject}:${decision.when}`} className="aera-record-decision">
              <span className="aera-record-name">{decision.subject}</span>
              <span className="aera-record-sub">
                {`${decision.selectedOption} · ${decision.statusWord}`}
              </span>
              <p className="aera-record-note">
                {`${t('decidedBy')} ${decision.decidedBy} · ${t('recordedBy')} ${decision.recordedBy}`}
              </p>
              {decision.rationale === undefined
                ? null
                : <p className="aera-record-note">{decision.rationale}</p>}
              {/* §21 of the parent order, on every decision, always. */}
              <p className="aera-record-caveat">{decision.notAFactNote}</p>
              <Technical lines={decision.technical} label={t('technicalDetails')} />
            </li>
          ))}
        </ul>
      </Category>

      {/* §27 — typed institutional proof. Never a message. */}
      <Category
        title={t('evidence')}
        count={surface.evidenceCards.length}
        emptyReason={t('noTypedEvidence')}
      >
        <ul className="aera-record-list">
          {surface.evidenceCards.map(card => (
            <li key={`${card.classWord}:${card.subject}:${card.when}`}>
              <span className="aera-record-class">{card.classWord}</span>
              <span className="aera-record-name">{card.subject}</span>
              <span className="aera-record-sub"><>{card.actor}{' · '}<When value={card.when} /></></span>
              {card.outcome === undefined
                ? null
                : <p className="aera-record-note">{card.outcome}</p>}
              <Technical lines={card.technical} label={t('technicalDetails')} />
            </li>
          ))}
        </ul>
      </Category>

      {/* §25: provider / integration state. */}
      {surface.liveProviderState === undefined
        ? null
        : (
            <section className="aera-record-category">
              <h4 className="aera-record-category-head">{t('liveProviderState')}</h4>
              {surface.liveProviderState.recorded === undefined
                ? null
                : <p className="aera-record-note">{`${t('recorded')}: ${surface.liveProviderState.recorded}`}</p>}
              {surface.liveProviderState.live === undefined
                ? null
                : <p className="aera-record-note">{`${t('live')}: ${surface.liveProviderState.live}`}</p>}
              {surface.liveProviderState.unavailableReason === undefined
                ? null
                : <p className="aera-record-empty">{surface.liveProviderState.unavailableReason}</p>}
            </section>
          )}

      {/*
        * §30 — every displayed zero, mechanically classified against the store.
        *
        * Under Technical details, collapsed, because it answers an auditor's
        * question rather than the reader's: the reader already has the plain
        * sentence beside each empty category. What this adds is the mechanism
        * — whether a zero is TRUE_ZERO, a PROJECTION_DEFECT or a RECORDING_GAP
        * — computed from the store instead of asserted in prose, so a category
        * that silently stops projecting can no longer keep claiming nothing
        * was ever recorded.
        */}
      {(surface.zeroClassifications ?? []).length === 0
        ? null
        : (
            <Technical
              label={t('zeroClassification')}
              lines={(surface.zeroClassifications ?? []).map(
                row => `${row.category}: ${row.classification} — ${row.sentence}`
                  + (row.storeRecords > 0 ? ` [store records: ${String(row.storeRecords)}]` : '')
                  + (row.gapEvidence.length > 0 ? ` [events: ${row.gapEvidence.join(', ')}]` : ''),
              )}
            />
          )}

      <p className="aera-record-foot">
        {`${t('projectedAt')} `}<When value={surface.projectedAt} />
      </p>
    </div>
  )
}
