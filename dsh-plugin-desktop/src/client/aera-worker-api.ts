/**
 * Same-origin browser client for the governed worker surface —
 * WO-AERA-CODE-CLAUDE-CODE-GOVERNED-WORKER-INTEGRATION-001 §15.
 *
 * Every response is validated into a bounded shape before React sees it; a
 * malformed response is refused rather than rendered.
 */

const STATUS_PATH = '/desktop/aera/worker/status'
const ACTION_PATH = '/desktop/aera/worker/action'
const MAX_TEXT = 4_096
const MAX_ROWS = 50

export interface WorkerEpochSummaryView {
  readonly epochId: string
  readonly sequence: number
  readonly cliVersion?: string
  readonly terminalStatus?: string
  readonly terminalReason?: string
}

export interface WorkerInstallationKeyStatusView {
  readonly status: 'NOT_ENROLLED' | 'ENROLLED' | 'UNAVAILABLE'
  readonly scope: 'PRODUCTION' | 'DEV' | 'NONE'
  readonly installationKeyId?: string
  readonly x?: string
  readonly publicJwkSha256?: string
  readonly publicHandOverPath?: string
  readonly reason?: string
}

export interface WorkerLocalEffectStatusView {
  readonly state: string
  readonly reason?: string
  readonly lastRefusal?: string
  readonly workerEpochId?: string
  readonly publicEpochPath?: string
  readonly sessionExpiresAt?: string
}

export interface WorkerStatusView {
  readonly workOrderId: string
  readonly installationKey?: WorkerInstallationKeyStatusView
  readonly localEffect?: WorkerLocalEffectStatusView
  readonly unavailableReason?: string
  readonly provider?: string
  readonly environmentId?: string
  readonly liveState?: string
  readonly authClass?: string
  readonly modelReported?: string
  readonly epochCount: number
  readonly currentEpoch?: WorkerEpochSummaryView
  readonly lastTerminal?: WorkerEpochSummaryView
  readonly authorityEnvelope: readonly { readonly decisionId: string, readonly grant: string }[]
  readonly recentEffects: readonly { readonly subject: string, readonly outcome?: string }[]
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > MAX_TEXT) throw new Error(`dsh-plugin-desktop: invalid ${label} in worker status`)
  return value
}
const optional = (value: unknown, label: string): string | undefined => value === undefined ? undefined : text(value, label)

function epoch(value: unknown): WorkerEpochSummaryView | undefined {
  if (value === undefined) return undefined
  if (!isObject(value)) throw new Error('dsh-plugin-desktop: invalid epoch in worker status')
  const runtime = isObject(value.runtime) ? value.runtime : {}
  const terminal = isObject(value.terminal) ? value.terminal : undefined
  const cliVersion = optional(runtime.cliVersion, 'cliVersion')
  const terminalStatus = terminal === undefined ? undefined : optional(terminal.status, 'terminal status')
  const terminalReason = terminal === undefined ? undefined : optional(terminal.reason, 'terminal reason')
  if (typeof value.sequence !== 'number') throw new Error('dsh-plugin-desktop: invalid epoch sequence')
  return {
    epochId: text(value.epochId, 'epochId'),
    sequence: value.sequence,
    ...(cliVersion === undefined ? {} : { cliVersion }),
    ...(terminalStatus === undefined ? {} : { terminalStatus }),
    ...(terminalReason === undefined ? {} : { terminalReason }),
  }
}

const KEY_FIELDS = ['status', 'scope', 'installationKeyId', 'x', 'publicJwkSha256', 'publicHandOverPath', 'reason']
const B64URL_43 = /^[A-Za-z0-9_-]{43}$/u

/** Public installation-key projection: an exact field allowlist, so no private member can ride along. */
function installationKey(value: unknown): WorkerInstallationKeyStatusView | undefined {
  if (value === undefined) return undefined
  if (!isObject(value) || !Object.keys(value).every(key => KEY_FIELDS.includes(key))) throw new Error('dsh-plugin-desktop: invalid installation key in worker status')
  const status = value.status
  const scope = value.scope
  if (status !== 'NOT_ENROLLED' && status !== 'ENROLLED' && status !== 'UNAVAILABLE') throw new Error('dsh-plugin-desktop: invalid installation key status')
  if (scope !== 'PRODUCTION' && scope !== 'DEV' && scope !== 'NONE') throw new Error('dsh-plugin-desktop: invalid installation key scope')
  const pattern = (field: unknown, label: string, re: RegExp): string | undefined => {
    if (field === undefined) return undefined
    if (typeof field !== 'string' || !re.test(field)) throw new Error(`dsh-plugin-desktop: invalid ${label} in worker status`)
    return field
  }
  const installationKeyId = pattern(value.installationKeyId, 'installationKeyId', B64URL_43)
  const x = pattern(value.x, 'x', B64URL_43)
  const publicJwkSha256 = pattern(value.publicJwkSha256, 'publicJwkSha256', /^[0-9a-f]{64}$/u)
  const publicHandOverPath = optional(value.publicHandOverPath, 'publicHandOverPath')
  const reason = optional(value.reason, 'reason')
  return {
    status,
    scope,
    ...(installationKeyId === undefined ? {} : { installationKeyId }),
    ...(x === undefined ? {} : { x }),
    ...(publicJwkSha256 === undefined ? {} : { publicJwkSha256 }),
    ...(publicHandOverPath === undefined ? {} : { publicHandOverPath }),
    ...(reason === undefined ? {} : { reason }),
  }
}

const LE_FIELDS = ['state', 'reason', 'lastRefusal', 'agentPrincipalId', 'aeraSessionId', 'connectionId', 'workerEpochId', 'sessionExpiresAt', 'publicEpochPath']
const CODE = /^[A-Z0-9_:]{1,120}$/u

/** Public local-effect projection (D-0c): an exact field allowlist, so no token can ride along. */
function localEffect(value: unknown): WorkerLocalEffectStatusView | undefined {
  if (value === undefined) return undefined
  if (!isObject(value) || !Object.keys(value).every(key => LE_FIELDS.includes(key))) throw new Error('dsh-plugin-desktop: invalid local-effect status')
  const code = (field: unknown, label: string): string | undefined => {
    if (field === undefined) return undefined
    if (typeof field !== 'string' || !CODE.test(field)) throw new Error(`dsh-plugin-desktop: invalid ${label} in local-effect status`)
    return field
  }
  const state = code(value.state, 'state')
  if (state === undefined) throw new Error('dsh-plugin-desktop: invalid local-effect status')
  const reason = code(value.reason, 'reason')
  const lastRefusal = code(value.lastRefusal, 'lastRefusal')
  const workerEpochId = optional(value.workerEpochId, 'workerEpochId')
  const publicEpochPath = optional(value.publicEpochPath, 'publicEpochPath')
  const sessionExpiresAt = optional(value.sessionExpiresAt, 'sessionExpiresAt')
  return {
    state,
    ...(reason === undefined ? {} : { reason }),
    ...(lastRefusal === undefined ? {} : { lastRefusal }),
    ...(workerEpochId === undefined ? {} : { workerEpochId }),
    ...(publicEpochPath === undefined ? {} : { publicEpochPath }),
    ...(sessionExpiresAt === undefined ? {} : { sessionExpiresAt }),
  }
}

/** Validate a status response. */
export function parseWorkerStatus(value: unknown): WorkerStatusView {
  if (!isObject(value)) throw new Error('dsh-plugin-desktop: invalid worker status')
  const workOrderId = text(value.workOrderId, 'workOrderId')
  const key = installationKey(value.installationKey)
  const le = localEffect(value.localEffect)
  const keyView = { ...(key === undefined ? {} : { installationKey: key }), ...(le === undefined ? {} : { localEffect: le }) }
  if (value.unavailableReason !== undefined) {
    return { workOrderId, ...keyView, unavailableReason: text(value.unavailableReason, 'unavailableReason'), epochCount: 0, authorityEnvelope: [], recentEffects: [] }
  }
  const envelope = Array.isArray(value.authorityEnvelope) ? value.authorityEnvelope.slice(0, MAX_ROWS) : []
  const effects = Array.isArray(value.recentEffects) ? value.recentEffects.slice(0, MAX_ROWS) : []
  const provider = optional(value.provider, 'provider')
  const environmentId = optional(value.environmentId, 'environmentId')
  const liveState = optional(value.liveState, 'liveState')
  const authClass = optional(value.authClass, 'authClass')
  const modelReported = optional(value.modelReported, 'modelReported')
  const currentEpoch = epoch(value.currentEpoch)
  const lastTerminal = epoch(value.lastTerminal)
  return {
    workOrderId,
    ...keyView,
    ...(provider === undefined ? {} : { provider }),
    ...(environmentId === undefined ? {} : { environmentId }),
    ...(liveState === undefined ? {} : { liveState }),
    ...(authClass === undefined ? {} : { authClass }),
    ...(modelReported === undefined ? {} : { modelReported }),
    epochCount: typeof value.epochCount === 'number' ? value.epochCount : 0,
    ...(currentEpoch === undefined ? {} : { currentEpoch }),
    ...(lastTerminal === undefined ? {} : { lastTerminal }),
    authorityEnvelope: envelope.map(row => {
      if (!isObject(row)) throw new Error('dsh-plugin-desktop: invalid authority row')
      return { decisionId: text(row.decisionId, 'decisionId'), grant: text(row.grant, 'grant') }
    }),
    recentEffects: effects.map(row => {
      if (!isObject(row)) throw new Error('dsh-plugin-desktop: invalid effect row')
      const outcome = optional(row.outcome, 'outcome')
      return { subject: text(row.subject, 'subject'), ...(outcome === undefined ? {} : { outcome }) }
    }),
  }
}

export interface AeraWorkerApi {
  status(workOrderId: string): Promise<WorkerStatusView>
  action(request: Record<string, unknown>): Promise<unknown>
}

export function createAeraWorkerApi(fetcher: FetchLike = globalThis.fetch.bind(globalThis)): AeraWorkerApi {
  return Object.freeze({
    async status(workOrderId: string) {
      const response = await fetcher(`${STATUS_PATH}?workOrderId=${encodeURIComponent(workOrderId)}`, {
        method: 'GET', credentials: 'same-origin', redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json' },
      })
      if (!response.ok) throw new Error(`Worker status unavailable (${String(response.status)})`)
      return parseWorkerStatus(await response.json() as unknown)
    },
    async action(request: Record<string, unknown>) {
      const response = await fetcher(ACTION_PATH, {
        method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
      const body = await response.json() as unknown
      if (!response.ok) {
        const message = isObject(body) && typeof body.message === 'string' ? body.message : `Worker action refused (${String(response.status)})`
        throw new Error(message)
      }
      return body
    },
  })
}
