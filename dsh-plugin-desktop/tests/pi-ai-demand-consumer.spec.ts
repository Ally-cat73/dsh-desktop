import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { TOOL_RUNTIME_SCHEDULER } from '@deepseek-ai/dsh-tools'

const require = createRequire(import.meta.url)
const cleanup = new Set<string>()
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  for (const path of cleanup) rmSync(path, { recursive: true, force: true })
  cleanup.clear()
})

async function actualAgentStep() {
  const source = readFileSync(join(dirname(require.resolve('@deepseek-ai/dsh-agent-loop/package.json')), 'lib/index.js'), 'utf8')
  const directory = mkdtempSync(join(tmpdir(), 'c1-actual-agent-step-'))
  cleanup.add(directory)
  const file = join(directory, 'index.mjs')
  // Same private-source exposure seam as empty-tool-call-loop.spec.ts: body is
  // exact installed consumer code, with one test-only export appended.
  writeFileSync(file, `${source}\nexport { ReactLoopAgent };\n`)
  const module = await import(pathToFileURL(file).href)
  return module.ReactLoopAgent.prototype.step as (this: unknown, assembly: unknown) => Promise<unknown>
}

describe('actual agent loop consumes locally settled adapter demands', () => {
  for (const cause of ['timeout', 'cancel'] as const) {
    it(`does not authorize replay or dispatch late tools after ${cause}`, async () => {
      const step = await actualAgentStep()
      vi.useFakeTimers()
      const forbiddenFetch = vi.fn(() => { throw new Error('OFFLINE_FIXTURE_NETWORK_FORBIDDEN') })
      vi.stubGlobal('fetch', forbiddenFetch)
      const caller = new AbortController()
      let deliver!: (result: IteratorResult<unknown>) => void
      const transport = {
        [Symbol.asyncIterator]() { return this },
        next: vi.fn(() => new Promise<IteratorResult<unknown>>(resolve => { deliver = resolve })),
        return: vi.fn(() => new Promise<IteratorResult<unknown>>(() => {})),
      }
      const streamSimple = vi.fn(() => transport)
      const prototype = PiAiAdapter.prototype as unknown as {
        streamWithSnapshot(this: unknown, options: unknown, snapshot: unknown): AsyncGenerator<unknown>
      }
      const adapterStream = prototype.streamWithSnapshot.call({
        profileOf: () => ({ streamIdleTimeoutMs: 10 }),
        modelOf: () => ({ id: 'fixture', input: ['text'], contextWindow: 100 }),
        config: { resolveApiKey: async () => undefined },
      }, { provider: 'fixture', model: 'fixture', messages: [], signal: caller.signal },
      { models: { streamSimple } })
      const requestStream = vi.fn(() => adapterStream)
      const requestErrors = vi.fn()
      const toolDispatch = vi.fn()
      const append = vi.fn(() => ({ seq: 1 }))
      const receiver = {
        id: 'fixture-agent', phase: { kind: 'running', turn: 1, step: 0, abort: caller },
        session: { deriveMessages: () => [], append },
        buildRequest: vi.fn(async () => ({ request: { provider: 'fixture', model: 'fixture', signal: caller.signal },
          preparedCall: { stream: requestStream, retryPolicy: { fixture: 'existing-policy-not-mutated' } } })),
        dispatch: { waterfall: requestErrors },
        loopCtx: { tools: { [TOOL_RUNTIME_SCHEDULER]: { dispatch: toolDispatch } } },
      }
      let outcome: unknown
      const pending = step.call(receiver, { sections: [], variables: {}, tools: [] })
      pending.then(value => { outcome = value }, error => { outcome = error })
      await vi.advanceTimersByTimeAsync(0)
      if (cause === 'timeout') await vi.advanceTimersByTimeAsync(11)
      else { caller.abort('fixture cancellation'); await vi.advanceTimersByTimeAsync(0) }
      expect(outcome).toMatchObject({ code: cause === 'timeout' ? 'TIMEOUT' : 'ABORTED' })
      const settled = outcome
      deliver({ done: false, value: { type: 'toolcall_end', contentIndex: 0,
        toolCall: { id: 'opaque|call', name: 'fixture-tool', arguments: { x: 1 } } } })
      await vi.advanceTimersByTimeAsync(0)
      expect(outcome).toBe(settled)
      expect(requestStream).toHaveBeenCalledTimes(1)
      expect(streamSimple).toHaveBeenCalledTimes(1)
      expect(requestErrors).not.toHaveBeenCalled()
      expect(toolDispatch).not.toHaveBeenCalled()
      expect(append).not.toHaveBeenCalled()
      expect(forbiddenFetch).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    })
  }
})
