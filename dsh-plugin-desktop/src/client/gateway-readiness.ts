/** Truthful composer readiness for the governed Aera Code Gateway profile. */

import { AERA_GATEWAY_READINESS_PATH } from '../aera-gateway-readiness-contract.ts'

export interface CurrentSessionSource {
  getSnapshot(): { readonly sessionId: string | undefined }
  subscribe(listener: () => void): () => void
}

interface ComposerBlockSink {
  set(sessionId: string, block: { readonly reason: string } | undefined): void
}

interface InstallOptions {
  readonly current: CurrentSessionSource
  readonly blocks: ComposerBlockSink
  readonly fetch?: typeof fetch
  readonly origin?: string
  readonly pollMs?: number
  readonly maxPolls?: number
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A fresh Session is inert until the Desktop Host confirms the real Gateway
 * bootstrap. A missing Host route means this is not the governed profile and
 * leaves the ordinary DSH composer unchanged.
 */
export function installAeraGatewayReadinessClient(options: InstallOptions): () => void {
  const fetchImpl = options.fetch ?? fetch
  const origin = options.origin ?? window.location.origin
  const pollMs = options.pollMs ?? 100
  const maxPolls = options.maxPolls ?? 50
  let generation = 0
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const refresh = async (sessionId: string, currentGeneration: number, attempt = 0): Promise<void> => {
    try {
      const response = await fetchImpl(
        `${origin}${AERA_GATEWAY_READINESS_PATH}?session_id=${encodeURIComponent(sessionId)}`,
        { method: 'GET', headers: { accept: 'application/json' } },
      )
      if (disposed || currentGeneration !== generation) return
      if (response.status === 404) {
        options.blocks.set(sessionId, undefined)
        return
      }
      if (!response.ok) throw new Error(`HTTP_${String(response.status)}`)
      const status: unknown = await response.json()
      if (!record(status) || typeof status.state !== 'string') throw new Error('INVALID_STATUS')
      if (status.state === 'READY') {
        options.blocks.set(sessionId, undefined)
        return
      }
      if (status.state === 'BLOCKED') {
        options.blocks.set(sessionId, {
          reason: typeof status.message === 'string'
            ? status.message
            : 'Aera Gateway execution is unavailable for this Session.',
        })
        return
      }
      if (status.state === 'CHECKING' && attempt < maxPolls) {
        timer = setTimeout(() => { void refresh(sessionId, currentGeneration, attempt + 1) }, pollMs)
        return
      }
      throw new Error('READINESS_TIMEOUT')
    } catch {
      if (!disposed && currentGeneration === generation) {
        options.blocks.set(sessionId, {
          reason: 'Aera Gateway readiness could not be verified for this Session.',
        })
      }
    }
  }

  const reconcile = (): void => {
    generation += 1
    if (timer) clearTimeout(timer)
    const sessionId = options.current.getSnapshot().sessionId
    if (!sessionId) return
    options.blocks.set(sessionId, { reason: 'Checking Aera Gateway authority for this Session…' })
    void refresh(sessionId, generation)
  }

  const unsubscribe = options.current.subscribe(reconcile)
  reconcile()
  return () => {
    disposed = true
    generation += 1
    if (timer) clearTimeout(timer)
    const sessionId = options.current.getSnapshot().sessionId
    if (sessionId) options.blocks.set(sessionId, undefined)
    unsubscribe()
  }
}
