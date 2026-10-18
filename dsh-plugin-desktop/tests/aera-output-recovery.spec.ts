/** C5: real collected subprocess output, shell results and canonical desktop tool rendering. */
import { mkdtempSync, readFileSync, writeFileSync, existsSync, unlinkSync, writeSync, closeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import LocalBash from '@deepseek-ai/dsh-bash-local'
import '@deepseek-ai/dsh-agent-presets'
import { CallId, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { boot } from '@deepseek-ai/dsh-app-boot'
import { ensureDesktopProfile, prepareDesktopProfile } from '../src/profile.ts'
import { installProfilePackageResolver } from '../src/module-resolution.ts'

const base = mkdtempSync(join(tmpdir(), 'c5-output-fixtures-'))
const signal = (): AbortSignal => new AbortController().signal
const text = (result: { content: readonly { type: string, text?: string }[] }): string => result.content.map(b => b.text ?? '').join('\n')
const contexts: Context[] = []
afterAll(async () => { for (const ctx of contexts) await ctx.fiber.dispose() })

async function local(maxBytes = 64, cap = 256): Promise<Context> {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(SubprocessLocal)
  await ctx.plugin(LocalBash, { cwd: base, maxOutputBytes: maxBytes, maxSpillBytes: cap, graceMs: 30 })
  return ctx
}
function collected(ctx: Context, source: string) {
  return ctx.subprocess.spawn({ argv: [process.execPath, '-e', source], cwd: base,
    stdio: { stdin: 'ignore', stdout: { maxBytes: 64, spill: { maxBytes: 256 } }, stderr: { maxBytes: 64, spill: { maxBytes: 256 } } }, graceMs: 30 })
}

// This assertion fails on the exact pre-fix reader: it still returns the deleted path.
it('withdraws a missing artifact on the next real reader lookup without replaying the process', async () => {
  const ctx = await local(), handle = collected(ctx, "require('node:fs').writeSync(1,Buffer.alloc(128,120))")
  await handle.done
  const first = handle.collected.stdout!.readFrom(0)
  expect(first.spillPath).toBeTruthy(); unlinkSync(first.spillPath!)
  const missing = handle.collected.stdout!.readFrom(0)
  expect(missing.spillPath).toBeUndefined()
  expect(missing.capture).toMatchObject({ state: 'UNAVAILABLE', originalBytes: 128, capturedBytes: 64, omittedBytes: 64, artifactAvailability: 'UNAVAILABLE' })
  expect(await handle.done).toMatchObject({ exitCode: 0, signal: null })
})

it.each([['below', 255, 'COMPLETE'], ['at', 256, 'COMPLETE'], ['above', 257, 'PARTIAL']] as const)('%s effective spill cap has truthful byte accounting', async (_name, count, state) => {
  const ctx = await local(), handle = collected(ctx, `require('node:fs').writeSync(1,Buffer.alloc(${count},120))`)
  await handle.done
  const read = handle.collected.stdout!.readFrom(0)
  expect(read.lossy).toBe(true)
  expect(read.capture).toMatchObject({ state, originalBytes: count, capturedBytes: state === 'COMPLETE' ? count : 64, omittedBytes: state === 'COMPLETE' ? 0 : count - 64 })
  if (state === 'COMPLETE') expect(readFileSync(read.spillPath!)).toEqual(Buffer.alloc(count, 120))
  else { expect(read.spillPath).toBeUndefined(); expect(read.capture?.reason).toBe('SPILL_CAP_EXCEEDED') }
})

it('small success and nonzero exit keep execution outcome independent from complete capture', async () => {
  const ctx = await local()
  for (const exit of [0, 7]) {
    const handle = collected(ctx, `require('node:fs').writeSync(1,'hello');process.exitCode=${exit}`)
    expect(await handle.done).toMatchObject({ exitCode: exit, signal: null })
    expect(handle.collected.stdout!.readFrom(0)).toMatchObject({ text: 'hello', lossy: false, capture: { state: 'COMPLETE', originalBytes: 5, capturedBytes: 5, omittedBytes: 0 } })
  }
})

it('long single-line and UTF-8 split tails retain complete raw artifacts without guessing from decoded string size', async () => {
  const ctx = await local()
  const payload = Buffer.from('🌿'.repeat(40) + 'x')
  const handle = collected(ctx, `require('node:fs').writeSync(1,Buffer.from('${payload.toString('hex')}','hex'))`)
  await handle.done
  const read = handle.collected.stdout!.readFrom(0)
  expect(read.capture).toMatchObject({ state: 'COMPLETE', originalBytes: payload.length, capturedBytes: payload.length, omittedBytes: 0 })
  expect(readFileSync(read.spillPath!)).toEqual(payload)
})

it('stdout/stderr keep separate exact streams and the established stdout-then-stderr shell representation', async () => {
  const ctx = await local()
  const result = await ctx.shell.run(ctx.shell.resolve({ command: `printf out; printf err >&2`, workdir: base }))
  expect(result.stdout.text).toBe('out'); expect(result.stderr.text).toBe('err')
  expect(result.stdout.recovery).toContain('capture COMPLETE'); expect(result.stderr.recovery).toContain('capture COMPLETE')
})

it.each(['CREATE', 'WRITE', 'FINALIZE', 'LOOKUP'] as const)('%s capture failure stays separate from exit zero', async stage => {
  const ctx = await local()
  const failure = () => { throw Object.assign(new Error('synthetic I/O failure'), { code: stage === 'WRITE' ? 'ENOSPC' : 'EIO' }) }
  ;(ctx.subprocess as SubprocessLocal).internals.captureIo = stage === 'CREATE' ? { openSync: failure } : stage === 'WRITE' ? { writeSync: failure } : stage === 'LOOKUP' ? { lstatSync: failure } : {
    closeSync: (fd: number) => { closeSync(fd); failure() },
  }
  const handle = collected(ctx, "require('node:fs').writeSync(1,Buffer.alloc(128,120))")
  expect(await handle.done).toMatchObject({ exitCode: 0, signal: null })
  const read = handle.collected.stdout!.readFrom(0)
  expect(read.spillPath).toBeUndefined(); expect(read.text.length).toBe(64)
  expect(read.capture?.state).toBe(stage === 'LOOKUP' ? 'UNAVAILABLE' : 'PARTIAL')
  if (stage !== 'LOOKUP') expect(read.capture?.failure?.stage).toBe(stage)
})

it('retries only short artifact writes, never command effects; zero-progress writes fail truthfully', async () => {
  const ctx = await local()
  ;(ctx.subprocess as SubprocessLocal).internals.captureIo = { writeSync: ((fd: number, buffer: Buffer, offset: number, length: number) => writeSync(fd, buffer, offset, Math.min(length, 7))) as typeof writeSync }
  const handle = collected(ctx, "require('node:fs').writeSync(1,Buffer.alloc(128,120))")
  await handle.done; const read = handle.collected.stdout!.readFrom(0)
  expect(read.capture?.state).toBe('COMPLETE'); expect(readFileSync(read.spillPath!)).toEqual(Buffer.alloc(128, 120))
  ;(ctx.subprocess as SubprocessLocal).internals.captureIo = { writeSync: (() => 0) as typeof writeSync }
  const stalled = collected(ctx, "require('node:fs').writeSync(1,Buffer.alloc(128,120))")
  await stalled.done
  expect(stalled.collected.stdout!.readFrom(0).capture).toMatchObject({ state: 'PARTIAL', failure: { stage: 'WRITE', code: 'EIO' } })
})

it('does not advertise a replacement/truncated file as the original complete capture', async () => {
  const ctx = await local(), handle = collected(ctx, "require('node:fs').writeSync(1,Buffer.alloc(128,120))")
  await handle.done; const path = handle.collected.stdout!.readFrom(0).spillPath!
  writeFileSync(path, 'changed')
  expect(handle.collected.stdout!.readFrom(0)).toMatchObject({ capture: { state: 'UNAVAILABLE', reason: 'ARTIFACT_CHANGED' } })
  expect(handle.collected.stdout!.readFrom(0).spillPath).toBeUndefined()
})

it('withdraws a same-length in-place rewrite of the original artifact', async () => {
  const ctx = await local(), handle = collected(ctx, "require('node:fs').writeSync(1,Buffer.alloc(128,120))")
  await handle.done
  const path = handle.collected.stdout!.readFrom(0).spillPath!
  writeFileSync(path, Buffer.alloc(128, 121))
  const read = handle.collected.stdout!.readFrom(0)
  expect(read.spillPath).toBeUndefined()
  expect(read.capture).toMatchObject({ state: 'UNAVAILABLE', capturedBytes: 64, omittedBytes: 64, reason: 'ARTIFACT_CHANGED' })
})

it('never rebaselines a changed artifact when later command output arrives', async () => {
  const ctx = await local(), release = join(base, 'release-append')
  const source = `const fs=require('node:fs');fs.writeSync(1,Buffer.alloc(128,120));const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)})){clearInterval(timer);fs.writeSync(1,Buffer.alloc(64,122))}},5)`
  const handle = collected(ctx, source)
  await vi.waitFor(() => expect(handle.collected.stdout!.readFrom(0).nextOffset).toBe(128), { timeout: 1500 })
  const path = handle.collected.stdout!.readFrom(0).spillPath!
  writeFileSync(path, Buffer.alloc(128, 121)); writeFileSync(release, 'release')
  expect(await handle.done).toMatchObject({ exitCode: 0, signal: null })
  const read = handle.collected.stdout!.readFrom(0)
  expect(read.text).toBe('z'.repeat(64)); expect(read.spillPath).toBeUndefined()
  expect(read.capture).toMatchObject({ state: 'PARTIAL', observedBytes: 192, capturedBytes: 64, omittedBytes: 128, reason: 'ARTIFACT_CHANGED' })
})

function delayedPipeSource(count: number, marker: string): string {
  const late = `setTimeout(()=>{require('node:fs').writeFileSync(${JSON.stringify(marker)},'attempted');try{require('node:fs').writeSync(1,'LATE_SYNTHETIC')}catch{}},180)`
  return `require('node:fs').writeSync(1,Buffer.alloc(${count},120));require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(late)}],{stdio:['ignore',1,2]});process.exit(0)`
}
it.each([32, 128])('forced non-EOF pipe closure with %s observed bytes keeps unknown totals separate from exit zero', async count => {
  const ctx = await local(), marker = join(base, `late-${count}`)
  const handle = collected(ctx, delayedPipeSource(count, marker))
  expect(await handle.done).toMatchObject({ exitCode: 0, signal: null })
  const read = handle.collected.stdout!.readFrom(0)
  expect(read.capture).toMatchObject({ state: 'PARTIAL', observedBytes: count, originalBytes: 'UNKNOWN', capturedBytes: count, omittedBytes: 'UNKNOWN', reason: 'PIPE_CLOSED_BEFORE_EOF' })
  if (count > 64) expect(readFileSync(read.spillPath!)).toEqual(Buffer.alloc(count, 120))
  await new Promise(resolve => setTimeout(resolve, 350))
  expect(existsSync(marker)).toBe(true)
})

it('timeout and cancellation preserve their execution facts and observed capture facts', async () => {
  const ctx = await local()
  const command = `'${process.execPath}' -e "require('node:fs').writeSync(1,'started');setInterval(()=>{},1000)"`
  const timed = await ctx.shell.run(ctx.shell.resolve({ command, workdir: base, timeoutMs: 100 }))
  expect(timed.timedOut).toBe(true); expect(timed.stdout.recovery).toContain('capture COMPLETE')
  const cancel = new AbortController(); const running = ctx.shell.run(ctx.shell.resolve({ command, workdir: base, timeoutMs: 10000, signal: cancel.signal }))
  setTimeout(() => cancel.abort(), 100)
  const cancelled = await running
  expect(cancelled.aborted).toBe(true); expect(cancelled.timedOut).toBe(false); expect(cancelled.stdout.recovery).toContain('capture COMPLETE')
})

it('mixed invalid UTF-8 remains the existing text-with-replacement route; the complete raw artifact preserves bytes', async () => {
  const ctx = await local(), payload = Buffer.concat([Buffer.from('text:'), Buffer.alloc(128, 255)])
  const handle = collected(ctx, `require('node:fs').writeSync(1,Buffer.from('${payload.toString('hex')}','hex'))`)
  await handle.done; const read = handle.collected.stdout!.readFrom(0)
  expect(read.text).toContain('�'); expect(read.capture?.state).toBe('COMPLETE')
  expect(readFileSync(read.spillPath!)).toEqual(payload)
})

class InertModel extends LlmAdapter {
  override async *stream(): AsyncIterable<StreamChunk> { yield { type: 'finish', reason: { kind: 'stop' } } }
}

describe('actual prepared desktop/default preset output edge', () => {
  let ctx: Context, release: () => void, agent: NonNullable<ReturnType<Context['agents']['get']>>
  const home = join(base, 'desktop')
  const writer = join(base, 'output.cjs')
  beforeAll(async () => {
    writeFileSync(writer, `const fs=require('node:fs');let n=Number(process.argv[2]);const b=Buffer.alloc(65536,120);while(n>0)n-=fs.writeSync(1,b,0,Math.min(n,b.length))`)
    vi.stubEnv('HOME', home); vi.stubEnv('DSH_HOME', home); vi.stubEnv('DSH_TELEMETRY_DISABLED', '1')
    vi.stubEnv('AERA_COLLAB_STORE_DIR', join(home, 'participation'))
    vi.stubEnv('AERA_COLLAB_CORPUS_ROOT', base); vi.stubEnv('AERA_COLLAB_STACK_ROOT', base); vi.stubEnv('AERA_COLLAB_WORKSPACE_ROOT', base)
    ensureDesktopProfile(home); const prepared = prepareDesktopProfile('1', home)
    release = installProfilePackageResolver(prepared.bareModuleBaseUrl)
    const excluded = ['desktop-terminal','aera-collab-workspace','desktop-diagnostics','desktop-notifications','desktop-updates','desktop-pnpm','desktop-profiles','session-title-llm']
    ctx = await boot('C5-fixture', prepared.rootConfig, [...prepared.patches, { id: 'webserver', config: { host: '127.0.0.1', port: 0 } }, ...excluded.map(id => ({ id, disabled: true }))], host => {
      host.loader.internal = undefined
      host.provide('cmdlineArgs', { get: () => ['--no-open','--port','0'] })
      host.provide('appExit', () => {})
      host.provide('desktopBrowserAccess', { ordinaryBrowserEnabled: false, rendererHeader: { name: 'x-c5-fixture', value: 'inert' } })
      host.provide('desktopRuntime', { platform: process.platform, updates: { currentVersion: '2.0.4' }, schedule() { return async () => {} }, mountScheduled: async () => {}, show() {}, requestRestart: async () => {}, prepareToQuit() {} })
    }, prepared.bareModuleBaseUrl)
    ctx.llm.registerAdapter(['c5-inert'], new InertModel())
    const preset = await ctx.agentPresets.resolve(undefined)
    const handle = await ctx.agentLoop.createAgent(ctx, { sessionId: SessionId('c5-desktop'), meta: { cwd: base, agentPreset: preset.id }, agentOptions: { provider: 'c5-inert', model: 'fixture' }, setup: async c => { await ctx.agentPresets.mount(c, preset.id) } })
    agent = handle.agent
  })
  afterAll(async () => { await ctx?.fiber.dispose(); release?.(); vi.unstubAllEnvs() })
  let sequence = 0
  const execute = (name: string, args: object) => ctx.tools.execute({ callId: CallId(`c5-${++sequence}`), name, arguments: args, agent, signal: signal() })
  const produce = (bytes: number, background = false) => execute('bash', { command: `'${process.execPath}' '${writer}' ${bytes}`, description: 'Produce inert output for recovery validation', workdir: base, run_in_background: background })

  it('keeps native small output unchanged and adds no tool', async () => {
    const before = ctx.tools.schemas(agent).length
    const result = await produce(32)
    expect(result.isError, text(result)).toBe(false); expect(text(result)).toBe('x'.repeat(32))
    expect(ctx.tools.schemas(agent)).toHaveLength(before)
    expect(ctx.tools.schemas(agent).some(tool => /recovery|artifact/.test(tool.name))).toBe(false)
  })

  it.each([67108863, 67108864, 67108865])('production spill cap boundary %i remains bounded and truthful', async bytes => {
    const result = await produce(bytes), visible = text(result)
    expect(result.isError, text(result)).toBe(false); expect(Buffer.byteLength(visible)).toBeLessThanOrEqual(50000)
    if (bytes <= 67108864) expect(visible).toContain('capture COMPLETE')
    else { expect(visible).toContain('capture PARTIAL'); expect(visible).toContain('SPILL_CAP_EXCEEDED'); expect(visible).not.toContain('full output:') }
  })

  it('renders partial capture and UNKNOWN omission even when the retained inline text is not truncated', async () => {
    const script = join(base, 'forced-pipe.cjs'), marker = join(base, 'late-native')
    writeFileSync(script, delayedPipeSource(32, marker))
    const original = ctx.subprocess.spawn.bind(ctx.subprocess)
    ctx.subprocess.spawn = spec => original({ ...spec, graceMs: 30 })
    try {
      const result = await execute('bash', { command: `'${process.execPath}' '${script}'`, description: 'Exercise inert forced pipe closure', workdir: base })
      expect(result.isError, text(result)).toBe(false)
      expect(text(result)).toContain('capture PARTIAL'); expect(text(result)).toContain('omitted UNKNOWN')
      expect(text(result)).toContain('original stream size UNKNOWN'); expect(text(result)).not.toContain('inline truncated')
      const value = result.value as { stdout: { recovery: string }, exitCode: number }
      expect(value.exitCode).toBe(0)
      await new Promise(resolve => setTimeout(resolve, 350)); expect(existsSync(marker)).toBe(true)
    } finally { ctx.subprocess.spawn = original }
  })

  it('background job_output withdraws a dead artifact instead of asserting full output', async () => {
    const original = ctx.subprocess.spawn.bind(ctx.subprocess)
    const handles: ReturnType<typeof original>[] = []
    ctx.subprocess.spawn = spec => { const handle = original(spec); handles.push(handle); return handle }
    try {
      const acknowledgement = await produce(131072, true)
      const value = acknowledgement.value as { kind: string, jobId: string }
      expect(acknowledgement.isError, text(acknowledgement)).toBe(false)
      expect(value.kind).toBe('background')
      const handle = handles.at(-1)!; await handle.done
      const path = handle.collected.stdout!.readFrom(0).spillPath!
      expect(existsSync(path)).toBe(true); unlinkSync(path)
      const result = await execute('job_output', { job_id: value.jobId, wait: false })
      expect(result.isError, text(result)).toBe(false); expect(text(result)).toContain('capture UNAVAILABLE')
      expect(text(result)).toContain('ARTIFACT_UNAVAILABLE'); expect(text(result)).not.toContain('full output:')
      expect(text(result)).toContain('exit code: 0')
      expect(handles).toHaveLength(1)
    } finally { ctx.subprocess.spawn = original }
  })
})
