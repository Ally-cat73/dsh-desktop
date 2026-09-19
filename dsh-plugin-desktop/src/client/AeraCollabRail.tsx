/**
 * The human collaboration rail — §8–§14 of the superseding order.
 *
 * This is where two people talk about a piece of work. It is deliberately NOT
 * the institutional ledger: that is the Record projection (§22–§25), reachable
 * from the mode switch at the top and composed from different components
 * rather than the same ones hidden and shown (§24).
 *
 * The rail is a self-contained component with no knowledge of which container
 * hosts it. That is on purpose — the shell's right column is currently held by
 * tool inspection, so where this mounts is still being decided, and none of the
 * semantics below depend on the answer.
 *
 * What the order asked for and what each part answers:
 *
 *   §9  messages look like messages — speaker, then what they said
 *   §10 a composer a person can use without knowing what a packet is
 *   §11 SHARE CURRENT STATE with no ids, no hashes, no schema choice
 *   §13 a compact state card, not a raw packet
 *   §14 an inspector that opens over the conversation, not instead of it
 *   §17 §43 §44 human names first, canonical ids under Technical details
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  type AeraCollabApi,
  type CollabMessageRow,
  type CollabPacketCard,
  type CollabPacketState,
  type CollabSurfaceView,
  type CollabThreadRow,
} from './aera-collab-api.ts'
import type { AeraCollabLocaleKey } from './aera-collab-locales.ts'
import { displayTime } from './aera-collab-format.ts'

/** Timestamps are subordinate (§9): rendered small, exact value on hover. */
function When({ value }: { readonly value: string | undefined }) {
  const shown = displayTime(value)
  if (shown === undefined) return null
  return <time className="aera-rail-when" dateTime={shown.exact} title={shown.exact}>{shown.label}</time>
}

type Translate = (key: AeraCollabLocaleKey) => string

/** §44: every human object may disclose its canonical identity, collapsed. */
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
 * §13 — the compact state card.
 *
 * Counts and a capture time. No revisions on the face of it: §17 is explicit
 * that `Authentication → Integration` is the human form and the forty-hex
 * pair belongs underneath. `View current state` (§20) resolves separately and
 * renders BESIDE the snapshot, because the snapshot must never be overwritten
 * by what is true now.
 */
function StateCard({ card, api, t, onOpen }: {
  readonly card: CollabPacketCard
  readonly api: Pick<AeraCollabApi, 'packetState'>
  readonly t: Translate
  readonly onOpen: (card: CollabPacketCard) => void
}) {
  const [live, setLive] = useState<CollabPacketState>()
  const [busy, setBusy] = useState(false)
  const packetId = card.technical[0]

  return (
    <div className="aera-rail-state-card">
      <div className="aera-rail-state-head">
        <span className="aera-rail-state-title">{t('stateCardTitle')}</span>
        <span className="aera-rail-state-operands">{card.operands}</span>
      </div>
      {card.facts.length === 0
        ? null
        : (
            <ul className="aera-rail-state-facts">
              {card.facts.map(fact => <li key={fact}>{fact}</li>)}
            </ul>
          )}
      <p className="aera-rail-state-captured">
        {`${t('capturedAt')} `}
        <When value={card.capturedAt} />
      </p>
      {card.stateNote === undefined
        ? null
        : (
            <p className={card.stateMoved ? 'aera-rail-state-moved' : 'aera-rail-state-steady'}>
              {card.stateNote}
            </p>
          )}
      <div className="aera-rail-state-actions">
        <button type="button" onClick={() => { onOpen(card) }}>{t('openState')}</button>
        {packetId === undefined
          ? null
          : (
              <button
                type="button"
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
      </div>
      {/* §20: the live answer sits BESIDE the snapshot, never replacing it. */}
      {live === undefined
        ? null
        : <p className="aera-rail-state-live">{live.humanSummary}</p>}
      <Technical lines={card.technical} label={t('technicalDetails')} />
    </div>
  )
}

/**
 * §9 — one message, as a message.
 *
 * Name, then a role badge only where it carries meaning, then the words. The
 * timestamp is subordinate. The order was explicit that
 * `NAME + HUMAN + INTENT + TIMESTAMP` run together is unreadable, and that is
 * exactly what the previous surface produced.
 */
function MessageBubble({ message, mine, api, t, onOpenState }: {
  readonly message: CollabMessageRow
  readonly mine: boolean
  readonly api: Pick<AeraCollabApi, 'packetState'>
  readonly t: Translate
  readonly onOpenState: (card: CollabPacketCard) => void
}) {
  const agent = message.principalKind === 'AGENT'
  return (
    <li
      className={`aera-rail-msg${mine ? ' aera-rail-msg-mine' : ''}${agent ? ' aera-rail-msg-agent' : ''}`}
      data-speaker={message.principalKind.toLowerCase()}
    >
      <div className="aera-rail-msg-head">
        <span className="aera-rail-msg-who">{message.who}</span>
        {/* §9: a badge where it carries meaning. A human is not badged "HUMAN". */}
        {agent ? <span className="aera-rail-msg-badge">{t('agentBadge')}</span> : null}
        {message.intentLabel === undefined
          ? null
          : <span className="aera-rail-msg-intent">{message.intentLabel}</span>}
        <span className="aera-rail-msg-when"><When value={message.when} /></span>
      </div>
      {/* §40 of the parent order: an agent's words are interpretation, said so. */}
      {message.authorshipNote === undefined
        ? null
        : <p className="aera-rail-msg-analysis">{message.authorshipNote}</p>}
      <p className="aera-rail-msg-body">{message.body}</p>
      {message.packets.map(card => (
        <StateCard
          key={card.technical[0] ?? card.capturedAt}
          card={card}
          api={api}
          t={t}
          onOpen={onOpenState}
        />
      ))}
      {message.otherReferences.length === 0
        ? null
        : (
            <ul className="aera-rail-msg-refs">
              {message.otherReferences.map(ref => <li key={ref}>{ref}</li>)}
            </ul>
          )}
      <Technical lines={message.technical} label={t('technicalDetails')} />
    </li>
  )
}

/**
 * §14 — the inspector.
 *
 * A drawer over the conversation. The order is explicit that inspecting a
 * packet must not navigate the reader into a replacement page; they close it
 * and carry on talking.
 */
function StateInspector({ card, t, onClose }: {
  readonly card: CollabPacketCard
  readonly t: Translate
  readonly onClose: () => void
}) {
  return (
    <div className="aera-rail-inspector" role="dialog" aria-label={t('stateCardTitle')}>
      <div className="aera-rail-inspector-head">
        <span>{t('stateCardTitle')}</span>
        <button type="button" onClick={onClose} aria-label={t('close')}>×</button>
      </div>
      <p className="aera-rail-inspector-operands">{card.operands}</p>
      <ul className="aera-rail-state-facts">
        {card.facts.map(fact => <li key={fact}>{fact}</li>)}
      </ul>
      <p className="aera-rail-state-captured">
        {`${t('capturedAt')} `}<When value={card.capturedAt} />
      </p>
      {card.stateNote === undefined ? null : <p className="aera-rail-state-steady">{card.stateNote}</p>}
      <Technical lines={card.technical} label={t('technicalDetails')} />
    </div>
  )
}

/** §10/§11 — the composer. Two verbs, no schema, no ids. */
function Composer({ workOrderId, threadId, canShareState, compareLineIndex, api, t, onDone }: {
  readonly workOrderId: string
  readonly threadId: string
  readonly canShareState: boolean
  readonly compareLineIndex?: number
  readonly api: Pick<AeraCollabApi, 'coordinate'>
  readonly t: Translate
  readonly onDone: () => void
}) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const run = useCallback((request: Record<string, unknown>) => {
    setBusy(true)
    setError(undefined)
    void api.coordinate(request)
      .then(() => { setDraft(''); onDone() })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => { setBusy(false) })
  }, [api, onDone])

  const text = draft.trim()
  return (
    <form
      className="aera-rail-composer"
      onSubmit={(event) => {
        event.preventDefault()
        if (text === '') return
        run({
          action: 'POST_MESSAGE',
          workOrderId,
          threadId,
          body: text,
          requestId: `rail-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
        })
      }}
    >
      <textarea
        rows={2}
        value={draft}
        placeholder={t('messagePlaceholder')}
        aria-label={t('messagePlaceholder')}
        onChange={(event) => { setDraft(event.target.value) }}
      />
      <div className="aera-rail-composer-actions">
        <button type="submit" disabled={busy || text === ''}>{t('send')}</button>
        {/*
          * §11 — SHARE CURRENT STATE. One press. The system resolves the
          * current authorised state from the active work context; the person
          * supplies nothing but, optionally, a sentence. When they have typed
          * one the verb changes to say what will actually happen.
          */}
        {canShareState
          ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  run({
                    action: 'SHARE_COMPARE_TO_THREAD',
                    workOrderId,
                    threadId,
                    ...(compareLineIndex === undefined ? {} : { compareLineIndex }),
                    ...(text === '' ? {} : { note: text }),
                  })
                }}
              >
                {text === '' ? t('shareCurrentState') : t('sendWithCurrentState')}
              </button>
            )
          : null}
      </div>
      {error === undefined ? null : <p className="aera-rail-error">{error}</p>}
    </form>
  )
}

/** §8 — the rail itself. */
export function AeraCollabRail({ surface, api, t, onChanged, compareLineIndex }: {
  readonly surface: CollabSurfaceView
  readonly api: Pick<AeraCollabApi, 'coordinate' | 'packetState'>
  readonly t: Translate
  readonly onChanged: () => void
  readonly compareLineIndex?: number
}) {
  const threads = useMemo(
    () => surface.threads.filter(thread => !thread.archived),
    [surface.threads],
  )
  const [activeId, setActiveId] = useState<string>()
  const [inspecting, setInspecting] = useState<CollabPacketCard>()
  const [newSubject, setNewSubject] = useState('')

  // Thread identity is not bound to the container: the selection survives the
  // rail closing and reopening, and falls back to the first open thread.
  const active: CollabThreadRow | undefined = useMemo(
    () => threads.find(thread => thread.technical[0] === activeId) ?? threads[0],
    [threads, activeId],
  )
  useEffect(() => {
    if (active !== undefined && activeId === undefined) setActiveId(active.technical[0])
  }, [active, activeId])

  const me = surface.participants.find(row => row.principalKind === 'HUMAN')?.displayName
  const threadId = active?.technical[0]

  return (
    <div className="aera-rail">
      <header className="aera-rail-head">
        <h3 className="aera-rail-title">{active?.subject ?? t('coordination')}</h3>
        {active === undefined
          ? null
          : <p className="aera-rail-about">{active.aboutLine}</p>}
        {/* §8: who is in this conversation, in names. */}
        <ul className="aera-rail-participants">
          {surface.participants.map(person => (
            <li key={person.displayName}>
              <span className="aera-rail-person">{person.displayName}</span>
              {person.principalKind === 'AGENT'
                ? <span className="aera-rail-msg-badge">{t('agentBadge')}</span>
                : null}
              {person.contributionSentence === undefined
                ? null
                : <span className="aera-rail-person-note">{person.contributionSentence}</span>}
            </li>
          ))}
        </ul>
        {threads.length > 1
          ? (
              <label className="aera-rail-switch">
                {t('shareToThread')}
                <select
                  value={threadId ?? ''}
                  onChange={(event) => { setActiveId(event.target.value) }}
                >
                  {threads.map(thread => (
                    <option key={thread.technical[0] ?? thread.subject} value={thread.technical[0] ?? ''}>
                      {thread.subject}
                    </option>
                  ))}
                </select>
              </label>
            )
          : null}
        {/*
          * §17/§43: the thread's canonical ids stay canonical and stay
          * reachable. They are last and collapsed because §43 puts the human
          * subject first — but "not first" must never become "not available".
          */}
        {active === undefined
          ? null
          : <Technical lines={active.technical} label={t('technicalDetails')} />}
      </header>

      <p className="aera-rail-delivery">{surface.coordinationDeliveryNote}</p>

      {active === undefined
        ? (
            <div className="aera-rail-empty">
              <p>{surface.threadsEmptyReason ?? t('noThreads')}</p>
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  const subject = newSubject.trim()
                  if (subject === '') return
                  void api.coordinate({ action: 'OPEN_THREAD', workOrderId: surface.workOrderId, subject })
                    .then(() => { setNewSubject(''); onChanged() })
                    .catch(() => undefined)
                }}
              >
                <input
                  value={newSubject}
                  placeholder={t('threadSubject')}
                  aria-label={t('threadSubject')}
                  onChange={(event) => { setNewSubject(event.target.value) }}
                />
                <button type="submit" disabled={newSubject.trim() === ''}>{t('startThread')}</button>
              </form>
            </div>
          )
        : (
            <>
              <ol className="aera-rail-stream">
                {active.messages.map(message => (
                  <MessageBubble
                    key={message.technical[0] ?? String(message.sequence)}
                    message={message}
                    mine={me !== undefined && message.who === me}
                    api={api}
                    t={t}
                    onOpenState={setInspecting}
                  />
                ))}
              </ol>
              {threadId === undefined
                ? null
                : (
                    <Composer
                      workOrderId={surface.workOrderId}
                      threadId={threadId}
                      canShareState={surface.compare !== undefined}
                      {...(compareLineIndex === undefined ? {} : { compareLineIndex })}
                      api={api}
                      t={t}
                      onDone={onChanged}
                    />
                  )}
            </>
          )}

      {inspecting === undefined
        ? null
        : <StateInspector card={inspecting} t={t} onClose={() => { setInspecting(undefined) }} />}
    </div>
  )
}
