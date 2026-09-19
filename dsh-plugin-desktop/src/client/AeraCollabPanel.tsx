/**
 * The Collab panel — Aera Code's owner-visible way into collaboration.
 *
 * WO-AERA-CODE-COLLAB-READ-FIRST-SURFACE-001.
 *
 * It sits beside Chat and Trajectory because that is where a person looks for
 * another view of the work in front of them. Owner acceptance failed once on a
 * build where the Collab route existed and no affordance reached it, so this
 * panel is deliberately unconditional: it renders whenever the tab strip
 * renders, and it NEVER throws and never removes itself. When nothing can be
 * resolved it opens on the picker and says what is missing — an empty panel
 * that explains itself is honest; a tab that vanishes is not.
 *
 * Read-first, exactly as the surface it leads to: resolving the workspace and
 * reading the directory touch nothing.
 *
 * Review finding D3: choosing a different Work Order REPLACES the surface with
 * the picker rather than appending it underneath. Appended below a long
 * surface, the control looked like it did nothing at all.
 */

import { useCallback, useEffect, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AeraCollabApi, CollabResolutionView } from './aera-collab-api.ts'
import { AeraCollabPicker } from './AeraCollabPicker.tsx'
import { AeraCollabWorkspace } from './AeraCollabWorkspace.tsx'

/** Registration-side capabilities for the Collab panel. */
export interface AeraCollabPanelInjected {
  readonly api: AeraCollabApi
}

/**
 * Renderer-composed props for the Collab conversation view.
 *
 * Kept as the shape the details-column props derive from. The centre-column
 * REGISTRATION is gone (§4); `AeraCollabPanel` below is no longer registered
 * anywhere and exists only as the named counterpart of
 * `AeraCollabDetailsTab`, so the two seats cannot drift apart if the centre is
 * ever legitimately wanted again.
 */
export type AeraCollabPanelProps =
  PropsRuntime<'conversation.view'>
  & PropsLocale<'aera.collab'>
  & InjectFace<AeraCollabPanelInjected>

/** Renderer-composed props for the Collaborate tab of the details column. */
export type AeraCollabDetailsTabProps =
  PropsRuntime<'conversation.details.collab'>
  & PropsLocale<'aera.collab'>
  & InjectFace<AeraCollabPanelInjected>

/**
 * The same entry, in the conversation tab strip.
 *
 * NOT REGISTERED (§4, and R2's dead-code note). The centre-column tab was
 * removed; this remains as the single-implementation counterpart of the
 * details-column seat below, and is exported so a reader grepping for the old
 * surface finds the explanation rather than silence.
 */
export function AeraCollabPanel({ api, t }: AeraCollabPanelProps) {
  return <CollabEntry api={api} t={t} />
}

/**
 * The same entry, in the right-hand details column beside tool inspection
 * (controller ruling, Option B). The column is narrow, so the subtree marks
 * itself and the styles tighten — nothing about the content changes, because a
 * different Collab in a different container is two things to keep true.
 */
export function AeraCollabDetailsTab({ api, t }: AeraCollabDetailsTabProps) {
  return (
    <div className="aera-collab-in-details">
      <CollabEntry api={api} t={t} />
    </div>
  )
}

/** The panel body both registrations render. */
function CollabEntry({ api, t }: {
  readonly api: AeraCollabApi
  readonly t: AeraCollabPanelProps['t']
}) {
  const [resolution, setResolution] = useState<CollabResolutionView>()
  const [chosen, setChosen] = useState<string>()
  const [picking, setPicking] = useState(false)
  const [resolving, setResolving] = useState(true)
  const [busy, setBusy] = useState(false)
  const [openFailed, setOpenFailed] = useState(false)

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const resolved = await api.resolve()
        if (!live) return
        setResolution(resolved)
        // Nothing to show but the picker? Then open on it, rather than making
        // the reader discover a second click.
        if (resolved.workOrderId === undefined) setPicking(true)
      } catch {
        if (!live) return
        setResolution({ source: 'NONE' })
        setPicking(true)
      } finally {
        if (live) setResolving(false)
      }
    })()
    return () => { live = false }
  }, [api])

  const onChoose = useCallback((workOrderId: string) => {
    setChosen(workOrderId)
    setPicking(false)
  }, [])

  const onOpenWindow = useCallback((workOrderId: string) => {
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

  const workOrderId = chosen ?? resolution?.workOrderId
  const showPicker = picking || workOrderId === undefined

  if (resolving) return <p className="aera-collab-status">{t('loading')}</p>

  return (
    <section className="aera-collab-panel" aria-label={t('tab')}>
      {workOrderId === undefined
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
              <p className="aera-collab-resolved-id">{workOrderId}</p>
              {chosen === undefined && resolution?.repositoryId !== undefined
                ? <p className="aera-collab-resolved-repository">{resolution.repositoryId}</p>
                : null}
              <div className="aera-collab-actions">
                <button
                  type="button"
                  className="aera-collab-change"
                  aria-expanded={showPicker}
                  onClick={() => { setPicking(current => !current) }}
                >
                  {showPicker ? t('closePicker') : t('changeWorkOrder')}
                </button>
                <button
                  type="button"
                  className="aera-collab-open"
                  disabled={busy}
                  onClick={() => { onOpenWindow(workOrderId) }}
                >
                  {busy ? t('openingCollab') : t('openInWindow')}
                </button>
              </div>
            </header>
          )}

      {openFailed ? <p className="aera-collab-error" role="alert">{t('openCollabError')}</p> : null}

      {/*
        * D3: the picker REPLACES the surface. Showing both stacked put the
        * picker below a surface tall enough that "Choose a different Work
        * Order" looked inert.
        */}
      {showPicker
        ? <AeraCollabPicker api={api} t={t} onChoose={onChoose} />
        : <AeraCollabWorkspace api={api} workOrderId={workOrderId} t={t} />}
    </section>
  )
}
