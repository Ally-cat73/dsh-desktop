/**
 * §14 FAILURE / ROTATION and the §24 design test —
 * WO-AERA-CODE-CLAUDE-CODE-GOVERNED-WORKER-INTEGRATION-001.
 *
 * Start an Epoch, orient, do bounded governed work, checkpoint and hand off,
 * KILL the worker process unexpectedly, start a fresh Epoch on a DIFFERENT
 * worker binary from a FRESH manager (nothing in memory survives), and show it
 * re-orients from durable Aera state alone: the Aera Session, Work Order,
 * Working Line, authority, performed effects, checkpoint and handoff all
 * survive; the dead process is not needed; its late intents are refused; its
 * conversation is not replayed.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ParticipationStore } from '@aera/participation-runtime'
import { ClaudeCodeWorkerAdapter } from '../src/aera-claude-worker-host.ts'
import { DEFAULT_WORKER_EPOCH_LIMITS } from '../src/aera-worker-adapter.ts'
import { LocalExecutionPolicyGate, WorkerEffectBroker } from '../src/aera-worker-effect-broker.ts'
import { AeraWorkerSessionManager } from '../src/aera-worker-session.ts'
import { POISONED_PARENT_ENV, git, makeFakeClaude, makeWorkerWorld, type FakeScript, type WorkerWorld } from './aera-worker-fixtures.ts'

const LIMITS = { ...DEFAULT_WORKER_EPOCH_LIMITS, turnTimeoutMs: 15_000, epochTimeoutMs: 60_000, cancelGraceMs: 300 }
const CHAT_MARKER = 'PRIVATE-CHAT-MARKER-7731'
const grouped = (text: string): string => (createHash('sha256').update(text).digest('hex').match(/.{8}/gu) ?? []).join('-')

/** A brand-new manager over the same durable store: nothing survives in memory. */
async function freshManager(world: WorkerWorld, script: FakeScript): Promise<AeraWorkerSessionManager> {
  const { pin } = await makeFakeClaude(script)
  return new AeraWorkerSessionManager({
    store: new ParticipationStore(world.storeDir),
    adapter: new ClaudeCodeWorkerAdapter(pin, { parentEnv: POISONED_PARENT_ENV, scratchRoot: world.scratchRoot }),
    gate: new LocalExecutionPolicyGate(),
    config: { humanPrincipalId: world.owner, delegationId: world.delegationId, environmentId: 'AERA_DEV', limits: LIMITS },
    broker: { parentEnv: POISONED_PARENT_ENV },
  })
}

function groupGone(pid: number | undefined): boolean {
  if (pid === undefined) return true
  try { process.kill(-pid, 0); return false } catch { return true }
}

describe('§14 rotation: kill the worker mid-Epoch, continue from durable Aera state', () => {
  it('survives an unexpected worker death with no dependence on the dead process or its chat', async () => {
    const world = makeWorkerWorld()
    const head0 = git(world.repoRoot, 'rev-parse', 'HEAD')

    // --- Epoch 1: Claude A does bounded governed work, checkpoints, hands off, then is killed.
    let pidA: number | undefined
    const managerA = await freshManager(world, {
      turns: [
        {
          text: `Working on it. ${CHAT_MARKER} (private reasoning that must never be replayed)`,
          intents: [
            { intentId: 'w', kind: 'fs.write', path: 'progress.txt', content: 'step 1 done\n' },
            { intentId: 'c', kind: 'git.commit', paths: ['progress.txt'], message: 'worker: step 1' },
            { intentId: 'k', kind: 'checkpoint', summary: 'step 1 committed' },
          ],
        },
        {
          text: `Handing off. ${CHAT_MARKER}`,
          intents: [],
          handoff: { summary: 'Step 1 is committed and checkpointed; step 2 remains.', nextSteps: ['append "step 2 done" to progress.txt', 'commit it'] },
        },
        { hang: true },
      ],
    })
    managerA.grantAuthority({
      workOrderId: world.workOrderId,
      codeWorkingLineId: world.line.codeWorkingLineId,
      grants: [{ effectClass: 'fs.read' }, { effectClass: 'fs.write' }, { effectClass: 'git.commit' }, { effectClass: 'checkpoint' }],
    })
    const epoch1 = managerA.runEpoch({
      workOrderId: world.workOrderId,
      codeWorkingLineId: world.line.codeWorkingLineId,
      task: 'Do step 1, checkpoint, hand off.',
      onEvent: (event) => {
        if (event.kind === 'PROCESS_STARTED') pidA = event.pid
        // Turn 3 hangs: the worker dies UNEXPECTEDLY while a turn is in flight.
        if (event.kind === 'TURN_COMPLETED' && event.turn === 2) {
          setTimeout(() => { if (pidA !== undefined) process.kill(pidA, 'SIGKILL') }, 150)
        }
      },
    })
    const result1 = await epoch1
    expect(result1.terminal.status).toBe('CRASHED')
    expect(result1.terminal.signal).toBe('SIGKILL')
    expect(result1.outcomes.map(outcome => outcome.code)).toEqual(['PERFORMED', 'PERFORMED', 'PERFORMED'])
    expect(result1.handoffEvidenceId).toMatch(/^aera:evidence:/u)
    expect(groupGone(pidA)).toBe(true)
    const head1 = git(world.repoRoot, 'rev-parse', 'HEAD')
    expect(head1).not.toBe(head0)

    // --- The durable record alone answers §24.
    const store = new ParticipationStore(world.storeDir)
    const checkpoint = store.listCodeCheckpoints(world.line.codeWorkingLineId).at(-1)
    expect(checkpoint?.stateRef).toEqual({ kind: 'COMMIT', revision: head1 })
    expect(checkpoint?.mintedBy).toBe(managerA.principals(world.workOrderId).broker)
    const epochsAfterCrash = managerA.epochs(world.workOrderId, result1.aeraSessionId)
    expect(epochsAfterCrash).toHaveLength(1)
    expect(epochsAfterCrash[0]?.terminal?.status).toBe('CRASHED')

    // --- Epoch 2: a DIFFERENT worker binary (Claude B), a FRESH manager (Aera Code restarted).
    const managerB = await freshManager(world, {
      version: '2.1.281-fake',
      turns: [
        { text: 'oriented ${INPUT_SHA}', intents: [{ intentId: 'r', kind: 'fs.read', path: 'progress.txt' }] },
        { intents: [{ intentId: 'w2', kind: 'fs.write', path: 'progress.txt', content: 'step 1 done\nstep 2 done\n' }, { intentId: 'c2', kind: 'git.commit', paths: ['progress.txt'], message: 'worker: step 2' }], status: 'DONE' },
      ],
    })
    const result2 = await managerB.runEpoch({ workOrderId: world.workOrderId, codeWorkingLineId: world.line.codeWorkingLineId, task: 'Continue the work.' })

    // Same Aera Session, next Epoch, different runtime.
    expect(result2.aeraSessionId).toBe(result1.aeraSessionId)
    expect(result2.sequence).toBe(2)
    expect(result2.epochId).not.toBe(result1.epochId)
    const epochs = managerB.epochs(world.workOrderId, result2.aeraSessionId)
    expect(epochs.map(epoch => epoch.runtime.cliVersion)).toEqual(['2.1.280-fake', '2.1.281-fake'])

    // Re-oriented from durable state only.
    const orientation = result2.orientation
    expect(orientation).toContain(world.workOrderId)
    expect(orientation).toContain(world.line.codeWorkingLineId)
    expect(orientation).toContain(checkpoint?.checkpointId ?? 'missing')
    expect(orientation).toContain('Step 1 is committed and checkpointed; step 2 remains.')
    expect(orientation).toContain('Worker effect performed: fs.write (w)')
    expect(orientation).toContain('Worker effect performed: git.commit (c)')
    expect(orientation).toContain('aera-worker/v1:fs.write')
    expect(orientation).toContain('OBJECTIVE: make README say hello.')
    // No chat replay: nothing Claude A merely SAID reaches Claude B.
    expect(orientation).not.toContain(CHAT_MARKER)
    const turn1 = store.listTypedEvidence(world.workOrderId).filter(row => row.subject.includes(`turn 1 output (${result2.epochId})`))[0]
    expect(turn1?.body).toContain(grouped(orientation))

    // Claude B continued the work through the governed path.
    expect(result2.outcomes.map(outcome => outcome.code)).toEqual(['PERFORMED', 'PERFORMED', 'PERFORMED'])
    expect(readFileSync(join(world.repoRoot, 'progress.txt'), 'utf8')).toBe('step 1 done\nstep 2 done\n')
    expect(git(world.repoRoot, 'log', '-1', '--format=%B')).toContain(`Aera-Worker-Epoch: ${result2.epochId}`)

    // The dead Epoch cannot act: a late intent under its id is STALE_EPOCH.
    const principals = managerB.principals(world.workOrderId)
    const broker = new WorkerEffectBroker({ store: new ParticipationStore(world.storeDir), principals, gate: new LocalExecutionPolicyGate(), parentEnv: POISONED_PARENT_ENV })
    const late = await broker.handleIntent({
      aeraSessionId: result1.aeraSessionId,
      epochId: result1.epochId,
      workOrderId: world.workOrderId,
      codeWorkingLineId: world.line.codeWorkingLineId,
      currentEpochId: () => managerB.currentEpochId(world.workOrderId, result1.aeraSessionId),
    }, { intentId: 'late', kind: 'fs.write', codeWorkingLineId: world.line.codeWorkingLineId, path: 'late.txt', content: 'x' })
    expect(late).toMatchObject({ performed: false, code: 'STALE_EPOCH' })
    expect(existsSync(join(world.repoRoot, 'late.txt'))).toBe(false)
  })

  it('an Epoch left open by an Aera Code crash is superseded, not resumed, and its intents go stale', async () => {
    const world = makeWorkerWorld()
    const hung = await freshManager(world, { turns: [{ hang: true }] })
    let pid: number | undefined
    const running = hung.runEpoch({
      workOrderId: world.workOrderId,
      codeWorkingLineId: world.line.codeWorkingLineId,
      task: 'hang',
      onEvent: (event) => { if (event.kind === 'PROCESS_STARTED') pid = event.pid },
    })
    await new Promise(resolve => setTimeout(resolve, 300))
    const session = hung.findAeraSession(world.workOrderId)
    const orphanEpoch = session === undefined ? undefined : hung.currentEpochId(world.workOrderId, session.sessionId)
    expect(orphanEpoch).toBeDefined()

    // A NEW Aera Code process (fresh manager) starts the next Epoch.
    const next = await freshManager(world, { turns: [{ status: 'DONE' }] })
    const result = await next.runEpoch({ workOrderId: world.workOrderId, codeWorkingLineId: world.line.codeWorkingLineId, task: 'continue' })
    const epochs = next.epochs(world.workOrderId, result.aeraSessionId)
    expect(epochs.map(epoch => epoch.terminal?.status)).toEqual(['SUPERSEDED_UNCLEAN', 'COMPLETED'])
    expect(epochs[0]?.terminal?.reason).toMatch(/not signalled/u)

    // Clean up the stranded process the way its own host would.
    await hung.cancel(world.workOrderId, 'test cleanup')
    await running
    expect(groupGone(pid)).toBe(true)
  })
})
