/**
 * O-1 U-D F2-3: the readable, Aera-owned worker scratch root
 * (O1_PROVENANCE_SPEC_V2 §6.3; P0_PPS_FINDINGS F2-3; V2.1 NO-6, NO-8).
 *
 * The CLI's `environment` attachment reports the worker cwd to the model. The
 * old `$TMPDIR/aera-worker-epoch-XXXXXX` path tripped PPS
 * `encoded_secret_base64` in ~65% of Epochs. The cwd is now
 * `<userData>/workerScratch/epoch-NNNN`, every component readable, never in
 * `$TMPDIR`, never in a git work tree, never under a CLAUDE.md.
 *
 * The PPS rows run the REAL `@aera/pps` evaluatePrivacyBoundary. It does not
 * resolve inside the desktop repo, so it is loaded from the built stack
 * `packages/pps/dist` (o1-provenance-stack worktree; `AERA_PPS_DIST`
 * overrides). The secret in the negative row is generated in-test (NO-8) and
 * never committed.
 */
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ClaudeCodeWorkerAdapter,
  READABLE_PATH_PART,
  WORKER_SCRATCH_ROOT_NAME,
  allocateWorkerScratchDir,
  workerScratchPathRefusal,
  type WorkerScratchPathEnvironment,
} from '../src/aera-claude-worker-host.ts'
import { DEFAULT_WORKER_EPOCH_LIMITS } from '../src/aera-worker-adapter.ts'
import { OBSERVATION_BLOCK_PREFIX } from '../src/aera-worker-provenance.ts'
import { POISONED_PARENT_ENV, makeFakeClaude, testHotPath } from './aera-worker-fixtures.ts'
import { ENV_LINE_PREFIX_SOURCE, renderCliAttachment } from './fixtures/claude-cli-attachments.ts'

const PRODUCTION_SHAPED = '/Users/sam/Library/Application Support/Aera Code/workerScratch/epoch-0001'

/** A probe environment for a path that does not exist on this machine. */
const probes = (overrides: Partial<WorkerScratchPathEnvironment> = {}): WorkerScratchPathEnvironment => ({
  tmpRoots: ['/var/folders/zz/T', '/private/var/folders/zz/T'],
  home: '/Users/sam',
  realpath: (path: string) => path,
  exists: () => false,
  isEmptyDir: () => true,
  ...overrides,
})

const codeOf = async (promise: Promise<unknown>): Promise<string | undefined> => {
  try { await promise; return undefined } catch (error) { return (error as { code?: string }).code }
}

describe('F2-3: the scratch path grammar and host invariant (§6.3, NO-6)', () => {
  it('READABLE_PATH_PART is the exact NO-6 regex: production capitalised folders pass, random tokens do not', () => {
    expect(READABLE_PATH_PART.source).toBe('^(?:[a-z]+(?:[A-Z][a-z]+)*|[A-Z][a-z]+(?:[A-Z][a-z]+)*|[A-Z]{2,8}|[A-Za-z]+[0-9]{1,4}|[0-9]{1,4})$')
    for (const part of ['Users', 'Library', 'Application', 'Support', 'Aera', 'Code', 'workerScratch', 'epoch', '0001', 'sam', 'AERA', 'ally73']) {
      expect(READABLE_PATH_PART.test(part), part).toBe(true)
    }
    for (const part of ['', 'a1B2c3', 'xX9k2LmQ', '00000000', 'zyxvpxvq6csfxvn', 'JSmith']) expect(READABLE_PATH_PART.test(part), part).toBe(false)
    expect(WORKER_SCRATCH_ROOT_NAME).toBe('workerScratch')
  })

  it('accepts the pinned production-shaped root WITH a space', () => {
    expect(workerScratchPathRefusal(PRODUCTION_SHAPED, probes())).toBeUndefined()
  })

  it.each([
    ['a $TMPDIR path', '/var/folders/zz/T/aera-worker-epoch-a1B2c3', probes()],
    ['a realpath $TMPDIR path', '/private/var/folders/zz/T/epoch-0001', probes()],
    ['a random-suffix path', '/Users/sam/Library/Application Support/Aera Code/workerScratch/aera-worker-epoch-a1B2c3', probes()],
    ['a symlinked path', PRODUCTION_SHAPED, probes({ realpath: () => '/Volumes/elsewhere/epoch-0001' })],
    ['a path inside a git work tree', PRODUCTION_SHAPED, probes({ exists: (path: string) => path === '/Users/sam/Library/.git' })],
    ['a path under a CLAUDE.md', PRODUCTION_SHAPED, probes({ exists: (path: string) => path === '/Users/sam/Library/Application Support/CLAUDE.md' })],
    ['a path under a CLAUDE.local.md', PRODUCTION_SHAPED, probes({ exists: (path: string) => path === '/Users/CLAUDE.local.md' })],
    ['a path under a project .claude directory', PRODUCTION_SHAPED, probes({ exists: (path: string) => path === '/Users/sam/Library/.claude' })],
    ['HOME itself', '/Users/sam', probes()],
    ['a non-empty dir', PRODUCTION_SHAPED, probes({ isEmptyDir: () => false })],
    ['an unreadable username', '/Users/JSmith/Library/Application Support/Aera Code/workerScratch/epoch-0001', probes({ home: '/Users/JSmith' })],
    ['a relative path', 'workerScratch/epoch-0001', probes()],
  ])('refuses %s', (_label, path, env) => {
    expect(workerScratchPathRefusal(path, env)).toMatch(/\S/u)
  })

  it('HOME\'s own .claude (the CLI login configuration) does not refuse the production root', () => {
    expect(workerScratchPathRefusal(PRODUCTION_SHAPED, probes({ exists: (path: string) => path === '/Users/sam/.claude' }))).toBeUndefined()
  })

  it('refuses real symlinked, git and $TMPDIR paths on this machine', () => {
    const base = mkdtempSync(join(tmpdir(), 'scratch-real-'))
    const target = join(base, 'target')
    mkdirSync(target)
    const link = join(base, 'link')
    symlinkSync(target, link)
    expect(workerScratchPathRefusal(link)).toMatch(/\S/u)
    expect(workerScratchPathRefusal(target)).toMatch(/\S/u) // under $TMPDIR and not readable
    mkdirSync(join(base, 'repo', '.git'), { recursive: true })
    mkdirSync(join(base, 'repo', 'epoch'))
    expect(workerScratchPathRefusal(join(base, 'repo', 'epoch'))).toMatch(/\S/u)
  })
})

describe('F2-3: the root and the epoch-NNNN counter', () => {
  it('creates the root 0700, then epoch-0001, epoch-0002 (exclusive mkdir, EEXIST → next), each 0700', () => {
    const root = join(mkdtempSync(join(tmpdir(), 'scratch-root-')), WORKER_SCRATCH_ROOT_NAME)
    const first = allocateWorkerScratchDir(root)
    const second = allocateWorkerScratchDir(root)
    expect(first).toBe(join(root, 'epoch-0001'))
    expect(second).toBe(join(root, 'epoch-0002'))
    expect(statSync(root).mode & 0o777).toBe(0o700)
    expect(statSync(first).mode & 0o777).toBe(0o700)
    expect(readdirSync(root).sort()).toEqual(['epoch-0001', 'epoch-0002'])
  })

  it('tightens a pre-existing wider root to 0700, and refuses a symlinked root', () => {
    const base = mkdtempSync(join(tmpdir(), 'scratch-root-'))
    const root = join(base, WORKER_SCRATCH_ROOT_NAME)
    mkdirSync(root, { mode: 0o755 })
    allocateWorkerScratchDir(root)
    expect(statSync(root).mode & 0o777).toBe(0o700)
    const real = join(base, 'real')
    mkdirSync(real)
    const linked = join(base, 'linked')
    symlinkSync(real, linked)
    expect(() => allocateWorkerScratchDir(linked)).toThrow(expect.objectContaining({ code: 'WORKER_SCRATCH_PATH_NONCONFORMING' }) as Error)
  })

  it('refuses WORKER_SCRATCH_EXHAUSTED when every number is taken', () => {
    const root = join(mkdtempSync(join(tmpdir(), 'scratch-root-')), WORKER_SCRATCH_ROOT_NAME)
    allocateWorkerScratchDir(root, { maxIndex: 2 })
    allocateWorkerScratchDir(root, { maxIndex: 2 })
    expect(() => allocateWorkerScratchDir(root, { maxIndex: 2 })).toThrow(expect.objectContaining({ code: 'WORKER_SCRATCH_EXHAUSTED' }) as Error)
  })
})

describe('A57: a non-conforming scratch path refuses the spawn — no process', () => {
  const spec = () => ({ epochId: 'aera:worker-epoch:00000000-0000-4000-8000-000000000001', aeraSessionId: 's', workOrderId: 'w', codeWorkingLineId: 'l', systemPrompt: 'p', limits: DEFAULT_WORKER_EPOCH_LIMITS })

  it('the production guard refuses a $TMPDIR root; the fake CLI is never spawned', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'a57-'))
    const envLog = join(dir, 'env.log')
    const { pin } = await makeFakeClaude({ envLog, turns: [{ text: 'never' }] }, dir)
    const scratchRoot = join(dir, 'aera-worker-epoch-XXXXXX')
    const adapter = new ClaudeCodeWorkerAdapter(pin, { parentEnv: POISONED_PARENT_ENV, scratchRoot, hotPath: testHotPath() })
    expect(await codeOf(adapter.startEpoch(spec()))).toBe('WORKER_SCRATCH_PATH_NONCONFORMING')
    // Only the preflight `--version` ran; no spawn line.
    const log = existsSync(envLog) ? readFileSync(envLog, 'utf8') : ''
    expect(log).not.toMatch(/^spawn:/mu)
    // The refused epoch dir was not left behind.
    expect(existsSync(scratchRoot) ? readdirSync(scratchRoot) : []).toEqual([])
  })

  it('without a configured root the worker refuses (it never falls back to $TMPDIR)', async () => {
    const { pin } = await makeFakeClaude({ turns: [{ text: 'never' }] })
    const adapter = new ClaudeCodeWorkerAdapter(pin, { parentEnv: POISONED_PARENT_ENV, hotPath: testHotPath() })
    expect(await codeOf(adapter.startEpoch(spec()))).toBe('WORKER_SCRATCH_PATH_NONCONFORMING')
  })
})

/* --------------------------------------------------- the real @aera/pps */

const PPS_DIST = process.env.AERA_PPS_DIST ?? '/Users/Allyd/AERA-Workspace/worktrees/o1-provenance-stack/packages/pps/dist/index.js'

interface PpsReceipt { readonly decision: string, readonly reasonCodes: readonly string[] }
interface PpsResult { readonly allowed: boolean, readonly receipt: PpsReceipt }
type Evaluate = (input: { direction: string, routeId: string, policyVersion: string, value: unknown }) => Promise<PpsResult>

const loadPps = async (): Promise<Evaluate> => {
  const pps = await import(/* @vite-ignore */ pathToFileURL(PPS_DIST).href) as { evaluatePrivacyBoundary: Evaluate }
  return pps.evaluatePrivacyBoundary
}

/**
 * The two Router PPS stages on one request (aera-router @3e868bd5):
 *   stage 1 `gateway.anthropic-compatible.policy-input` on extractPromptText(body)
 *           = system texts joined \n, \n, the last user message's text blocks joined \n
 *           (anthropicProxy.ts; providerPrivacyBoundary.ts evaluateProviderPrivacyForGovernance);
 *   stage 2 `gateway.anthropic.passthrough` on the parsed upstream body (providerPrivacyFetch).
 * NO-8: on the hot path a stage-1 DENY ends the request before stage 2, so each
 * stage is evaluated independently here.
 */
const stages = async (body: { system: readonly { text: string }[], messages: readonly { role: string, content: readonly { type: string, text: string }[] }[] }): Promise<readonly [PpsResult, PpsResult]> => {
  const evaluate = await loadPps()
  const last = body.messages.at(-1)!
  const promptText = `${body.system.map(row => row.text).join('\n')}\n${last.content.map(row => row.text).join('\n')}`
  const stage1 = await evaluate({ direction: 'provider_request', routeId: 'gateway.anthropic-compatible.policy-input', policyVersion: 'adq-006-beta-v1', value: promptText })
  const stage2 = await evaluate({ direction: 'provider_request', routeId: 'gateway.anthropic.passthrough', policyVersion: 'adq-006-beta-v1', value: body })
  return [stage1, stage2]
}

const encoded = (result: PpsResult): string[] => result.receipt.reasonCodes.filter(code => code.startsWith('encoded_'))
/**
 * The ROT13 email-shape detector fires on the CLI's own account sentence (the
 * dummy address) and only redacts (P0_PPS_FINDINGS §2.7 baseline: SANITIZE
 * `crypto_sensitive, encoded_pii_rot13, pii_email`). Every other encoded_* is
 * a deny reason (universalBoundary l.149-151).
 */
const encodedOtherThanEmailRot13 = (result: PpsResult): string[] => encoded(result).filter(code => code !== 'encoded_pii_rot13')

describe.skipIf(!existsSync(PPS_DIST))('F2-3 with the real @aera/pps (§6.3 tests, A47; A48 / NO-8)', () => {
  const environment = renderCliAttachment('environment', { cwd: PRODUCTION_SHAPED, osVersion: 'Darwin 25.0.0' })
  /** The full Phase E shape: F2 system prompt + [BRIEFING, RECORD, HUMAN] + the CLI pipeline (dummy address). */
  const phaseE = async (extraObservation?: string, withAccountNote = true) => {
    const { buildWorkerSystemPrompt } = await import('../src/aera-worker-session.ts')
    const { buildOrientationBlocks } = await import('../src/aera-worker-provenance.ts')
    const epochId = 'aera:worker-epoch:0b0c0d0e-1a2b-4c3d-8e9f-a0b1c2d3e4f5'
    const line = 'aera:code_working_line:0a1b2c3d'
    const { blocks } = buildOrientationBlocks({
      briefing: { sequence: 1, epochId, aeraSessionId: 'psession-0001-1a2b3c4d', lifecycleState: 'ACTIVE', stateSource: 'STATE_RECORD', payloadLength: 4120, payloadSha256: 'e'.repeat(64), codeWorkingLineId: line, originRevision: 'f'.repeat(40), lineLifecycle: 'OPEN', performedCount: 0, deniedCount: 0, bindingCount: 1 },
      authority: { kind: 'CAS' },
      owner: { workOrderId: 'WO-AERA-CODE-CLAUDE-CODE-GOVERNED-WORKER-INTEGRATION-001', title: 'Governed Claude Code worker dogfood', label: 'Phase E line', branchRef: 'agc/wo-aera-code-claude-code-governed-worker-001', repositoryId: 'aera-repo:dsh-desktop', bindings: [{ repositoryId: 'aera-repo:dsh-desktop', role: 'PRIMARY' }], task: 'Read README.md and propose one small documentation fix.' },
      records: { performed: [], denied: [] },
    })
    const content = [
      ...blocks.map(row => row.text),
      ...(extraObservation === undefined ? [] : [`${OBSERVATION_BLOCK_PREFIX}fs.read .env.sample\n${extraObservation}`]),
      environment,
      renderCliAttachment('model', { modelId: 'claude-opus-4-6', marketingName: 'Claude Opus 4.6', knowledgeCutoff: 'May 2025' }),
      ...(withAccountNote ? [renderCliAttachment('session_context', { email: 'worker-fixture@example.invalid' })] : []),
      renderCliAttachment('date', { date: '2026-10-03' }),
    ].map(text => ({ type: 'text', text }))
    return { system: [{ text: buildWorkerSystemPrompt({ epochId, codeWorkingLineId: line }) }], messages: [{ role: 'user', content }] }
  }

  it('renders the environment block from the binary literals (lp prefix " - ")', () => {
    expect(ENV_LINE_PREFIX_SOURCE).toContain('[` - ${n}`]')
    expect(environment).toContain(` - Primary working directory: ${PRODUCTION_SHAPED}\n - Is a git repository: false\n`)
    expect(environment.startsWith('<system-reminder>\n# Environment\nYou have been invoked in the following environment: \n')).toBe(true)
  })

  it('the rendered environment line with the F2-3 cwd: allowed on both stages, no encoded_* reason', async () => {
    const [stage1, stage2] = await stages({ system: [{ text: '' }], messages: [{ role: 'user', content: [{ type: 'text', text: environment }] }] })
    for (const stage of [stage1, stage2]) {
      expect(stage.allowed).toBe(true)
      expect(stage.receipt.decision).not.toBe('DENY')
      expect(encoded(stage)).toEqual([])
    }
  })

  it('A47: the full Phase E shape: SANITIZE/allowed on both stages, not DENY, no deny-class encoded_* reason', async () => {
    const [stage1, stage2] = await stages(await phaseE())
    for (const stage of [stage1, stage2]) {
      expect(stage.allowed).toBe(true)
      expect(stage.receipt.decision).not.toBe('DENY')
      expect(encodedOtherThanEmailRot13(stage)).toEqual([])
    }
    // Without the CLI account sentence there is no encoded_* reason at all: the F2-3 cwd adds none.
    const [bare1, bare2] = await stages(await phaseE(undefined, false))
    for (const stage of [bare1, bare2]) {
      expect(stage.allowed).toBe(true)
      expect(encoded(stage)).toEqual([])
    }
  })

  it('A48 / NO-8: a synthetic encoded secret generated in-test inside an observation DENIES on both stages', async () => {
    const secret = randomBytes(48).toString('base64')
    const [stage1, stage2] = await stages(await phaseE(`SERVICE_TOKEN=${secret}`))
    for (const stage of [stage1, stage2]) {
      expect(stage.allowed).toBe(false)
      expect(stage.receipt.decision).toBe('DENY')
      expect(encoded(stage).length).toBeGreaterThan(0)
    }
  })
})
