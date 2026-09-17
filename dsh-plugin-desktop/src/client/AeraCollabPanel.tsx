/**
 * The Collab panel — Aera Code's owner-visible way into collaboration.
 *
 * WO-AERA-CODE-COLLAB-READ-FIRST-SURFACE-001, owner entry-point direction.
 *
 * It sits beside Chat and Trajectory because that is where a person looks for
 * another view of the work in front of them. Owner acceptance failed once on a
 * build where the Collab route existed and no affordance reached it, so this
 * panel is deliberately unconditional: it renders whenever the tab strip
 * renders, and it NEVER throws and never removes itself. When nothing can be
 * resolved it opens and says what is missing — an empty panel that explains
 * itself is honest; a tab that vanishes is not.
 *
 * Read-first, exactly as the surface it leads to: reading the directory and
 * resolving the workspace touch nothing. Opening a Work Order joins it, which
 * writes a session record, so that is a separate and explicit act by the
 * reader — never a side effect of rendering a tab.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  AeraCollabApi,
  CollabDirectoryResultView,
  CollabDirectoryRowView,
  CollabResolutionView,
} from './aera-collab-api.ts'
import { AeraCollabSurface } from './AeraCollabSurface.tsx'

/** Registration-side business face for the Collab panel. */
export interface AeraCollabPanelInjected {
  readonly api: AeraCollabApi
}

/** Renderer-composed props for the Collab conversation view. */
export type AeraCollabPanelProps =
  PropsRuntime<'conversation.view'>
  & PropsLocale<'aera.collab'>
  & InjectFace<AeraCollabPanelInjected>

type LoadState = 'loading' | 'ready' | 'failed'

/** Say why a row matched, in words, rather than leaving the reader to guess. */
function matchedLabel(row: CollabDirectoryRowView, t: AeraCollabPanelProps['t']): string {
  const names = row.matchedOn.map(match =>
    match === 'ID' ? t('matchId') : match === 'TITLE' ? t('matchTitle') : t('matchRepository'))
  return names.length === 0 ? '' : `${t('matchedOn')}: ${names.join(', ')}`
}

/** One selectable Work Order. */
function CollabRow({ row, t, busy, onOpen }: {
  readonly row: CollabDirectoryRowView
  readonly t: AeraCollabPanelProps['t']
  readonly busy: boolean
  readonly onOpen: (workOrderId: string) => void
}) {
  const matched = matchedLabel(row, t)
  return (
    <li className="aera-collab-row">
      <button
        type="button"
        className="aera-collab-row-button"
        disabled={busy}
        onClick={() => { onOpen(row.workOrderId) }}
      >
        <span className="aera-collab-row-title">{row.title === '' ? row.workOrderId : row.title}</span>
        <span className="aera-collab-row-id">{row.workOrderId}</span>
        <span className="aera-collab-row-facts">
          <span className="aera-collab-state">{row.lifecycleState}</span>
          <span className="aera-collab-repository">
            {row.primaryRepositoryId ?? t('noRepository')}
          </span>
        </span>
        {matched === '' ? null : <span className="aera-collab-row-matched">{matched}</span>}
      </button>
    </li>
  )
}

/** The Collab entry panel: what this workspace is about, or a way to choose. */
export function AeraCollabPanel({ api, t }: AeraCollabPanelProps) {
  const [state, setState] = useState<LoadState>('loading')
  const [resolution, setResolution] = useState<CollabResolutionView>()
  const [directory, setDirectory] = useState<CollabDirectoryResultView>()
  const [query, setQuery] = useState('')
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [openFailed, setOpenFailed] = useState(false)
  const searchId = useId()
  // A slow reply to a stale query must never overwrite a newer one.
  const queryGeneration = useRef(0)

  const loadDirectory = useCallback(async (next: string, generation: number) => {
    try {
      const result = await api.directory(next)
      if (queryGeneration.current !== generation) return
      setDirectory(result)
      setState('ready')
    } catch {
      if (queryGeneration.current !== generation) return
      setState('failed')
    }
  }, [api])

  const load = useCallback(() => {
    setState('loading')
    const generation = queryGeneration.current + 1
    queryGeneration.current = generation
    void (async () => {
      try {
        const resolved = await api.resolve()
        if (queryGeneration.current !== generation) return
        setResolution(resolved)
        // Nothing to show but the picker? Then open on the picker rather than
        // making the reader discover a second click.
        if (resolved.workOrderId === undefined) setPicking(true)
      } catch {
        if (queryGeneration.current !== generation) return
        setResolution({ source: 'NONE' })
        setPicking(true)
      }
      await loadDirectory('', generation)
    })()
  }, [api, loadDirectory])

  useEffect(() => { load() }, [load])

  const onSearch = useCallback((next: string) => {
    setQuery(next)
    const generation = queryGeneration.current + 1
    queryGeneration.current = generation
    void loadDirectory(next.trim(), generation)
  }, [loadDirectory])

  const onSelect = useCallback((workOrderId: string) => {
    // Choosing from the picker changes what THIS panel shows. It does not
    // launch anything, and it joins nothing.
    setResolution(current => ({ source: current?.source ?? 'NONE', workOrderId }))
    setPicking(false)
  }, [])

  const onOpen = useCallback((workOrderId?: string) => {
    setBusy(true)
    setOpenFailed(false)
    void (async () => {
      try {
        await api.openCollab(workOrderId)
      } catch {
        setOpenFailed(true)
      } finally {
        setBusy(false)
      }
    })()
  }, [api])

  const resolved = resolution?.workOrderId
  const showPicker = picking || resolved === undefined

  return (
    <section className="aera-collab-panel" aria-label={t('tab')}>
      {resolved === undefined
        ? (
            <header className="aera-collab-header">
              <h2 className="aera-collab-title">{t('unresolvedTitle')}</h2>
              {/*
                * The reason the workspace resolved to nothing is shown, not
                * swallowed. "No Work Order" and "I could not tell" are
                * different facts and the reader is entitled to know which.
                */}
              {resolution?.reason === undefined
                ? null
                : <p className="aera-collab-reason">{resolution.reason}</p>}
            </header>
          )
        : (
            <header className="aera-collab-header">
              <h2 className="aera-collab-title">{t('resolvedTitle')}</h2>
              <p className="aera-collab-intro">{t('resolvedIntro')}</p>
              <p className="aera-collab-resolved-id">{resolved}</p>
              {resolution?.repositoryId === undefined
                ? null
                : <p className="aera-collab-resolved-repository">{resolution.repositoryId}</p>}
              <div className="aera-collab-actions">
                <button
                  type="button"
                  className="aera-collab-change"
                  onClick={() => { setPicking(current => !current) }}
                >
                  {t('changeWorkOrder')}
                </button>
                {/*
                  * The separate window is kept as a secondary affordance, not
                  * the way in: the surface itself now renders here, under the
                  * tab the reader already has open.
                  */}
                <button
                  type="button"
                  className="aera-collab-open"
                  disabled={busy}
                  onClick={() => { onOpen(resolved) }}
                >
                  {busy ? t('openingCollab') : t('openInWindow')}
                </button>
              </div>
            </header>
          )}

      {openFailed ? <p className="aera-collab-error" role="alert">{t('openCollabError')}</p> : null}

      {resolved === undefined
        ? null
        : <AeraCollabSurface api={api} workOrderId={resolved} t={t} />}

      {showPicker
        ? (
            <div className="aera-collab-picker">
              <h3 className="aera-collab-picker-title">{t('pickerTitle')}</h3>
              <p className="aera-collab-picker-intro">{t('pickerIntro')}</p>
              <label className="aera-collab-search-label" htmlFor={searchId}>{t('searchLabel')}</label>
              <input
                id={searchId}
                className="aera-collab-search"
                type="search"
                autoComplete="off"
                value={query}
                placeholder={t('searchPlaceholder')}
                onChange={event => { onSearch(event.target.value) }}
              />
              {state === 'loading' ? <p className="aera-collab-status">{t('loading')}</p> : null}
              {state === 'failed'
                ? (
                    <p className="aera-collab-status" role="alert">
                      {t('unavailable')}
                      {' '}
                      <button type="button" className="aera-collab-retry" onClick={load}>{t('retry')}</button>
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
                        ? (
                            <p className="aera-collab-status">
                              {directory.emptyReason ?? t('unavailable')}
                            </p>
                          )
                        : (
                            <ul className="aera-collab-rows">
                              {directory.rows.map(row => (
                                <CollabRow
                                  key={row.workOrderId}
                                  row={row}
                                  t={t}
                                  busy={busy}
                                  onOpen={onSelect}
                                />
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
        : null}
    </section>
  )
}
