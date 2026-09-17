/**
 * The Collab picker — finding work without knowing a WorkOrderId.
 *
 * WO-AERA-CODE-COLLAB-READ-FIRST-SURFACE-001, review findings D2 and D3.
 *
 * Shared by the Collab tab and by the shell-level overlay that the sidebar
 * opens, so both offer the same way in: a search field over title, WorkOrderId
 * and repository, with ACTIVE work listed before anything is typed. There is
 * deliberately no free-text WorkOrderId field anywhere in this component —
 * requiring someone to type an id is the entry path the continuation order
 * forbids, and a picker that still asked for one would only be hiding it.
 *
 * The search field takes focus on mount, because both callers open this in
 * response to a deliberate act ("Open Collab…", "Choose a different Work
 * Order") and the next thing the reader wants to do is type.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type {
  AeraCollabApi,
  CollabDirectoryResultView,
  CollabDirectoryRowView,
} from './aera-collab-api.ts'
import type { AeraCollabLocaleKey } from './aera-collab-locales.ts'

type Translate = (key: AeraCollabLocaleKey) => string

/** Say why a row matched, in words, rather than leaving the reader to guess. */
function matchedLabel(row: CollabDirectoryRowView, t: Translate): string {
  const names = row.matchedOn.map(match =>
    match === 'ID' ? t('matchId') : match === 'TITLE' ? t('matchTitle') : t('matchRepository'))
  return names.length === 0 ? '' : `${t('matchedOn')}: ${names.join(', ')}`
}

/** One selectable Work Order. */
function CollabRow({ row, t, onChoose }: {
  readonly row: CollabDirectoryRowView
  readonly t: Translate
  readonly onChoose: (workOrderId: string) => void
}) {
  const matched = matchedLabel(row, t)
  return (
    <li className="aera-collab-row">
      <button
        type="button"
        className="aera-collab-row-button"
        onClick={() => { onChoose(row.workOrderId) }}
      >
        <span className="aera-collab-row-title">{row.title === '' ? row.workOrderId : row.title}</span>
        <span className="aera-collab-row-id">{row.workOrderId}</span>
        <span className="aera-collab-row-facts">
          <span className="aera-collab-state">{row.lifecycleState}</span>
          <span className="aera-collab-repository">{row.primaryRepositoryId ?? t('noRepository')}</span>
        </span>
        {matched === '' ? null : <span className="aera-collab-row-matched">{matched}</span>}
      </button>
    </li>
  )
}

/** Search for a Work Order, or take one from the list of live work. */
export function AeraCollabPicker({ api, t, onChoose, autoFocus = true }: {
  readonly api: Pick<AeraCollabApi, 'directory'>
  readonly t: Translate
  readonly onChoose: (workOrderId: string) => void
  readonly autoFocus?: boolean
}) {
  const [directory, setDirectory] = useState<CollabDirectoryResultView>()
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [query, setQuery] = useState('')
  const searchId = useId()
  const search = useRef<HTMLInputElement>(null)
  // A slow reply to a stale query must never overwrite a newer one.
  const generation = useRef(0)

  const load = useCallback((next: string) => {
    const mine = generation.current + 1
    generation.current = mine
    setState('loading')
    void (async () => {
      try {
        const result = await api.directory(next.trim())
        if (generation.current !== mine) return
        setDirectory(result)
        setState('ready')
      } catch {
        if (generation.current !== mine) return
        setState('failed')
      }
    })()
  }, [api])

  useEffect(() => {
    load('')
    if (autoFocus) search.current?.focus()
  }, [load, autoFocus])

  return (
    <div className="aera-collab-picker">
      <h3 className="aera-collab-picker-title">{t('pickerTitle')}</h3>
      <p className="aera-collab-picker-intro">{t('pickerIntro')}</p>
      <label className="aera-collab-search-label" htmlFor={searchId}>{t('searchLabel')}</label>
      <input
        id={searchId}
        ref={search}
        className="aera-collab-search"
        type="search"
        autoComplete="off"
        value={query}
        placeholder={t('searchPlaceholder')}
        onChange={event => {
          setQuery(event.target.value)
          load(event.target.value)
        }}
      />
      {state === 'loading' ? <p className="aera-collab-status">{t('loading')}</p> : null}
      {state === 'failed'
        ? (
            <p className="aera-collab-status" role="alert">
              {t('unavailable')}
              {' '}
              <button type="button" className="aera-collab-retry" onClick={() => { load(query) }}>
                {t('retry')}
              </button>
            </p>
          )
        : null}
      {state === 'ready' && directory !== undefined
        ? (
            <>
              <p className="aera-collab-listing">
                {directory.listing === 'ACTIVE' ? t('listingActive') : t('listingMatches')}
              </p>
              {directory.rows.length === 0
                ? <p className="aera-collab-status">{directory.emptyReason ?? t('unavailable')}</p>
                : (
                    <ul className="aera-collab-rows">
                      {directory.rows.map(row => (
                        <CollabRow key={row.workOrderId} row={row} t={t} onChoose={onChoose} />
                      ))}
                    </ul>
                  )}
              {directory.truncated ? <p className="aera-collab-status">{t('truncated')}</p> : null}
              <p className="aera-collab-total">
                {`${t('totalRecorded')}: ${String(directory.totalWorkOrders)}`}
              </p>
            </>
          )
        : null}
    </div>
  )
}
