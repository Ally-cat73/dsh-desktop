/**
 * The governed effect boundary end to end (§10) and the §11 NATIVE BYPASS
 * adversarial suite — WO-AERA-CODE-CLAUDE-CODE-GOVERNED-WORKER-INTEGRATION-001.
 *
 * Real disposable ParticipationStore, real git worktree, the real host driving
 * the deterministic fake CLI. Every "no effect" claim is checked against the
 * filesystem and git, not only against the returned outcome.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ParticipationStore } from '@aera/participation-runtime'
import { ClaudeCodeWorkerAdapter } from '../src/aera-claude-worker-host.ts'
import { DEFAULT_WORKER_EPOCH_LIMITS, type WorkerLiveEvent } from '../src/aera-worker-adapter.ts'
import {
  LocalExecutionPolicyGate,
  gateFromProtectedExecutor,
  type SentinelGate,
} from '../src/aera-worker-effect-broker.ts'
import { AeraWorkerSessionManager } from '../src/aera-worker-session.ts'
import type { WorkerGrant } from '../src/aera-worker-authority.ts'
import { POISONED_PARENT_ENV, git, makeFakeClaude, makeWorkerWorld, type FakeScript, type WorkerWorld } from './aera-worker-fixtures.ts'

const LIMITS = { ...DEFAULT_WORKER_EPOCH_LIMITS, turnTimeoutMs: 15_000, epochTimeoutMs: 60_000, cancelGraceMs: 300 }
/** The fake echoes digests in 8-char groups so secret masking of worker text cannot hide them. */
const sha256 = (text: string): string => (createHash('sha256').update(text).digest('hex').match(/.{8}/gu) ?? []).join('-')

async function managerFor(world: WorkerWorld, script: FakeScript, options: {
  gate?: SentinelGate
  environmentId?: string
  humanPrincipalId?: string
} = {}): Promise<AeraWorkerSessionManager> {
  const { pin } = await makeFakeClaude(script)
  return new AeraWorkerSessionManager({
    store: new ParticipationStore(world.storeDir),
    adapter: new ClaudeCodeWorkerAdapter(pin, { parentEnv: POISONED_PARENT_ENV, scratchRoot: world.scratchRoot }),
    gate: options.gate ?? new LocalExecutionPolicyGate(),
    config: {
      humanPrincipalId: options.humanPrincipalId ?? world.owner,
      delegationId: world.delegationId,
      environmentId: options.environmentId ?? 'AERA_DEV',
      limits: LIMITS,
    },
    broker: { parentEnv: POISONED_PARENT_ENV },
  })
}

function grant(manager: AeraWorkerSessionManager, world: WorkerWorld, ...grants: WorkerGrant[]) {
  return manager.grantAuthority({ workOrderId: world.workOrderId, codeWorkingLineId: world.line.codeWorkingLineId, grants })
}

async function runOnce(world: WorkerWorld, script: FakeScript, grants: WorkerGrant[], options: Parameters<typeof managerFor>[2] & { onEvent?: (event: WorkerLiveEvent, manager: AeraWorkerSessionManager) => void } = {}) {
  const manager = await managerFor(world, script, options)
  if (grants.length > 0) grant(manager, world, ...grants)
  const result = await manager.runEpoch({
    workOrderId: world.workOrderId,
    codeWorkingLineId: world.line.codeWorkingLineId,
    task: 'TEST task',
    ...(options.onEvent === undefined ? {} : { onEvent: (event: WorkerLiveEvent) => { options.onEvent?.(event, manager) } }),
  })
  return { manager, result }
}

function repoUnchanged(world: WorkerWorld, head: string): void {
  expect(git(world.repoRoot, 'rev-parse', 'HEAD')).toBe(head)
  expect(git(world.repoRoot, 'status', '--porcelain')).toBe('')
}

describe('§10 governed effect boundary — authorised effect', () => {
  it('Claude proposes → Aera authorises (owner decision) → gate → broker performs → verifier → record → observation returned', async () => {
    const world = makeWorkerWorld()
    const { manager, result } = await runOnce(world, {
      turns: [
        { text: 'first input ${INPUT_SHA}', intents: [{ intentId: 'r1', kind: 'fs.read', path: 'README.md' }, { intentId: 'w1', kind: 'fs.write', path: 'hello.txt', content: 'hello from the governed worker\n' }] },
        { text: 'second input ${INPUT_SHA}', status: 'DONE' },
      ],
    }, [{ effectClass: 'fs.read' }, { effectClass: 'fs.write' }])

    expect(result.terminal.status).toBe('COMPLETED')
    expect(result.outcomes.map(outcome => [outcome.intentId, outcome.performed, outcome.code])).toEqual([['r1', true, 'PERFORMED'], ['w1', true, 'PERFORMED']])
    expect(readFileSync(join(world.repoRoot, 'hello.txt'), 'utf8')).toBe('hello from the governed worker\n')

    const store = new ParticipationStore(world.storeDir)
    const principals = manager.principals(world.workOrderId)
    const performed = store.listTypedEvidence(world.workOrderId).filter(row => row.evidenceClass === 'EXECUTION_EVIDENCE')
    expect(performed).toHaveLength(2)
    for (const row of performed) {
      const legs = row.contribution
      expect(legs).toMatchObject({ recordedBy: principals.host, performedBy: principals.broker, authorisedBy: world.owner, verifiedBy: principals.verifier })
      expect(new Set([legs.recordedBy, legs.performedBy, legs.authorisedBy, legs.verifiedBy]).size).toBe(4)
      expect(Object.values(legs)).not.toContain(principals.worker)
      expect(row.outcome).toBe('PASS')
    }
    // The proposal is recorded separately, as analysis attributed to the worker.
    const proposals = store.listTypedEvidence(world.workOrderId).filter(row => row.subject.startsWith('Worker effect intent proposed'))
    expect(proposals).toHaveLength(2)
    expect(proposals.every(row => row.evidenceClass === 'ANALYTICAL_EVIDENCE' && row.analyticalProvenance?.producer === principals.worker)).toBe(true)
    // Sentinel-seam events carry the complete attribution tuple and say which evaluator decided.
    const gateEvents = store.listEvents().filter(event => event.eventKind === 'SENTINEL_EXECUTION' && event.workOrderId === world.workOrderId)
    expect(gateEvents).toHaveLength(2)
    expect(gateEvents.every(event => /AERA_CODE_LOCAL_EXECUTION_POLICY \(remote Sentinel: no/u.test(event.summary))).toBe(true)

    // §13: the Epoch received exactly the recorded orientation, and exactly the recorded observations.
    const turns = store.listTypedEvidence(world.workOrderId).filter(row => / turn \d output /u.test(row.subject))
    const turnText = (n: number): string => String((JSON.parse(turns[n]?.body ?? '{}') as { text?: string }).text)
    expect(turnText(0)).toContain(sha256(result.orientation))
    const context = store.listTypedEvidence(world.workOrderId).find(row => row.subject.startsWith('Worker Epoch context supplied'))
    expect(context?.body).toContain(result.orientation)
    const observationInput = `AERA OBSERVATIONS (Epoch ${result.epochId})\n${result.outcomes.map(outcome => outcome.observation).join('\n\n')}`
    expect(turnText(1)).toContain(sha256(observationInput))
    const bodies = performed.map(row => row.body)
    for (const outcome of result.outcomes) expect(bodies).toContain(outcome.observation)
  })

  it('"done" is not closure: a DONE worker leaves the Work Order ACTIVE', async () => {
    const world = makeWorkerWorld()
    await runOnce(world, { turns: [{ text: 'all done', status: 'DONE' }] }, [])
    expect(new ParticipationStore(world.storeDir).effectiveWorkOrderState(world.workOrderId)?.lifecycleState).toBe('ACTIVE')
  })

  it('a malformed intent block is recorded as a rejected proposal and performs nothing', async () => {
    const world = makeWorkerWorld()
    const head = git(world.repoRoot, 'rev-parse', 'HEAD')
    const { result } = await runOnce(world, {
      turns: [{ text: '```aera-effect-intents\n{"version":"AeraEffectIntentBatchV1","epochId":"x","status":"CONTINUE","intents":[{"intentId":"i","kind":"fs.write","codeWorkingLineId":"L","path":"x","content":"x","sudo":true}]}\n```' }, { text: 'ok', status: 'DONE' }],
    }, [{ effectClass: 'fs.write' }])
    expect(result.outcomes).toHaveLength(0)
    expect(new ParticipationStore(world.storeDir).listTypedEvidence(world.workOrderId).some(row => row.subject.startsWith('Worker intent block rejected'))).toBe(true)
    repoUnchanged(world, head)
  })

  it('only the Work Order owner can grant worker authority', async () => {
    const world = makeWorkerWorld()
    const manager = await managerFor(world, { turns: [{ text: 'x' }] }, { humanPrincipalId: 'aera:participant:00000000-0000-4000-8000-00000000dead' })
    expect(() => grant(manager, world, { effectClass: 'fs.write' })).toThrow(/Only the Work Order owner/u)
  })
})

describe('§17 authority denial and Sentinel denial', () => {
  it('authority denial: no owner grant → nothing performed, denial recorded', async () => {
    const world = makeWorkerWorld()
    const head = git(world.repoRoot, 'rev-parse', 'HEAD')
    const { result } = await runOnce(world, { turns: [{ intents: [{ intentId: 'w', kind: 'fs.write', path: 'x.txt', content: 'x' }] }, { status: 'DONE' }] }, [])
    expect(result.outcomes[0]).toMatchObject({ performed: false, stage: 'AUTHORITY', code: 'NO_GRANT' })
    expect(existsSync(join(world.repoRoot, 'x.txt'))).toBe(false)
    repoUnchanged(world, head)
    const denial = new ParticipationStore(world.storeDir).listTypedEvidence(world.workOrderId).find(row => row.subject.startsWith('Worker effect denied'))
    expect(denial?.evidenceClass).toBe('DECISION_EVIDENCE')
    expect(denial?.contribution.performedBy).toBeUndefined()
  })

  it('Sentinel denial: an authorised effect the Sentinel seam denies is never performed', async () => {
    const world = makeWorkerWorld()
    const denyingSentinel = gateFromProtectedExecutor(async () => ({ effectExecuted: false }), 'TEST_REMOTE_SENTINEL', true)
    const { result } = await runOnce(world, { turns: [{ intents: [{ intentId: 'w', kind: 'fs.write', path: 'x.txt', content: 'x' }] }, { status: 'DONE' }] }, [{ effectClass: 'fs.write' }], { gate: denyingSentinel })
    expect(result.outcomes[0]).toMatchObject({ performed: false, stage: 'SENTINEL', code: 'SENTINEL_DENIED' })
    expect(existsSync(join(world.repoRoot, 'x.txt'))).toBe(false)
    const event = new ParticipationStore(world.storeDir).listEvents().find(row => row.eventKind === 'SENTINEL_EXECUTION' && row.workOrderId === world.workOrderId)
    expect(event?.summary).toMatch(/denied by TEST_REMOTE_SENTINEL \(remote Sentinel: yes/u)
  })

  it('a Sentinel seam that throws fails CLOSED', async () => {
    const world = makeWorkerWorld()
    const broken = gateFromProtectedExecutor(async () => { throw new Error('sentinel unreachable') }, 'TEST_REMOTE_SENTINEL', true)
    const { result } = await runOnce(world, { turns: [{ intents: [{ intentId: 'w', kind: 'fs.write', path: 'x.txt', content: 'x' }] }, { status: 'DONE' }] }, [{ effectClass: 'fs.write' }], { gate: broken })
    expect(result.outcomes[0]).toMatchObject({ performed: false, code: 'SENTINEL_UNAVAILABLE' })
    expect(existsSync(join(world.repoRoot, 'x.txt'))).toBe(false)
  })
})

describe('§11 NATIVE BYPASS — adversarial regression suite', () => {
  it('direct file write: a native Write tool_use refuses the Epoch; the repository is untouched', async () => {
    const world = makeWorkerWorld()
    const head = git(world.repoRoot, 'rev-parse', 'HEAD')
    const { result } = await runOnce(world, { turns: [{ toolUse: true, text: 'writing directly' }] }, [{ effectClass: 'fs.write' }])
    expect(result.terminal.status).toBe('GUARD_REFUSED')
    expect(result.outcomes).toHaveLength(0)
    repoUnchanged(world, head)
  })

  it('direct file write into the worker cwd is detected as a native effect', async () => {
    const world = makeWorkerWorld()
    const { result } = await runOnce(world, { turns: [{ writeFileInCwd: 'pwned.txt', text: 'x' }] }, [])
    expect(result.terminal.status).toBe('NATIVE_EFFECT_DETECTED')
    expect(result.terminal.scratchResidue).toContain('pwned.txt')
  })

  it('direct shell mutation: a shell-string or launcher command is refused even with exec.shell authority', async () => {
    const world = makeWorkerWorld()
    const head = git(world.repoRoot, 'rev-parse', 'HEAD')
    const { result } = await runOnce(world, {
      turns: [{ intents: [
        { intentId: 's1', kind: 'exec.shell', argv: ['bash', '-c', 'echo pwned > pwned.txt'] },
        { intentId: 's2', kind: 'exec.shell', argv: ['node', '-e', 'require("fs").writeFileSync("pwned.txt","x")'] },
        { intentId: 's3', kind: 'exec.shell', argv: ['env', 'touch', 'pwned.txt'] },
      ] }, { status: 'DONE' }],
    }, [{ effectClass: 'exec.shell' }])
    expect(result.outcomes.map(outcome => outcome.code)).toEqual(['SENTINEL_DENIED', 'SENTINEL_DENIED', 'SENTINEL_DENIED'])
    expect(existsSync(join(world.repoRoot, 'pwned.txt'))).toBe(false)
    repoUnchanged(world, head)
  })

  it('git commit: refused without git.commit authority; with it, the BROKER commits and says so', async () => {
    const world = makeWorkerWorld()
    const head = git(world.repoRoot, 'rev-parse', 'HEAD')
    const denied = await runOnce(world, { turns: [{ intents: [{ intentId: 'w', kind: 'fs.write', path: 'a.txt', content: 'a' }, { intentId: 'c', kind: 'git.commit', paths: ['a.txt'], message: 'worker commit' }] }, { status: 'DONE' }] }, [{ effectClass: 'fs.write' }])
    expect(denied.result.outcomes.map(outcome => outcome.code)).toEqual(['PERFORMED', 'NO_GRANT'])
    expect(git(world.repoRoot, 'rev-parse', 'HEAD')).toBe(head)

    const allowed = await runOnce(world, { turns: [{ intents: [{ intentId: 'c', kind: 'git.commit', paths: ['a.txt'], message: 'worker commit' }] }, { status: 'DONE' }] }, [{ effectClass: 'git.commit' }])
    expect(allowed.result.outcomes[0]).toMatchObject({ performed: true, code: 'PERFORMED' })
    const message = git(world.repoRoot, 'log', '-1', '--format=%B')
    expect(message).toContain(`Aera-Worker-Epoch: ${allowed.result.epochId}`)
    expect(message).toContain('performed by the Aera execution broker')
    expect(git(world.repoRoot, 'rev-parse', 'HEAD')).not.toBe(head)
  })

  it('package install: no executor exists; an install via exec is refused by policy', async () => {
    const world = makeWorkerWorld()
    const head = git(world.repoRoot, 'rev-parse', 'HEAD')
    const { result } = await runOnce(world, {
      turns: [{ intents: [
        { intentId: 'p1', kind: 'package.install', argv: ['npm', 'install', 'left-pad'] },
        { intentId: 'p2', kind: 'exec.shell', argv: ['npm', 'install', 'left-pad'] },
        { intentId: 'p3', kind: 'exec.shell', argv: ['corepack', 'yarn', 'add', 'left-pad'] },
      ] }, { status: 'DONE' }],
    }, [{ effectClass: 'package' }, { effectClass: 'exec.shell' }])
    expect(result.outcomes.map(outcome => outcome.code)).toEqual(['DENIED_NO_EXECUTOR', 'SENTINEL_DENIED', 'SENTINEL_DENIED'])
    expect(existsSync(join(world.repoRoot, 'node_modules'))).toBe(false)
    repoUnchanged(world, head)
  })

  it('arbitrary network tool: no network executor; network CLIs are refused; an MCP surface refuses the Epoch', async () => {
    const world = makeWorkerWorld()
    const { result } = await runOnce(world, {
      turns: [{ intents: [
        { intentId: 'n1', kind: 'network.request', url: 'https://example.com' },
        { intentId: 'n2', kind: 'exec.shell', argv: ['curl', '-o', 'x', 'https://example.com'] },
        { intentId: 'n3', kind: 'git.push', ref: 'main' },
      ] }, { status: 'DONE' }],
    }, [{ effectClass: 'network' }, { effectClass: 'exec.shell' }])
    expect(result.outcomes.map(outcome => outcome.code)).toEqual(['DENIED_NO_EXECUTOR', 'SENTINEL_DENIED', 'DENIED_NO_EXECUTOR'])
    const mcp = await runOnce(makeWorkerWorld(), { turns: [{ initMcp: [{ name: 'claude.ai Gmail', status: 'connected' }], text: 'x' }] }, [])
    expect(mcp.result.terminal.status).toBe('GUARD_REFUSED')
    expect(mcp.result.terminal.reason).toMatch(/MCP_SERVERS_PRESENT/u)
  })

  it('tool outside the authorised workspace: traversal, absolute and symlink escapes and .git internals are refused', async () => {
    const world = makeWorkerWorld()
    symlinkSync('/etc', join(world.repoRoot, 'escape'))
    git(world.repoRoot, 'add', 'escape')
    git(world.repoRoot, 'commit', '-qm', 'test: symlink')
    const { result } = await runOnce(world, {
      turns: [{ intents: [
        { intentId: 'o1', kind: 'fs.read', path: '../../../../etc/hosts' },
        { intentId: 'o2', kind: 'fs.read', path: '/etc/hosts' },
        { intentId: 'o3', kind: 'fs.read', path: 'escape/hosts' },
        { intentId: 'o4', kind: 'fs.write', path: 'escape/pwned', content: 'x' },
        { intentId: 'o5', kind: 'fs.write', path: '.git/config', content: 'x' },
        { intentId: 'o6', kind: 'exec.shell', argv: ['cat', '/etc/hosts'] },
      ] }, { status: 'DONE' }],
    }, [{ effectClass: 'fs.read' }, { effectClass: 'fs.write' }, { effectClass: 'exec.shell' }])
    expect(result.outcomes.map(outcome => outcome.code)).toEqual(Array(6).fill('SENTINEL_DENIED'))
    expect(result.outcomes.some(outcome => /localhost/u.test(outcome.observation))).toBe(false)
  })

  it('effect after authority revocation: revoked mid-Epoch, the very next intent is denied', async () => {
    const world = makeWorkerWorld()
    let decisionId = ''
    const { result } = await runOnce(world, {
      turns: [
        { intents: [{ intentId: 'a', kind: 'fs.write', path: 'a.txt', content: 'a' }] },
        { intents: [{ intentId: 'b', kind: 'fs.write', path: 'b.txt', content: 'b' }] },
        { status: 'DONE' },
      ],
    }, [], {
      onEvent: (event, manager) => {
        if (event.kind === 'RUNTIME_READY' && decisionId === '') {
          decisionId = grant(manager, world, { effectClass: 'fs.write' }).decisionId
        }
        if (event.kind === 'TURN_COMPLETED' && event.turn === 2) {
          manager.revokeAuthority({ workOrderId: world.workOrderId, decisionId, note: 'TEST revoke' })
        }
      },
    })
    expect(result.outcomes.map(outcome => [outcome.intentId, outcome.code])).toEqual([['a', 'PERFORMED'], ['b', 'AUTHORITY_REVOKED']])
    expect(existsSync(join(world.repoRoot, 'a.txt'))).toBe(true)
    expect(existsSync(join(world.repoRoot, 'b.txt'))).toBe(false)
  })

  it('wrong Working Line: an intent naming another line, or a worktree on another branch, is refused', async () => {
    const world = makeWorkerWorld()
    const wrong = await runOnce(world, { turns: [{ lineOverride: world.otherLine.codeWorkingLineId, intents: [{ intentId: 'w', kind: 'fs.write', path: 'x.txt', content: 'x' }] }, { status: 'DONE' }] }, [{ effectClass: 'fs.write' }])
    expect(wrong.result.outcomes[0]).toMatchObject({ performed: false, code: 'WORKING_LINE_MISMATCH' })
    git(world.repoRoot, 'checkout', '-q', 'main')
    const moved = await runOnce(world, { turns: [{ intents: [{ intentId: 'w', kind: 'fs.write', path: 'x.txt', content: 'x' }] }, { status: 'DONE' }] }, [])
    expect(moved.result.outcomes[0]).toMatchObject({ performed: false, code: 'WORKING_LINE_LOCATION_MISMATCH' })
    expect(existsSync(join(world.repoRoot, 'x.txt'))).toBe(false)
  })

  it('mutation with only read authority is READ_ONLY_AUTHORITY', async () => {
    const world = makeWorkerWorld()
    const head = git(world.repoRoot, 'rev-parse', 'HEAD')
    const { result } = await runOnce(world, {
      turns: [{ intents: [
        { intentId: 'r', kind: 'fs.read', path: 'README.md' },
        { intentId: 'w', kind: 'fs.write', path: 'README.md', content: 'pwned' },
        { intentId: 't', kind: 'exec.test', argv: ['true'] },
      ] }, { status: 'DONE' }],
    }, [{ effectClass: 'fs.read' }, { effectClass: 'git.read' }])
    expect(result.outcomes.map(outcome => outcome.code)).toEqual(['PERFORMED', 'READ_ONLY_AUTHORITY', 'READ_ONLY_AUTHORITY'])
    repoUnchanged(world, head)
  })
})

describe('§17 Session/Epoch separation, stale Epoch, DEV/CANARY, redaction', () => {
  it('two Epochs share ONE Aera Session; provider session ids are telemetry, not identity', async () => {
    const world = makeWorkerWorld()
    const first = await runOnce(world, { turns: [{ status: 'DONE' }] }, [])
    const second = await runOnce(world, { turns: [{ status: 'DONE' }] }, [])
    expect(second.result.aeraSessionId).toBe(first.result.aeraSessionId)
    expect(second.result.epochId).not.toBe(first.result.epochId)
    expect([first.result.sequence, second.result.sequence]).toEqual([1, 2])
    const epochs = second.manager.epochs(world.workOrderId, second.result.aeraSessionId)
    expect(epochs.map(epoch => epoch.terminal?.status)).toEqual(['COMPLETED', 'COMPLETED'])
    expect(epochs.every(epoch => epoch.runtime.workerType === 'CLAUDE_CODE')).toBe(true)
  })

  it('stale Epoch: a batch claiming another Epoch id is refused', async () => {
    const world = makeWorkerWorld()
    const { result } = await runOnce(world, {
      turns: [{ epochOverride: 'aera:worker-epoch:00000000-0000-4000-8000-00000000beef', intents: [{ intentId: 'w', kind: 'fs.write', path: 'x.txt', content: 'x' }] }, { status: 'DONE' }],
    }, [{ effectClass: 'fs.write' }])
    expect(result.outcomes[0]).toMatchObject({ performed: false, code: 'STALE_EPOCH' })
    expect(existsSync(join(world.repoRoot, 'x.txt'))).toBe(false)
  })

  it('DEV/CANARY separation: a Session bound to one environment refuses an Epoch from the other', async () => {
    const world = makeWorkerWorld()
    await runOnce(world, { turns: [{ status: 'DONE' }] }, [], { environmentId: 'AERA_DEV' })
    const canary = await managerFor(world, { turns: [{ status: 'DONE' }] }, { environmentId: 'CANARY' })
    await expect(canary.runEpoch({ workOrderId: world.workOrderId, codeWorkingLineId: world.line.codeWorkingLineId, task: 't' }))
      .rejects.toMatchObject({ code: 'WORKER_SESSION_ENVIRONMENT_MISMATCH' })
  })

  it('secret redaction: secrets read from the workspace are masked in the observation AND the record', async () => {
    const world = makeWorkerWorld()
    writeFileSync(join(world.repoRoot, 'config.env'), 'api_key=sk-abcdefghijklmnopqrstuvwxyz012345\nAuthorization: Bearer abc.def.ghi\n')
    const { result } = await runOnce(world, { turns: [{ intents: [{ intentId: 'r', kind: 'fs.read', path: 'config.env' }] }, { status: 'DONE' }] }, [{ effectClass: 'fs.read' }])
    const observation = result.outcomes[0]?.observation ?? ''
    expect(observation).toMatch(/api_key=\*\*\*\*/u)
    expect(observation).not.toMatch(/sk-abcdefghijklmnopqrstuvwxyz012345|abc\.def\.ghi/u)
    const raw = readFileSync(join(world.storeDir, 'typed-evidence.json'), 'utf8')
    expect(raw).not.toMatch(/sk-abcdefghijklmnopqrstuvwxyz012345|abc\.def\.ghi/u)
    expect(JSON.stringify(new ParticipationStore(world.storeDir).listTypedEvidence())).not.toMatch(/SHOULD-NEVER-LEAK/u)
  })

  it('status view: provider, environment, Epochs, authority envelope and recent effects (§15)', async () => {
    const world = makeWorkerWorld()
    const { manager } = await runOnce(world, { turns: [{ intents: [{ intentId: 'r', kind: 'fs.read', path: 'README.md' }] }, { status: 'DONE' }] }, [{ effectClass: 'fs.read' }])
    const status = manager.status(world.workOrderId)
    expect(status).toMatchObject({ workerType: 'CLAUDE_CODE', environmentId: 'AERA_DEV', liveState: 'IDLE', epochCount: 1, authClass: 'SUBSCRIPTION_OAUTH' })
    expect(status.provider).toMatch(/existing subscription login/u)
    expect(status.lastTerminal?.terminal?.status).toBe('COMPLETED')
    expect(status.authorityEnvelope.map(entry => entry.grant)).toEqual(['aera-worker/v1:fs.read'])
    expect(status.recentEffects.some(effect => effect.subject.startsWith('Worker effect performed: fs.read'))).toBe(true)
  })
})
