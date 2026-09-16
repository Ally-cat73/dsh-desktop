/** Private installation identity used only by DSH Desktop update checks. */

import { randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, open, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

/** Header carrying the pseudonymous Desktop installation identity. */
export const DESKTOP_INSTALLATION_ID_HEADER = 'X-DSH-Desktop-Installation-Id'

/** Relative state location below Electron's userData directory. */
export const DESKTOP_INSTALLATION_ID_RELATIVE_PATH = join('identity', 'installation-id')

/** Maximum state bytes read before treating an ordinary file as corrupt. */
export const MAX_DESKTOP_INSTALLATION_ID_BYTES = 128

const PRIVATE_DIRECTORY_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600

/**
 * Minimum age before an orphaned writer lock may be reclaimed.
 *
 * A legitimate writer holds the lock for the few milliseconds it takes to read
 * the state and rename one small file into place, and a contender only reaches
 * reclamation after `withFileLock` has already waited out its own timeout. A
 * lock this old whose recorded process is gone is an orphan, not contention.
 * The generous margin is what keeps PID reuse from making a LIVE writer look
 * reclaimable.
 */
const STALE_LOCK_MIN_AGE_MS = 30_000

/** Maximum lock bytes read before refusing to interpret it as a PID. */
const MAX_LOCK_BYTES = 64
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

/** Locally generated, pseudonymous UUID v4 scoped to one Desktop userData tree. */
export type DesktopInstallationId = string & { readonly __desktopInstallationId: unique symbol }

/** Injectable UUID source and process probe used only by focused tests. */
export interface DesktopInstallationIdOptions {
  readonly randomUUID?: () => string
  /** Whether a PID is still running. Defaults to a real `kill(pid, 0)` probe. */
  readonly processIsAlive?: (pid: number) => boolean
  /** Clock used to age a candidate orphaned lock. */
  readonly now?: () => number
}

/** Failure raised when the identity state path is unsafe or cannot be persisted. */
export class DesktopInstallationIdError extends Error {
  constructor(message: string, options: { readonly cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'DesktopInstallationIdError'
  }
}

/** Return the exact private state path for one Electron userData directory. */
export function desktopInstallationIdPath(userDataDirectory: string): string {
  if (userDataDirectory.length === 0
    || /[\0\r\n]/u.test(userDataDirectory)
    || !isAbsolute(userDataDirectory)) {
    throw new DesktopInstallationIdError('Desktop userData must be an absolute path without control characters.')
  }
  return join(resolve(userDataDirectory), DESKTOP_INSTALLATION_ID_RELATIVE_PATH)
}

/** Parse one canonical lowercase UUID v4 without accepting surrounding text. */
export function parseDesktopInstallationId(value: unknown): DesktopInstallationId | undefined {
  return typeof value === 'string' && UUID_V4_PATTERN.test(value)
    ? value as DesktopInstallationId
    : undefined
}

/** Require one canonical UUID v4 before it can enter an outbound header. */
export function assertDesktopInstallationId(value: string): DesktopInstallationId {
  const parsed = parseDesktopInstallationId(value)
  if (parsed === undefined) {
    throw new DesktopInstallationIdError('Desktop installation identity must be a canonical lowercase UUID v4.')
  }
  return parsed
}

/**
 * Return the installation UUID for one Desktop userData tree.
 *
 * A missing or corrupt ordinary file is rebuilt atomically. Symbolic links,
 * directories, and other special entries are rejected rather than followed or
 * removed. Persistence failures are explicit: callers must not silently emit a
 * fresh, process-local identifier on every update check.
 *
 * Reading an identity that already exists takes NO writer lock. `withFileLock`
 * serialises writers precisely so that "readers stay lock-free because the
 * rename commit is atomic"; taking the writer lock to perform what is almost
 * always a pure read broke that contract and made every launch depend on a
 * lock it did not need.
 *
 * That mattered because the lock is a plain `wx`-created sibling file removed
 * in a `finally`: a process killed while holding it — a crash, a force quit,
 * a SIGKILL — never runs that `finally` and leaves the lock behind forever.
 * Every later launch then timed out on an orphan and reported that the
 * identity "could not be persisted safely", even though a perfectly valid
 * identity was sitting next to the orphaned lock, readable, and never read.
 * Desktop startup awaits this call, so the whole product fell into Recovery
 * Mode until somebody deleted the lock by hand.
 *
 * So the write path — the only path that genuinely needs exclusion — may now
 * reclaim a lock that is provably an orphan: an ordinary file, older than
 * {@link STALE_LOCK_MIN_AGE_MS}, whose recorded PID is no longer running. It
 * retries exactly once and then fails closed. Every genuinely unsafe state
 * (symlink, directory, special file, unreadable state, a lock held by a live
 * process) still refuses rather than guessing.
 */
export async function getOrCreateDesktopInstallationId(
  userDataDirectory: string,
  options: DesktopInstallationIdOptions = {},
): Promise<DesktopInstallationId> {
  const statePath = desktopInstallationIdPath(userDataDirectory)
  const identityDirectory = dirname(statePath)
  await prepareIdentityDirectory(identityDirectory)

  // Lock-free read. An unsafe state still throws from here, before any lock.
  const existing = await readPersistedInstallationId(statePath)
  if (existing !== undefined) return existing

  try {
    return await createPersistedInstallationId(statePath, options)
  } catch (cause) {
    if (cause instanceof DesktopInstallationIdError) throw cause
    if (!await reclaimOrphanedWriterLock(statePath, options)) {
      throw new DesktopInstallationIdError('Desktop installation identity could not be persisted safely.', { cause })
    }
    try {
      return await createPersistedInstallationId(statePath, options)
    } catch (retryCause) {
      if (retryCause instanceof DesktopInstallationIdError) throw retryCause
      throw new DesktopInstallationIdError('Desktop installation identity could not be persisted safely.', { cause: retryCause })
    }
  }
}

/** Generate and persist an identity under the cross-process writer lock. */
async function createPersistedInstallationId(
  statePath: string,
  options: DesktopInstallationIdOptions,
): Promise<DesktopInstallationId> {
  return await withFileLock(statePath, async () => {
    const persisted = await readPersistedInstallationId(statePath)
    if (persisted !== undefined) return persisted

    const generated = assertDesktopInstallationId((options.randomUUID ?? randomUUID)())
    await writeFileAtomic(statePath, `${generated}\n`, {
      mode: PRIVATE_FILE_MODE,
      dirMode: PRIVATE_DIRECTORY_MODE,
    })
    return generated
  })
}

/** Is this PID still running? `EPERM` means alive but owned by someone else. */
function defaultProcessIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Remove the writer lock only when it is provably an orphan, and report
 * whether the caller may retry. Anything uncertain returns `false`: a lock
 * held by a live process, a lock too young to judge, a symlink or directory
 * planted at the lock path, or content that is not a plain PID.
 */
async function reclaimOrphanedWriterLock(
  statePath: string,
  options: DesktopInstallationIdOptions,
): Promise<boolean> {
  const lockPath = `${statePath}.lock`
  const now = options.now ?? Date.now
  const processIsAlive = options.processIsAlive ?? defaultProcessIsAlive

  let stat: Awaited<ReturnType<typeof lstat>>
  try {
    stat = await lstat(lockPath)
  } catch {
    return false // nothing to reclaim; the original failure stands
  }
  // Never follow or remove anything that is not an ordinary lock file.
  if (!stat.isFile() || stat.isSymbolicLink()) return false
  if (stat.size === 0 || stat.size > MAX_LOCK_BYTES) return false
  if (now() - stat.mtimeMs < STALE_LOCK_MIN_AGE_MS) return false

  const handle = await open(lockPath, 'r')
  let pid: number
  try {
    const opened = await handle.stat()
    // Refuse if the lock was replaced between inspection and open.
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino) return false
    const buffer = Buffer.alloc(MAX_LOCK_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0)
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead))
    const match = /^(\d{1,10})\n?$/u.exec(text)
    if (match === null) return false
    pid = Number(match[1])
  } catch {
    return false
  } finally {
    await handle.close()
  }
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  if (processIsAlive(pid)) return false

  try {
    await rm(lockPath, { force: true })
  } catch {
    return false
  }
  return true
}

async function prepareIdentityDirectory(directory: string): Promise<void> {
  try {
    await mkdir(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
    const stat = await lstat(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new DesktopInstallationIdError('Desktop identity state directory must be an ordinary directory.')
    }
    await chmod(directory, PRIVATE_DIRECTORY_MODE)
  } catch (cause) {
    if (cause instanceof DesktopInstallationIdError) throw cause
    throw new DesktopInstallationIdError('Desktop identity state directory is unavailable.', { cause })
  }
}

async function readPersistedInstallationId(statePath: string): Promise<DesktopInstallationId | undefined> {
  let stat: Awaited<ReturnType<typeof lstat>>
  try {
    stat = await lstat(statePath)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new DesktopInstallationIdError('Desktop installation identity state could not be inspected.', { cause })
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new DesktopInstallationIdError('Desktop installation identity state must be an ordinary file.')
  }
  if (stat.size > MAX_DESKTOP_INSTALLATION_ID_BYTES) return undefined

  const handle = await open(statePath, 'r')
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || opened.size > MAX_DESKTOP_INSTALLATION_ID_BYTES) return undefined
    if (opened.dev !== stat.dev || opened.ino !== stat.ino) {
      throw new DesktopInstallationIdError('Desktop installation identity state changed while it was being opened.')
    }
    const buffer = Buffer.alloc(MAX_DESKTOP_INSTALLATION_ID_BYTES + 1)
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0)
    if (bytesRead > MAX_DESKTOP_INSTALLATION_ID_BYTES) return undefined
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead))
    const match = /^([0-9a-f-]+)\n?$/u.exec(text)
    const parsed = match === null ? undefined : parseDesktopInstallationId(match[1])
    if (parsed === undefined) return undefined
    await handle.chmod(PRIVATE_FILE_MODE)
    return parsed
  } catch (cause) {
    if (cause instanceof TypeError) return undefined
    if (cause instanceof DesktopInstallationIdError) throw cause
    throw new DesktopInstallationIdError('Desktop installation identity state could not be read safely.', { cause })
  } finally {
    await handle.close()
  }
}
