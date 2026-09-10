/**
 * Collab host-integration seam — WO-AGC-002 Remit C (desktop retarget).
 *
 * The SAME three-member host contract delivered by remit A
 * (`hostSeam.ts`): everything else in the consumer is host-agnostic. The
 * desktop supplies its window/document machinery here; identity, authority and
 * the graph stay in the substrate packages and are never part of the seam.
 */

// Namespace import: see the note in `electron-reveal.ts`.
import * as electron from 'electron'

export interface CollabHostSeam {
  /** Where the observed worktree is, if one is configured. */
  resolveWorkspaceRoot(): string | undefined
  /** Open an authorised, already-resolved local source file. */
  openLocalSource(absolutePath: string): Promise<void>
  /** Surface an honest message/refusal to the user. */
  showMessage(message: string): void
}

/**
 * Desktop implementation. The workspace root comes from
 * `AERA_COLLAB_WORKSPACE_ROOT` (environment-resolved like every other collab
 * setting; no new Settings implementation). Authorised sources open through
 * the operating system's default handler for the real file — the path handed
 * here has already passed the service's traversal-hardened containment check.
 */
export function createDesktopCollabHostSeam(
  env: Readonly<Record<string, string | undefined>>,
  showMessage: (message: string) => void,
): CollabHostSeam {
  return {
    resolveWorkspaceRoot: () => {
      const root = env['AERA_COLLAB_WORKSPACE_ROOT']
      return root === undefined || root.trim() === '' ? undefined : root
    },
    openLocalSource: async (absolutePath: string) => {
      const failure = await electron.shell.openPath(absolutePath)
      if (failure !== '') throw new Error(`Failed to open source: ${failure}`)
    },
    showMessage,
  }
}
