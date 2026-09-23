/**
 * Pure protocol tests — stream parsing, the init/event guard, effect-intent
 * translation and the owner-decision authority evaluator.
 * WO-AERA-CODE-CLAUDE-CODE-GOVERNED-WORKER-INTEGRATION-001 §9/§10/§17.
 */
import { describe, expect, it } from 'vitest'
import type { DecisionV1 } from '@aera/participation-contracts'
import {
  MAX_STREAM_LINE_BYTES,
  StreamLineFramer,
  classifyAuth,
  evaluateEventGuard,
  evaluateInitGuard,
  parseStreamLine,
  resultUsage,
} from '../src/aera-claude-stream.ts'
import {
  MAX_INTENTS_PER_TURN,
  MAX_WRITE_BYTES,
  effectClassOf,
  extractIntentBatch,
  intentToActionRequest,
} from '../src/aera-worker-effect-intent.ts'
import {
  evaluateWorkerAuthority,
  formatWorkerGrant,
  parseWorkerGrant,
  workerAuthorityEnvelope,
} from '../src/aera-worker-authority.ts'
import { argvPolicyRefusal } from '../src/aera-worker-effect-broker.ts'

const CLEAN_INIT = {
  type: 'system', subtype: 'init', cwd: '/scratch', tools: [], mcp_servers: [], skills: [], slash_commands: [],
  plugins: [{ name: 'agents-md', path: 'builtin' }, { name: 'telemetry', path: 'builtin' }],
  apiKeySource: 'none', claude_code_version: '2.1.280', model: 'claude-haiku-4-5-20251001', agents: ['claude', 'Explore'],
}
const EXPECT = { scratchDirs: ['/scratch'], cliVersion: '2.1.280', model: 'haiku' }

describe('stream parsing (§17 streaming parsing / malformed output)', () => {
  it('frames lines across chunks and drops blank lines', () => {
    const framer = new StreamLineFramer()
    expect(framer.push('{"type":"a"}\n{"ty')).toEqual(['{"type":"a"}'])
    expect(framer.push('pe":"b"}\n\n')).toEqual(['{"type":"b"}'])
    expect(framer.remainder()).toBe('')
  })
  it('refuses an unbounded line', () => {
    expect(() => new StreamLineFramer().push('x'.repeat(MAX_STREAM_LINE_BYTES + 1))).toThrow('STREAM_LINE_TOO_LONG')
  })
  it('refuses non-JSON, non-object and untyped lines', () => {
    expect(parseStreamLine('nope').ok).toBe(false)
    expect(parseStreamLine('[1]').ok).toBe(false)
    expect(parseStreamLine('{"x":1}').ok).toBe(false)
    expect(parseStreamLine('{"type":"result"}').ok).toBe(true)
  })
  it('states the SIGINT usage gap and the notional cost basis', () => {
    expect(resultUsage({ type: 'result', terminal_reason: 'aborted_streaming', usage: { input_tokens: 0 } })).toMatchObject({ reported: false })
    expect(resultUsage({ type: 'result', terminal_reason: 'completed', usage: { input_tokens: 3, output_tokens: 4 }, total_cost_usd: 0.01 }))
      .toMatchObject({ reported: true, inputTokens: 3, outputTokens: 4, notionalCostUsd: 0.01 })
  })
})

describe('init / event guard (§7, probe-1 shape)', () => {
  it('accepts the proven isolated shape (only the two compiled-in builtins; model alias recorded)', () => {
    expect(evaluateInitGuard(CLEAN_INIT, EXPECT)).toEqual({ ok: true })
  })
  it('refuses the owner\'s installed plugins (what --safe-mode alone still listed)', () => {
    const verdict = evaluateInitGuard({ ...CLEAN_INIT, plugins: [...CLEAN_INIT.plugins, { name: 'superpowers', path: '/Users/x/.claude/plugins/cache/superpowers' }] }, EXPECT)
    expect(verdict).toMatchObject({ ok: false, code: 'PLUGINS_PRESENT' })
  })
  it('refuses a builtin-named plugin that is not actually builtin', () => {
    expect(evaluateInitGuard({ ...CLEAN_INIT, plugins: [{ name: 'telemetry', path: '/tmp/evil' }] }, EXPECT)).toMatchObject({ ok: false, code: 'PLUGINS_PRESENT' })
  })
  it('refuses an init that does not report its load surface', () => {
    const { tools: _omit, ...partial } = CLEAN_INIT
    expect(evaluateInitGuard(partial, EXPECT)).toMatchObject({ ok: false, code: 'INIT_MALFORMED' })
  })
  it('refuses slash commands', () => {
    expect(evaluateInitGuard({ ...CLEAN_INIT, slash_commands: ['/deploy'] }, EXPECT)).toMatchObject({ ok: false, code: 'SLASH_COMMANDS_PRESENT' })
  })
  it('enforces a concrete model pin exactly', () => {
    expect(evaluateInitGuard(CLEAN_INIT, { ...EXPECT, model: 'claude-haiku-4-5-20251001' })).toEqual({ ok: true })
    expect(evaluateInitGuard(CLEAN_INIT, { ...EXPECT, model: 'claude-opus-5-5-20260101' })).toMatchObject({ ok: false, code: 'MODEL_MISMATCH' })
  })
  it('refuses hook events, tool blocks on assistant AND user messages, and permission denials', () => {
    expect(evaluateEventGuard({ type: 'system', subtype: 'hook_response' })).toMatchObject({ ok: false, code: 'HOOK_ACTIVITY' })
    expect(evaluateEventGuard({ type: 'assistant', message: { content: [{ type: 'server_tool_use' }] } })).toMatchObject({ ok: false, code: 'NATIVE_TOOL_USE' })
    expect(evaluateEventGuard({ type: 'user', message: { content: [{ type: 'tool_result' }] } })).toMatchObject({ ok: false, code: 'NATIVE_TOOL_USE' })
    expect(evaluateEventGuard({ type: 'result', permission_denials: [{}] })).toMatchObject({ ok: false, code: 'PERMISSION_DENIALS' })
    expect(evaluateEventGuard({ type: 'rate_limit_event' })).toEqual({ ok: true })
  })
  it('classifies auth from non-secret facts only (§16)', () => {
    expect(classifyAuth({ apiKeySource: 'none', authenticationFailed: false, turnSucceeded: true })).toBe('SUBSCRIPTION_OAUTH')
    expect(classifyAuth({ apiKeySource: 'none', authenticationFailed: true, turnSucceeded: false })).toBe('NOT_LOGGED_IN')
    expect(classifyAuth({ apiKeySource: 'ANTHROPIC_API_KEY', authenticationFailed: false, turnSucceeded: true })).toBe('API_KEY_AUTH_REFUSED')
  })
})

const block = (batch: unknown): string => `thinking…\n\`\`\`aera-effect-intents\n${JSON.stringify(batch)}\n\`\`\`\n`
const BATCH = { version: 'AeraEffectIntentBatchV1', epochId: 'aera:worker-epoch:e1', status: 'CONTINUE' }

describe('effect-intent translation (§9)', () => {
  it('extracts a valid batch and maps it to the canonical ACTION_REQUEST', () => {
    const extraction = extractIntentBatch(block({ ...BATCH, intents: [{ intentId: 'i1', kind: 'fs.write', codeWorkingLineId: 'L', path: 'a.txt', content: 'x' }] }))
    expect(extraction.kind).toBe('BATCH')
    if (extraction.kind !== 'BATCH') return
    const intent = extraction.batch.intents[0]
    expect(intent).toBeDefined()
    if (intent === undefined) return
    expect(intentToActionRequest(intent, 'aera-repo:r')).toMatchObject({ kind: 'ACTION_REQUEST', operation: 'fs.write', resource: 'repo:aera-repo:r:a.txt' })
  })
  it('text without a block is NONE — prose is never an effect', () => {
    expect(extractIntentBatch('I have written the file and committed it.')).toEqual({ kind: 'NONE' })
  })
  it.each([
    ['two blocks', block(BATCH) + block(BATCH)],
    ['unterminated', '```aera-effect-intents\n{}'],
    ['not JSON', '```aera-effect-intents\n{nope}\n```'],
    ['wrong version', block({ ...BATCH, version: 'V0' })],
    ['unknown batch key', block({ ...BATCH, exec: 'rm -rf /' })],
    ['unknown kind', block({ ...BATCH, intents: [{ intentId: 'i', kind: 'fs.delete', codeWorkingLineId: 'L', path: 'x' }] })],
    ['unknown intent field', block({ ...BATCH, intents: [{ intentId: 'i', kind: 'fs.read', codeWorkingLineId: 'L', path: 'x', sudo: true }] })],
    ['shell string argv', block({ ...BATCH, intents: [{ intentId: 'i', kind: 'exec.shell', codeWorkingLineId: 'L', argv: 'rm -rf /' }] })],
    ['oversize write', block({ ...BATCH, intents: [{ intentId: 'i', kind: 'fs.write', codeWorkingLineId: 'L', path: 'x', content: 'x'.repeat(MAX_WRITE_BYTES + 1) }] })],
    ['duplicate ids', block({ ...BATCH, intents: [{ intentId: 'i', kind: 'git.status', codeWorkingLineId: 'L' }, { intentId: 'i', kind: 'git.status', codeWorkingLineId: 'L' }] })],
    ['too many intents', block({ ...BATCH, intents: Array.from({ length: MAX_INTENTS_PER_TURN + 1 }, (_, i) => ({ intentId: `i${String(i)}`, kind: 'git.status', codeWorkingLineId: 'L' })) })],
    ['missing required field', block({ ...BATCH, intents: [{ intentId: 'i', kind: 'fs.write', codeWorkingLineId: 'L', path: 'x' }] })],
  ])('rejects %s as a MALFORMED proposal', (_label, text) => {
    expect(extractIntentBatch(text).kind).toBe('MALFORMED')
  })
  it('maps every kind to an authority class; package/network/deploy/external have their own classes', () => {
    expect(effectClassOf('git.status')).toBe('git.read')
    expect(effectClassOf('git.push')).toBe('network')
    expect(effectClassOf('package.install')).toBe('package')
    expect(effectClassOf('fs.list')).toBe('fs.read')
  })
})

describe('local execution policy argv rules (§11)', () => {
  const root = '/work/repo'
  it.each([
    [['bash', '-c', 'echo pwned > x']],
    [['sh', 'script.sh']],
    [['curl', 'https://example.com']],
    [['npx', 'something']],
    [['npm', 'install', 'left-pad']],
    [['corepack', 'yarn', 'add', 'left-pad']],
    [['yarn']],
    [['pip', 'install', 'x']],
    [['node', '-e', 'require("fs").writeFileSync("/etc/x","")']],
    [['python3', '-c', 'print(1)']],
    [['git', 'commit', '-am', 'x']],
    [['rm', '-rf', '/']],
    [['cat', '../../etc/passwd']],
    [['/bin/rm', 'x']],
  ])('refuses %j', (argv) => {
    expect(argvPolicyRefusal(argv, root)).toBeTypeOf('string')
  })
  it.each([
    [['corepack', 'yarn', 'vitest', 'run', 'tests/x.spec.ts']],
    [['npm', 'test']],
    [['node', 'scripts/check.mjs']],
    [['yarn', 'run', 'typecheck']],
  ])('permits %j (confined, no network, no install)', (argv) => {
    expect(argvPolicyRefusal(argv, root)).toBeUndefined()
  })
})

const OWNER = 'aera:participant:owner'
const LINE = 'aera:code_working_line:one'
const decision = (overrides: Partial<DecisionV1> & { contribution?: unknown } = {}): DecisionV1 => ({
  decisionVersion: 'DecisionV1',
  decisionId: 'aera:decision:d1',
  workOrderId: 'WO-1',
  subject: 's',
  options: [{ optionId: 'grant', label: 'grant' }],
  selectedOptionId: 'grant',
  status: 'RECORDED',
  discussionIds: [],
  evidenceIds: [],
  codeWorkingLineIds: [LINE],
  checkpointIds: [],
  authorisedEffects: [formatWorkerGrant({ effectClass: 'fs.read' })],
  resultingEffects: [],
  contribution: { recordedBy: 'aera:participant:host', performedBy: OWNER, authorisedBy: OWNER },
  ...overrides,
} as unknown as DecisionV1)
const evaluate = (decisions: DecisionV1[], effectClass: Parameters<typeof evaluateWorkerAuthority>[0]['effectClass'], argv?: string[]) =>
  evaluateWorkerAuthority({ decisions, ownerPrincipalId: OWNER, workOrderId: 'WO-1', codeWorkingLineId: LINE, effectClass, ...(argv === undefined ? {} : { argv }) })

describe('owner-decision authority (§10 CAS/authority leg)', () => {
  it('round-trips grant strings and ignores foreign authorisedEffects', () => {
    const grant = { effectClass: 'exec.test' as const, argvPrefix: ['corepack', 'yarn', 'vitest'] }
    expect(parseWorkerGrant(formatWorkerGrant(grant))).toEqual(grant)
    expect(parseWorkerGrant('merge the PR')).toBeUndefined()
    expect(parseWorkerGrant('aera-worker/v1:fs.read argv=["x"]')).toBeUndefined()
    expect(parseWorkerGrant('aera-worker/v1:root.everything')).toBeUndefined()
  })
  it('authorises exactly what the owner granted', () => {
    expect(evaluate([decision()], 'fs.read')).toMatchObject({ kind: 'AUTHORISED', decisionId: 'aera:decision:d1', authorisedBy: OWNER })
  })
  it('mutation with read-only authority is READ_ONLY_AUTHORITY', () => {
    expect(evaluate([decision()], 'fs.write')).toMatchObject({ kind: 'DENIED', code: 'READ_ONLY_AUTHORITY' })
  })
  it('a revoked grant is AUTHORITY_REVOKED', () => {
    expect(evaluate([decision({ status: 'REVOKED' })], 'fs.read')).toMatchObject({ kind: 'DENIED', code: 'AUTHORITY_REVOKED' })
  })
  it('a grant on another Working Line is WORKING_LINE_NOT_GRANTED', () => {
    expect(evaluate([decision({ codeWorkingLineIds: ['aera:code_working_line:two'] as never })], 'fs.read')).toMatchObject({ kind: 'DENIED', code: 'WORKING_LINE_NOT_GRANTED' })
  })
  it('a decision not decided AND authorised by the owner grants nothing (an agent cannot self-authorise)', () => {
    expect(evaluate([decision({ contribution: { recordedBy: 'x', performedBy: 'aera:participant:agent', authorisedBy: 'aera:participant:agent' } } as never)], 'fs.read'))
      .toMatchObject({ kind: 'DENIED', code: 'NO_GRANT' })
  })
  it('an argv-pinned exec grant covers only commands with that prefix', () => {
    const pinned = decision({ authorisedEffects: [formatWorkerGrant({ effectClass: 'exec.test', argvPrefix: ['corepack', 'yarn', 'vitest'] })] })
    expect(evaluate([pinned], 'exec.test', ['corepack', 'yarn', 'vitest', 'run'])).toMatchObject({ kind: 'AUTHORISED' })
    expect(evaluate([pinned], 'exec.test', ['corepack', 'yarn', 'build'])).toMatchObject({ kind: 'DENIED', code: 'ARGV_NOT_GRANTED' })
  })
  it('no owner, no authority', () => {
    expect(evaluateWorkerAuthority({ decisions: [decision()], ownerPrincipalId: undefined, workOrderId: 'WO-1', codeWorkingLineId: LINE, effectClass: 'fs.read' }))
      .toMatchObject({ kind: 'DENIED', code: 'OWNER_UNKNOWN' })
  })
  it('the envelope lists only active owner grants', () => {
    expect(workerAuthorityEnvelope({ decisions: [decision(), decision({ decisionId: 'aera:decision:d2' as never, status: 'REVOKED' })], ownerPrincipalId: OWNER, workOrderId: 'WO-1' }))
      .toHaveLength(1)
  })
})
