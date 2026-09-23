/**
 * Deterministic fixtures for the governed Claude worker suites —
 * WO-AERA-CODE-CLAUDE-CODE-GOVERNED-WORKER-INTEGRATION-001 §17.
 *
 * FAKE CLI. A generated executable (absolute node shebang, so it runs under the
 * worker's `PATH=/usr/bin:/bin`) that speaks the Claude Code stream-json
 * protocol from a per-test script. Because it is a real file with a real
 * sha256, every test also exercises the binary pin. It can be told to
 * misbehave the way a compromised or changed CLI might: report tools/MCP/
 * plugins, fire hooks, emit tool_use blocks, write into its cwd, crash, hang,
 * emit malformed output, or fail authentication.
 *
 * REAL STORE + REAL GIT. A disposable `ParticipationStore`, an owner-supplied
 * ACTIVE Work Order, a registered HUMAN owner, and a Working Line whose
 * recorded location is a real git worktree on its own branch.
 */
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ParticipationStore } from '@aera/participation-runtime'
import { issueAeraPrincipalId, type AeraPrincipalId } from '@aera/cis-contracts'
import { worktreeInstance, type CodeWorkingLineV1 } from '@aera/participation-contracts'
import { sha256File, type ClaudeWorkerPin } from '../src/aera-claude-worker-host.ts'

export const FAKE_VERSION = '2.1.280-fake'
export const FAKE_MODEL = 'claude-fake-5-20260101'

/** One scripted turn of the fake CLI. */
export interface FakeTurn {
  /** Assistant text. `${ENV_KEYS}` / `${INPUT_SHA}` / `${INPUT}` are substituted. */
  readonly text?: string
  /** Intents to emit in an aera-effect-intents block (epochId/line filled in). */
  readonly intents?: readonly Record<string, unknown>[]
  readonly status?: 'CONTINUE' | 'HANDOFF' | 'DONE'
  readonly handoff?: { readonly summary: string, readonly nextSteps: readonly string[] }
  /** Override the batch epochId (stale-epoch tests). */
  readonly epochOverride?: string
  /** Override intents' codeWorkingLineId (wrong-line tests). */
  readonly lineOverride?: string
  readonly initTools?: readonly string[]
  readonly initMcp?: readonly unknown[]
  readonly initPlugins?: readonly unknown[]
  readonly initSkills?: readonly string[]
  readonly apiKeySource?: string
  readonly initModel?: string
  readonly initVersion?: string
  readonly initCwd?: string
  readonly writeFileInCwd?: string
  readonly writeFileAbsolute?: string
  readonly hookEvent?: boolean
  readonly toolUse?: boolean
  readonly permissionDenials?: boolean
  readonly malformed?: boolean
  readonly authFail?: boolean
  readonly hang?: boolean
  readonly crash?: number
  readonly stderr?: string
  /** Spawn a detached grandchild that outlives the fake (orphan test). */
  readonly spawnStraggler?: boolean
}

export interface FakeScript {
  readonly version?: string
  readonly model?: string
  readonly turns: readonly FakeTurn[]
}

const FAKE_SOURCE = String.raw`
const fs = require('node:fs')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const SCRIPT = JSON.parse(process.env.__NEVER__ ?? __SCRIPT__)
const argv = process.argv.slice(2)
const out = (event) => process.stdout.write(JSON.stringify(event) + '\n')
if (argv[0] === '--version') { process.stdout.write((SCRIPT.version || '${FAKE_VERSION}') + ' (Claude Code)\n'); process.exit(0) }
const REQUIRED = [['--tools', ''], ['--setting-sources', ''], ['--input-format', 'stream-json'], ['--output-format', 'stream-json'], ['--permission-prompts', 'none']]
for (const [flag, value] of REQUIRED) {
  const index = argv.indexOf(flag)
  if (index < 0 || argv[index + 1] !== value) { process.stderr.write('fake: missing isolation flag ' + flag + '\n'); process.exit(97) }
}
for (const flag of ['--safe-mode', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence']) {
  if (!argv.includes(flag)) { process.stderr.write('fake: missing ' + flag + '\n'); process.exit(97) }
}
if (argv.includes('--bare') || argv.includes('--resume') || argv.includes('--mcp-config')) process.exit(98)
const systemPrompt = argv[argv.indexOf('--system-prompt') + 1] || ''
const epochId = (/aera:worker-epoch:[0-9a-f-]+/.exec(systemPrompt) || [''])[0]
const lineId = (/codeWorkingLineId (aera:code_working_line:[A-Za-z0-9_-]+)/.exec(systemPrompt) || ['', ''])[1]
const model = SCRIPT.model || '${FAKE_MODEL}'
let turn = 0
let buffer = ''
let keepAlive
process.on('SIGINT', () => {
  out({ type: 'result', subtype: 'error_during_execution', is_error: true, terminal_reason: 'aborted_streaming', usage: { input_tokens: 0, output_tokens: 0 }, permission_denials: [] })
  process.exit(0)
})
process.on('SIGTERM', () => process.exit(143))
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index)
    buffer = buffer.slice(index + 1)
    if (line.trim() !== '') onMessage(JSON.parse(line))
  }
})
process.stdin.on('end', () => { if (keepAlive === undefined) process.exit(0) })
function onMessage(message) {
  turn += 1
  const step = SCRIPT.turns[turn - 1] || SCRIPT.turns[SCRIPT.turns.length - 1]
  const input = String(message.message && message.message.content)
  out({
    type: 'system', subtype: 'init', cwd: step.initCwd || process.cwd(), session_id: 'fake-session-' + turn,
    tools: step.initTools || [], mcp_servers: step.initMcp || [], skills: step.initSkills || [], slash_commands: [],
    plugins: step.initPlugins || [{ name: 'agents-md', path: 'builtin' }, { name: 'telemetry', path: 'builtin' }],
    agents: ['claude', 'Explore'], apiKeySource: step.apiKeySource || 'none',
    claude_code_version: step.initVersion || SCRIPT.version || '${FAKE_VERSION}', model: step.initModel || model,
  })
  if (step.stderr) process.stderr.write(step.stderr + '\n')
  if (step.writeFileInCwd) fs.writeFileSync(step.writeFileInCwd, 'native effect')
  if (step.writeFileAbsolute) fs.writeFileSync(step.writeFileAbsolute, 'native effect')
  if (step.spawnStraggler) spawn('/bin/sleep', ['30'], { stdio: 'ignore' }).unref()
  if (step.crash !== undefined) process.exit(step.crash)
  if (step.hang) { keepAlive = setInterval(() => {}, 1000); return }
  if (step.malformed) { process.stdout.write('this is not json\n'); return }
  if (step.hookEvent) out({ type: 'system', subtype: 'hook_started', hook_name: 'SessionStart' })
  if (step.toolUse) out({ type: 'assistant', message: { model, content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'git commit -am pwned' } }] } })
  if (step.authFail) {
    out({ type: 'assistant', error: 'authentication_failed', message: { model: '<synthetic>', content: [{ type: 'text', text: 'Not logged in · Please run /login' }] } })
    out({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in', terminal_reason: 'api_error', usage: { input_tokens: 0, output_tokens: 0 }, permission_denials: [] })
    return
  }
  let text = (step.text || '')
    .split('$' + '{ENV_KEYS}').join(Object.keys(process.env).sort().join(','))
    .split('$' + '{INPUT_SHA}').join(crypto.createHash('sha256').update(input).digest('hex').match(/.{8}/g).join('-'))
    .split('$' + '{INPUT}').join(input)
  if (step.intents !== undefined || step.status !== undefined) {
    const batch = {
      version: 'AeraEffectIntentBatchV1',
      epochId: step.epochOverride || epochId,
      status: step.status || 'CONTINUE',
      intents: (step.intents || []).map((intent) => Object.assign({ codeWorkingLineId: step.lineOverride || lineId }, intent)),
    }
    if (step.handoff) batch.handoff = step.handoff
    const FENCE = String.fromCharCode(96).repeat(3)
    text += '\n\n' + FENCE + 'aera-effect-intents\n' + JSON.stringify(batch) + '\n' + FENCE + '\n'
  }
  out({ type: 'assistant', message: { model, content: [{ type: 'thinking', thinking: '' }, { type: 'text', text }] } })
  out({
    type: 'result', subtype: 'success', is_error: false, result: text, session_id: 'fake-session-' + turn,
    usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 5 },
    modelUsage: { [model]: {} }, total_cost_usd: 0.001, duration_ms: 7, terminal_reason: 'completed',
    permission_denials: step.permissionDenials ? [{ tool_name: 'Write' }] : [],
  })
}
`

/** Write a fake CLI for `script` and return its pin. */
export async function makeFakeClaude(script: FakeScript, dir = mkdtempSync(join(tmpdir(), 'aera-fake-claude-'))): Promise<{ pin: ClaudeWorkerPin, path: string }> {
  const path = join(dir, 'claude-fake')
  const source = FAKE_SOURCE.replace('process.env.__NEVER__ ?? __SCRIPT__', JSON.stringify(JSON.stringify(script)))
  writeFileSync(path, `#!${process.execPath}\n${source}`)
  chmodSync(path, 0o755)
  return {
    path,
    pin: { binaryPath: path, sha256: await sha256File(path), version: script.version ?? FAKE_VERSION, model: script.model ?? FAKE_MODEL },
  }
}

const GIT_IDENTITY = ['-c', 'user.email=test@example.invalid', '-c', 'user.name=TEST Owner']

export function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...GIT_IDENTITY, ...args], { encoding: 'utf8' }).trim()
}

export interface WorkerWorld {
  readonly base: string
  readonly storeDir: string
  readonly store: ParticipationStore
  readonly workOrderId: string
  readonly owner: AeraPrincipalId
  readonly delegationId: string
  readonly repoRoot: string
  readonly branch: string
  readonly line: CodeWorkingLineV1
  readonly otherLine: CodeWorkingLineV1
  readonly scratchRoot: string
}

/** A disposable institution: store, owner, ACTIVE owner-supplied WO, git worktree, two Working Lines. */
export function makeWorkerWorld(workOrderId = 'WO-TEST-CLAUDE-WORKER-001'): WorkerWorld {
  const base = mkdtempSync(join(tmpdir(), 'aera-worker-world-'))
  const storeDir = join(base, 'store')
  const repoRoot = join(base, 'repo')
  const scratchRoot = join(base, 'scratch')
  mkdirSync(repoRoot, { recursive: true })
  mkdirSync(scratchRoot, { recursive: true })
  const branch = 'agc/test-worker-line'
  execFileSync('git', ['-C', repoRoot, 'init', '-q', '-b', 'main'])
  writeFileSync(join(repoRoot, 'README.md'), '# synthetic TEST repository\nfirst line\n')
  git(repoRoot, 'add', 'README.md')
  git(repoRoot, 'commit', '-qm', 'test: seed')
  git(repoRoot, 'config', 'user.email', 'test@example.invalid')
  git(repoRoot, 'config', 'user.name', 'TEST Owner')
  git(repoRoot, 'checkout', '-q', '-b', branch)
  const head = git(repoRoot, 'rev-parse', 'HEAD')

  const store = new ParticipationStore(storeDir)
  const owner = issueAeraPrincipalId()
  store.registerHumanParticipant({ principalId: owner, displayName: 'TEST Owner' })
  store.registerWorkOrder({
    workOrderId,
    title: 'TEST governed Claude worker order',
    exactPayload: 'OBJECTIVE: make README say hello.\nACCEPTANCE: README.md contains "hello from the governed worker".\n',
    authorityClass: 'OWNER_SUPPLIED',
    lifecycleStatus: 'ACTIVE',
    owner: { principalId: owner, displayName: 'TEST Owner' },
    source: { nativeSessionId: 's', messageId: 'm', eventSequence: 1, submittedAt: new Date().toISOString() },
  })
  const delegationId = 'delegation-test-worker-1'
  const seeder = store.ensureAgentPrincipal({ displayName: 'TEST Line Seeder', agentRole: 'ORCHESTRATOR', createdBy: owner })
  const seedSession = store.openSession({
    principalId: seeder.principalId,
    workOrderId,
    delegationRef: { delegationId, delegatorPrincipalId: owner, authorityMode: 'RECORDED_NOT_ENFORCED' },
  })
  const repositoryId = 'aera-repo:test-worker-repo' as Parameters<ParticipationStore['openWorkingLine']>[0]['repositoryId']
  const open = (label: string, branchRef: string): CodeWorkingLineV1 => store.openWorkingLine({
    sessionId: seedSession.sessionId,
    idempotencyKey: label,
    authorisingWorkOrderId: workOrderId,
    workOrderId,
    repositoryId,
    originAcceptedStateId: 'aera:accepted_integration_state:test-seed' as Parameters<ParticipationStore['openWorkingLine']>[0]['originAcceptedStateId'],
    originRevision: head,
    integrationTarget: { kind: 'ACCEPTED_INTEGRATION_STATE', repositoryId, targetRef: 'main' },
    expectedTargetRevision: head,
    label,
    branchRef,
    worktrees: [worktreeInstance({ repositoryId, localPath: repoRoot, branchRef, headRevision: head, dirtyState: 'CLEAN' })],
  }).line
  const line = open('TEST worker line', branch)
  const otherLine = open('TEST other line', 'agc/some-other-branch')
  store.closeSession(seedSession.sessionId)
  return { base, storeDir, store, workOrderId, owner, delegationId, repoRoot, branch, line, otherLine, scratchRoot }
}

/** Poisoned parent environment: every secret-shaped variable a worker must never see. */
export const POISONED_PARENT_ENV: Readonly<Record<string, string>> = Object.freeze({
  HOME: process.env.HOME ?? '/tmp',
  USER: process.env.USER ?? 'test',
  LOGNAME: process.env.LOGNAME ?? process.env.USER ?? 'test',
  PATH: process.env.PATH ?? '/usr/bin:/bin',
  CLAUDE_CODE_MESSAGING_TOKEN: 'cc-msg-token-SHOULD-NEVER-LEAK-0123456789abcdef',
  CLAUDE_CODE_SESSION_ID: 'controller-session',
  CLAUDECODE: '1',
  ANTHROPIC_API_KEY: 'sk-ant-SHOULD-NEVER-LEAK-0123456789abcdef',
  AERA_GATEWAY_AGC_EXECUTION_KEY: 'aera-exec-key-SHOULD-NEVER-LEAK',
  AERA_COLLAB_STORE_DIR: '/should/never/leak',
})
