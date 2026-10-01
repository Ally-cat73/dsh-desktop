/**
 * The Aera Code effect sandbox — D-0d1 of
 * WO-AERA-CODE-CLAUDE-CODE-GOVERNED-WORKER-INTEGRATION-001.
 *
 * Port of the reviewed proof-driver sandbox
 * (`aera-stack tools/local-effect-proof-driver/src/sandboxExec.ts`): macOS
 * `sandbox-exec` (Seatbelt) behind the `@aera/effect-broker` sandbox port.
 * The broker refuses EVERY effect — read, patch and test — unless this port
 * is provided and `establish()` succeeds (`broker.ts:236`, re-checked after
 * the release); there is no unsandboxed fallback.
 *
 * Profile: deny by default; no network; writes only inside the Working Line
 * (and `/dev/null`); reads only the Working Line, the spec's readable paths
 * and the system locations an executable needs to load. The executable,
 * argv, cwd and environment come from the trusted catalog, never the model.
 *
 * Differences from the source, both tightening: the cwd containment check is
 * path-segment aware (the source's `startsWith` accepted a sibling such as
 * `<root>2`), and platform / binary presence are injectable for tests.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { isAbsolute, relative, sep } from 'node:path'
import {
  SANDBOX_CONTRACT_VERSION,
  type SandboxExecutionSpec,
  type SandboxPort,
  type SandboxRunResult,
} from '@aera/effect-broker'

export const SANDBOX_EXEC = '/usr/bin/sandbox-exec'

const SYSTEM_READ = ['/usr/lib', '/usr/bin', '/bin', '/System', '/Library/Apple', '/private/var/db/dyld', '/private/var/db/timezone', '/dev']

function quote(path: string): string {
  if (!path.startsWith('/') || /["\\\n\r\0]/u.test(path)) throw new Error('SANDBOX_PATH_INVALID')
  return `"${path}"`
}

/** Is `candidate` the root or inside it (absolute paths, segment-aware)? */
function within(root: string, candidate: string): boolean {
  if (!isAbsolute(root) || !isAbsolute(candidate)) return false
  const rel = relative(root, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

/** The Seatbelt profile for one spec (exported for review and tests). */
export function seatbeltProfile(spec: Pick<SandboxExecutionSpec, 'workspaceRoot' | 'readablePaths' | 'writablePaths'>): string {
  const reads = [...new Set([spec.workspaceRoot, ...spec.readablePaths, ...SYSTEM_READ])].map(path => `(subpath ${quote(path)})`)
  const writes = [...new Set([spec.workspaceRoot, ...spec.writablePaths])].map(path => `(subpath ${quote(path)})`)
  return [
    '(version 1)',
    '(deny default)',
    '(allow process-exec process-fork)',
    '(allow signal (target self))',
    '(allow sysctl-read)',
    '(allow mach-lookup)',
    '(allow file-read-metadata)',
    `(allow file-read* ${reads.join(' ')} (literal "/"))`,
    `(allow file-write* ${writes.join(' ')} (literal "/dev/null"))`,
    '(deny network*)',
  ].join('\n')
}

export interface SandboxExecPortOptions {
  readonly platform?: string
  readonly exists?: (path: string) => boolean
}

export function createSandboxExecPort(options: SandboxExecPortOptions = {}): SandboxPort {
  const platform = options.platform ?? process.platform
  const exists = options.exists ?? existsSync
  return {
    contractVersion: SANDBOX_CONTRACT_VERSION,
    establish() {
      if (platform !== 'darwin' || !exists(SANDBOX_EXEC)) return Promise.resolve({ ok: false, reason: 'SANDBOX_EXEC_UNAVAILABLE' })
      return Promise.resolve({ ok: true, profileDigest: createHash('sha256').update(seatbeltProfile({ workspaceRoot: '/W', readablePaths: [], writablePaths: [] })).digest('hex') })
    },
    run(spec: SandboxExecutionSpec): Promise<SandboxRunResult> {
      if (spec.network !== 'NONE' || !spec.executable.startsWith('/') || !within(spec.workspaceRoot, spec.cwd)) {
        return Promise.reject(new Error('SANDBOX_SPEC_REFUSED'))
      }
      let profile: string
      try {
        profile = seatbeltProfile(spec)
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error('SANDBOX_PATH_INVALID'))
      }
      return new Promise(resolve => {
        const child = spawn(SANDBOX_EXEC, ['-p', profile, spec.executable, ...spec.argv], { cwd: spec.cwd, env: { ...spec.env }, shell: false, stdio: 'pipe' })
        const stdout: Buffer[] = []
        const stderr: Buffer[] = []
        let bytes = 0
        let truncated = false
        let timedOut = false
        const collect = (sink: Buffer[]) => (chunk: Buffer) => {
          if (bytes + chunk.byteLength > spec.maxOutputBytes) {
            truncated = true
            sink.push(chunk.subarray(0, Math.max(0, spec.maxOutputBytes - bytes)))
            bytes = spec.maxOutputBytes
            return
          }
          bytes += chunk.byteLength
          sink.push(chunk)
        }
        child.stdout.on('data', collect(stdout))
        child.stderr.on('data', collect(stderr))
        const timer = setTimeout(() => {
          timedOut = true
          child.kill('SIGKILL')
        }, spec.timeoutMs)
        child.on('error', () => undefined)
        child.on('close', (code, signal) => {
          clearTimeout(timer)
          resolve({ exitStatus: code, ...(signal ? { signal } : {}), timedOut, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), truncated })
        })
        if (spec.stdin) child.stdin.end(Buffer.from(spec.stdin))
        else child.stdin.end()
      })
    },
  }
}
