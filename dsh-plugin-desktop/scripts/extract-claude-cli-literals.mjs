#!/usr/bin/env node
/**
 * Static extraction of the Claude Code 2.1.280 literals the governed worker's
 * provenance manifest depends on (O1_PROVENANCE_SPEC_V2 §2.2, §8.2; V2.1 NO-1).
 *
 * NEVER EXECUTES THE BINARY. It opens the pinned file read-only, asserts its
 * sha256 and size, finds each search string at exactly its expected offset,
 * checks that it is unique inside a bounded window around that offset, and
 * prints `{id, offset, literal, sha256}` for the literal value inside it. The
 * committed fixture `tests/fixtures/claude-cli-2.1.280-literals.json` is this
 * script's output; a reviewer re-runs it and diffs.
 *
 * usage: node scripts/extract-claude-cli-literals.mjs [binaryPath] > fixture.json
 */
import { createHash } from 'node:crypto'
import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CLI_VERSION = '2.1.280'
const BINARY_SHA256 = '387a5c5dcdbb815085edf0baf79591f9d8894efe922bceaf3d75b1b08055229d'
const BINARY_BYTES = 217_254_576
const WINDOW = 4096

/**
 * id, search string, its expected byte offset, and the [start, end) slice of
 * the search string that is the literal value (end undefined = to the end).
 */
const LITERALS = [
  ['EH', 'var EH="<system-reminder>"', 170349522, 8, -1],
  ['GEE', 'GEe="</system-reminder>"', 170349549, 5, -1],
  ['UA', 'function Ua(e){return`${EH}\n${e}\n${GEe}`}', 181020661, 0, undefined],
  ['KEYS', '$6t=["userEmail","attachedProject","gitStatus","perforceMode"]', 177360878, 0, undefined],
  ['EWE_KEYLINE', '[`# ${h}\n${e[h]}`]', 177361081, 0, undefined],
  ['HDR', '"As you answer the user\'s questions, you can use the following context:"', 177361433, 1, -1],
  ['EWE_JOIN', '${s.join(`\n`)}', 177361507, 0, undefined],
  ['IMP', '\n\nIMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.`', 177361521, 2, -1],
  ['SENT_PRE', 'userEmail:`The user\'s email address is ${M}', 177936321, 11, -4],
  ['SENT_POST', '${M}. Use it only to identify the user, such as for authorship, attribution, or filtering their own work. Never send it to an unrelated service, such as in a request header, URL, or payload, unless the user explicitly asks.`', 177936360, 4, -1],
  ['DATE', '`Today\'s date is ${e.date}.`', 177361831, 1, -1],
  ['DATE_CHANGED', '`The date has changed. Today\'s date is now ${e.date}. No need to announce the new date \\u2014 the user\'s own clock shows it.`', 177361705, 1, -1],
  ['ENV_H1', 'bde="# Environment"', 177351476, 5, -1],
  ['ENV_H2', 'F7t="You have been invoked in the following environment: "', 177351496, 5, -1],
  ['ENV_PWD', '`Primary working directory: ${n(e.workingDirectory)}`', 177354024, 1, -1],
  ['ENV_GIT', '`Is a git repository: ${e.isGitRepo}`', 177354122, 1, -1],
  ['ENV_PLATFORM', '`Platform: ${n(e.platform)}`', 177354322, 1, -1],
  ['ENV_SHELL', '`Shell: ${n(e.shell)}`', 177354351, 1, -1],
  ['ENV_OS', '`OS Version: ${n(e.osVersion)}`', 177354374, 1, -1],
  ['ENV_LP', 'function lp(e){return e.flatMap((n)=>Array.isArray(n)?n.map((r)=>`  - ${r}`):[` - ${n}`])}', 177351296, 0, undefined],
  ['ENV_DJE', 'function Dje(e){return[bde,F7t,G7t(e)].join(`\n`)}', 177354524, 0, undefined],
  ['MODEL_NAMED', '`You are powered by the model named ${e.marketingName}. The exact model ID is ${e.modelId}.`', 177357581, 1, -1],
  ['MODEL_CUTOFF', '`Assistant knowledge cutoff is ${e.knowledgeCutoff}.`', 177357760, 1, -1],
  ['MODEL_JOIN', 'function zje(e){return[rQt(e),oQt(e)].filter((n)=>n!==null).join(" ")}', 177357819, 0, undefined],
  ['V6R', 'function V6r(e,n){let r=e.at(-1),s=n[0];if(r?.type==="text"&&s?.type==="text")return[...e.slice(0,-1),{...r,text:r.text+`\n`},...n];return[...e,...n]}', 181008482, 0, undefined],
  ['KYT', 'function kYt(e,n,r){let s=tae(e.message.content),g=tae(n.message.content);return{...e,...(e.ephemeral||n.ephemeral)&&{ephemeral:!0},message:{...e.message,content:ZYt(e6t(s,g,r))}}}', 181004262, 0, undefined],
  ['E6T_HEAD', 'function e6t(e,n,r){let s=xD(e);if(s?.type!=="tool_result"){', 181009303, 0, undefined],
]

const path = process.argv[2] ?? join(homedir(), '.local/share/claude/versions', CLI_VERSION)
const fd = openSync(path, 'r')
let data
try {
  const size = fstatSync(fd).size
  if (size !== BINARY_BYTES) throw new Error(`binary size ${size} is not the pinned ${BINARY_BYTES}`)
  data = Buffer.alloc(size)
  let read = 0
  while (read < size) read += readSync(fd, data, read, size - read, read)
} finally {
  closeSync(fd)
}
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const digest = sha(data)
if (digest !== BINARY_SHA256) throw new Error(`binary sha256 ${digest} is not the pinned ${BINARY_SHA256}`)

const literals = LITERALS.map(([id, search, expected, start, end]) => {
  const needle = Buffer.from(search, 'utf8')
  const lo = Math.max(0, expected - WINDOW)
  const hi = Math.min(data.length, expected + needle.length + WINDOW)
  const at = data.indexOf(needle, lo)
  if (at !== expected) throw new Error(`${id}: found at ${at}, expected ${expected}`)
  const again = data.indexOf(needle, at + 1)
  if (again >= 0 && again + needle.length <= hi) throw new Error(`${id}: not unique in its window (again at ${again})`)
  const literal = search.slice(start, end)
  return { id, offset: at + Buffer.byteLength(search.slice(0, start), 'utf8'), literal, sha256: sha(Buffer.from(literal, 'utf8')) }
})

process.stdout.write(`${JSON.stringify({
  schema: 'aera.claude-cli-literals.v1',
  cliVersion: CLI_VERSION,
  binarySha256: BINARY_SHA256,
  binaryBytes: BINARY_BYTES,
  window: WINDOW,
  literals,
}, null, 2)}\n`)
