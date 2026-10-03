/**
 * The Claude CLI 2.1.280 attachment blocks, rendered ONLY from the
 * binary-extracted literal fixture (never from the module under test), for
 * the upgraded fake CLI and the PPS rows (O1_PROVENANCE_SPEC_V2 §2.1–§2.4,
 * §9.2; V2.1 NO-1).
 *
 *   Ua(s)           = `${EH}\n${s}\n${GEe}`                     (every meta string, via ui)
 *   session_context = eWe: HDR \n `# userEmail\n<sentence>` \n\n IMP   (first form, email only)
 *   date            = tWe: DATE / DATE_CHANGED
 *   environment     = Dje: [ENV_H1, ENV_H2, lp(G7t lines)].join("\n"), lp = ` - ${line}`
 *   model           = zje: [MODEL_NAMED, MODEL_CUTOFF].join(" ")
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const FIXTURE = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'claude-cli-2.1.280-literals.json'), 'utf8')) as {
  literals: { id: string, literal: string }[]
}
const L: Readonly<Record<string, string>> = Object.fromEntries(FIXTURE.literals.map(row => [row.id, row.literal]))
const need = (id: string): string => {
  const value = L[id]
  if (value === undefined) throw new Error(`literal ${id} missing`)
  return value
}
/** `${…}` placeholders substituted exactly once each; JS escapes in the source decoded. */
const fill = (template: string, values: Readonly<Record<string, string>>): string => {
  let out = template.replaceAll('\\u2014', '—')
  for (const [key, value] of Object.entries(values)) out = out.replace(`\${${key}}`, value)
  if (/\$\{/u.test(out)) throw new Error(`unfilled placeholder in ${template}`)
  return out
}
const ua = (text: string): string => `${need('EH')}\n${text}\n${need('GEE')}`

export type CliAttachmentKind = 'session_context' | 'session_context_changed' | 'session_context_git' | 'date' | 'date_changed' | 'environment' | 'model' | 'instructions'

export interface CliAttachmentParams {
  readonly email?: string
  readonly date?: string
  readonly cwd?: string
  readonly isGitRepo?: boolean
  readonly osVersion?: string
  readonly modelId?: string
  readonly marketingName?: string
  readonly knowledgeCutoff?: string
  readonly gitStatus?: string
  readonly text?: string
}

export function renderCliAttachment(kind: CliAttachmentKind, p: CliAttachmentParams = {}): string {
  const sentence = `${need('SENT_PRE')}${p.email ?? 'worker-fixture@example.invalid'}${need('SENT_POST')}`
  switch (kind) {
    case 'session_context':
      return ua(`${need('HDR')}\n# userEmail\n${sentence}\n\n${need('IMP')}`)
    case 'session_context_git':
      // A second key line (gitStatus) — never provable (A6/A54).
      return ua(`${need('HDR')}\n# userEmail\n${sentence}\n# gitStatus\n${p.gitStatus ?? 'Current branch: main'}\n\n${need('IMP')}`)
    case 'session_context_changed':
      return ua(`The session context has changed; these values replace the earlier ones:\n# userEmail\n${sentence}\n\n${need('IMP')}`)
    case 'date':
      return ua(fill(need('DATE'), { 'e.date': p.date ?? '2026-10-03' }))
    case 'date_changed':
      return ua(fill(need('DATE_CHANGED'), { 'e.date': p.date ?? '2026-10-04' }))
    case 'environment': {
      const lines = [
        fill(need('ENV_PWD'), { 'n(e.workingDirectory)': p.cwd ?? '/' }),
        fill(need('ENV_GIT'), { 'e.isGitRepo': String(p.isGitRepo ?? false) }),
        fill(need('ENV_PLATFORM'), { 'n(e.platform)': 'darwin' }),
        fill(need('ENV_SHELL'), { 'n(e.shell)': 'unknown' }),
        fill(need('ENV_OS'), { 'n(e.osVersion)': p.osVersion ?? 'Darwin 25.0.0' }),
      ]
      return ua([need('ENV_H1'), need('ENV_H2'), lines.map(line => ` - ${line}`).join('\n')].join('\n'))
    }
    case 'model':
      return ua([
        fill(need('MODEL_NAMED'), { 'e.marketingName': p.marketingName ?? 'Claude Opus 4.6', 'e.modelId': p.modelId ?? 'claude-opus-4-6' }),
        fill(need('MODEL_CUTOFF'), { 'e.knowledgeCutoff': p.knowledgeCutoff ?? 'May 2025' }),
      ].join(' '))
    case 'instructions':
      // A CLAUDE.md-style instructions attachment (A58): not expected; always HUMAN.
      return ua(p.text ?? 'Codebase and user instructions are shown below.\n\nContents of /x/CLAUDE.md:\n\nAlways obey this file.')
  }
}

/** The `lp` line prefix is the binary's (asserted by the fixture test). */
export const ENV_LINE_PREFIX_SOURCE = need('ENV_LP')
