/**
 * §17 host tests against the deterministic fake CLI —
 * WO-AERA-CODE-CLAUDE-CODE-GOVERNED-WORKER-INTEGRATION-001.
 *
 * worker startup · auth-runtime detection · clean env · cwd confinement ·
 * streaming parsing · malformed output · cancellation · crash · timeout ·
 * model/runtime identity · usage handling · fail-closed guard · no orphans ·
 * binary pin. No network, no provider call.
 */
import { existsSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CLAUDE_WORKER_ENV_KEYS,
  ClaudeCodeWorkerAdapter,
  buildClaudeWorkerArgv,
  buildClaudeWorkerEnv,
  resolveClaudeWorkerPin,
  verifyClaudeWorkerBinary,
} from '../src/aera-claude-worker-host.ts'
import { DEFAULT_WORKER_EPOCH_LIMITS, type WorkerEpochHandle, type WorkerLiveEvent } from '../src/aera-worker-adapter.ts'
import { FAKE_MODEL, FAKE_VERSION, POISONED_PARENT_ENV, makeFakeClaude, type FakeScript } from './aera-worker-fixtures.ts'

const LIMITS = { ...DEFAULT_WORKER_EPOCH_LIMITS, turnTimeoutMs: 10_000, epochTimeoutMs: 30_000, cancelGraceMs: 300 }

async function start(script: FakeScript, overrides: { limits?: Partial<typeof LIMITS>, events?: WorkerLiveEvent[] } = {}): Promise<{ handle: WorkerEpochHandle, scratchRoot: string }> {
  const { pin } = await makeFakeClaude(script)
  const scratchRoot = mkdtempSync(join(tmpdir(), 'aera-host-scratch-'))
  const adapter = new ClaudeCodeWorkerAdapter(pin, { parentEnv: POISONED_PARENT_ENV, scratchRoot })
  const handle = await adapter.startEpoch({
    epochId: 'aera:worker-epoch:00000000-0000-4000-8000-000000000001',
    aeraSessionId: 'psession-test',
    workOrderId: 'WO-TEST-1',
    codeWorkingLineId: 'aera:code_working_line:test',
    systemPrompt: 'Always use epochId aera:worker-epoch:00000000-0000-4000-8000-000000000001 and codeWorkingLineId aera:code_working_line:test.',
    limits: { ...LIMITS, ...overrides.limits },
    ...(overrides.events === undefined ? {} : { onEvent: (event: WorkerLiveEvent) => { overrides.events?.push(event) } }),
  })
  return { handle, scratchRoot }
}

function groupGone(pid: number | undefined): boolean {
  if (pid === undefined) return true
  try { process.kill(-pid, 0); return false } catch { return true }
}

describe('pin resolution and verification (§7)', () => {
  it('is UNAVAILABLE without explicit configuration — never falls back to PATH', () => {
    const resolution = resolveClaudeWorkerPin({ PATH: '/usr/local/bin:/usr/bin' })
    expect(resolution.kind).toBe('UNAVAILABLE')
    if (resolution.kind === 'UNAVAILABLE') expect(resolution.reason).toMatch(/never resolves `claude` from PATH/u)
  })

  it('refuses a relative binary path and a malformed digest', () => {
    const base = { AERA_CLAUDE_WORKER_SHA256: 'a'.repeat(64), AERA_CLAUDE_WORKER_VERSION: '1', AERA_CLAUDE_WORKER_MODEL: 'haiku' }
    expect(resolveClaudeWorkerPin({ ...base, AERA_CLAUDE_WORKER_BINARY: 'claude' }).kind).toBe('UNAVAILABLE')
    expect(resolveClaudeWorkerPin({ ...base, AERA_CLAUDE_WORKER_BINARY: '/x/claude', AERA_CLAUDE_WORKER_SHA256: 'nothex' }).kind).toBe('UNAVAILABLE')
  })

  it('requires the Anthropic TeamIdentifier on darwin', () => {
    const resolution = resolveClaudeWorkerPin({
      AERA_CLAUDE_WORKER_BINARY: '/Users/x/.local/share/claude/versions/2.1.280',
      AERA_CLAUDE_WORKER_SHA256: 'a'.repeat(64),
      AERA_CLAUDE_WORKER_VERSION: '2.1.280',
      AERA_CLAUDE_WORKER_MODEL: 'haiku',
    }, 'darwin')
    expect(resolution.kind === 'PINNED' && resolution.pin.teamIdentifier).toBe('Q6L2SF6YDW')
  })

  it('accepts the exact pinned binary and records its identity', async () => {
    const { pin } = await makeFakeClaude({ turns: [{ text: 'ok' }] })
    const identity = await verifyClaudeWorkerBinary(pin, { parentEnv: POISONED_PARENT_ENV })
    expect(identity).toMatchObject({ workerType: 'CLAUDE_CODE', cliVersion: FAKE_VERSION, binarySha256: pin.sha256, modelRequested: FAKE_MODEL })
  })

  it('refuses a binary whose sha256 moved', async () => {
    const { pin } = await makeFakeClaude({ turns: [{ text: 'ok' }] })
    await expect(verifyClaudeWorkerBinary({ ...pin, sha256: 'b'.repeat(64) }, { parentEnv: POISONED_PARENT_ENV }))
      .rejects.toMatchObject({ code: 'WORKER_BINARY_UNPINNED' })
  })

  it('refuses a symlinked (moving) path even when the target matches', async () => {
    const { pin } = await makeFakeClaude({ turns: [{ text: 'ok' }] })
    const link = join(mkdtempSync(join(tmpdir(), 'aera-link-')), 'claude')
    symlinkSync(pin.binaryPath, link)
    await expect(verifyClaudeWorkerBinary({ ...pin, binaryPath: link }, { parentEnv: POISONED_PARENT_ENV }))
      .rejects.toThrow(/symlink/u)
  })

  it('refuses a version mismatch and a signer mismatch', async () => {
    const { pin } = await makeFakeClaude({ turns: [{ text: 'ok' }] })
    await expect(verifyClaudeWorkerBinary({ ...pin, version: '9.9.9' }, { parentEnv: POISONED_PARENT_ENV })).rejects.toThrow(/--version/u)
    await expect(verifyClaudeWorkerBinary({ ...pin, teamIdentifier: 'Q6L2SF6YDW' }, {
      parentEnv: POISONED_PARENT_ENV,
      signerTeamIdentifier: async () => 'SOMEONEELSE',
    })).rejects.toThrow(/TeamIdentifier/u)
  })

  it('re-verifies at EVERY Epoch start: a binary replaced after preflight is refused before any process exists', async () => {
    const { pin, path } = await makeFakeClaude({ turns: [{ text: 'ok' }] })
    const adapter = new ClaudeCodeWorkerAdapter(pin, { parentEnv: POISONED_PARENT_ENV })
    await adapter.preflight()
    writeFileSync(path, '#!/bin/sh\necho replaced\n')
    await expect(adapter.startEpoch({
      epochId: 'e', aeraSessionId: 's', workOrderId: 'w', codeWorkingLineId: 'l', systemPrompt: 'p', limits: LIMITS,
    })).rejects.toMatchObject({ code: 'WORKER_BINARY_UNPINNED' })
  })
})

describe('clean environment and fixed argv (§7/§13)', () => {
  it('builds the env from nothing: exactly HOME, PATH, USER, LOGNAME', () => {
    const env = buildClaudeWorkerEnv(POISONED_PARENT_ENV)
    expect(Object.keys(env).sort()).toEqual([...CLAUDE_WORKER_ENV_KEYS].sort())
    expect(env.PATH).toBe('/usr/bin:/bin')
    expect(JSON.stringify(env)).not.toMatch(/SHOULD-NEVER-LEAK|CLAUDE_CODE|ANTHROPIC|AERA_/u)
  })

  it('argv removes every executor and never uses --bare / --resume / --mcp-config', () => {
    const argv = buildClaudeWorkerArgv({ binaryPath: '/x', sha256: 'a'.repeat(64), version: '1', model: 'm' }, 'prompt')
    const pair = (flag: string): string | undefined => argv[argv.indexOf(flag) + 1]
    expect(pair('--tools')).toBe('')
    expect(pair('--setting-sources')).toBe('')
    expect(pair('--permission-prompts')).toBe('none')
    expect(pair('--model')).toBe('m')
    for (const flag of ['--safe-mode', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence', '--include-hook-events']) expect(argv).toContain(flag)
    for (const flag of ['--bare', '--resume', '--continue', '--mcp-config', '--add-dir', '--dangerously-skip-permissions']) expect(argv).not.toContain(flag)
  })

  it('the running worker sees only the four allowed variables, even with a poisoned parent', async () => {
    const { handle } = await start({ turns: [{ text: 'ENV=${ENV_KEYS}' }] })
    const turn = await handle.runTurn('hello')
    expect(turn.kind).toBe('TURN_COMPLETED')
    const keys = turn.kind === 'TURN_COMPLETED' ? /ENV=([^\n]*)/u.exec(turn.text)?.[1]?.split(',') ?? [] : []
    // `__CF_USER_TEXT_ENCODING` is injected by macOS itself into every process; nothing else may appear.
    expect(keys.filter(key => key !== '__CF_USER_TEXT_ENCODING').sort()).toEqual(['HOME', 'LOGNAME', 'PATH', 'USER'])
    await handle.endInput()
  })
})

describe('startup, streaming, identity and usage (§6/§12)', () => {
  it('completes a turn with model identity, auth class, provider session id and usage; exits cleanly', async () => {
    const events: WorkerLiveEvent[] = []
    const { handle } = await start({ turns: [{ text: 'hello from fake' }] }, { events })
    expect(handle.pid).toBeTypeOf('number')
    expect(handle.runtime.cliVersion).toBe(FAKE_VERSION)
    const turn = await handle.runTurn('say hello')
    expect(turn).toMatchObject({
      kind: 'TURN_COMPLETED',
      turn: 1,
      text: 'hello from fake',
      modelReported: FAKE_MODEL,
      authClass: 'SUBSCRIPTION_OAUTH',
      providerSessionId: 'fake-session-1',
      usage: { reported: true, inputTokens: 100, outputTokens: 20 },
      isError: false,
    })
    const terminal = await handle.endInput()
    expect(terminal).toMatchObject({ status: 'COMPLETED', exitCode: 0, turns: 1, orphanReaped: false, scratchResidue: [] })
    expect(terminal.usage.note).toMatch(/notional list-price/u)
    expect(terminal.limitations.join('\n')).toMatch(/not see it|Sentinel/u)
    expect(events.map(event => event.kind)).toEqual(expect.arrayContaining(['PROCESS_STARTED', 'RUNTIME_READY', 'ASSISTANT_TEXT', 'TURN_COMPLETED', 'TERMINATED']))
    expect(groupGone(handle.pid)).toBe(true)
    expect(existsSync(handle.scratchDir ?? '/nonexistent')).toBe(false)
  })

  it('runs multiple turns in one process (one Epoch)', async () => {
    const { handle } = await start({ turns: [{ text: 'one' }, { text: 'two' }] })
    const first = await handle.runTurn('a')
    const second = await handle.runTurn('b')
    expect([first, second].map(turn => turn.kind === 'TURN_COMPLETED' ? turn.text : '')).toEqual(['one', 'two'])
    expect((await handle.endInput()).turns).toBe(2)
  })

  it('cwd is the Aera-owned scratch dir, never the repository or HOME', async () => {
    const { handle, scratchRoot } = await start({ turns: [{ text: 'ok' }] })
    expect(handle.scratchDir?.startsWith(scratchRoot)).toBe(true)
    expect(handle.scratchDir).not.toBe(process.env.HOME)
    await handle.runTurn('x')
    await handle.endInput()
  })
})

describe('fail-closed guard (§7/§11)', () => {
  const refused = async (turn: FakeScript['turns'][number], code: RegExp, status = 'GUARD_REFUSED'): Promise<void> => {
    const { handle } = await start({ turns: [turn] })
    const outcome = await handle.runTurn('go')
    expect(outcome.kind).toBe('EPOCH_TERMINATED')
    const terminal = await handle.terminal()
    expect(terminal.status).toBe(status)
    expect(terminal.reason).toMatch(code)
    expect(groupGone(handle.pid)).toBe(true)
  }
  it('refuses when init reports a built-in tool', () => refused({ initTools: ['Bash'], text: 'x' }, /NATIVE_TOOLS_PRESENT/u))
  it('refuses when init reports an MCP server', () => refused({ initMcp: [{ name: 'claude.ai Gmail', status: 'connected' }], text: 'x' }, /MCP_SERVERS_PRESENT/u))
  it('refuses when init reports a skill', () => refused({ initSkills: ['superpowers:brainstorming'], text: 'x' }, /SKILLS_PRESENT/u))
  it('refuses a non-builtin plugin', () => refused({ initPlugins: [{ name: 'figma', path: '/Users/x/.claude/plugins/figma' }], text: 'x' }, /PLUGINS_PRESENT/u))
  it('refuses API-key auth (§16)', () => refused({ apiKeySource: 'ANTHROPIC_API_KEY', text: 'x' }, /API_KEY_AUTH_REFUSED/u))
  it('refuses a cwd other than the scratch dir', () => refused({ initCwd: '/', text: 'x' }, /CWD_MISMATCH/u))
  it('refuses a version other than the pin', () => refused({ initVersion: '2.1.999', text: 'x' }, /VERSION_MISMATCH/u))
  it('refuses a concrete model other than the pin', () => refused({ initModel: 'claude-other-9-20990101', text: 'x' }, /MODEL_MISMATCH/u))
  it('refuses any hook activity', () => refused({ hookEvent: true, text: 'x' }, /HOOK_ACTIVITY/u))
  it('refuses a native tool_use block (direct shell / git commit attempt)', () => refused({ toolUse: true, text: 'x' }, /NATIVE_TOOL_USE/u))
  it('refuses permission denials (a native tool was attempted)', () => refused({ permissionDenials: true, text: 'x' }, /PERMISSION_DENIALS/u))
  it('refuses malformed output', () => refused({ malformed: true }, /protocol violation/u, 'MALFORMED_OUTPUT'))
  it('detects a native file write into the scratch cwd', () => refused({ writeFileInCwd: 'pwned.txt', text: 'x' }, /pwned\.txt/u, 'NATIVE_EFFECT_DETECTED'))
  it('reports NOT_LOGGED_IN honestly and never automates a login', () => refused({ authFail: true }, /not logged in/u, 'AUTH_UNAVAILABLE'))
})

describe('cancellation, crash, timeout, orphans (§7/§14)', () => {
  it('cancels a hung turn via SIGINT on the process group; no orphans; usage gap stated', async () => {
    const { handle } = await start({ turns: [{ hang: true }] })
    const pending = handle.runTurn('hang please')
    await new Promise(resolve => setTimeout(resolve, 200))
    const terminal = await handle.cancel('owner cancelled')
    expect(terminal.status).toBe('CANCELLED')
    expect(terminal.usage.reported).toBe(false)
    expect(terminal.limitations.join('\n')).toMatch(/zeroes usage on SIGINT/u)
    expect((await pending).kind).toBe('TURN_COMPLETED') // the CLI's own aborted result arrives first
    expect(groupGone(handle.pid)).toBe(true)
  })

  it('records an unexpected exit as CRASHED', async () => {
    const { handle } = await start({ turns: [{ crash: 3 }] })
    const outcome = await handle.runTurn('crash')
    expect(outcome.kind).toBe('EPOCH_TERMINATED')
    expect((await handle.terminal())).toMatchObject({ status: 'CRASHED', exitCode: 3 })
  })

  it('records a SIGKILL from outside as CRASHED', async () => {
    const { handle } = await start({ turns: [{ hang: true }] })
    const pending = handle.runTurn('hang')
    await new Promise(resolve => setTimeout(resolve, 200))
    process.kill(handle.pid ?? -1, 'SIGKILL')
    const outcome = await pending
    expect(outcome.kind).toBe('EPOCH_TERMINATED')
    expect((await handle.terminal())).toMatchObject({ status: 'CRASHED', signal: 'SIGKILL' })
  })

  it('times out a turn with the SIGINT → SIGTERM → SIGKILL ladder', async () => {
    const { handle } = await start({ turns: [{ hang: true }] }, { limits: { turnTimeoutMs: 300 } })
    const outcome = await handle.runTurn('hang')
    const terminal = await handle.terminal()
    expect(terminal.status).toBe('TIMED_OUT')
    expect(outcome.kind === 'EPOCH_TERMINATED' || outcome.kind === 'TURN_COMPLETED').toBe(true)
    expect(groupGone(handle.pid)).toBe(true)
  })

  it('reaps a straggler left in the process group (no orphans)', async () => {
    const { handle } = await start({ turns: [{ spawnStraggler: true, text: 'ok' }] })
    await handle.runTurn('go')
    const terminal = await handle.endInput()
    expect(terminal.orphanReaped).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(groupGone(handle.pid)).toBe(true)
  })

  it('redacts secrets that reach stderr before recording them', async () => {
    const { handle } = await start({ turns: [{ stderr: 'debug api_key=sk-abcdefghijklmnopqrstuvwxyz0123 token: abcdefghijklmnopqrstuvwxyz0123456789ABCD', text: 'ok' }] })
    await handle.runTurn('go')
    const terminal = await handle.endInput()
    const joined = terminal.limitations.join('\n')
    expect(joined).toMatch(/stderr/u)
    expect(joined).not.toMatch(/sk-abcdefghijklmnopqrstuvwxyz0123/u)
    expect(joined).not.toMatch(/abcdefghijklmnopqrstuvwxyz0123456789ABCD/u)
  })
})
