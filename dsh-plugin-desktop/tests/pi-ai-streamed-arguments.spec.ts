import { afterEach, describe, expect, it, vi } from 'vitest'
import { processResponsesStream } from '@earendil-works/pi-ai/api/openai-responses-shared'
import { resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter, type ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { createProvider } from '@earendil-works/pi-ai'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import { stream as streamResponses } from '@earendil-works/pi-ai/api/openai-responses'
import type { AssistantMessage, AssistantMessageEvent, Model, StreamOptions } from '@earendil-works/pi-ai'

// The fixture runs the exact installed patched dependency, with inert provider events.
const model = {
  id: 'fixture', name: 'Fixture', api: 'openai-responses', provider: 'openai',
  baseUrl: 'https://example.test/v1', reasoning: true, input: ['text'],
  contextWindow: 262144, maxTokens: 32768,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
} as Model<'openai-responses'>
const item = { type: 'function_call', id: 'fc_fixture', call_id: 'call_fixture', name: 'fixture', arguments: '' }
type Wire = Record<string, unknown>
const completed: Wire = { type: 'response.completed', response: { id: 'resp_fixture', status: 'completed' } }
const usage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } })
function output(): AssistantMessage {
  return { role: 'assistant', content: [], api: model.api, provider: model.provider,
    model: model.id, usage: usage(), stopReason: 'stop', timestamp: 0 }
}
function chunksOf(raw: string, size: number) {
  return Array.from({ length: Math.ceil(raw.length / size) }, (_, i) => raw.slice(i * size, (i + 1) * size))
}
function eventsFor(raw: string, chunks = chunksOf(raw, 17), initial = item, final = { ...item, arguments: raw }): Wire[] {
  return [{ type: 'response.output_item.added', output_index: 0, item: initial },
    ...chunks.map(delta => ({ type: 'response.function_call_arguments.delta', output_index: 0, delta })),
    { type: 'response.function_call_arguments.done', output_index: 0, arguments: raw },
    { type: 'response.output_item.done', output_index: 0, item: final }, completed]
}
async function consume(events: Wire[]) {
  const message = output()
  const emitted: AssistantMessageEvent[] = []
  const argumentsDuringDelta: unknown[] = []
  const sink = { push(event: AssistantMessageEvent) {
    emitted.push(event)
    if (event.type === 'toolcall_delta') argumentsDuringDelta.push(structuredClone((message.content[event.contentIndex] as { arguments: object }).arguments))
  } }
  const args = [
    (async function* () { yield* events })(), message, sink, model,
  ] as unknown as Parameters<typeof processResponsesStream>
  await processResponsesStream(...args)
  return { message, emitted, argumentsDuringDelta }
}
async function measured(raw: string, chunks: string[], label: string) {
  let count = 0
  const parse = JSON.parse
  const spy = vi.spyOn(JSON, 'parse').mockImplementation((text: string, ...rest: unknown[]) => {
    if (text.startsWith('{"payload"')) count++
    return Reflect.apply(parse, JSON, [text, ...rest])
  })
  let result: Awaited<ReturnType<typeof consume>>
  try { result = await consume(eventsFor(raw, chunks)) } finally { spy.mockRestore() }
  const call = result.message.content.find(block => block.type === 'toolCall')!
  expect(call.type).toBe('toolCall')
  if (call.type !== 'toolCall') throw new Error('tool call missing')
  const row = { FIXTURE: label, ARGUMENT_BYTES: Buffer.byteLength(raw), CHUNK_COUNT: chunks.length,
    FULL_PARSE_COUNT: count, FINAL_ARGUMENT_EQUIVALENT: JSON.stringify(call.arguments) === JSON.stringify(JSON.parse(raw)),
    ID_PRESERVED: call.id === 'call_fixture|fc_fixture', NAME_PRESERVED: call.name === 'fixture' }
  console.log(JSON.stringify(row))
  expect(row).toMatchObject({ FULL_PARSE_COUNT: 1, FINAL_ARGUMENT_EQUIVALENT: true, ID_PRESERVED: true, NAME_PRESERVED: true })
  expect(result.argumentsDuringDelta.every(block => Object.keys(block as object).length === 0)).toBe(true)
  expect(result.emitted.filter(event => event.type === 'toolcall_delta').map(event => event.delta).join('')).toBe(raw)
  return result
}

function fixtureAdapter() {
  const piProvider = createProvider({ id: model.provider, models: [model], api: openAIResponsesApi(),
    auth: { apiKey: { name: 'Fixture', resolve: async () => ({ auth: { apiKey: 'fixture' } }) } } })
  const profile = { provider: model.provider, displayName: 'Fixture', streamIdleTimeoutMs: 10000,
    configuredMaxTokens: new Map<string, number>(), piProvider, maxRequestImageBytes: 1024 * 1024,
    requestImagePixelBudget: 1000000, requestImageMaxBytes: 1024 * 1024,
    retryPolicy: resolveRetryPolicy(undefined, 'fixture'),
  } satisfies ResolvedPiAiProviderProfile
  return new PiAiAdapter({ profiles: () => new Map([[model.provider, profile]]),
    resolveApiKey: async () => 'fixture', auth: {
      credentials: { read: async () => undefined, list: async () => [], modify: async (_id, fn) => fn(undefined), delete: async () => {} },
      authContext: { env: async () => undefined, fileExists: async () => false },
    } })
}
function mockWire(events: Wire[]) {
  const fetch = vi.fn(async () => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''),
    { headers: { 'content-type': 'text/event-stream' } }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('pi-ai active Responses streamed arguments', () => {
  for (const size of [128, 4096, 65536, 1024 * 1024]) {
    for (const chunkSize of [17, 257]) {
      it(`parses ${size} payload characters once with ${chunkSize}-character chunks`, async () => {
        const raw = JSON.stringify({ payload: 'x'.repeat(size) })
        await measured(raw, chunksOf(raw, chunkSize), `${size}/${chunkSize}`)
      })
    }
  }
  it('preserves nested structures, escapes, Unicode, and boundaries inside escapes and strings', async () => {
    const raw = JSON.stringify({ payload: { list: ['quote" slash\\ \n\t\u0001 😀', { nested: [null, true, -1.25e12] }], value: 'tail' } })
    await measured(raw, chunksOf(raw, 1), 'nested/one-code-unit')
  })
  it('uses arguments.done suffix completion without parsing that partial event', async () => {
    const raw = '{"payload":"suffix completion"}'
    await measured(raw, ['{"payload":"suf'], 'done-suffix')
  })
  it('uses authoritative final item when arguments.done replaces rather than extends the prefix', async () => {
    const raw = '{"payload":"authoritative"}'
    const result = await consume(eventsFor(raw, ['{"payload":"obsolete']))
    expect(result.message.content[0]).toMatchObject({ arguments: { payload: 'authoritative' } })
  })
  it('can finalize without arguments.done, and accepts a JSON empty object', async () => {
    const raw = '{"payload":3}'
    const events = eventsFor(raw).filter(event => event.type !== 'response.function_call_arguments.done')
    expect((await consume(events)).message.content[0]).toMatchObject({ arguments: { payload: 3 } })
    expect((await consume(eventsFor('{}'))).message.content[0]).toMatchObject({ arguments: {} })
  })
  it('preserves nonempty IDs/names across empty final fields and accepts late call/item IDs and name', async () => {
    const raw = '{"payload":1}'
    const existing = await consume(eventsFor(raw, [raw], item, { ...item, id: '', call_id: '', name: '', arguments: raw }))
    expect(existing.message.content[0]).toMatchObject({ id: 'call_fixture|fc_fixture', name: 'fixture' })
    const late = await consume(eventsFor(raw, [raw], { ...item, id: '', call_id: '', name: '' }))
    expect(late.message.content[0]).toMatchObject({ id: 'call_fixture|fc_fixture', name: 'fixture' })
    const partlyLate = await consume(eventsFor(raw, [raw], { ...item, call_id: '' }, { ...item, id: '', arguments: raw }))
    expect(partlyLate.message.content[0]).toMatchObject({ id: 'call_fixture|fc_fixture', name: 'fixture' })
    const missing = await consume(eventsFor(raw, [raw], { ...item, call_id: '' }, { ...item, call_id: '', arguments: raw }))
    expect(missing.message.content[0]).toMatchObject({ id: '|fc_fixture', name: 'fixture' })
  })
  for (const [label, initialIds, finalIds, expectedId] of [
    ['opaque call ID', { call_id: 'call|opaque', id: 'fc_X' }, { call_id: '', id: '' }, 'call|opaque|fc_X'],
    ['opaque item ID', { call_id: 'call_X', id: 'fc|opaque' }, { call_id: '', id: '' }, 'call_X|fc|opaque'],
    ['both opaque IDs', { call_id: 'call|one|two', id: 'fc|three|four' }, { call_id: '', id: '' }, 'call|one|two|fc|three|four'],
    ['late call ID', { call_id: '', id: 'fc|opaque' }, { call_id: 'late|call', id: '' }, 'late|call|fc|opaque'],
    ['late item ID', { call_id: 'call|opaque', id: '' }, { call_id: '', id: 'late|item' }, 'call|opaque|late|item'],
    ['partial identity update', { call_id: 'call|old', id: 'fc|retained' }, { call_id: 'call|new', id: '' }, 'call|new|fc|retained'],
  ] as const) {
    it(`preserves opaque identity components across ${label}`, async () => {
      const result = await consume(eventsFor('{}', ['{', '}'], { ...item, ...initialIds },
        { ...item, ...finalIds, name: '', arguments: '{}' }))
      expect(result.message.content[0]).toMatchObject({ id: expectedId, name: 'fixture', arguments: {} })
    })
  }
  it('preserves the independent reviewer opaque-ID counterexample through public provider and installed Harness consumer', async () => {
    const initial = { ...item, call_id: 'call|opaque', id: 'fc_X' }
    const final = { ...item, call_id: '', id: '', name: '', arguments: '{}' }
    const wire = eventsFor('{}', ['{', '}'], initial, final)
    mockWire(wire)
    const providerEvents: AssistantMessageEvent[] = []
    for await (const event of streamResponses(model, { messages: [] }, { apiKey: 'fixture', maxRetries: 0 } as StreamOptions)) providerEvents.push(event)
    mockWire(wire)
    const harnessChunks = []
    for await (const chunk of fixtureAdapter().stream({ provider: model.provider, model: model.id, messages: [] })) harnessChunks.push(chunk)
    const providerCall = providerEvents.find(event => event.type === 'toolcall_end')
    const harnessCall = harnessChunks.find(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call')
    const actual = { provider: providerCall?.type === 'toolcall_end' ? providerCall.toolCall.id : undefined,
      harness: harnessCall?.type === 'block-end' && harnessCall.block.type === 'tool-call' ? harnessCall.block.id : undefined }
    console.log(JSON.stringify({ FIXTURE: 'R2_OPAQUE_ID', EXPECTED: 'call|opaque|fc_X', ...actual }))
    expect(actual).toEqual({ provider: 'call|opaque|fc_X', harness: 'call|opaque|fc_X' })
  })
  it('leaves an empty or whitespace name for the preserved agent-loop refusal guard', async () => {
    for (const name of ['', '  ']) {
      const blank = { ...item, name }
      expect((await consume(eventsFor('{}', ['{}'], blank, { ...blank, arguments: '{}' }))).message.content[0]).toMatchObject({ name, arguments: {} })
    }
  })
  it('keeps interleaved parallel calls and index identities separate', async () => {
    const second = { ...item, id: 'fc_second', call_id: 'call_second', name: 'second' }
    const events: Wire[] = [
      { type: 'response.output_item.added', output_index: 2, item },
      { type: 'response.output_item.added', output_index: 7, item: second },
      { type: 'response.function_call_arguments.delta', output_index: 2, delta: '{"payload":' },
      { type: 'response.function_call_arguments.delta', output_index: 7, delta: '{"nested":[' },
      { type: 'response.function_call_arguments.delta', output_index: 2, delta: '1}' },
      { type: 'response.function_call_arguments.delta', output_index: 7, delta: '2]}' },
      { type: 'response.output_item.done', output_index: 7, item: { ...second, arguments: '{"nested":[2]}' } },
      { type: 'response.output_item.done', output_index: 2, item: { ...item, arguments: '{"payload":1}' } }, completed,
    ]
    expect((await consume(events)).message.content).toMatchObject([
      { id: 'call_fixture|fc_fixture', name: 'fixture', arguments: { payload: 1 } },
      { id: 'call_second|fc_second', name: 'second', arguments: { nested: [2] } },
    ])
  })
  for (const raw of ['', '  ', '{"payload":"unfinished', '{"payload":', '{"payload":1,}', '{"payload":"\\q"}', '{"payload":true}garbage']) {
    it(`refuses malformed final input without a completed tool event: ${raw}`, async () => {
      const message = output(); const emitted: AssistantMessageEvent[] = []
      const args = [(async function* () { yield* eventsFor(raw) })(), message,
        { push(event: AssistantMessageEvent) { emitted.push(event) } }, model] as unknown as Parameters<typeof processResponsesStream>
      await expect(processResponsesStream(...args)).rejects.toThrow()
      expect(emitted.some(event => event.type === 'toolcall_end')).toBe(false)
    })
  }
  it('refuses invalid or absent authoritative final arguments even after a valid prefix and arguments.done', async () => {
    for (const argumentsValue of ['', ' ', undefined, null, '{"payload":']) {
      const final = { ...item, arguments: argumentsValue }
      await expect(consume(eventsFor('{"payload":1}', ['{"payload":1}'], item, final as typeof item))).rejects.toThrow()
    }
  })
  it('normalizes absent initial IDs and fills late identities at the completed item boundary', async () => {
    const initial = { type: 'function_call', name: 'fixture', arguments: '' } as typeof item
    expect((await consume(eventsFor('{}', ['{}'], initial))).message.content[0]).toMatchObject({ id: 'call_fixture|fc_fixture' })
    expect((await consume(eventsFor('{}', ['{}'], initial, { ...initial, arguments: '{}' }))).message.content[0]).toMatchObject({ id: '|' })
  })
  it('rejects an unfinished partial call without publishing a completed call', async () => {
    await expect(consume(eventsFor('{"payload":"partial').filter(event => event.type !== 'response.output_item.done'))).rejects.toThrow('before function call argument validation')
  })
  it('preserves reasoning replay signatures, response ID, usage, service tier hook and custom tool input', async () => {
    const reasoning = { type: 'reasoning', id: 'rs_fixture', summary: [{ type: 'summary_text', text: 'thought' }] }
    const encrypted = { ...reasoning, encrypted_content: 'opaque-encrypted-fixture' }
    const events: Wire[] = [
      { type: 'response.output_item.added', output_index: 0, item: reasoning },
      { type: 'response.output_item.done', output_index: 0, item: reasoning },
      ...eventsFor('{"payload":42}').slice(0, -1).map(event => ({ ...event, output_index: 1 })),
      { type: 'response.output_item.added', output_index: 3, item: { type: 'custom_tool_call', id: 'ctc_fixture', call_id: 'custom_fixture', name: 'grammar', input: '' } },
      { type: 'response.custom_tool_call_input.delta', output_index: 3, delta: 'plain text' },
      { type: 'response.output_item.done', output_index: 3, item: { type: 'custom_tool_call', id: 'ctc_fixture', call_id: 'custom_fixture', name: 'grammar', input: 'plain text' } },
      { type: 'response.completed', response: { id: 'resp_metadata', status: 'completed', output: [encrypted], usage: {
        input_tokens: 30, output_tokens: 12, total_tokens: 42, input_tokens_details: { cached_tokens: 3 }, output_tokens_details: { reasoning_tokens: 4 },
      }, service_tier: 'priority' } },
    ]
    const message = output(); const pricing = vi.fn()
    const args = [(async function* () { yield* events })(), message, { push() {} }, model,
      { applyServiceTierPricing: pricing }] as unknown as Parameters<typeof processResponsesStream>
    await processResponsesStream(...args)
    expect(message).toMatchObject({ responseId: 'resp_metadata', stopReason: 'toolUse', usage: { input: 27, output: 12, cacheRead: 3, reasoning: 4, totalTokens: 42 } })
    expect(message.content[0]).toMatchObject({ type: 'thinking', thinking: 'thought', thinkingSignature: JSON.stringify(encrypted) })
    expect(message.content[2]).toMatchObject({ arguments: { input: 'plain text' }, id: 'custom_fixture|ctc_fixture' })
    expect(pricing).toHaveBeenCalledWith(message.usage, 'priority')
  })
  it('bounds parse work for an eight MiB final argument allocation', async () => {
    const raw = JSON.stringify({ payload: 'x'.repeat(8 * 1024 * 1024) })
    await measured(raw, chunksOf(raw, 8192), '8MiB/8192')
  })
  it('preserves valid final arguments, late identity, text signature and replay through the installed Harness consumer', async () => {
    const raw = JSON.stringify({ payload: { nested: [1, 'escaped\\quote"'] } })
    const reasoning = { type: 'reasoning', id: 'rs_replay', encrypted_content: 'opaque', summary: [{ type: 'summary_text', text: 'thought' }] }
    const text = { type: 'message', id: 'msg_fixture', phase: 'final_answer', content: [{ type: 'output_text', text: 'answer' }] }
    const fetch = mockWire([
      { type: 'response.output_item.done', output_index: 2, item: reasoning },
      { type: 'response.output_item.done', output_index: 3, item: text },
      ...eventsFor(raw, chunksOf(raw, 2), { ...item, call_id: '' }).slice(0, -1),
      { type: 'response.completed', response: { id: 'resp_consumer', status: 'completed' } },
    ])
    const chunks = []
    for await (const chunk of fixtureAdapter().stream({ provider: model.provider, model: model.id, messages: [] })) chunks.push(chunk)
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'block-end', block: {
      type: 'tool-call', id: 'call_fixture|fc_fixture', name: 'fixture', arguments: JSON.stringify(JSON.parse(raw)),
    } }))
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'tool-calls' }, replayState: {
      response: { kind: 'pi-ai', version: 2, responseId: 'resp_consumer' }, blocks: [
        { type: 'reasoning', thinkingSignature: JSON.stringify(reasoning) },
        { type: 'text', textSignature: expect.stringContaining('msg_fixture') }, { type: 'tool-call' },
      ],
    } })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('installed Harness consumer refuses malformed finals without a runnable tool block', async () => {
    mockWire(eventsFor('{"payload":"unfinished'))
    const chunks = []
    for await (const chunk of fixtureAdapter().stream({ provider: model.provider, model: model.id, messages: [] })) chunks.push(chunk)
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error' } })
    expect(chunks.some(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call')).toBe(false)
  })
  for (const terminal of ['response.completed', 'response.incomplete']) {
    it(`installed Harness consumer refuses a pending partial call at ${terminal}`, async () => {
      const wire = eventsFor('{"payload":"unfinished').filter(event => event.type !== 'response.output_item.done')
      wire[wire.length - 1] = { type: terminal, response: { id: 'resp_pending', status: terminal === 'response.completed' ? 'completed' : 'incomplete' } }
      mockWire(wire)
      const chunks = []
      for await (const chunk of fixtureAdapter().stream({ provider: model.provider, model: model.id, messages: [] })) chunks.push(chunk)
      expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error' } })
      expect(chunks.some(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call')).toBe(false)
    })
  }
  it('public Responses provider emits terminal error for malformed arguments and no runnable toolcall_end', async () => {
    const wire = eventsFor('{"payload":"unfinished')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(wire.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })))
    const events: AssistantMessageEvent[] = []
    for await (const event of streamResponses(model, { messages: [] }, { apiKey: 'fixture', maxRetries: 0 } as StreamOptions)) events.push(event)
    expect(events.at(-1)).toMatchObject({ type: 'error', reason: 'error', error: { stopReason: 'error' } })
    expect(events.some(event => event.type === 'toolcall_end' || event.type === 'done')).toBe(false)
  })
})
