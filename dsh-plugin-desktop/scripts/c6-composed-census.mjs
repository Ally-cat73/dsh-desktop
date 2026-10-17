/** Complete model-surface fixture capture using the real desktop Loader/presets. */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { ensureDesktopProfile, prepareDesktopProfile } from '../lib/profile.js'
import { installProfilePackageResolver } from '../lib/module-resolution.js'
import { boot, composeEntries } from '@deepseek-ai/dsh-app-boot'
import { LlmAdapter, createUserMessage, CallId, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { createProvider } from '@earendil-works/pi-ai'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import { buildFactoryContextFixture, FIXTURE_PRINCIPALS, FIXTURE_WORK_ORDERS } from '../tests/support/institutional-context-fixture.ts'

const scripts = dirname(fileURLToPath(import.meta.url))
const output = process.env.AERA_C6_OUT
assert(output, 'AERA_C6_OUT must designate an evidence directory')
mkdirSync(output, { recursive: true })
const json = value => JSON.stringify(value, (key, val) => key === 'signal' ? undefined : val)
const clone = value => JSON.parse(json(value))
const bytes = value => Buffer.byteLength(typeof value === 'string' ? value : json(value))
const role = process.env.AERA_C6_ROLE ?? 'IMPLEMENTER'
const home = mkdtempSync(join(tmpdir(), 'aera-c6-composition-'))
process.env.DSH_HOME = home
process.env.HOME = home
process.env.DSH_TELEMETRY_DISABLED = '1'
const repo = join(home, 'fixture-repository')
mkdirSync(join(repo, '.agents/skills/c6-coding'), { recursive: true })
mkdirSync(join(repo, '.agents/skills/c6-calendar'), { recursive: true })
writeFileSync(join(repo, 'AGENTS.md'), '# C6 fixture repository\nPreserve the public greeting API. Make only the requested coding change. Use local deterministic tests. Do not access credentials or external services.\n')
writeFileSync(join(repo, 'greeting.ts'), 'export const greeting = () => "hello"\n')
for (const [name, description, body] of [
  ['c6-coding', 'Inspect and test the synthetic greeting function.', 'C6 CODING SKILL: inspect greeting.ts; preserve its exported signature; use only inert local evidence.'],
  ['c6-calendar', 'Inspect synthetic calendar metadata for a scheduling task.', 'C6 CALENDAR SKILL: this is unrelated to the greeting coding task.'],
]) writeFileSync(join(repo, `.agents/skills/${name}/SKILL.md`), `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`)
execFileSync('git', ['init', '-q', repo])
execFileSync('git', ['-C', repo, 'add', 'AGENTS.md', 'greeting.ts', '.agents'])
const storeDir = join(home, 'participation')
const ids = buildFactoryContextFixture(storeDir)
Object.assign(process.env, {
  AERA_COLLAB_STORE_DIR: storeDir, AERA_COLLAB_CORPUS_ROOT: repo, AERA_COLLAB_STACK_ROOT: repo,
  AERA_COLLAB_WORKSPACE_ROOT: repo, AERA_COLLAB_PRINCIPAL_ID: FIXTURE_PRINCIPALS.owner,
  AERA_COLLAB_PRINCIPAL_NAME: 'C6 Fixture Owner', AERA_COLLAB_AGENT_NAME: `C6 ${role}`,
  AERA_COLLAB_AGENT_ROLE: role, AERA_COLLAB_DELEGATION_ID: `delegation-c6-${role.toLowerCase()}`,
})
ensureDesktopProfile(home)
writeFileSync(join(home, 'profiles/desktop/cordis.patch.yml'), `- insert:\n  - id: c6-owner-overlay\n    name: ${pathToFileURL(join(scripts, 'c6-fixture-overlay.mjs')).href}\n`)
const prepared = prepareDesktopProfile('1', home)
const release = installProfilePackageResolver(prepared.bareModuleBaseUrl)
const headlessIds = ['desktop-terminal', 'aera-collab-workspace', 'desktop-diagnostics', 'desktop-notifications', 'desktop-updates', 'desktop-pnpm', 'desktop-profiles', 'session-title-llm']
const overrides = [
  { id: 'webserver', config: { host: '127.0.0.1', port: 0 } },
  ...headlessIds.map(id => ({ id, disabled: true })),
  { insert: [{ id: 'c6-mcp', name: '@deepseek-ai/dsh-mcp-client', config: { transport: 'stdio', serverName: 'c6', command: process.execPath, args: [join(scripts, 'c6-inert-mcp.mjs')], env: {}, cwd: repo, failOnStartupError: true } }] },
]
const captures = [], assemblies = new Map(), labels = new Map(), scriptsById = new Map()
let ctx, callSequence = 0
const model = { id: 'c6-fixture', name: 'C6 inert fixture', api: 'openai-responses', provider: 'c6-inert', baseUrl: 'https://c6.invalid/v1', reasoning: false, input: ['text'], contextWindow: 1000000, maxTokens: 256, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }
const piProvider = createProvider({ id: model.provider, models: [model], api: openAIResponsesApi(), auth: { apiKey: { name: 'C6 fixture', resolve: async () => ({ auth: { apiKey: 'C6_INERT_NOT_A_CREDENTIAL' } }) } } })
const profile = { provider: model.provider, displayName: 'C6 inert', streamIdleTimeoutMs: 1000, configuredMaxTokens: new Map(), piProvider, maxRequestImageBytes: 1048576, requestImagePixelBudget: 1000000, requestImageMaxBytes: 1048576, retryPolicy: resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'c6-inert') }
const realAdapter = new PiAiAdapter({ profiles: () => new Map([[model.provider, profile]]), resolveApiKey: async () => 'C6_INERT_NOT_A_CREDENTIAL', auth: { credentials: { read: async () => undefined, list: async () => [], modify: async (_id, fn) => fn(undefined), delete: async () => {} }, authContext: { env: async () => undefined, fileExists: async () => false } } })
function* responseChunks(spec) {
  if (spec?.tool) {
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId(spec.callId ?? `c6_call_${++callSequence}`), name: spec.tool, arguments: JSON.stringify(spec.args ?? {}) } }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  } else {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: spec?.text ?? 'C6 inert completion.' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: spec?.text ?? 'C6 inert completion.' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
class CaptureAdapter extends LlmAdapter {
  resolveModel(provider, name, signal) { return realAdapter.resolveModel(provider, name, signal) }
  async prepareCall(provider, model, signal) {
    const prepared = await realAdapter.prepareCall(provider, model, signal)
    return { model: prepared.model, stream: options => this.capture(options, prepared.stream) }
  }
  stream() { throw new Error('C6 capture must use the real prepared adapter closure') }
  async *capture(options, preparedStream) {
    const spec = scriptsById.get(options.sessionId)?.shift()
    const before = json(options), wire = []
    const previous = globalThis.fetch
    globalThis.fetch = async (url, init) => {
      assert(String(url).startsWith('https://c6.invalid/'), 'Non-fixture network request refused')
      assert.equal(typeof init?.body, 'string')
      wire.push({ url: String(url), body: init.body })
      return new Response('data: {"type":"response.completed","response":{"id":"c6_response","status":"completed","usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }
    try { for await (const _chunk of preparedStream(options)) { /* transport response deliberately inert */ } }
    finally { globalThis.fetch = previous }
    assert.equal(json(options), before, 'Capture or serialization mutated GenerateOptions')
    assert.equal(wire.length, 1, 'Exactly one inert serialization must be captured')
    // Control serialization uses the same prepared adapter without request/assembly capture.
    const control = []
    globalThis.fetch = async (url, init) => {
      assert(String(url).startsWith('https://c6.invalid/'))
      control.push(init.body)
      return new Response('data: {"type":"response.completed","response":{"id":"c6_response","status":"completed","usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }
    try { for await (const _chunk of preparedStream(options)) {} }
    finally { globalThis.fetch = previous }
    assert.deepEqual(control, [wire[0].body], 'Captured and control provider serialization differ')
    assert.equal(json(options), before)

    captures.push({ label: spec?.label ?? labels.get(options.sessionId) ?? 'child', sessionId: options.sessionId, request: clone(options), assembly: clone(assemblies.get(options.sessionId) ?? {}), provider: wire[0], generateOptionsBytes: bytes(before), providerSerializedBytes: bytes(wire[0].body), immutable: Object.isFrozen(options), preparedAdapter: true, captureControlEquivalent: true })
    yield* responseChunks(spec)
  }
}
try {
  ctx = await boot('C6-inert-census', prepared.rootConfig, [...prepared.patches, ...overrides], host => {
    host.loader.internal = undefined
    host.provide('cmdlineArgs', { get: () => ['--no-open', '--port', '0'] })
    host.provide('appExit', () => {})
    host.provide('desktopBrowserAccess', { ordinaryBrowserEnabled: false, rendererHeader: { name: 'x-c6-fixture', value: 'inert' } })
    host.provide('desktopRuntime', { platform: process.platform, updates: { currentVersion: '2.0.4' }, schedule() { return async () => {} }, mountScheduled: async () => {}, show() {}, requestRestart: async () => {}, prepareToQuit() {} })
  }, prepared.bareModuleBaseUrl)
  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const result = await next()
    if (context.agent) assemblies.set(String(context.agent.id), result)
    return result
  })
  ctx.llm.registerAdapter(['c6-inert'], new CaptureAdapter())
  ctx.on('subagent/start', info => labels.set(String(info.id), `${role}/standard/child-${info.provider ?? 'backend'}`))
  const children = []
  const presets = process.env.AERA_C6_PRESETS?.split(',') ?? ['standard', 'code', 'minimal', 'cordis']
  for (const preset of presets) {
    const id = `c6-${role.toLowerCase()}-${preset}`
    labels.set(id, `${role}/${preset}/fresh`)
    const handle = await ctx.agentLoop.createAgent(ctx, { sessionId: SessionId(id), meta: { cwd: repo, agentPreset: preset }, agentOptions: { provider: 'c6-inert', model: model.id }, setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, preset) } })
    const agent = handle.agent
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'C6 fixture: inspect the greeting implementation without changing its public API.' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    console.log('CAPTURED', labels.get(id), captures.at(-1)?.generateOptionsBytes)
    if (preset === 'standard') {
      const follow = async (label, text, specs = []) => {
        labels.set(id, `${role}/${preset}/${label}`)
        scriptsById.set(id, specs.map(spec => ({ ...spec, label: `${role}/${preset}/${spec.label ?? label}` })))
        agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
        await agent.whenIdle()
      }
      await follow('resolve', 'Resolve the fixture Work Order for this coding task.', [
        { tool: 'aera_collab_resolve_work_context', args: { work_order_id: FIXTURE_WORK_ORDERS.target } },
        { label: 'tool-only-after-resolve' },
      ])
      await follow('joined', 'Continue the joined fixture Work Order. Preserve its authority constraints.')
      for (let i = 1; i <= 8; i++) await follow(`steady-${i}`, 'Continue the bounded fixture task. Keep existing authority and evidence constraints.')
      await follow('continuing', 'Inspect the inert greeting evidence.', [
        { tool: 'mcp__c6__inspect_fixture', args: { path: 'greeting.ts' } }, { label: 'tool-only-mcp-result' },
      ])
      await follow('loaded-skill', '/c6-coding Inspect this fixture using the skill.')
      for (const packetRole of role === 'IMPLEMENTER' ? ['IMPLEMENTER', 'REVIEWER', 'ARCHITECT', 'RESEARCHER', 'INCIDENT_RESPONDER'] : role === 'REVIEWER' ? ['REVIEWER'] : []) {
        const args = { role: packetRole }
        if (packetRole === 'REVIEWER') Object.assign(args, { review_pass: 'PASS_A', candidate_repository_id: ids.candidate.repositoryId, candidate_revision: ids.candidate.candidateRevision, base_revision: ids.candidate.baseRevision })
        await follow(`packet-${packetRole}`, `Retrieve the ${packetRole} fixture institutional packet.`, [
          { tool: 'aera_collab_institutional_context', args }, { label: `packet-${packetRole}-result` },
        ])
      }
      for (const backend of ['spawn', 'fork']) {
        const run = await ctx.subagents.start(backend, { label: `C6 ${role} ${backend}`, parent: agent, signal: new AbortController().signal,
          agentOptions: { provider: 'c6-inert', model: model.id },
          prompt: [{ type: 'text', text: `C6 ${role}-style child. Work Order ${FIXTURE_WORK_ORDERS.target}. Inspect greeting.ts; preserve its public API. Do not change authority or external state. Retrieve evidence through the collaboration tools if needed.` }] })
        const result = await run.result
        children.push({ backend, roleStyle: role, id: run.id, parent: id, meta: clone(run.localAgent?.session.header), result: clone(result), toolFilter: null })
        await run.dispose()
      }
      // Controlled presentation comparison: identical standard preset with scoped Code Mode.
      const codeId = `${id}-code-presentation`
      labels.set(codeId, `${role}/standard/code-presentation`)
      const code = await ctx.agentLoop.createAgent(ctx, { sessionId: SessionId(codeId), meta: { cwd: repo, agentPreset: preset }, agentOptions: { provider: 'c6-inert', model: model.id }, setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, preset); agentCtx.tools.presentAs('code') } })
      code.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'C6 fixture: inspect the greeting implementation without changing its public API.' }], source: { kind: 'user' } }))
      await code.agent.whenIdle()
    }
  }
  writeFileSync(join(output, `${role}-captures.json`), JSON.stringify({ role, fixtureHome: home, children, mechanism: 'MECHANISM_MEASURED; OWNER_CONFIGURATION_NOT_MEASURED', headlessExclusions: headlessIds, effectiveRows: composeEntries([prepared.patches, overrides]), captures }, null, 2) + '\n')
} finally { await ctx?.fiber.dispose(); release() }
