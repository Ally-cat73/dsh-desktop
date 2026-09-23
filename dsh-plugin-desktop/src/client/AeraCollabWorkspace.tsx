/**
 * The Collab workspace: one substrate, two human projections, one switch.
 *
 * §22–§25 of the superseding order. `Collaborate` is the messaging rail;
 * `Record` is the institutional history. They are separate component trees
 * (`AeraCollabRail` / `AeraCollabRecord`) rather than one tree with sections
 * toggled, because §24 rejects exactly that: "Do NOT simply hide/show the same
 * components between Collaborate and Record."
 *
 * Both render from ONE `CollabSurfaceView` fetched once by this component
 * (§48) — one canonical substrate, one read, no shadow store and no second
 * fetch that could disagree with the first.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { AeraCollabApi, CollabSurfaceView } from './aera-collab-api.ts'
import type { AeraCollabLocaleKey } from './aera-collab-locales.ts'
import { AeraCollabRail } from './AeraCollabRail.tsx'
import { AeraCollabRecord } from './AeraCollabRecord.tsx'
import { AeraWorkerStatus } from './AeraWorkerStatus.tsx'
import type { AeraWorkerApi } from './aera-worker-api.ts'

type Translate = (key: AeraCollabLocaleKey) => string

export type CollabMode = 'COLLABORATE' | 'RECORD'

export function AeraCollabWorkspace({ api, workOrderId, t, initialMode = 'COLLABORATE', mode: controlledMode, onModeChange, workerApi }: {
  readonly api: Pick<AeraCollabApi, 'view' | 'coordinate' | 'packetState'>
  /** Governed worker surface (§15 of the Claude worker order). Absent = not shown. */
  readonly workerApi?: AeraWorkerApi
  readonly workOrderId: string
  readonly t: Translate
  readonly initialMode?: CollabMode
  /**
   * Which projection to show, when the container wants to own it.
   *
   * The drawer does, so that closing on Record and reopening returns to
   * Record. Held uncontrolled otherwise, which is what the tests use.
   */
  readonly mode?: CollabMode
  readonly onModeChange?: (next: CollabMode) => void
}) {
  const [uncontrolledMode, setUncontrolledMode] = useState<CollabMode>(initialMode)
  const mode = controlledMode ?? uncontrolledMode
  const setMode = (next: CollabMode): void => {
    setUncontrolledMode(next)
    onModeChange?.(next)
  }
  const [surface, setSurface] = useState<CollabSurfaceView>()
  const [unavailable, setUnavailable] = useState<string>()
  const [loading, setLoading] = useState(true)
  /*
   * Compare is a runtime observation of a checkout, and it is expensive. The
   * rail asks for it only when the reader is about to share state, so opening
   * a conversation never pays for a diff nobody asked to see (§41).
   */
  const [compareLineIndex, setCompareLineIndex] = useState<number>()

  const read = useCallback(async (withCompare?: number) => {
    setLoading(true)
    try {
      const result = await api.view({
        workOrderId,
        ...(withCompare === undefined ? {} : { compareLineIndex: withCompare }),
      })
      if ('unavailableReason' in result && !('workOrderId' in result)) {
        setUnavailable(result.unavailableReason)
        setSurface(undefined)
        return
      }
      setSurface(result as CollabSurfaceView)
      setUnavailable(undefined)
    } catch (cause) {
      setUnavailable(cause instanceof Error ? cause.message : String(cause))
      setSurface(undefined)
    } finally {
      setLoading(false)
    }
  }, [api, workOrderId])

  useEffect(() => { void read(compareLineIndex) }, [read, compareLineIndex])

  /*
   * The mode switch is part of the frame, not part of the data. It renders
   * while the read is in flight and while the read has failed, so a reader who
   * opened Record does not lose the control that got them there the moment a
   * projection is slow or unavailable.
   */
  const frame = (body: ReactNode) => (
    <div className="aera-collab-workspace">
      <div className="aera-collab-mode" role="tablist" aria-label={t('coordination')}>
        {(['COLLABORATE', 'RECORD'] as const).map(candidate => (
          <button
            key={candidate}
            type="button"
            role="tab"
            aria-selected={mode === candidate}
            className={mode === candidate ? 'aera-collab-mode-tab aera-collab-mode-tab-on' : 'aera-collab-mode-tab'}
            onClick={() => { setMode(candidate) }}
          >
            {candidate === 'COLLABORATE' ? t('viewCollaborate') : t('viewRecord')}
          </button>
        ))}
      </div>
      {body}
    </div>
  )

  if (unavailable !== undefined) return frame(<p className="aera-collab-status">{unavailable}</p>)
  if (surface === undefined) {
    return frame(<p className="aera-collab-status">{loading ? t('loading') : t('unavailable')}</p>)
  }

  return frame(
    <>
      {mode === 'COLLABORATE'
        ? (
            <AeraCollabRail
                surface={surface}
                api={api}
                t={t}
                onChanged={() => { void read(compareLineIndex) }}
                capturing={loading && compareLineIndex !== undefined}
                onCaptureState={() => {
                  /*
                   * §22 — capturing is part of the share action now, not a
                   * separate button the reader has to know to press first.
                   * The index is the OBSERVED, comparable line; a durable
                   * Working Line cannot be compared from here, and index 0 is
                   * not reliably the right row.
                   */
                  const index = surface.lines.findIndex(
                    line => line.provenance === 'OBSERVED' && line.compareAvailable,
                  )
                  if (index >= 0) setCompareLineIndex(index)
                }}
              {...(compareLineIndex === undefined ? {} : { compareLineIndex })}
            />
          )
        : <AeraCollabRecord surface={surface} t={t} />}
      {workerApi === undefined || mode !== 'COLLABORATE'
        ? null
        : (
            <AeraWorkerStatus
              api={workerApi}
              workOrderId={workOrderId}
              t={t}
              lines={surface.lines.flatMap(line => line.codeWorkingLineId === undefined ? [] : [{ codeWorkingLineId: line.codeWorkingLineId, label: line.label }])}
            />
          )}
    </>,
  )
}
