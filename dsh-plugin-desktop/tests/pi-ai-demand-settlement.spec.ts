import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PiAiAdapter, type ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { createProvider, type Model } from '@earendil-works/pi-ai'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'

type Event = Record<string, unknown>
type Chunk = Record<string, unknown>
type Result = IteratorResult<Event>
const never = () => new Promise<Result>(() => {})
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 }
function terminal(error?: string): Event {
  const message = { role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage,
    stopReason: error ? 'error' : 'stop', errorMessage: error, model: 'fixture', api: 'openai-responses',
    provider: 'fixture', timestamp: 0 }
  return error ? { type: 'error', error: message } : { type: 'done', message }
}
function controlled(teardown: () => Promise<Result> | Result = () => ({ done: true, value: undefined })) {
  const buffered: Array<{ result?: Result; error?: Error }> = []
  const pending: Array<{ resolve: (result: Result) => void; reject: (error: Error) => void }> = []
  const deliver = (entry: { result?: Result; error?: Error }) => {
    const demand = pending.shift()
    if (!demand) { buffered.push(entry); return }
    if (entry.error) demand.reject(entry.error)
    else demand.resolve(entry.result!)
  }
  return {
    [Symbol.asyncIterator]() { return this },
    next: vi.fn(() => {
      const entry = buffered.shift()
      if (entry) return entry.error ? Promise.reject(entry.error) : Promise.resolve(entry.result!)
      return new Promise<Result>((resolve, reject) => pending.push({ resolve, reject }))
    }),
    return: vi.fn(teardown),
    push: (event: Event) => deliver({ result: { done: false, value: event } }),
    end: () => deliver({ result: { done: true, value: undefined } }),
    fail: (error: Error) => deliver({ error }),
  }
}
function fixture(transport = controlled(), signal?: AbortSignal, idle = 10) {
  let forwarded!: AbortSignal
  const receiver = {
    profileOf: () => ({ streamIdleTimeoutMs: idle }),
    modelOf: () => ({ id: 'fixture', input: ['text'], contextWindow: 100 }),
    config: { resolveApiKey: async () => undefined },
  }
  const dispatch = vi.fn((_model: unknown, _context: unknown, options: { signal: AbortSignal }) => {
    forwarded = options.signal
    return transport
  })
  // Execute the installed adapter and its actual translator/watchdog. Only inert
  // receiver data and model transport are supplied, never a copied adapter body.
  const prototype = PiAiAdapter.prototype as unknown as {
    streamWithSnapshot(this: unknown, options: unknown, snapshot: unknown): AsyncGenerator<Chunk>
  }
  const adapter = prototype.streamWithSnapshot.call(receiver,
    { provider: 'fixture', model: 'fixture', messages: [], signal }, { models: { streamSimple: dispatch } })
  const blocks: Chunk[] = []
  const toolDispatch = vi.fn()
  const consume = async () => {
    for await (const chunk of adapter) {
      blocks.push(chunk)
      if (chunk.type === 'block-end' && (chunk.block as { type?: string })?.type === 'tool-call') toolDispatch(chunk)
    }
  }
  return { adapter, transport, dispatch, toolDispatch, blocks, consume, signal: () => forwarded }
}
function observe<T>(promise: Promise<T>) {
  const result: { state: string; value?: T; error?: { code?: string; message?: string } } = { state: 'PENDING' }
  promise.then(value => { result.state = 'RESOLVED'; result.value = value }, error => {
    result.state = 'REJECTED'; result.error = error
  })
  return result
}
const flush = () => vi.advanceTimersByTimeAsync(0)
const lateTool: Event = { type: 'toolcall_end', contentIndex: 0,
  toolCall: { id: 'opaque|call', name: 'fixture-tool', arguments: { x: 1 } } }

let forbiddenFetch: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.useFakeTimers()
  forbiddenFetch = vi.fn(() => { throw new Error('OFFLINE_FIXTURE_NETWORK_FORBIDDEN') })
  vi.stubGlobal('fetch', forbiddenFetch)
})
afterEach(() => {
  expect(forbiddenFetch).not.toHaveBeenCalled()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('actual pi-ai local demand settlement', () => {
  it('settles never-resolving next despite ignored abort, and disposes the deadline', async () => {
    const f = fixture()
    const result = observe(f.adapter.next())
    await vi.advanceTimersByTimeAsync(11)
    expect(result).toMatchObject({ state: 'REJECTED', error: { code: 'TIMEOUT' } })
    expect(f.signal().aborted).toBe(true)
    expect(f.dispatch).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('settles cancellation despite ignored abort and hanging next/return', async () => {
    const caller = new AbortController()
    const f = fixture(controlled(never), caller.signal)
    const result = observe(f.adapter.next())
    await flush()
    caller.abort('fixture cancellation')
    await flush()
    expect(result).toMatchObject({ state: 'REJECTED', error: { code: 'ABORTED' } })
    expect(f.signal().aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('does not await a hanging transport return after consumer return', async () => {
    const f = fixture(controlled(never))
    f.transport.push({ type: 'text_start', contentIndex: 0 })
    await expect(f.adapter.next()).resolves.toMatchObject({ value: { type: 'block-start' } })
    const result = observe(f.adapter.return(undefined))
    await flush()
    expect(result.state).toBe('RESOLVED')
    expect(f.transport.return).toHaveBeenCalledTimes(1)
    expect(f.signal().aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
  for (const mode of ['sync throw', 'rejected', 'late rejected'] as const) {
    it(`handles ${mode} transport return without changing local result`, async () => {
      let rejectLate!: (error: Error) => void
      const teardown = () => {
        if (mode === 'sync throw') throw new Error('fixture sync return error')
        if (mode === 'rejected') return Promise.reject(new Error('fixture return rejection'))
        return new Promise<Result>((_resolve, reject) => { rejectLate = reject })
      }
      const f = fixture(controlled(teardown))
      f.transport.push({ type: 'text_start', contentIndex: 0 })
      await f.adapter.next()
      const result = observe(f.adapter.return(undefined))
      await flush()
      expect(result.state).toBe('RESOLVED')
      if (mode === 'late rejected') { rejectLate(new Error('late fixture return error')); await flush() }
      expect(vi.getTimerCount()).toBe(0)
    })
  }
  it('legitimate completion wins before timeout without an idle timer during consumer think time', async () => {
    const f = fixture()
    f.transport.push(terminal())
    await expect(f.adapter.next()).resolves.toMatchObject({ value: { type: 'usage' } })
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(100)
    await expect(f.adapter.next()).resolves.toMatchObject({ value: { type: 'finish', reason: { kind: 'stop' } } })
    await expect(f.adapter.next()).resolves.toMatchObject({ done: true })
    expect(vi.getTimerCount()).toBe(0)
  })
  for (const [message, code] of [
    ['SENTINEL_DENIED fixture refusal', 'GOVERNANCE_POLICY'],
    ['SENTINEL_POLICY_UNAVAILABLE', 'GOVERNANCE_UNAVAILABLE'],
    ['PROVIDER_EXECUTION_FORBIDDEN', 'AUTHORITY'],
    ['PROVIDER_LOCKED', 'PROVIDER_STATE'],
    ['HTTP 401', 'AUTH'], ['HTTP 429', 'RATE_LIMIT'], ['network socket', 'TRANSPORT'],
  ]) {
    it(`preserves terminal refusal/error classification ${code}`, async () => {
      const f = fixture()
      f.transport.push(terminal(message))
      await expect(f.adapter.next()).resolves.toMatchObject({ value: { type: 'usage' } })
      await expect(f.adapter.next()).resolves.toMatchObject({ value: { type: 'finish',
        reason: { kind: 'error', failure: { code } } } })
      await expect(f.adapter.next()).resolves.toMatchObject({ done: true })
      expect(f.dispatch).toHaveBeenCalledTimes(1)
      expect(f.toolDispatch).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    })
  }
  it('translated useful progress starts a fresh interval for the next demand', async () => {
    const f = fixture()
    const first = observe(f.adapter.next())
    await vi.advanceTimersByTimeAsync(8)
    f.transport.push({ type: 'text_delta', contentIndex: 0, delta: 'useful' })
    await flush()
    expect(first).toMatchObject({ state: 'RESOLVED', value: { value: { type: 'text-delta' } } })
    const next = observe(f.adapter.next())
    await vi.advanceTimersByTimeAsync(8)
    expect(next.state).toBe('PENDING')
    f.transport.push({ type: 'thinking_delta', contentIndex: 1, delta: 'reasoning' })
    await flush()
    expect(next.state).toBe('RESOLVED')
    await f.adapter.return(undefined)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('dropped start/keepalive and unknown wire metadata cannot extend a pending demand', async () => {
    const f = fixture()
    const result = observe(f.adapter.next())
    for (let tick = 0; tick < 3; tick++) {
      await vi.advanceTimersByTimeAsync(3)
      f.transport.push({ type: 'start' })
      f.transport.push({ type: 'keepalive' })
      await flush()
    }
    await vi.advanceTimersByTimeAsync(2)
    expect(result).toMatchObject({ state: 'REJECTED', error: { code: 'TIMEOUT' } })
    expect(vi.getTimerCount()).toBe(0)
  })
  for (const termination of ['timeout', 'cancel'] as const) {
    for (const late of ['tool', 'done', 'refusal', 'error'] as const) {
      it(`${termination} followed by late ${late} cannot reopen local consumption or dispatch/replay`, async () => {
        const caller = new AbortController()
        const f = fixture(controlled(never), caller.signal)
        const result = observe(f.consume())
        await flush()
        if (termination === 'cancel') caller.abort('fixture cancellation')
        else await vi.advanceTimersByTimeAsync(11)
        await flush()
        expect(result).toMatchObject({ state: 'REJECTED', error: { code: termination === 'cancel' ? 'ABORTED' : 'TIMEOUT' } })
        const saved = result.error
        if (late === 'error') f.transport.fail(new Error('late ignored transport rejection'))
        else f.transport.push(late === 'tool' ? lateTool : terminal(late === 'refusal' ? 'SENTINEL_DENIED' : undefined))
        await flush()
        expect(result.error).toBe(saved)
        expect(f.blocks).toEqual([])
        expect(f.toolDispatch).not.toHaveBeenCalled()
        expect(f.dispatch).toHaveBeenCalledTimes(1)
        await expect(f.adapter.next()).resolves.toMatchObject({ done: true })
        expect(vi.getTimerCount()).toBe(0)
      })
    }
  }
  it('caller already aborted settles without consuming the transport', async () => {
    const caller = new AbortController()
    caller.abort('early fixture abort')
    const f = fixture(controlled(), caller.signal)
    const result = observe(f.adapter.next())
    await flush()
    expect(result).toMatchObject({ state: 'REJECTED', error: { code: 'ABORTED' } })
    expect(f.transport.next).not.toHaveBeenCalled()
    // Existing construction/preflight behavior remains: cancellation settles the
    // demand, and does not claim to cancel model creation or credential lookup.
    expect(f.dispatch).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('ordinary source closure preserves STREAM_CLOSED and removes demand listeners', async () => {
    const add = vi.spyOn(AbortSignal.prototype, 'addEventListener')
    const remove = vi.spyOn(AbortSignal.prototype, 'removeEventListener')
    const f = fixture()
    f.transport.end()
    const result = observe(f.adapter.next())
    await flush()
    expect(result).toMatchObject({ state: 'REJECTED', error: { code: 'STREAM_CLOSED' } })
    const added = add.mock.calls.filter(args => args[0] === 'abort')
    expect(added.length).toBeGreaterThan(0)
    for (const [, listener] of added) expect(remove.mock.calls.some(args => args[0] === 'abort' && args[1] === listener)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('preserves a selected source failure when cancellation arrives before outer error handling', async () => {
    const caller = new AbortController()
    const f = fixture(controlled(), caller.signal)
    const failure = Object.assign(new Error('fixture source governance failure'), { code: 'GOVERNANCE_POLICY' })
    const originalRemove = AbortSignal.prototype.removeEventListener
    let armed = true
    vi.spyOn(AbortSignal.prototype, 'removeEventListener').mockImplementation(function (this: AbortSignal, ...args) {
      originalRemove.apply(this, args)
      if (armed && this === f.signal()) { armed = false; caller.abort('after selected source failure') }
    })
    f.transport.fail(failure)
    const result = observe(f.adapter.next())
    await flush()
    expect(result.state).toBe('REJECTED')
    expect(result.error).toBe(failure)
    expect(f.dispatch).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('preserves a selected refusal finish when a later cancellation competes', async () => {
    const caller = new AbortController()
    const f = fixture(controlled(), caller.signal)
    f.transport.push(terminal('SENTINEL_DENIED fixture'))
    await f.adapter.next() // usage; refusal finish is the next translated demand
    const originalRemove = AbortSignal.prototype.removeEventListener
    let armed = true
    vi.spyOn(AbortSignal.prototype, 'removeEventListener').mockImplementation(function (this: AbortSignal, ...args) {
      originalRemove.apply(this, args)
      if (armed && this === f.signal()) { armed = false; caller.abort('after selected refusal finish') }
    })
    await expect(f.adapter.next()).resolves.toMatchObject({ value: { type: 'finish',
      reason: { kind: 'error', failure: { code: 'GOVERNANCE_POLICY' } } } })
    await f.adapter.return(undefined)
    expect(vi.getTimerCount()).toBe(0)
  })
  for (const cause of ['timeout', 'cancel', 'complete'] as const) {
    it(`releases the demand listener on ${cause}`, async () => {
      const caller = new AbortController()
      const f = fixture(controlled(never), caller.signal)
      const add = vi.spyOn(AbortSignal.prototype, 'addEventListener')
      const remove = vi.spyOn(AbortSignal.prototype, 'removeEventListener')
      const result = observe(f.adapter.next())
      await flush()
      if (cause === 'timeout') await vi.advanceTimersByTimeAsync(11)
      else if (cause === 'cancel') caller.abort('fixture cancellation')
      else f.transport.push({ type: 'text_delta', contentIndex: 0, delta: 'complete demand' })
      await flush()
      expect(result.state).not.toBe('PENDING')
      const listeners = add.mock.calls.filter(args => args[0] === 'abort')
      expect(listeners.length).toBe(1)
      expect(remove.mock.calls.some(args => args[0] === 'abort' && args[1] === listeners[0]![1])).toBe(true)
      if (cause === 'complete') await f.adapter.return(undefined)
      expect(vi.getTimerCount()).toBe(0)
    })
  }
  for (const winner of ['response', 'abort'] as const) {
    it(`arbitrates simultaneous pending response/cancel with ${winner} first`, async () => {
      const caller = new AbortController()
      const f = fixture(controlled(never), caller.signal)
      const result = observe(f.adapter.next())
      await flush()
      if (winner === 'response') {
        f.transport.push({ type: 'text_delta', contentIndex: 0, delta: 'won' })
        await flush()
        caller.abort('after response')
        expect(result).toMatchObject({ state: 'RESOLVED', value: { value: { type: 'text-delta' } } })
        await f.adapter.return(undefined)
      } else {
        caller.abort('before response')
        f.transport.push(lateTool)
        await flush()
        expect(result).toMatchObject({ state: 'REJECTED', error: { code: 'ABORTED' } })
      }
      expect(f.dispatch).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    })
  }
})


describe('public adapter with actual C2 Responses producer and inert SSE body', () => {
  for (const cause of ['timeout', 'cancel'] as const) {
    it(`settles ${cause} without a second model request or late tool dispatch`, async () => {
      const model = { id: 'fixture', name: 'Fixture', api: 'openai-responses', provider: 'openai',
        baseUrl: 'https://example.test/v1', reasoning: true, input: ['text'],
        contextWindow: 262144, maxTokens: 32768,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      } as Model<'openai-responses'>
      const piProvider = createProvider({ id: model.provider, models: [model], api: openAIResponsesApi(),
        auth: { apiKey: { name: 'Fixture', resolve: async () => ({ auth: { apiKey: 'fixture' } }) } } })
      const profile = { provider: model.provider, displayName: 'Fixture', streamIdleTimeoutMs: 10,
        configuredMaxTokens: new Map<string, number>(), piProvider, maxRequestImageBytes: 1024 * 1024,
        requestImagePixelBudget: 1000000, requestImageMaxBytes: 1024 * 1024,
        retryPolicy: resolveRetryPolicy(undefined, 'fixture'),
      } satisfies ResolvedPiAiProviderProfile
      const adapter = new PiAiAdapter({ profiles: () => new Map([[model.provider, profile]]),
        resolveApiKey: async () => 'fixture', auth: {
          credentials: { read: async () => undefined, list: async () => [], modify: async (_id, fn) => fn(undefined), delete: async () => {} },
          authContext: { env: async () => undefined, fileExists: async () => false },
        } })
      let wire!: ReadableStreamDefaultController<Uint8Array>
      const body = new ReadableStream<Uint8Array>({ start(controller) { wire = controller } })
      const inertFetch = vi.fn(async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }))
      vi.stubGlobal('fetch', inertFetch)
      const caller = new AbortController()
      const chunks: unknown[] = []
      const dispatch = vi.fn()
      const consumption = observe((async () => {
        for await (const chunk of adapter.stream({ provider: model.provider, model: model.id,
          messages: [], tools: [], signal: caller.signal })) {
          chunks.push(chunk)
          if (chunk.type === 'block-end' && chunk.block.type === 'tool-call') dispatch(chunk.block)
        }
      })())
      await flush()
      expect(inertFetch).toHaveBeenCalledTimes(1)
      if (cause === 'timeout') await vi.advanceTimersByTimeAsync(11)
      else { caller.abort('public fixture cancellation'); await flush() }
      expect(consumption).toMatchObject({ state: 'REJECTED', error: { code: cause === 'timeout' ? 'TIMEOUT' : 'ABORTED' } })
      const outcome = consumption.error
      const item = { type: 'function_call', id: 'item-opaque', call_id: 'call-opaque', name: 'fixture-tool', arguments: '{"x":1}' }
      for (const event of [
        { type: 'response.output_item.added', output_index: 0, item: { ...item, arguments: '' } },
        { type: 'response.function_call_arguments.delta', output_index: 0, delta: item.arguments },
        { type: 'response.output_item.done', output_index: 0, item },
        { type: 'response.completed', response: { id: 'resp-fixture', status: 'completed' } },
      ]) wire.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
      wire.close()
      await flush()
      expect(consumption.error).toBe(outcome)
      expect(chunks).toEqual([])
      expect(dispatch).not.toHaveBeenCalled()
      expect(inertFetch).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    })
  }
})
