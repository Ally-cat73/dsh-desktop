/**
 * Claude Code stream-json protocol parsing and the FAIL-CLOSED load-surface
 * guard — WO-AERA-CODE-CLAUDE-CODE-GOVERNED-WORKER-INTEGRATION-001 §7/§11.
 *
 * Pure functions only: no process, no filesystem. The host feeds stdout bytes
 * in; this module says what each line means and whether the Epoch may
 * continue.
 *
 * THE GUARD IS THE PROOF THE WORKER HAS NO EXECUTOR. The CLI reports its load
 * surface in `system/init` (Phase A recon §C; Phase B probe 2 showed one init
 * per turn in stream-json input mode). Every init, and every other event, is
 * checked. Anything that indicates a native executor — a built-in tool, an MCP
 * server, a skill, a slash command, a non-builtin plugin, a hook firing, a
 * tool_use block, a permission denial (a tool was attempted), API-key auth —
 * refuses the Epoch. A future CLI version that silently re-enables any of them
 * is therefore refused, not trusted.
 */

import type { WorkerAuthClass, WorkerUsage } from './aera-worker-adapter.ts'

/** Longest stdout line accepted before the Epoch is refused as malformed. */
export const MAX_STREAM_LINE_BYTES = 4 * 1024 * 1024

/**
 * The only plugins a fully isolated Epoch may report: compiled into the binary
 * (`path: "builtin"`), not loadable from the owner's configuration. Phase B
 * probe 1: `--safe-mode --setting-sources ""` reduces `plugins` to exactly
 * these two. They are recorded per Epoch as known, ungoverned behaviour
 * (`telemetry@builtin` reports to Anthropic; `agents-md@builtin` reads
 * AGENTS.md from the cwd, which is an empty Aera-owned scratch dir).
 */
export const ALLOWED_BUILTIN_PLUGINS: readonly string[] = Object.freeze(['agents-md', 'telemetry'])

/** Incremental newline framing with a hard line bound. */
export class StreamLineFramer {
  private buffer = ''

  /** Push a chunk; returns complete lines, or throws when a line exceeds the bound. */
  push(chunk: string): string[] {
    this.buffer += chunk
    const lines: string[] = []
    let index = this.buffer.indexOf('\n')
    while (index >= 0) {
      const line = this.buffer.slice(0, index)
      this.buffer = this.buffer.slice(index + 1)
      if (line.trim() !== '') lines.push(line)
      index = this.buffer.indexOf('\n')
    }
    if (Buffer.byteLength(this.buffer, 'utf8') > MAX_STREAM_LINE_BYTES) {
      throw new Error('STREAM_LINE_TOO_LONG')
    }
    return lines
  }

  /** Any unterminated trailing content (a truncated final line). */
  remainder(): string {
    return this.buffer
  }
}

/** A parsed stdout event, or a malformed line. */
export type ParsedStreamLine =
  | { readonly ok: true, readonly event: Readonly<Record<string, unknown>> }
  | { readonly ok: false, readonly reason: string }

export function parseStreamLine(line: string): ParsedStreamLine {
  if (Buffer.byteLength(line, 'utf8') > MAX_STREAM_LINE_BYTES) return { ok: false, reason: 'line exceeds bound' }
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return { ok: false, reason: 'line is not JSON' }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'line is not a JSON object' }
  }
  const event = value as Record<string, unknown>
  if (typeof event.type !== 'string') return { ok: false, reason: 'event has no type' }
  return { ok: true, event }
}

/** What the host expects the isolated runtime to report. */
export interface ClaudeInitExpectations {
  /** The Epoch scratch dir, in every spelling the OS may report (logical and real path). */
  readonly scratchDirs: readonly string[]
  readonly cliVersion: string
  /** Pinned model. An alias (e.g. `haiku`) is recorded; a full id must match exactly. */
  readonly model: string
}

export type GuardVerdict =
  | { readonly ok: true }
  | { readonly ok: false, readonly code: GuardRefusalCode, readonly detail: string }

export type GuardRefusalCode =
  | 'NATIVE_TOOLS_PRESENT'
  | 'MCP_SERVERS_PRESENT'
  | 'SKILLS_PRESENT'
  | 'SLASH_COMMANDS_PRESENT'
  | 'PLUGINS_PRESENT'
  | 'HOOK_ACTIVITY'
  | 'NATIVE_TOOL_USE'
  | 'PERMISSION_DENIALS'
  | 'API_KEY_AUTH_REFUSED'
  | 'CWD_MISMATCH'
  | 'VERSION_MISMATCH'
  | 'MODEL_MISMATCH'
  | 'INIT_MALFORMED'

const refuse = (code: GuardRefusalCode, detail: string): GuardVerdict => ({ ok: false, code, detail })

function stringArray(value: unknown): readonly unknown[] | undefined {
  return Array.isArray(value) ? value : undefined
}

/** A model id that is a concrete id rather than an alias (`haiku`, `sonnet`, `opus`, …). */
export function isConcreteModelId(model: string): boolean {
  return /^claude-[a-z0-9-]+-\d/u.test(model) || /\d{8}/u.test(model)
}

/** Evaluate one `system/init` against the isolation contract. */
export function evaluateInitGuard(
  init: Readonly<Record<string, unknown>>,
  expected: ClaudeInitExpectations,
): GuardVerdict {
  const tools = stringArray(init.tools)
  const mcp = stringArray(init.mcp_servers)
  const skills = stringArray(init.skills)
  const slash = stringArray(init.slash_commands)
  const plugins = stringArray(init.plugins)
  if (tools === undefined || mcp === undefined || skills === undefined || slash === undefined || plugins === undefined) {
    return refuse('INIT_MALFORMED', 'init does not report tools, mcp_servers, skills, slash_commands and plugins; the load surface cannot be verified')
  }
  if (tools.length > 0) return refuse('NATIVE_TOOLS_PRESENT', `init reports ${String(tools.length)} tool(s): ${tools.map(String).slice(0, 8).join(', ')}`)
  if (mcp.length > 0) return refuse('MCP_SERVERS_PRESENT', `init reports ${String(mcp.length)} MCP server(s)`)
  if (skills.length > 0) return refuse('SKILLS_PRESENT', `init reports ${String(skills.length)} skill(s)`)
  if (slash.length > 0) return refuse('SLASH_COMMANDS_PRESENT', `init reports ${String(slash.length)} slash command(s)`)
  for (const plugin of plugins) {
    const record = plugin !== null && typeof plugin === 'object' ? plugin as Record<string, unknown> : {}
    const name = typeof record.name === 'string' ? record.name : String(plugin)
    if (record.path !== 'builtin' || !ALLOWED_BUILTIN_PLUGINS.includes(name)) {
      return refuse('PLUGINS_PRESENT', `init reports non-builtin plugin ${name}`)
    }
  }
  if (init.apiKeySource !== 'none') {
    return refuse('API_KEY_AUTH_REFUSED', `apiKeySource is ${String(init.apiKeySource)}; V1 uses the existing subscription login only (§16)`)
  }
  if (typeof init.cwd !== 'string' || !expected.scratchDirs.includes(init.cwd)) {
    return refuse('CWD_MISMATCH', 'init cwd is not the Epoch scratch dir')
  }
  if (init.claude_code_version !== expected.cliVersion) {
    return refuse('VERSION_MISMATCH', `init reports version ${String(init.claude_code_version)}, pinned ${expected.cliVersion}`)
  }
  const model = typeof init.model === 'string' ? init.model : ''
  if (model === '') return refuse('MODEL_MISMATCH', 'init reports no model')
  if (isConcreteModelId(expected.model) && model !== expected.model) {
    return refuse('MODEL_MISMATCH', `init reports model ${model}, pinned ${expected.model}`)
  }
  return { ok: true }
}

const TOOL_BLOCK_TYPES = new Set(['tool_use', 'server_tool_use', 'mcp_tool_use', 'tool_result', 'mcp_tool_result'])

/** Evaluate any non-init event. */
export function evaluateEventGuard(event: Readonly<Record<string, unknown>>): GuardVerdict {
  const type = event.type
  if (type === 'system') {
    const subtype = event.subtype
    if (typeof subtype === 'string' && /^hook_/u.test(subtype)) {
      return refuse('HOOK_ACTIVITY', `hook event ${subtype}`)
    }
  }
  if (typeof type === 'string' && /hook/u.test(type)) return refuse('HOOK_ACTIVITY', `hook event ${type}`)
  if (type === 'assistant' || type === 'user') {
    const message = event.message
    const content = message !== null && typeof message === 'object'
      ? (message as Record<string, unknown>).content
      : undefined
    if (Array.isArray(content)) {
      for (const block of content) {
        const blockType = block !== null && typeof block === 'object' ? (block as Record<string, unknown>).type : undefined
        if (typeof blockType === 'string' && TOOL_BLOCK_TYPES.has(blockType)) {
          return refuse('NATIVE_TOOL_USE', `${type} message carries a ${blockType} block`)
        }
      }
    }
  }
  if (type === 'result') {
    const denials = event.permission_denials
    if (Array.isArray(denials) && denials.length > 0) {
      return refuse('PERMISSION_DENIALS', `result reports ${String(denials.length)} permission denial(s): a native tool was attempted`)
    }
  }
  return { ok: true }
}

/** Text content of an assistant event (thinking blocks excluded). */
export function assistantText(event: Readonly<Record<string, unknown>>): string {
  if (event.type !== 'assistant') return ''
  const message = event.message
  if (message === null || typeof message !== 'object') return ''
  const content = (message as Record<string, unknown>).content
  if (!Array.isArray(content)) return ''
  return content
    .map(block => block !== null && typeof block === 'object' && (block as Record<string, unknown>).type === 'text'
      ? String((block as Record<string, unknown>).text ?? '')
      : '')
    .join('')
}

/** `authentication_failed` on an assistant event means the CLI is not logged in. */
export function isAuthenticationFailure(event: Readonly<Record<string, unknown>>): boolean {
  return event.type === 'assistant' && event.error === 'authentication_failed'
}

const num = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined

/** Usage from a `result` event, with the SIGINT-zeroing limitation made explicit. */
export function resultUsage(event: Readonly<Record<string, unknown>>): WorkerUsage {
  const usage = event.usage !== null && typeof event.usage === 'object' ? event.usage as Record<string, unknown> : {}
  const inputTokens = num(usage.input_tokens)
  const outputTokens = num(usage.output_tokens)
  const cacheCreationInputTokens = num(usage.cache_creation_input_tokens)
  const cacheReadInputTokens = num(usage.cache_read_input_tokens)
  const notionalCostUsd = num(event.total_cost_usd)
  const aborted = event.terminal_reason === 'aborted_streaming'
  return {
    reported: !aborted,
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(cacheCreationInputTokens === undefined ? {} : { cacheCreationInputTokens }),
    ...(cacheReadInputTokens === undefined ? {} : { cacheReadInputTokens }),
    ...(notionalCostUsd === undefined ? {} : { notionalCostUsd }),
    note: aborted
      ? 'turn aborted: the CLI zeroes usage on interrupt, so tokens already consumed are not reported'
      : 'total_cost_usd is a notional list-price figure, not a subscription charge',
  }
}

/** The concrete model a `result` event attributes usage to, if any. */
export function resultModel(event: Readonly<Record<string, unknown>>): string | undefined {
  const modelUsage = event.modelUsage
  if (modelUsage === null || typeof modelUsage !== 'object') return undefined
  const keys = Object.keys(modelUsage)
  return keys.length === 0 ? undefined : keys.sort().join(',')
}

/** Classify auth from what the CLI reported (non-secret facts only). */
export function classifyAuth(input: {
  readonly apiKeySource?: unknown
  readonly authenticationFailed: boolean
  readonly turnSucceeded: boolean
}): WorkerAuthClass {
  if (input.apiKeySource !== undefined && input.apiKeySource !== 'none') return 'API_KEY_AUTH_REFUSED'
  if (input.authenticationFailed) return 'NOT_LOGGED_IN'
  if (input.apiKeySource === 'none' && input.turnSucceeded) return 'SUBSCRIPTION_OAUTH'
  return 'UNKNOWN'
}
