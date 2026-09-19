/**
 * The open/closed state of the cold-start Collab picker.
 *
 * WO-AERA-CODE-COLLAB-READ-FIRST-SURFACE-001, review finding D2.
 *
 * The conversation tab strip is `scope: 'session'`, so with no Session open the
 * tab does not exist and the sidebar is the ONLY way in. That path used to open
 * the native window on an empty WorkOrderId field — a typed route, which the
 * continuation order forbids outright. It now opens a picker inside the main
 * shell instead.
 *
 * The sidebar button and the overlay are two separate slot registrations that
 * have to agree about one piece of state, so it lives here: a minimal
 * observable shared by both, with no dependency on either.
 */

/** Notified whenever the picker opens or closes. */
type Listener = (open: boolean) => void

/**
 * How an affordance reveals Collab.
 *
 * `COLUMN` means the details column opened on the Collaborate tab — the normal
 * path once a Session exists. `PICKER` means there was no column to open, so
 * the shell-level picker was used instead; that is the cold start, and it is
 * the reason the picker cannot simply be deleted now that a column exists.
 */
export type AeraCollabReveal = 'COLUMN' | 'PICKER'

/** Opens the right-hand details column, where the shell has one. */
export interface AeraCollabColumn {
  /** @returns true when a column was actually opened. */
  open(): boolean
  close(): void
  isOpen(): boolean
}

/** Shared open/closed state for the shell-level Collab picker. */
export interface AeraCollabEntryController {
  isOpen(): boolean
  open(): void
  close(): void
  toggle(): void
  subscribe(listener: Listener): () => void
  /**
   * Reveal Collab through the best affordance available, and say which was
   * used. Toggling: a second press on an already-open column closes it, so the
   * one button both opens and closes, as the ruling requires.
   */
  reveal(): AeraCollabReveal
  /** Attach the shell's details column once the shell has one. */
  attachColumn(column: AeraCollabColumn): void
}

/** Create one controller per client generation. */
export function createAeraCollabEntryController(): AeraCollabEntryController {
  let open = false
  let column: AeraCollabColumn | undefined
  const listeners = new Set<Listener>()
  const publish = (): void => {
    for (const listener of [...listeners]) listener(open)
  }
  return Object.freeze({
    isOpen: () => open,
    open: () => {
      if (open) return
      open = true
      publish()
    },
    close: () => {
      if (!open) return
      open = false
      publish()
    },
    toggle: () => {
      open = !open
      publish()
    },
    attachColumn: (next: AeraCollabColumn) => { column = next },
    reveal: (): AeraCollabReveal => {
      if (column !== undefined) {
        if (column.isOpen()) {
          column.close()
          return 'COLUMN'
        }
        if (column.open()) return 'COLUMN'
      }
      /*
       * No column: the details slot is session-scoped, so with no Session open
       * there is nowhere for Collab to sit. That is precisely the cold start
       * the picker exists for.
       */
      open = !open
      publish()
      return 'PICKER'
    },
    subscribe: (listener: Listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  })
}
