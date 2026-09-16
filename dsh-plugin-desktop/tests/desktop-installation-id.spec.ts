import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DESKTOP_INSTALLATION_ID_HEADER,
  MAX_DESKTOP_INSTALLATION_ID_BYTES,
  assertDesktopInstallationId,
  desktopInstallationIdPath,
  getOrCreateDesktopInstallationId,
  parseDesktopInstallationId,
} from '../src/desktop-installation-id.ts'

const roots: string[] = []
const FIRST = '01234567-89ab-4cde-8f01-23456789abcd'
const SECOND = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

async function userData(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-installation-id-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Desktop installation identity', () => {
  it('parses only canonical lowercase UUID v4 values', () => {
    expect(parseDesktopInstallationId(FIRST)).toBe(FIRST)
    expect(parseDesktopInstallationId('01234567-89AB-4CDE-8F01-23456789ABCD')).toBeUndefined()
    expect(parseDesktopInstallationId('01234567-89ab-1cde-8f01-23456789abcd')).toBeUndefined()
    expect(parseDesktopInstallationId(` ${FIRST}`)).toBeUndefined()
    expect(() => assertDesktopInstallationId('not-a-uuid')).toThrow('canonical lowercase UUID v4')
    expect(DESKTOP_INSTALLATION_ID_HEADER).toBe('X-DSH-Desktop-Installation-Id')
  })

  // ---------------------------------------------------------------------
  // Orphaned writer lock — the defect that put the product in Recovery Mode.
  //
  // `withFileLock` creates `<file>.lock` with `wx` and removes it in a
  // `finally`. A process killed while holding it never runs that `finally`,
  // so the lock outlives it. Desktop startup awaits the identity, so every
  // later launch fell into Recovery Mode reporting that the identity "could
  // not be persisted safely" — while a perfectly valid identity sat unread
  // beside the orphan.
  // ---------------------------------------------------------------------

  it('reads an existing identity without taking the writer lock', async () => {
    const root = await userData()
    const statePath = desktopInstallationIdPath(root)
    await mkdir(join(root, 'identity'), { recursive: true, mode: 0o700 })
    await writeFile(statePath, `${FIRST}\n`, { mode: 0o600 })

    // An orphaned lock from a killed writer, exactly as found on the owner's
    // machine: an ordinary file naming a PID that is no longer running.
    const lockPath = `${statePath}.lock`
    await writeFile(lockPath, '1807\n', { mode: 0o600 })

    // The identity is already persisted, so this is a pure read and must not
    // block on, wait for, or disturb the lock at all.
    const started = Date.now()
    await expect(getOrCreateDesktopInstallationId(root, { randomUUID: () => SECOND }))
      .resolves.toBe(FIRST)
    expect(Date.now() - started).toBeLessThan(1000) // no 2s lock timeout
    // The lock is not ours to remove on a read path.
    await expect(lstat(lockPath)).resolves.toBeDefined()
  })

  it('reclaims an orphaned lock when it must create an identity, then succeeds', async () => {
    const root = await userData()
    const statePath = desktopInstallationIdPath(root)
    await mkdir(join(root, 'identity'), { recursive: true, mode: 0o700 })
    const lockPath = `${statePath}.lock`
    await writeFile(lockPath, '1807\n', { mode: 0o600 })

    const identity = await getOrCreateDesktopInstallationId(root, {
      randomUUID: () => FIRST,
      processIsAlive: () => false,
      now: () => Date.now() + 60_000, // the lock is comfortably old
    })
    expect(identity).toBe(FIRST)
    expect(await readFile(statePath, 'utf8')).toBe(`${FIRST}\n`)
    await expect(lstat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('never steals a lock held by a LIVE process', async () => {
    const root = await userData()
    const statePath = desktopInstallationIdPath(root)
    await mkdir(join(root, 'identity'), { recursive: true, mode: 0o700 })
    const lockPath = `${statePath}.lock`
    await writeFile(lockPath, `${process.pid}\n`, { mode: 0o600 })

    await expect(getOrCreateDesktopInstallationId(root, {
      randomUUID: () => FIRST,
      processIsAlive: () => true,
      now: () => Date.now() + 60_000,
    })).rejects.toThrow('could not be persisted safely')
    // A live writer's lock is left exactly where it was.
    await expect(lstat(lockPath)).resolves.toBeDefined()
  })

  it('never steals a lock that is too young to judge', async () => {
    const root = await userData()
    const statePath = desktopInstallationIdPath(root)
    await mkdir(join(root, 'identity'), { recursive: true, mode: 0o700 })
    const lockPath = `${statePath}.lock`
    await writeFile(lockPath, '1807\n', { mode: 0o600 })

    await expect(getOrCreateDesktopInstallationId(root, {
      randomUUID: () => FIRST,
      processIsAlive: () => false, // dead, but the lock was just created
    })).rejects.toThrow('could not be persisted safely')
    await expect(lstat(lockPath)).resolves.toBeDefined()
  })

  it('never follows or removes a symlink planted at the lock path', async () => {
    const root = await userData()
    const statePath = desktopInstallationIdPath(root)
    await mkdir(join(root, 'identity'), { recursive: true, mode: 0o700 })
    const decoy = join(root, 'decoy')
    await writeFile(decoy, 'precious\n', { mode: 0o600 })
    await symlink(decoy, `${statePath}.lock`)

    await expect(getOrCreateDesktopInstallationId(root, {
      randomUUID: () => FIRST,
      processIsAlive: () => false,
      now: () => Date.now() + 60_000,
    })).rejects.toThrow('could not be persisted safely')
    // The symlink target is untouched.
    expect(await readFile(decoy, 'utf8')).toBe('precious\n')
  })

  it('refuses a lock whose content is not a plain PID', async () => {
    const root = await userData()
    const statePath = desktopInstallationIdPath(root)
    await mkdir(join(root, 'identity'), { recursive: true, mode: 0o700 })
    const lockPath = `${statePath}.lock`
    await writeFile(lockPath, 'not-a-pid\n', { mode: 0o600 })

    await expect(getOrCreateDesktopInstallationId(root, {
      randomUUID: () => FIRST,
      processIsAlive: () => false,
      now: () => Date.now() + 60_000,
    })).rejects.toThrow('could not be persisted safely')
    await expect(lstat(lockPath)).resolves.toBeDefined()
  })

  it('still fails closed when the state itself is unsafe, orphaned lock or not', async () => {
    const root = await userData()
    const statePath = desktopInstallationIdPath(root)
    await mkdir(join(root, 'identity'), { recursive: true, mode: 0o700 })
    await mkdir(statePath, { mode: 0o700 }) // a directory where the file belongs
    await writeFile(`${statePath}.lock`, '1807\n', { mode: 0o600 })

    await expect(getOrCreateDesktopInstallationId(root, {
      randomUUID: () => FIRST,
      processIsAlive: () => false,
      now: () => Date.now() + 60_000,
    })).rejects.toThrow('must be an ordinary file')
  })

  it('creates one private stable identity below userData', async () => {
    const root = await userData()
    const first = await getOrCreateDesktopInstallationId(root, { randomUUID: () => FIRST })
    const second = await getOrCreateDesktopInstallationId(root, { randomUUID: () => SECOND })
    const statePath = desktopInstallationIdPath(root)

    expect(first).toBe(FIRST)
    expect(second).toBe(FIRST)
    expect(statePath).toBe(join(root, 'identity', 'installation-id'))
    expect(await readFile(statePath, 'utf8')).toBe(`${FIRST}\n`)
    if (process.platform !== 'win32') {
      expect((await lstat(join(root, 'identity'))).mode & 0o777).toBe(0o700)
      expect((await lstat(statePath)).mode & 0o777).toBe(0o600)
    }
  })

  it('narrows existing private state permissions', async () => {
    const root = await userData()
    const directory = join(root, 'identity')
    const statePath = join(directory, 'installation-id')
    await mkdir(directory, { mode: 0o777 })
    await writeFile(statePath, `${FIRST}\n`, { mode: 0o666 })
    await chmod(directory, 0o777)
    await chmod(statePath, 0o666)

    await expect(getOrCreateDesktopInstallationId(root)).resolves.toBe(FIRST)
    if (process.platform !== 'win32') {
      expect((await lstat(directory)).mode & 0o777).toBe(0o700)
      expect((await lstat(statePath)).mode & 0o777).toBe(0o600)
    }
  })

  it.each([
    ['malformed contents', async (path: string) => { await writeFile(path, 'not-a-uuid\n') }],
    ['oversized contents', async (path: string) => { await writeFile(path, 'x'.repeat(MAX_DESKTOP_INSTALLATION_ID_BYTES + 1)) }],
    ['non-UTF-8 contents', async (path: string) => { await writeFile(path, Buffer.from([0xff, 0xfe])) }],
  ] as const)('atomically rebuilds an ordinary file with %s', async (_label, prepare) => {
    const root = await userData()
    const directory = join(root, 'identity')
    const statePath = join(directory, 'installation-id')
    await mkdir(directory)
    await prepare(statePath)

    await expect(getOrCreateDesktopInstallationId(root, { randomUUID: () => SECOND })).resolves.toBe(SECOND)
    expect(await readFile(statePath, 'utf8')).toBe(`${SECOND}\n`)
  })

  it('rejects a linked identity directory without writing through it', async () => {
    const root = await userData()
    const outside = await userData()
    await symlink(outside, join(root, 'identity'), process.platform === 'win32' ? 'junction' : 'dir')

    await expect(getOrCreateDesktopInstallationId(root, { randomUUID: () => FIRST }))
      .rejects.toThrow('must be an ordinary directory')
    await expect(readFile(join(outside, 'installation-id'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.skipIf(process.platform === 'win32')('rejects a symlink at the identity file path', async () => {
    const root = await userData()
    const outside = await userData()
    const directory = join(root, 'identity')
    const statePath = join(directory, 'installation-id')
    await mkdir(directory)
    const target = join(outside, 'target')
    await writeFile(target, `${FIRST}\n`)
    await symlink(target, statePath)

    await expect(getOrCreateDesktopInstallationId(root, { randomUUID: () => SECOND }))
      .rejects.toThrow('must be an ordinary file')
  })

  it('rejects a directory at the identity file path', async () => {
    const root = await userData()
    const directory = join(root, 'identity')
    const statePath = join(directory, 'installation-id')
    await mkdir(statePath, { recursive: true })

    await expect(getOrCreateDesktopInstallationId(root, { randomUUID: () => SECOND }))
      .rejects.toThrow('must be an ordinary file')
  })

  it('serializes concurrent first use onto one persisted identity', async () => {
    const root = await userData()
    const values = await Promise.all([
      getOrCreateDesktopInstallationId(root, { randomUUID: () => FIRST }),
      getOrCreateDesktopInstallationId(root, { randomUUID: () => SECOND }),
    ])

    expect(new Set(values)).toEqual(new Set([values[0]]))
    expect(await readFile(desktopInstallationIdPath(root), 'utf8')).toBe(`${values[0]}\n`)
  })

  it.each(['', 'relative/path', `/tmp/bad\0path`])('rejects unsafe userData path %j', async (root) => {
    await expect(getOrCreateDesktopInstallationId(root)).rejects.toThrow('must be an absolute path')
  })
})
