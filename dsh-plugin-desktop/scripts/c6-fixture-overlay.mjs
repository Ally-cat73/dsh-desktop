/** Explicit representative owner overlay; fixture-only, no production telemetry. */
export const name = 'c6-fixture-overlay'
export const inject = ['systemPrompt']
export function apply(ctx) {
  ctx.systemPrompt.section({ name: 'c6:owner-overlay', order: 20, text: 'C6 OWNER OVERLAY FIXTURE: work only in the synthetic repository. Preserve work-order identity, evidence and review isolation. No network or credential access.' })
}
