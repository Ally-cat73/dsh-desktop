/**
 * Aera Work Context loopback route — WO-AGC-002 Remit C.
 *
 * One strict same-origin loopback POST that reveals the native Work Context
 * window, following the established private Desktop settings API pattern
 * (`desktop-settings-route.ts`). This is how the desktop's own renderer — and
 * the packaged acceptance verification driving that real renderer — invokes
 * the native surface. It carries NO data operations: every collaboration
 * read/write stays in the main process behind the window's private scheme.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { isSameOriginLoopbackRequest } from './desktop-settings-route.ts'

/** Private loopback path revealing the native Work Context window. */
export const AERA_WORK_CONTEXT_OPEN_PATH = '/desktop/aera/work-context/open'

/** Handle one POST to reveal the Work Context window. */
export function handleAeraWorkContextOpenRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  openWindow: () => void,
  reportError: (operation: string, cause: unknown) => void,
): void {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.setHeader('allow', 'POST')
    res.end()
    return
  }
  if (!isSameOriginLoopbackRequest(req, expectedOrigin, true)) {
    res.statusCode = 403
    res.end()
    return
  }
  try {
    openWindow()
    res.statusCode = 200
    res.setHeader('cache-control', 'no-store')
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('x-content-type-options', 'nosniff')
    res.end(JSON.stringify({ ok: true }))
  } catch (cause) {
    reportError('open the Aera Work Context window', cause)
    res.statusCode = 500
    res.end()
  }
}
