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

type Translate = (key: AeraCollabLocaleKey) => string

export type CollabMode = 'COLLABORATE' | 'RECORD'

export function AeraCollabWorkspace({ api, workOrderId, t, initialMode = 'COLLABORATE' }: {
  readonly api: Pick<AeraCollabApi, 'view' | 'coordinate' | 'packetState'>
  readonly workOrderId: string
  readonly t: Translate
  readonly initialMode?: CollabMode
}) {
  const [mode, setMode] = useState<CollabMode>(initialMode)
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
            <>
              {/*
                * §11 needs a comparison in hand before it can share one. This
                * is the only place that asks for one, and only on request.
                */}
              {(() => {
                /*
                 * Which line can actually be compared.
                 *
                 * This used to be `lines.length > 0` and `setCompareLineIndex(0)`,
                 * which is wrong twice. Compare is only ever available for the
                 * line OBSERVED from this checkout — the service refuses a
                 * durable Working Line outright, because it cannot observe that
                 * line's checkout — so index 0 could ask for a comparison that
                 * can never be computed. And gating on `lines.length` meant that
                 * on a Work Order with no observable checkout the reader was
                 * shown nothing at all: no button, no reason. The composer now
                 * always carries the share affordance and says why it is
                 * unavailable (§21, §30); this offers the preparation step only
                 * where there is genuinely something to prepare.
                 */
                if (surface.compare !== undefined) return null
                const observed = surface.lines.findIndex(
                  line => line.provenance === 'OBSERVED' && line.compareAvailable,
                )
                if (observed < 0) return null
                return (
                  <button
                    type="button"
                    className="aera-collab-prepare-state"
                    onClick={() => { setCompareLineIndex(observed) }}
                  >
                    {t('prepareCurrentState')}
                  </button>
                )
              })()}
              <AeraCollabRail
                surface={surface}
                api={api}
                t={t}
                onChanged={() => { void read(compareLineIndex) }}
                {...(compareLineIndex === undefined ? {} : { compareLineIndex })}
              />
            </>
          )
        : <AeraCollabRecord surface={surface} t={t} />}
    </>,
  )
}
