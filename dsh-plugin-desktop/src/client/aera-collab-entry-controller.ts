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

/** Shared open/closed state for the shell-level Collab picker. */
export interface AeraCollabEntryController {
  isOpen(): boolean
  open(): void
  close(): void
  toggle(): void
  subscribe(listener: Listener): () => void
}

/** Create one controller per client generation. */
export function createAeraCollabEntryController(): AeraCollabEntryController {
  let open = false
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
    subscribe: (listener: Listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  })
}
