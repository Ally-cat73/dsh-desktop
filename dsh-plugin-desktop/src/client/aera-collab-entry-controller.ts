/**
 * The open/closed state of the Collab drawer.
 *
 * WO-AERA-COLLAB-RELAY-COORDINATION-THREADS-AND-WORKING-LINE-HANDOFF-001,
 * owner superseding continuation `CONTINUE_HOST_RECOVERY.md` §13 Option B.
 *
 * ## Why there is no column here any more
 *
 * This controller used to know about the shell's right-hand details column and
 * prefer it, falling back to a shell-level picker. The §14 host decision
 * removed that: the right region is the single, session-scoped `details` seat,
 * owned by `@deepseek-ai/dsh-client-ui-conversation`, whose `chatStore` is a
 * closure local the package never exports. Collab could only have sat there by
 * patching the vendor further (§12) or by displacing ordinary tool Details
 * (§15). It now lives on `shell.overlay` — public, `kind: 'list'`,
 * `scope: 'root'` — so there is exactly one way in and exactly one state to
 * hold, and no column to negotiate with.
 *
 * ## Why open means open
 *
 * `reveal()` used to toggle: pressing the affordance while Collab was already
 * showing closed it. That was defensible when the affordance was also the
 * column's only control, but under Option B the drawer carries its own close
 * button and Escape, so a toggling entry point is just a way to make the one
 * visible "Open Collab…" control sometimes do the opposite of what it says.
 * §18 asks for one click to open. `reveal()` opens. Closing is `close()`, and
 * the reader reaches it from the drawer.
 */

/** Notified whenever the drawer opens or closes. */
type Listener = (open: boolean) => void

/** Shared open/closed state for the shell-level Collab drawer. */
export interface AeraCollabEntryController {
  isOpen(): boolean
  open(): void
  close(): void
  /**
   * Open Collab. Idempotent, and never closes: see the note above. Kept as a
   * named affordance verb, distinct from `open()`, so the entry points read as
   * intent rather than as state assignment.
   */
  reveal(): void
  subscribe(listener: Listener): () => void
}

/** Create one controller per client generation. */
export function createAeraCollabEntryController(): AeraCollabEntryController {
  let open = false
  const listeners = new Set<Listener>()
  const publish = (): void => {
    for (const listener of [...listeners]) listener(open)
  }
  const doOpen = (): void => {
    if (open) return
    open = true
    publish()
  }
  return Object.freeze({
    isOpen: () => open,
    open: doOpen,
    reveal: doOpen,
    close: () => {
      if (!open) return
      open = false
      publish()
    },
    subscribe: (listener: Listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  })
}
