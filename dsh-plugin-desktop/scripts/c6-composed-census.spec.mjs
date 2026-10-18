/** Assertions over freshly generated inert full-composition evidence. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { attribute, bytes } from './c6-attribution.mjs'
const dir = process.env.AERA_C6_CAPTURE_DIR
assert(dir, 'Run c6-composed-census.mjs for four roles and supply AERA_C6_CAPTURE_DIR')
const roles = ['IMPLEMENTER','ORCHESTRATOR','REVIEWER','NAVIGATOR']
const records = roles.map(role => JSON.parse(readFileSync(join(dir, `${role}-captures.json`), 'utf8')))
const capture = (record, shape) => { const found = record.captures.find(c => c.label === `${record.role}/${shape}`); assert(found, shape); return found }
const snapshots = c => c.request.messages.filter(m => m.source.plugin === 'aera-collab-agent-tools')
for (const record of records) {
  test(`${record.role}: every request is frozen, passive, prepared, source-attributed and wire-reconciled`, () => {
    for (const c of record.captures) {
      assert.equal(c.immutable, true); assert.equal(c.preparedAdapter, true); assert.equal(c.captureControlEquivalent, true)
      assert.equal(bytes(c.request), c.generateOptionsBytes)
      assert.equal(bytes(c.provider.body), c.providerSerializedBytes)
      const a = attribute(c)
      assert.equal(Object.values(a.requestAllocation).reduce((x,y)=>x+y,0), c.generateOptionsBytes)
      assert.equal(Object.values(a.wireAllocation).reduce((x,y)=>x+y,0), c.providerSerializedBytes)
      assert.throws(() => attribute({ ...c, generateOptionsBytes: c.generateOptionsBytes + 1 }))
    }
  })
  test(`${record.role}: all shipped presets, controlled native/code, MCP, repo and lazy skills`, () => {
    for (const preset of ['standard','code','minimal','cordis']) assert(capture(record, `${preset}/fresh`))
    const native = capture(record, 'standard/fresh'), code = capture(record, 'standard/code-presentation')
    assert(native.request.tools.length > 20)
    assert.equal(code.request.tools.length, 1); assert.equal(code.request.tools[0].name, 'run_code')
    assert(code.request.system.includes('inspect_fixture')); assert(code.request.system.includes('calendar_fixture'))
    assert.equal(native.request.tools.filter(t => t.name.startsWith('mcp__c6__')).length, 2)
    assert.equal(attribute(native).textBytes.repository_instructions, 480)
    assert.equal(attribute(native).textBytes.skill_catalog, 824)
    assert.equal(attribute(native).textBytes.loaded_skill ?? 0, 0)
    assert((attribute(capture(record, 'standard/loaded-skill')).textBytes.loaded_skill ?? 0) > 0)
    assert.equal(capture(record, 'minimal/fresh').request.system, 'You are a helpful software engineer assistant.')
  })
  test(`${record.role}: fresh/joined/continuing/tool-only states, successful calls and child independence`, () => {
    const fresh = capture(record, 'standard/fresh'), joined = capture(record, 'standard/joined'), toolOnly = capture(record, 'standard/tool-only-mcp-result')
    assert(snapshots(fresh).at(-1).content[0].text.includes('No Work Order is joined'))
    assert(snapshots(joined).at(-1).content[0].text.includes('Current canonical Work Order: WO-FIXTURE-FACTORY-TARGET-002'))
    if (process.env.AERA_C6_EXPECT_DEDUP === '1') assert.equal(snapshots(capture(record, 'standard/steady-8')).length, 2)
    assert.equal(snapshots(toolOnly).length, snapshots(capture(record,'standard/continuing')).length)
    assert.equal(snapshots(capture(record,'standard/tool-only-after-resolve')).length, snapshots(capture(record,'standard/resolve')).length)
    for (const c of record.captures) for (const m of c.request.messages) for (const b of m.content) if (b.type === 'tool-result') assert.equal(b.isError, false, c.label)
    assert.equal(record.children.length, 2)
    const spawn = capture(record,'standard/child-spawn'), fork = capture(record,'standard/child-fork')
    assert.notEqual(spawn.sessionId, fresh.sessionId); assert.notEqual(fork.sessionId, spawn.sessionId)
    assert(fork.request.messages.length > spawn.request.messages.length)
    for (const child of record.children) {
      assert.equal(child.result.stopReason, 'completed'); assert.equal(child.meta.agentPreset, 'standard')
      assert.equal(child.meta.parentSession, fresh.sessionId)
    }
    assert(spawn.request.messages.some(m => m.content.some(b => b.text?.includes('WO-FIXTURE-FACTORY-TARGET-002'))))
  })
}
test('packet-role taxonomy is measured independently with real successful tool results', () => {
  const record = records[0]
  for (const role of ['IMPLEMENTER','REVIEWER','ARCHITECT','RESEARCHER','INCIDENT_RESPONDER']) {
    const c = capture(record, `standard/packet-${role}-result`)
    const result = c.request.messages.flatMap(m=>m.content).filter(b=>b.type==='tool-result').at(-1)
    // Actual output-retention may spill/truncate a large rendered packet; measure what the model sees.
    assert(result.content[0].text.includes(`\"role\": \"${role}\"`))
  }
})
test('role subtraction stays narrow across full preset composition', () => {
  const tools = role => capture(records.find(r=>r.role===role), 'standard/fresh').request.tools.map(t=>t.name)
  assert(!tools('REVIEWER').includes('aera_collab_find_evidence'))
  for (const role of ['IMPLEMENTER','ORCHESTRATOR','NAVIGATOR']) assert(tools(role).includes('aera_collab_find_evidence'))
})
