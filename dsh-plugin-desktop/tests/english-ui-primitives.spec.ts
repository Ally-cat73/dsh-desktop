import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import {
  ReadBlock,
  SearchBlock,
  TerminalBlock,
  WebBlock,
} from '@deepseek-ai/dsh-client-ui-primitives'

const han = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u
const require = createRequire(import.meta.url)

function render(element: ReturnType<typeof createElement>): string {
  const markup = renderToStaticMarkup(element)
  expect(markup).not.toMatch(han)
  return markup
}

describe('Aera Code English system UI primitives', () => {
  it('ships the pre-bundled web frontend without Chinese primitive labels', () => {
    const packageRoot = dirname(require.resolve('@deepseek-ai/dsh-web-frontend/package.json'))
    const html = readFileSync(join(packageRoot, 'dist', 'index.html'), 'utf8')
    const assetName = html.match(/src="\/?assets\/(index-[^"]+\.js)"/)?.[1]
    expect(assetName).toBeTruthy()

    const asset = readFileSync(join(packageRoot, 'dist', 'assets', assetName!), 'utf8')
    expect(asset).not.toMatch(han)
    expect(asset).toContain('Connection lost. Reconnecting…')
    expect(asset).toContain('No results found')
    expect(asset).toContain('Source list truncated')
  })

  it('renders Glob results, truncation, and zero results in English', () => {
    const results = render(createElement(SearchBlock, {
      kind: 'paths',
      paths: ['src/a.ts', 'src/b.ts'],
      total: 39,
      truncated: true,
      maxLines: 1,
    }))
    expect(results).toContain('Showing 2 of 39 paths')
    expect(results).toContain('Expand 1 more result lines')
    expect(results).toContain('… 1 more lines')

    const empty = render(createElement(SearchBlock, {
      kind: 'paths', paths: [], total: 0, truncated: false,
    }))
    expect(empty).toContain('No results')
  })

  it('renders Grep results, counts, truncation, and zero results in English', () => {
    const results = render(createElement(SearchBlock, {
      kind: 'matches',
      files: [{
        path: 'src/a.ts',
        matches: [
          { lineNumber: 1, line: 'first match' },
          { lineNumber: 2, line: 'second match' },
        ],
      }],
      total: 21,
      truncated: true,
      maxLines: 1,
    }))
    expect(results).toContain('Showing 2 of 21 matches')
    expect(results).toContain('Expand 2 more result lines')
    expect(results).toContain('… 2 more lines')

    const empty = render(createElement(SearchBlock, {
      kind: 'matches', files: [], total: 0, truncated: false,
    }))
    expect(empty).toContain('No results')
  })

  it('renders truncated Read ranges and copy controls in English', () => {
    const markup = render(createElement(ReadBlock, {
      label: 'README.md',
      lines: Array.from({ length: 20 }, (_, index) => ({
        number: index + 1,
        text: `line ${index + 1}`,
      })),
      totalLines: 220,
      maxLines: 2,
    }))
    expect(markup).toContain('Showing 20 of 220 lines')
    expect(markup).toContain('Copy')
    expect(markup).toContain('Expand 18 more lines')
  })

  it('renders terminal completion, empty output, copy, and collapsed counts in English', () => {
    const output = render(createElement(TerminalBlock, {
      command: 'printf proof',
      output: Array.from({ length: 5 }, (_, index) => `line ${index + 1}`).join('\n'),
      exitCode: 0,
      maxLines: 2,
    }))
    expect(output).toContain('Completed')
    expect(output).toContain('Copy')
    expect(output).toContain('Expand 3 more output lines')
    expect(output).toContain('… 3 more lines')

    const empty = render(createElement(TerminalBlock, {
      command: 'true', output: '', exitCode: 0,
    }))
    expect(empty).toContain('No output')
  })

  it('renders web zero results and truncation notices in English', () => {
    const empty = render(createElement(WebBlock, {
      kind: 'search', sources: [], truncated: false,
    }))
    expect(empty).toContain('No results')

    const truncated = render(createElement(WebBlock, {
      kind: 'search',
      sources: [{ url: 'https://example.test', title: 'Example' }],
      truncated: true,
    }))
    expect(truncated).toContain('Source list truncated')
  })
})
