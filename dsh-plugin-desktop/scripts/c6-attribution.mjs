/** Exact byte attribution for inert C6 evidence; no production hooks. */
import assert from 'node:assert/strict'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
export const bytes = value => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value))
const encodedText = text => bytes(JSON.stringify(text)) - 2
const sum = values => values.reduce((a, b) => a + b, 0)
export function messageCategory(message) {
  const source = message.source
  if (source.kind === 'agent-instructions') return 'repository_instructions'
  if (source.kind === 'skill-catalog') return 'skill_catalog'
  if (source.kind === 'skill-invocation') return 'loaded_skill'
  if (source.kind === 'plugin' && source.plugin === 'aera-collab-agent-tools') return 'work_order_orientation'
  if (source.kind === 'plugin' && source.plugin === '@deepseek-ai/dsh-system-prompt') return 'runtime_context'
  if (source.kind === 'tool') return 'retained_tool_results'
  if (['user', 'model', 'subagent', 'coordinator'].includes(source.kind)) return 'conversation_history'
  throw new Error(`Unattributed source: ${JSON.stringify(source)}`)
}
function sectionCategory(name) {
  if (name === 'deployment:persona') return 'preset_persona'
  if (name === 'c6:owner-overlay') return 'owner_overlay'
  if (name === 'tool:cordis') return 'cordis_platform_guidance'
  if (name.startsWith('tools:')) return 'code_mode_sdk'
  if (['tool:subagent','tool:subagent_fork'].includes(name)) return 'delegation_guidance'
  if (['tool:goal','tool:workflow','tool:ralph','plan:policy'].includes(name)) return 'plan_workflow_guidance'
  return 'desktop_global_and_tool_guidance'
}
export function toolCategory(name) {
  return name.startsWith('aera_collab_') ? 'collaboration_tool_schemas' : name.startsWith('mcp__') ? 'mcp_tool_schemas' : 'native_tool_schemas'
}
export function attribute(capture) {
  const { request, assembly } = capture
  const requestAllocation = {}, wireAllocation = {}, textBytes = {}, sections = []
  const add = (into, key, n) => into[key] = (into[key] ?? 0) + n
  const rendered = (assembly.sections ?? []).map(section => ({ name: section.name, text: renderPrompt({ ...assembly, sections: [section] }) })).filter(s => s.text)
  // complete-persona presets deliberately replace the earlier assembly.
  const finalSections = rendered.map(s => s.text).join('\n\n') === request.system ? rendered : rendered.filter(s => s.text === request.system)
  assert.equal(finalSections.map(s => s.text).join('\n\n'), request.system ?? '', 'Final system source must reconcile')
  for (const section of finalSections) {
    const category = sectionCategory(section.name)
    sections.push({ name: section.name, category, textBytes: bytes(section.text), encodedBytes: encodedText(section.text) })
    add(textBytes, category, bytes(section.text))
    add(requestAllocation, category, encodedText(section.text))
    add(wireAllocation, category, encodedText(section.text))
  }
  for (const tool of request.tools ?? []) add(requestAllocation, toolCategory(tool.name), bytes(tool))
  const textLookup = new Map(), callLookup = new Map()
  for (const message of request.messages) {
    const category = messageCategory(message)
    add(requestAllocation, category, bytes(message))
    for (const block of message.content) {
      if (block.type === 'text') { add(textBytes, category, bytes(block.text)); textLookup.set(block.text, category) }
      else if (block.type === 'tool-call') { callLookup.set(`call:${block.id}`, category); add(textBytes, category, bytes(block.arguments)) }
      else if (block.type === 'tool-result') {
        callLookup.set(`result:${block.toolCallId}`, category)
        for (const content of block.content) { assert.equal(content.type, 'text'); add(textBytes, category, bytes(content.text)) }
      } else throw new Error(`Unattributed block ${block.type}`)
    }
  }
  const wire = JSON.parse(capture.provider.body)
  for (const tool of wire.tools ?? []) add(wireAllocation, toolCategory(tool.name), bytes(tool))
  for (const item of wire.input) {
    if (item.role === 'system' || item.role === 'developer') {
      assert.equal(item.content, request.system)
      add(wireAllocation, 'provider_framing', bytes(item) - sum(sections.map(s => s.encodedBytes)))
    } else {
      let category
      if (item.call_id) category = callLookup.get(`${item.type === 'function_call_output' ? 'result' : 'call'}:${item.call_id}`)
      else if (Array.isArray(item.content)) {
        const categories = new Set(item.content.map(block => textLookup.get(block.text)))
        assert.equal(categories.size, 1, 'One source category per provider item')
        category = [...categories][0]
      }
      assert(category, `Unattributed provider input ${JSON.stringify(item).slice(0,100)}`)
      add(wireAllocation, category, bytes(item))
    }
  }
  add(requestAllocation, 'generate_options_framing', bytes(request) - sum(Object.values(requestAllocation)))
  add(wireAllocation, 'provider_framing', bytes(capture.provider.body) - sum(Object.values(wireAllocation)))
  assert.equal(sum(Object.values(requestAllocation)), capture.generateOptionsBytes)
  assert.equal(sum(Object.values(wireAllocation)), capture.providerSerializedBytes)
  assert(Object.values(requestAllocation).every(n => n >= 0))
  assert(Object.values(wireAllocation).every(n => n >= 0))
  return { label: capture.label, totalRequestBytes: capture.generateOptionsBytes, providerSerializedBytes: capture.providerSerializedBytes,
    toolCount: request.tools?.length ?? 0, toolSchemaBytes: bytes(request.tools ?? []), systemTextBytes: bytes(request.system ?? ''),
    requestAllocation, wireAllocation, textBytes, sections, tokenCount: 'NOT_MEASURED' }
}
