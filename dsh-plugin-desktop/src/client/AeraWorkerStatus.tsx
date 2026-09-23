/**
 * Minimal governed-worker card — WO-AERA-CODE-CLAUDE-CODE-GOVERNED-WORKER-INTEGRATION-001 §15.
 *
 * Shows: worker/provider identity, local-subscription auth status, model
 * identity where the CLI exposed it, running/waiting/failed/cancelled, the
 * current Worker Epoch, the owner's authority envelope and the governed state
 * of recent effects. Owner actions: start/cancel an Epoch, grant/revoke
 * effect classes on a Working Line. No shell redesign, no provider picker.
 */
import { useCallback, useEffect, useState } from 'react'
import type { AeraWorkerApi, WorkerStatusView } from './aera-worker-api.ts'
import type { AeraCollabLocaleKey } from './aera-collab-locales.ts'

type Translate = (key: AeraCollabLocaleKey) => string

/** Classes offered in the grant form. exec.shell / package / network / deploy / external are deliberately absent. */
export const GRANTABLE_CLASSES = ['context.read', 'fs.read', 'git.read', 'fs.write', 'exec.test', 'exec.build', 'git.commit', 'checkpoint'] as const

export function AeraWorkerStatus({ api, workOrderId, lines, t, initialStatus }: {
  readonly api: AeraWorkerApi
  readonly workOrderId: string
  readonly lines: readonly { readonly codeWorkingLineId: string, readonly label: string }[]
  readonly t: Translate
  /** For static rendering and tests; otherwise read on mount. */
  readonly initialStatus?: WorkerStatusView
}) {
  const [status, setStatus] = useState<WorkerStatusView | undefined>(initialStatus)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [lineId, setLineId] = useState(lines[0]?.codeWorkingLineId ?? '')
  const [task, setTask] = useState('')
  const [classes, setClasses] = useState<readonly string[]>(['context.read', 'fs.read', 'git.read'])

  const read = useCallback(async () => {
    try {
      setStatus(await api.status(workOrderId))
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [api, workOrderId])

  useEffect(() => { if (initialStatus === undefined) void read() }, [read, initialStatus])
  const live = status?.liveState !== undefined && status.liveState !== 'IDLE'
  useEffect(() => {
    if (!live) return undefined
    const timer = setInterval(() => { void read() }, 2_000)
    return () => { clearInterval(timer) }
  }, [live, read])

  const act = (request: Record<string, unknown>): void => {
    setBusy(true)
    api.action({ workOrderId, ...request })
      .then(() => { setError(undefined) }, (cause: unknown) => { setError(cause instanceof Error ? cause.message : String(cause)) })
      .finally(() => { setBusy(false); void read() })
  }

  if (status?.unavailableReason !== undefined) {
    return (
      <section className="aera-worker" aria-label={t('workerTitle')}>
        <h3>{t('workerTitle')}</h3>
        <p className="aera-worker-unavailable">{status.unavailableReason}</p>
      </section>
    )
  }
  return (
    <section className="aera-worker" aria-label={t('workerTitle')}>
      <h3>{t('workerTitle')}</h3>
      {status === undefined
        ? <p className="aera-collab-status">{error ?? t('loading')}</p>
        : (
            <>
              <dl className="aera-worker-identity">
                <dt>{t('workerProvider')}</dt><dd>{status.provider ?? '—'}</dd>
                <dt>{t('workerAuth')}</dt><dd>{status.authClass ?? t('workerNotYetObserved')}</dd>
                <dt>{t('workerModel')}</dt><dd>{status.modelReported ?? t('workerNotYetObserved')}</dd>
                <dt>{t('workerEnvironment')}</dt><dd>{status.environmentId ?? '—'}</dd>
                <dt>{t('workerState')}</dt><dd data-state={status.liveState}>{status.liveState ?? 'IDLE'}</dd>
                <dt>{t('workerEpoch')}</dt>
                <dd>
                  {status.currentEpoch === undefined
                    ? (status.lastTerminal === undefined
                        ? t('workerNoEpochs')
                        : `#${String(status.lastTerminal.sequence)} ${status.lastTerminal.terminalStatus ?? ''}`)
                    : `#${String(status.currentEpoch.sequence)} ${status.currentEpoch.epochId}`}
                </dd>
              </dl>
              {status.lastTerminal?.terminalReason === undefined || status.currentEpoch !== undefined
                ? null
                : <p className="aera-worker-terminal">{status.lastTerminal.terminalReason}</p>}
              <h4>{t('workerAuthority')}</h4>
              {status.authorityEnvelope.length === 0
                ? <p>{t('workerNoAuthority')}</p>
                : (
                    <ul className="aera-worker-authority">
                      {status.authorityEnvelope.map(row => (
                        <li key={`${row.decisionId}:${row.grant}`}>
                          <code>{row.grant}</code>
                          <button type="button" disabled={busy} onClick={() => { act({ action: 'REVOKE', decisionId: row.decisionId }) }}>{t('workerRevoke')}</button>
                        </li>
                      ))}
                    </ul>
                  )}
              <h4>{t('workerEffects')}</h4>
              {status.recentEffects.length === 0
                ? <p>{t('workerNoEffects')}</p>
                : (
                    <ul className="aera-worker-effects">
                      {status.recentEffects.map((row, index) => <li key={index} data-outcome={row.outcome}>{row.subject}</li>)}
                    </ul>
                  )}
            </>
          )}
      <form
        className="aera-worker-controls"
        onSubmit={(event) => { event.preventDefault() }}
      >
        <label>
          {t('workerLine')}
          <select value={lineId} onChange={(event) => { setLineId(event.target.value) }}>
            {lines.map(line => <option key={line.codeWorkingLineId} value={line.codeWorkingLineId}>{line.label}</option>)}
          </select>
        </label>
        <fieldset>
          <legend>{t('workerGrant')}</legend>
          {GRANTABLE_CLASSES.map(effectClass => (
            <label key={effectClass}>
              <input
                type="checkbox"
                checked={classes.includes(effectClass)}
                onChange={(event) => {
                  setClasses(event.target.checked ? [...classes, effectClass] : classes.filter(entry => entry !== effectClass))
                }}
              />
              {effectClass}
            </label>
          ))}
          <button type="button" disabled={busy || lineId === '' || classes.length === 0} onClick={() => { act({ action: 'GRANT', codeWorkingLineId: lineId, classes }) }}>{t('workerGrant')}</button>
        </fieldset>
        <label>
          {t('workerTask')}
          <textarea value={task} onChange={(event) => { setTask(event.target.value) }} rows={3} />
        </label>
        {live
          ? <button type="button" disabled={busy} onClick={() => { act({ action: 'CANCEL' }) }}>{t('workerCancel')}</button>
          : <button type="button" disabled={busy || lineId === '' || task.trim() === ''} onClick={() => { act({ action: 'START_EPOCH', codeWorkingLineId: lineId, task }) }}>{t('workerStart')}</button>}
      </form>
      {error === undefined || status === undefined ? null : <p className="aera-rail-error">{error}</p>}
    </section>
  )
}
