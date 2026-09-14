import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Aera Code background subagent settlement custody', () => {
  it('does not copy unfinished child tool-call blocks into the parent settlement notice', () => {
    const source = readFileSync(
      new URL('../node_modules/@deepseek-ai/dsh-subagent/lib/index.js', import.meta.url),
      'utf8',
    )
    expect(source).toContain('const closingText = terminal.output?.filter')
    expect(source).toContain('block?.type === "text"')
    expect(source).toContain('...closingText')
    expect(source).not.toContain('}, ...terminal.output]]')
    expect(source).toContain('nativeTurnMessageId')
    expect(source).toContain('nativeTurnTerminal')
    expect(source).toContain('continuable subagent launch has no source user-turn identity')
    expect(source).toContain('version: 3')
  })
})
