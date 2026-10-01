/**
 * D-0c test fixtures: a Router-shaped local-effect listener (relay gate + CIS
 * Epoch semantics + the model-invocation attest route), served in-process over
 * TLS 1.3 from PKI GENERATED IN THE TEST (never a real certificate), and a
 * test custody holding a generated Ed25519 key (never the Keychain).
 *
 * The semantics copied here are the as-built product ones (cr40-cas-seam @
 * 25fadd1e): relay `localEffectAgentRelay.ts` (registry gate, `{refusal}`),
 * CIS `agent-credentials.ts` (begin supersedes, continue keeps the id),
 * attest `modelInvocationAttest.ts` (`{error, reason?}`, 409 replay).
 */
import { execFileSync } from 'node:child_process'
import { generateKeyPairSync, randomBytes, randomUUID, sign, verify, type KeyObject } from 'node:crypto'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TLSSocket } from 'node:tls'
import {
  canonicalAgentCredentialProofBytes,
  issueAeraWorkerEpochId,
  type AgentCredentialProofPayload,
  type AgentSenderProofClaims,
} from '@aera/cis-contracts'
import { attemptBodyDigest, createAgentSenderProof, sha256Ref, MODEL_INVOCATION_ATTEST_ROUTE } from '@aera/local-effect-admission'
/* Literal copies of sentinel-contracts brokerCarry.ts:102-110 (the vendored barrel's extensionless re-exports are not typable here). */
const LOCAL_EFFECT_CHANNEL_BINDING_HEADER = 'aera-local-effect-channel-binding'
const localEffectChannelBinding = (socket: TLSSocket): string =>
  socket.exportKeyingMaterial(32, 'EXPORTER-aera-local-effect-channel-binding/v1', Buffer.alloc(0)).toString('hex')
import { installationKeyThumbprint } from '../src/aera-worker-installation-key.ts'

export const ROUTER_SAN = 'spiffe://aera.local/workload/aera-router'
export const CIS_ISSUER = 'https://cis.test.aera.invalid'
export const RELAY = Object.freeze({
  challenge: '/v1/local-effects/agents/challenges',
  begin: '/v1/local-effects/agents/epochs',
  continue: '/v1/local-effects/agents/epochs/continue',
})

/* ------------------------------------------------------------------ PKI */

export interface Pki { readonly dir: string, readonly caA: string, readonly caB: string, readonly leafA: { cert: Buffer, key: Buffer }, readonly leafB: { cert: Buffer, key: Buffer }, readonly rogueA: { cert: Buffer, key: Buffer } }

export function generatePki(): Pki {
  const dir = mkdtempSync(join(tmpdir(), 'd0c-pki-'))
  const openssl = (args: string[]): void => { execFileSync('/usr/bin/openssl', args, { stdio: ['ignore', 'ignore', 'pipe'] }) }
  const ca = (name: string): string => {
    const key = join(dir, `${name}.key`)
    const crt = join(dir, `${name}.crt`)
    const cnf = join(dir, `${name}.cnf`)
    writeFileSync(cnf, ['[req]', 'distinguished_name=dn', 'x509_extensions=v3', 'prompt=no', '[dn]', `CN=${name}`, '[v3]', 'basicConstraints=critical,CA:TRUE', 'keyUsage=critical,keyCertSign,cRLSign'].join('\n'))
    openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt, '-days', '2', '-config', cnf])
    chmodSync(key, 0o600)
    return crt
  }
  const leaf = (name: string, issuer: string, san: string): { cert: Buffer, key: Buffer } => {
    const key = join(dir, `${name}.key`)
    const csr = join(dir, `${name}.csr`)
    const crt = join(dir, `${name}.crt`)
    const ext = join(dir, `${name}.ext`)
    openssl(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', csr, '-subj', `/CN=${name}`])
    chmodSync(key, 0o600)
    writeFileSync(ext, [`subjectAltName=${san}`, 'basicConstraints=critical,CA:FALSE', 'keyUsage=critical,digitalSignature,keyEncipherment', 'extendedKeyUsage=serverAuth'].join('\n'))
    openssl(['x509', '-req', '-in', csr, '-CA', issuer, '-CAkey', issuer.replace(/\.crt$/u, '.key'), '-CAcreateserial', '-out', crt, '-days', '2', '-extfile', ext])
    return { cert: readFileSync(crt), key: readFileSync(key) }
  }
  const caA = ca('ca-a')
  const caB = ca('ca-b')
  return {
    dir,
    caA,
    caB,
    leafA: leaf('router-a', caA, `URI:${ROUTER_SAN},IP:127.0.0.1`),
    leafB: leaf('router-b', caB, `URI:${ROUTER_SAN},IP:127.0.0.1`),
    rogueA: leaf('rogue-a', caA, 'URI:spiffe://aera.local/workload/rogue,IP:127.0.0.1'),
  }
}

/* ------------------------------------------------------------- test custody */

export interface TestCustody {
  readonly installationKeyId: string
  readonly publicKey: KeyObject
  enrolled: boolean
  readonly port: {
    view(): { status: 'ENROLLED' | 'NOT_ENROLLED' | 'UNAVAILABLE', scope: 'DEV' }
    assertInstallationKeyId(expected: string): void
    senderProof(claims: AgentSenderProofClaims): string
    signAgentCredentialProof(payload: AgentCredentialProofPayload): string
  }
}

export function testCustody(): TestCustody {
  const pair = generateKeyPairSync('ed25519')
  const x = (pair.publicKey.export({ format: 'jwk' }) as { x: string }).x
  const id = installationKeyThumbprint({ kty: 'OKP', crv: 'Ed25519', x })
  const refuse = (code: string): never => { throw Object.assign(new Error(`Worker installation key: ${code}`), { code }) }
  const custody: TestCustody = {
    installationKeyId: id,
    publicKey: pair.publicKey,
    enrolled: true,
    port: {
      view: () => ({ status: custody.enrolled ? 'ENROLLED' : 'NOT_ENROLLED', scope: 'DEV' }),
      assertInstallationKeyId: (expected) => { if (!custody.enrolled) refuse('NOT_ENROLLED'); if (expected !== id) refuse('KEY_ID_MISMATCH') },
      senderProof: (claims) => { if (claims.installationKeyId !== id) refuse('KEY_ID_MISMATCH'); return createAgentSenderProof({ privateKey: pair.privateKey, claims }) },
      signAgentCredentialProof: (payload) => {
        if (payload.installationKeyId !== id) refuse('KEY_ID_MISMATCH')
        return sign(null, canonicalAgentCredentialProofBytes(payload), pair.privateKey).toString('base64url')
      },
    },
  }
  return custody
}

/* -------------------------------------------------------------- fake Router */

export interface RegistryRecord { agentPrincipalId: string, currentWorkerEpochId: string, status: 'ACTIVE' | 'REVOKED' }

export interface FakeRouterState {
  registry: RegistryRecord | undefined
  registryUnavailable: boolean
  readonly epochs: Map<string, 'ACTIVE' | 'SUPERSEDED'>
  readonly sessions: Map<string, { sessionId: string, workerEpochId: string, expiresAtMs: number }>
  readonly challenges: Map<string, string>
  sessionTtlMs: number
  /** Answers with a channel binding that is not this TLS session's. */
  badBinding: boolean
  /** Continue answers with a different Epoch id (C-1 violation). */
  continueChangesEpoch: boolean
  /** A restarted Router: the next N attests are refused SENDER_PROOF_REPLAYED (horizon). */
  replayHorizon: number
  /** The next N attests answer 409 MODEL_ATTESTATION_REPLAYED. */
  forceConflict: number
  /** The next N attests answer SUBJECT_SESSION_INVALID. */
  forceSessionInvalid: number
  readonly calls: string[]
  readonly attestBodies: Record<string, unknown>[]
  readonly attestClaims: Record<string, unknown>[]
  readonly attestNonces: Set<string>
  readonly proofNonces: Set<string>
}

export interface FakeRouter { readonly url: string, readonly state: FakeRouterState, close(): void }

const json = (status: number, body: unknown) => ({ status, body })

export async function startFakeRouter(material: { cert: Buffer, key: Buffer }, ids: { principalId: string, custody: TestCustody }, shared?: FakeRouterState): Promise<FakeRouter> {
  const state: FakeRouterState = shared ?? {
    registry: undefined,
    registryUnavailable: false,
    epochs: new Map(),
    sessions: new Map(),
    challenges: new Map(),
    sessionTtlMs: 600_000,
    badBinding: false,
    continueChangesEpoch: false,
    replayHorizon: 0,
    forceConflict: 0,
    forceSessionInvalid: 0,
    calls: [],
    attestBodies: [],
    attestClaims: [],
    attestNonces: new Set(),
    proofNonces: new Set(),
  }
  const publicKey = ids.custody.publicKey

  const bound = (aeraSessionId: unknown, principalId: unknown, epoch?: unknown): 'OK' | 'UNBOUND' | 'UNAVAILABLE' => {
    if (state.registryUnavailable) return 'UNAVAILABLE'
    const record = state.registry
    if (typeof aeraSessionId !== 'string' || record === undefined || record.status !== 'ACTIVE' || record.agentPrincipalId !== principalId) return 'UNBOUND'
    if (epoch !== undefined && record.currentWorkerEpochId !== epoch) return 'UNBOUND'
    return 'OK'
  }
  const gateRefusal = (gate: 'UNBOUND' | 'UNAVAILABLE') => gate === 'UNAVAILABLE'
    ? json(503, { refusal: 'EXECUTION_REGISTRY_UNAVAILABLE' })
    : json(403, { refusal: 'AGENT_NOT_BOUND_TO_SESSION' })

  const mint = (workerEpochId: string) => {
    const token = `tok.${randomBytes(24).toString('base64url')}`
    const sessionId = `aera:session:${randomUUID()}`
    const expiresAtMs = Date.now() + state.sessionTtlMs
    state.sessions.set(token, { sessionId, workerEpochId, expiresAtMs })
    return { token, sessionId, expiresAt: new Date(expiresAtMs).toISOString(), signingKeyId: 'cis-key-1' }
  }

  const handle = (path: string, body: Record<string, unknown>): { status: number, body: unknown } => {
    switch (path) {
      case RELAY.challenge: {
        const gate = bound(body.aeraSessionId, body.principalId)
        if (gate !== 'OK') return gateRefusal(gate)
        const challengeId = randomUUID()
        const nonce = randomBytes(32).toString('base64url')
        state.challenges.set(challengeId, nonce)
        return json(200, { challengeId, nonce, audience: CIS_ISSUER, expiresAt: new Date(Date.now() + 60_000).toISOString() })
      }
      case RELAY.begin:
      case RELAY.continue: {
        const continuing = path === RELAY.continue
        const gate = bound(body.aeraSessionId, body.principalId, continuing ? body.workerEpochId : undefined)
        if (gate !== 'OK') return gateRefusal(gate)
        const nonce = state.challenges.get(String(body.challengeId))
        state.challenges.delete(String(body.challengeId))
        if (nonce === undefined || body.installationKeyId !== ids.custody.installationKeyId) return json(403, { refusal: 'PROOF_REJECTED' })
        const payload = {
          purpose: continuing ? 'aera.cis.agent.epoch.continue.v1' : 'aera.cis.agent.epoch.begin.v1',
          audience: CIS_ISSUER,
          principalId: ids.principalId,
          installationKeyId: ids.custody.installationKeyId,
          challengeId: String(body.challengeId),
          nonce,
          ...(continuing ? { workerEpochId: body.workerEpochId } : {}),
        } as AgentCredentialProofPayload
        if (!verify(null, canonicalAgentCredentialProofBytes(payload), publicKey, Buffer.from(String(body.signature), 'base64url'))) return json(403, { refusal: 'PROOF_REJECTED' })
        if (continuing) {
          const epoch = state.epochs.get(String(body.workerEpochId))
          if (epoch === undefined) return json(404, { refusal: 'EPOCH_NOT_FOUND' })
          if (epoch !== 'ACTIVE') return json(403, { refusal: 'EPOCH_NOT_ACTIVE' })
          const id = state.continueChangesEpoch ? issueAeraWorkerEpochId() : String(body.workerEpochId)
          return json(200, { workerEpoch: { workerEpochId: id, status: 'ACTIVE' }, session: mint(id), revokedSessionIds: [] })
        }
        for (const [id, status] of state.epochs) if (status === 'ACTIVE') state.epochs.set(id, 'SUPERSEDED')
        const id = issueAeraWorkerEpochId()
        state.epochs.set(id, 'ACTIVE')
        return json(200, { workerEpoch: { workerEpochId: id, status: 'ACTIVE' }, session: mint(id), revokedSessionIds: [] })
      }
      case MODEL_INVOCATION_ATTEST_ROUTE: {
        state.attestBodies.push(body)
        const token = String(body.agentSessionToken)
        const session = state.sessions.get(token)
        if (session === undefined || session.expiresAtMs <= Date.now() || state.forceSessionInvalid > 0) {
          if (state.forceSessionInvalid > 0) state.forceSessionInvalid -= 1
          return json(403, { error: 'SUBJECT_SESSION_INVALID' })
        }
        if (state.registry === undefined || state.registry.status !== 'ACTIVE') return json(403, { error: 'EXECUTION_BINDING_NOT_ACTIVE' })
        if (state.registry.currentWorkerEpochId !== session.workerEpochId) return json(403, { error: 'WORKER_EPOCH_MISMATCH' })
        const [h, p, s] = String(body.senderProof).split('.')
        if (h === undefined || p === undefined || s === undefined || !verify(null, Buffer.from(`${h}.${p}`, 'ascii'), publicKey, Buffer.from(s, 'base64url'))) return json(403, { error: 'SENDER_PROOF_INVALID' })
        const claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as Record<string, unknown>
        state.attestClaims.push(claims)
        if (claims.audience !== ROUTER_SAN || claims.route !== MODEL_INVOCATION_ATTEST_ROUTE || claims.method !== 'POST'
          || claims.bodyDigest !== attemptBodyDigest(body) || claims.sessionId !== session.sessionId
          || claims.sessionTokenDigest !== sha256Ref(token) || claims.workerEpochId !== session.workerEpochId
          || claims.installationKeyId !== ids.custody.installationKeyId) return json(403, { error: 'SENDER_PROOF_INVALID' })
        if (state.replayHorizon > 0) { state.replayHorizon -= 1; return json(403, { error: 'SENDER_PROOF_REPLAYED' }) }
        if (state.proofNonces.has(String(claims.nonce))) return json(403, { error: 'SENDER_PROOF_REPLAYED' })
        state.proofNonces.add(String(claims.nonce))
        if (state.forceConflict > 0 || state.attestNonces.has(String(body.nonce))) {
          if (state.forceConflict > 0) state.forceConflict -= 1
          return json(409, { error: 'MODEL_ATTESTATION_REPLAYED' })
        }
        state.attestNonces.add(String(body.nonce))
        return json(200, { status: 'ATTESTED', casReceiptId: `cas-receipt-${String(state.attestNonces.size)}`, notAfter: new Date(Date.now() + 120_000).toISOString() })
      }
      default:
        return json(404, { error: 'NO_SUCH_ROUTE' })
    }
  }

  const server: Server = createServer({ ...material, minVersion: 'TLSv1.3' }, (req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const path = req.url ?? '/'
      state.calls.push(path)
      let body: Record<string, unknown> = {}
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> } catch { /* malformed → handler refuses */ }
      const answer = handle(path, body)
      res.setHeader(LOCAL_EFFECT_CHANNEL_BINDING_HEADER, state.badBinding ? 'ab'.repeat(32) : localEffectChannelBinding(req.socket as TLSSocket))
      res.writeHead(answer.status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(answer.body))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return { url: `https://127.0.0.1:${String(port)}/`, state, close: () => { server.close() } }
}

/** The operator's DP-9 writes (C-7): a pending record before begin, the begun Epoch after. */
export function operatorWritePending(state: FakeRouterState, principalId: string): void {
  state.registry = { agentPrincipalId: principalId, currentWorkerEpochId: 'aera:worker_epoch:pending', status: 'ACTIVE' }
}
export function operatorWriteEpoch(state: FakeRouterState, principalId: string, workerEpochId: string): void {
  state.registry = { agentPrincipalId: principalId, currentWorkerEpochId: workerEpochId, status: 'ACTIVE' }
}
