/**
 * D-0d1 — the governed-effect adapter (WO-AERA-CODE-CLAUDE-CODE-GOVERNED-WORKER-INTEGRATION-001).
 *
 * The desktop worker's intents map onto exactly the owner-approved delegation
 * capabilities (`aera.repo.read`, `aera.repo.patch`, `aera.test.run`); every
 * other intent is refused in governed mode (CD-1). Before any effect the
 * configured canonical Working Line and repository must equal what the
 * desktop resolved for the local worktree (review M-4). A test command is
 * matched on executable + argv (review m-6). Every effect — read, patch and
 * test — needs the sandbox (review m-12, `broker.ts:236`).
 *
 * The adapter produces broker requests only; it decides no authority (D-0d2).
 */
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  EffectBroker,
  FileBrokerJournal,
  SANDBOX_CONTRACT_VERSION,
  resolveEffect,
  type CapabilityCatalog,
  type EffectIntent,
  type RouterReleasePort,
  type SandboxPort,
} from '@aera/effect-broker'
import { repositoryPathResource, workingLineTreeResource } from '@aera/local-effect-authority'
import { EFFECT_INTENT_KINDS, type EffectIntentKind, type EffectIntentV1 } from '../src/aera-worker-effect-intent.ts'
import {
  GOVERNED_EFFECT_CAPABILITIES,
  GOVERNED_INTENT_CAPABILITY,
  checkWorkingLineBinding,
  governedEffectAttemptId,
  loadGovernedEffectCatalog,
  matchTestCommand,
  planGovernedEffect,
  type GovernedWorkingLineBinding,
  type PinnedGovernedCatalog,
} from '../src/aera-worker-governed-effects.ts'
import { SANDBOX_EXEC, createSandboxExecPort, seatbeltProfile } from '../src/aera-worker-sandbox-exec.ts'

const WL = 'aera:code_working_line:dogfood-d0d1'
const REPO = 'aera-repo:aera-stack'
const BINDING: GovernedWorkingLineBinding = { organisationId: 'org_aera', repositoryId: REPO, workingLineId: WL }
const LOCATION = { organisationId: 'org_aera', repositoryId: REPO, workingLineId: WL }
const EPOCH = 'aera:worker-epoch:5d0b1c9e-7f3a-4b51-9a3e-0c4d2e1f6a7b'
const ATTEMPT = { desktopEpochId: EPOCH, turn: 2, ordinal: 1 }

const CATALOG: CapabilityCatalog = {
  'aera.repo.read': { kind: 'READ_FILE', maxBytes: 65_536 },
  'aera.repo.patch': { kind: 'REPLACE_FILE', maxBytes: 262_144 },
  'aera.test.run': {
    kind: 'PROCESS',
    mutation: 'READ_ONLY',
    parameters: { component: ['router', 'broken'], suite: ['affected'] },
    commands: {
      'component=router&suite=affected': { executable: '/bin/echo', argv: ['router affected: 17 passed'], cwd: '', env: { LANG: 'C' }, timeoutMs: 5_000, maxOutputBytes: 4_096 },
      'component=broken&suite=affected': { executable: '/usr/bin/false', argv: [], cwd: '', env: {}, timeoutMs: 5_000, maxOutputBytes: 4_096 },
    },
  },
}

function scratchDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function writeCatalog(value: unknown, raw?: string): { file: string, sha: string } {
  const file = join(scratchDir('d0d1-catalog-'), 'effect-catalog.json')
  const text = raw ?? JSON.stringify(value)
  writeFileSync(file, text)
  return { file, sha: createHash('sha256').update(text).digest('hex') }
}

function pinned(catalog: CapabilityCatalog = CATALOG): PinnedGovernedCatalog {
  const { file, sha } = writeCatalog(catalog)
  const loaded = loadGovernedEffectCatalog(file, sha)
  if (loaded.status !== 'loaded') throw new Error(`fixture catalog refused: ${loaded.reason}`)
  return loaded.pinned
}

const LINE = { codeWorkingLineId: WL, repositoryId: REPO, label: 'dogfood' }

function intent(kind: EffectIntentKind, extra: Partial<EffectIntentV1> = {}): EffectIntentV1 {
  return { intentId: `i-${kind}`, kind, codeWorkingLineId: WL, ...extra }
}

function plan(i: EffectIntentV1, overrides: { binding?: GovernedWorkingLineBinding, resolved?: { codeWorkingLineId: string, repositoryId: string, label?: string }, catalog?: PinnedGovernedCatalog, attempt?: typeof ATTEMPT } = {}) {
  return planGovernedEffect({
    pinned: overrides.catalog ?? pinned(),
    binding: overrides.binding ?? BINDING,
    resolved: overrides.resolved ?? LINE,
    attempt: overrides.attempt ?? ATTEMPT,
    intent: i,
  })
}

function okRequest(result: ReturnType<typeof plan>): EffectIntent {
  if (!result.ok) throw new Error(`expected a request, got ${result.code}: ${result.reason}`)
  return result.request
}

// ---------------------------------------------------------------------------

describe('D-0d1 mapping: desktop intent → governed capability (closed set)', () => {
  it('the closed set is exactly aera.repo.read / aera.repo.patch / aera.test.run, from fs.read / fs.write / exec.test', () => {
    expect([...GOVERNED_EFFECT_CAPABILITIES].sort()).toEqual(['aera.repo.patch', 'aera.repo.read', 'aera.test.run'])
    expect(GOVERNED_INTENT_CAPABILITY).toEqual({ 'fs.read': 'aera.repo.read', 'fs.write': 'aera.repo.patch', 'exec.test': 'aera.test.run' })
  })

  it('fs.read → aera.repo.read on the repository path; the broker resolves it to the CAS REPOSITORY_PATH resource', () => {
    const result = plan(intent('fs.read', { path: 'src/index.ts' }))
    const request = okRequest(result)
    expect(request).toEqual({ effectAttemptId: `${EPOCH}:t2:1`, capability: 'aera.repo.read', path: 'src/index.ts' })
    expect(result.ok && result.capability).toBe('aera.repo.read')
    expect(result.ok && result.location).toEqual(LOCATION)
    const resolved = resolveEffect({ catalog: CATALOG, location: LOCATION, workerEpochId: 'cis-epoch-1', intent: request })
    const cas = repositoryPathResource(LOCATION, 'src/index.ts')
    expect(resolved.target).toEqual({ kind: 'REPOSITORY_PATH', path: 'src/index.ts' })
    expect(resolved.descriptor.capability).toBe('aera.repo.read')
    expect(resolved.descriptor.resource).toEqual({
      domain: 'aera',
      kind: cas.resourceKind,
      id: cas.resourceId,
      containerPath: cas.containerPath.map(ref => ({ kind: ref.containerKind, id: ref.containerId })),
    })
    expect(resolved.descriptor.resource.id).toBe(`${REPO}/${WL}/src/index.ts`)
    expect(resolved.plan.kind).toBe('READ_FILE')
  })

  it('fs.write → aera.repo.patch carrying the content bytes; the descriptor carries their digest, not the text', () => {
    const content = 'export const answer = 42\n'
    const request = okRequest(plan(intent('fs.write', { path: 'src/answer.ts', content })))
    expect(request.capability).toBe('aera.repo.patch')
    expect(request.path).toBe('src/answer.ts')
    expect(request.content).toBeInstanceOf(Uint8Array)
    expect(Buffer.from(request.content ?? new Uint8Array()).toString('utf8')).toBe(content)
    expect(Object.keys(request).sort()).toEqual(['capability', 'content', 'effectAttemptId', 'path'])
    const resolved = resolveEffect({ catalog: CATALOG, location: LOCATION, workerEpochId: 'cis-epoch-1', intent: request })
    expect(resolved.target).toEqual({ kind: 'REPOSITORY_PATH', path: 'src/answer.ts' })
    expect(resolved.descriptor.resource.id).toBe(repositoryPathResource(LOCATION, 'src/answer.ts').resourceId)
    expect(resolved.plan.kind).toBe('REPLACE_FILE')
    expect(JSON.stringify(resolved.descriptor)).not.toContain('answer = 42')
    expect(JSON.stringify(resolved.descriptor)).toContain(createHash('sha256').update(content).digest('hex'))
  })

  it('exec.test → aera.test.run with the matched catalog parameter tuple; the broker resolves the WORKING_LINE_TREE and that exact trusted command', () => {
    const request = okRequest(plan(intent('exec.test', { argv: ['/bin/echo', 'router affected: 17 passed'] })))
    expect(request).toEqual({ effectAttemptId: `${EPOCH}:t2:1`, capability: 'aera.test.run', parameters: { component: 'router', suite: 'affected' } })
    const resolved = resolveEffect({ catalog: CATALOG, location: LOCATION, workerEpochId: 'cis-epoch-1', intent: request })
    expect(resolved.target).toEqual({ kind: 'WORKING_LINE_TREE' })
    expect(resolved.descriptor.resource.id).toBe(workingLineTreeResource(LOCATION).resourceId)
    expect(resolved.plan).toMatchObject({ kind: 'PROCESS', command: CATALOG['aera.test.run']?.kind === 'PROCESS' ? CATALOG['aera.test.run'].commands['component=router&suite=affected'] : undefined })
  })

  it('a path the broker cannot canonicalise is still only a request: the broker refuses it (PATH_INVALID), the adapter never performs', () => {
    const request = okRequest(plan(intent('fs.read', { path: '../outside.txt' })))
    expect(() => resolveEffect({ catalog: CATALOG, location: LOCATION, workerEpochId: 'cis-epoch-1', intent: request })).toThrow('PATH_INVALID')
  })
})

describe('D-0d1 CD-1: every intent outside the closed set is refused in governed mode', () => {
  const unmapped = EFFECT_INTENT_KINDS.filter(kind => !['fs.read', 'fs.write', 'exec.test'].includes(kind))

  it('covers commit, checkpoint, list, build, shell, git reads, context and the no-executor kinds', () => {
    expect(unmapped).toEqual(expect.arrayContaining(['git.commit', 'checkpoint', 'fs.list', 'exec.build', 'exec.shell', 'git.status', 'git.diff', 'git.log', 'context.read', 'package.install', 'network.request', 'git.push', 'deploy', 'external.action']))
    expect(unmapped).toHaveLength(EFFECT_INTENT_KINDS.length - 3)
  })

  for (const kind of unmapped) {
    it(`${kind} → NOT_DELEGATED_IN_GOVERNED_MODE, typed, with no broker request`, () => {
      const result = plan(intent(kind, { argv: ['/bin/echo', 'router affected: 17 passed'], path: 'a.txt', message: 'm', paths: ['a.txt'], target: 't', summary: 's' }))
      expect(result.ok).toBe(false)
      expect(result).toMatchObject({ ok: false, code: 'NOT_DELEGATED_IN_GOVERNED_MODE' })
      expect(result).not.toHaveProperty('request')
      expect(!result.ok && result.reason).toContain(kind)
    })
  }

  it('git.commit is refused even when it names exactly the Working Line and a valid path', () => {
    expect(plan(intent('git.commit', { paths: ['src/index.ts'], message: 'feat: x' }))).toMatchObject({ ok: false, code: 'NOT_DELEGATED_IN_GOVERNED_MODE' })
  })
})

describe('D-0d1 M-4: the configured canonical Working Line / repository must equal what the desktop resolved', () => {
  it('both equal → a request on the configured location', () => {
    expect(checkWorkingLineBinding(BINDING, LINE)).toEqual({ ok: true, location: LOCATION })
  })

  it('a different resolved Working Line id → WORKING_LINE_BINDING_MISMATCH before any effect, for every mapped intent', () => {
    const resolved = { ...LINE, codeWorkingLineId: 'aera:code_working_line:other-line' }
    expect(checkWorkingLineBinding(BINDING, resolved)).toMatchObject({ ok: false, code: 'WORKING_LINE_BINDING_MISMATCH' })
    for (const i of [intent('fs.read', { path: 'a.txt' }), intent('fs.write', { path: 'a.txt', content: 'x' }), intent('exec.test', { argv: ['/bin/echo', 'router affected: 17 passed'] })]) {
      const result = plan(i, { resolved })
      expect(result).toMatchObject({ ok: false, code: 'WORKING_LINE_BINDING_MISMATCH' })
      expect(result).not.toHaveProperty('request')
    }
  })

  it('a different resolved repository id → WORKING_LINE_BINDING_MISMATCH before any effect, for every mapped intent', () => {
    const resolved = { ...LINE, repositoryId: 'aera-repo:some-other-checkout' }
    expect(checkWorkingLineBinding(BINDING, resolved)).toMatchObject({ ok: false, code: 'WORKING_LINE_BINDING_MISMATCH' })
    for (const i of [intent('fs.read', { path: 'a.txt' }), intent('fs.write', { path: 'a.txt', content: 'x' }), intent('exec.test', { argv: ['/bin/echo', 'router affected: 17 passed'] })]) {
      expect(plan(i, { resolved })).toMatchObject({ ok: false, code: 'WORKING_LINE_BINDING_MISMATCH' })
    }
  })

  it('a Working Line label equal to the canonical id cannot substitute for it (addendum §24 label probe)', () => {
    const resolved = { codeWorkingLineId: 'aera:code_working_line:local-copy', repositoryId: REPO, label: WL }
    expect(plan(intent('fs.read', { path: 'a.txt' }), { resolved })).toMatchObject({ ok: false, code: 'WORKING_LINE_BINDING_MISMATCH' })
  })

  it('comparison is exact: a case or whitespace variant is a mismatch', () => {
    expect(checkWorkingLineBinding(BINDING, { ...LINE, codeWorkingLineId: WL.toUpperCase() })).toMatchObject({ ok: false, code: 'WORKING_LINE_BINDING_MISMATCH' })
    expect(checkWorkingLineBinding(BINDING, { ...LINE, repositoryId: `${REPO} ` })).toMatchObject({ ok: false, code: 'WORKING_LINE_BINDING_MISMATCH' })
  })

  it('a configured id that is not canonical (CAS would not name it) → WORKING_LINE_BINDING_INVALID', () => {
    const bad = { ...BINDING, workingLineId: 'aera:working-line:dogfood' }
    expect(checkWorkingLineBinding(bad, { ...LINE, codeWorkingLineId: bad.workingLineId })).toMatchObject({ ok: false, code: 'WORKING_LINE_BINDING_INVALID' })
    const badRepo = { ...BINDING, repositoryId: 'repo:aera-stack' }
    expect(checkWorkingLineBinding(badRepo, { ...LINE, repositoryId: badRepo.repositoryId })).toMatchObject({ ok: false, code: 'WORKING_LINE_BINDING_INVALID' })
  })

  it('an intent naming another Working Line than the bound one → INTENT_WORKING_LINE_MISMATCH', () => {
    expect(plan(intent('fs.read', { path: 'a.txt', codeWorkingLineId: 'aera:code_working_line:other' }))).toMatchObject({ ok: false, code: 'INTENT_WORKING_LINE_MISMATCH' })
  })
})

describe('D-0d1 effectAttemptId: host-derived and deterministic, never from model text (catalog.ts L-8)', () => {
  it('is <desktopEpochId>:t<turn>:<ordinal> and passes the broker id grammar', () => {
    expect(governedEffectAttemptId(ATTEMPT)).toBe(`${EPOCH}:t2:1`)
    expect(/^[A-Za-z0-9][A-Za-z0-9:._@/-]{0,199}$/u.test(governedEffectAttemptId(ATTEMPT))).toBe(true)
  })

  it('does not depend on the model intentId; does depend on the host tuple', () => {
    const a = okRequest(plan({ ...intent('fs.read', { path: 'a.txt' }), intentId: 'model-says-x' }))
    const b = okRequest(plan({ ...intent('fs.read', { path: 'a.txt' }), intentId: 'model-says-y' }))
    expect(a.effectAttemptId).toBe(b.effectAttemptId)
    expect(a.effectAttemptId).not.toContain('model-says')
    const c = okRequest(plan(intent('fs.read', { path: 'a.txt' }), { attempt: { ...ATTEMPT, ordinal: 2 } }))
    const d = okRequest(plan(intent('fs.read', { path: 'a.txt' }), { attempt: { ...ATTEMPT, turn: 3 } }))
    expect(new Set([a.effectAttemptId, c.effectAttemptId, d.effectAttemptId]).size).toBe(3)
  })

  it('an invalid host tuple is refused (EFFECT_ATTEMPT_ID_INVALID)', () => {
    for (const attempt of [{ ...ATTEMPT, turn: -1 }, { ...ATTEMPT, ordinal: 1.5 }, { ...ATTEMPT, desktopEpochId: '' }, { ...ATTEMPT, desktopEpochId: 'has space' }]) {
      expect(plan(intent('fs.read', { path: 'a.txt' }), { attempt })).toMatchObject({ ok: false, code: 'EFFECT_ATTEMPT_ID_INVALID' })
    }
  })
})

describe('D-0d1 m-6: exec.test matches executable + argv exactly against one catalog command', () => {
  const testConfig = CATALOG['aera.test.run']
  if (testConfig?.kind !== 'PROCESS') throw new Error('fixture')

  it('[executable, ...argv] exactly → that entry’s parameter tuple', () => {
    expect(matchTestCommand(testConfig, ['/bin/echo', 'router affected: 17 passed'])).toEqual({ ok: true, parameters: { component: 'router', suite: 'affected' } })
    expect(matchTestCommand(testConfig, ['/usr/bin/false'])).toEqual({ ok: true, parameters: { component: 'broken', suite: 'affected' } })
  })

  it('args-only matching is refused: the catalog argv without its executable is not the command', () => {
    expect(matchTestCommand(testConfig, ['router affected: 17 passed'])).toMatchObject({ ok: false, code: 'TEST_COMMAND_NOT_IN_CATALOG' })
  })

  it('the same args under a different executable are refused', () => {
    expect(matchTestCommand(testConfig, ['/bin/cat', 'router affected: 17 passed'])).toMatchObject({ ok: false, code: 'TEST_COMMAND_NOT_IN_CATALOG' })
    expect(matchTestCommand(testConfig, ['echo', 'router affected: 17 passed'])).toMatchObject({ ok: false, code: 'TEST_COMMAND_NOT_IN_CATALOG' })
    expect(matchTestCommand(testConfig, ['/bin/false'])).toMatchObject({ ok: false, code: 'TEST_COMMAND_NOT_IN_CATALOG' })
  })

  it('prefix, suffix, shell metacharacters and shell wrappers are refused', () => {
    for (const argv of [
      ['/bin/echo'],
      ['/bin/echo', 'router affected: 17 passed', '--extra'],
      ['/bin/echo', 'router affected: 17 passed; rm -rf ~'],
      ['/bin/echo', 'router affected: 17 passed', '&&', '/bin/sh'],
      ['/bin/sh', '-c', '/bin/echo "router affected: 17 passed"'],
      ['/bin/echo', 'router  affected: 17 passed'],
      ['/usr/bin/false', ''],
    ]) {
      expect(matchTestCommand(testConfig, argv)).toMatchObject({ ok: false, code: 'TEST_COMMAND_NOT_IN_CATALOG' })
    }
  })

  it('two catalog entries with the same executable + argv → TEST_COMMAND_AMBIGUOUS (refused, not first-wins)', () => {
    const twin = { ...testConfig, parameters: { component: ['router', 'twin'], suite: ['affected'] }, commands: { ...testConfig.commands, 'component=twin&suite=affected': { executable: '/bin/echo', argv: ['router affected: 17 passed'], cwd: 'sub', env: {}, timeoutMs: 5_000, maxOutputBytes: 4_096 } } }
    expect(matchTestCommand(twin, ['/bin/echo', 'router affected: 17 passed'])).toMatchObject({ ok: false, code: 'TEST_COMMAND_AMBIGUOUS' })
  })

  it('through the plan: an unmatched command is a typed refusal with no request', () => {
    const result = plan(intent('exec.test', { argv: ['router affected: 17 passed'] }))
    expect(result).toMatchObject({ ok: false, code: 'TEST_COMMAND_NOT_IN_CATALOG' })
    expect(result).not.toHaveProperty('request')
  })
})

describe('D-0d1 catalog pin: the reviewed catalog file, sha256-pinned and validated', () => {
  it('loads a valid catalog whose bytes match the pin, and freezes it', () => {
    const { file, sha } = writeCatalog(CATALOG)
    const loaded = loadGovernedEffectCatalog(file, sha)
    expect(loaded.status).toBe('loaded')
    if (loaded.status !== 'loaded') return
    expect(loaded.pinned.sha256).toBe(sha)
    expect(loaded.pinned.catalog).toEqual(CATALOG)
    expect(Object.isFrozen(loaded.pinned.catalog)).toBe(true)
    const test = loaded.pinned.catalog['aera.test.run']
    expect(test?.kind === 'PROCESS' && Object.isFrozen(test.commands['component=router&suite=affected']?.argv)).toBe(true)
  })

  it('a sha mismatch → UNAVAILABLE (CATALOG_PIN_MISMATCH)', () => {
    const { file, sha } = writeCatalog(CATALOG)
    const other = sha.replace(/^./u, sha.startsWith('0') ? '1' : '0')
    expect(loadGovernedEffectCatalog(file, other)).toEqual({ status: 'UNAVAILABLE', reason: 'CATALOG_PIN_MISMATCH' })
  })

  it('a file edited after pinning → UNAVAILABLE', () => {
    const { file, sha } = writeCatalog(CATALOG)
    writeFileSync(file, JSON.stringify({ ...CATALOG, 'aera.repo.read': { kind: 'READ_FILE', maxBytes: 1 } }))
    expect(loadGovernedEffectCatalog(file, sha)).toMatchObject({ status: 'UNAVAILABLE', reason: 'CATALOG_PIN_MISMATCH' })
  })

  it('missing, symlinked, relative, non-JSON or a malformed pin → UNAVAILABLE', () => {
    const { file, sha } = writeCatalog(CATALOG)
    expect(loadGovernedEffectCatalog(join(scratchDir('d0d1-none-'), 'absent.json'), sha)).toMatchObject({ status: 'UNAVAILABLE', reason: 'CATALOG_MISSING' })
    const link = join(scratchDir('d0d1-link-'), 'linked.json')
    symlinkSync(file, link)
    expect(loadGovernedEffectCatalog(link, sha)).toMatchObject({ status: 'UNAVAILABLE', reason: 'CATALOG_NOT_REGULAR_FILE' })
    expect(loadGovernedEffectCatalog('effect-catalog.json', sha)).toMatchObject({ status: 'UNAVAILABLE', reason: 'CATALOG_PATH_NOT_ABSOLUTE' })
    const junk = writeCatalog(undefined, '{not json')
    expect(loadGovernedEffectCatalog(junk.file, junk.sha)).toMatchObject({ status: 'UNAVAILABLE', reason: 'CATALOG_NOT_JSON' })
    expect(loadGovernedEffectCatalog(file, sha.toUpperCase())).toMatchObject({ status: 'UNAVAILABLE', reason: 'CATALOG_PIN_INVALID' })
  })

  const invalid: Array<[string, unknown]> = [
    ['an extra capability (aera.git.commit)', { ...CATALOG, 'aera.git.commit': { kind: 'READ_FILE', maxBytes: 1 } }],
    ['an extra delegable-but-not-governed capability (aera.build.run)', { ...CATALOG, 'aera.build.run': CATALOG['aera.test.run'] }],
    ['a missing aera.test.run', { 'aera.repo.read': CATALOG['aera.repo.read'], 'aera.repo.patch': CATALOG['aera.repo.patch'] }],
    ['aera.repo.read as a PROCESS', { ...CATALOG, 'aera.repo.read': CATALOG['aera.test.run'] }],
    ['aera.repo.patch as READ_FILE', { ...CATALOG, 'aera.repo.patch': { kind: 'READ_FILE', maxBytes: 10 } }],
    ['a shell executable', { ...CATALOG, 'aera.test.run': { ...CATALOG['aera.test.run'], commands: { 'component=router&suite=affected': { executable: '/bin/sh', argv: ['-c', 'true'], cwd: '', env: {}, timeoutMs: 5, maxOutputBytes: 5 } } } }],
    ['a relative executable', { ...CATALOG, 'aera.test.run': { ...CATALOG['aera.test.run'], commands: { 'component=router&suite=affected': { executable: 'echo', argv: [], cwd: '', env: {}, timeoutMs: 5, maxOutputBytes: 5 } } } }],
    ['a command key that is not a canonical tuple', { ...CATALOG, 'aera.test.run': { ...CATALOG['aera.test.run'], commands: { 'suite=affected&component=router': { executable: '/bin/echo', argv: [], cwd: '', env: {}, timeoutMs: 5, maxOutputBytes: 5 } } } }],
    ['a command key with an undeclared value', { ...CATALOG, 'aera.test.run': { ...CATALOG['aera.test.run'], commands: { 'component=gateway&suite=affected': { executable: '/bin/echo', argv: [], cwd: '', env: {}, timeoutMs: 5, maxOutputBytes: 5 } } } }],
    ['a non-string env value', { ...CATALOG, 'aera.test.run': { ...CATALOG['aera.test.run'], commands: { 'component=router&suite=affected': { executable: '/bin/echo', argv: [], cwd: '', env: { N: 1 }, timeoutMs: 5, maxOutputBytes: 5 } } } }],
    ['an unknown field on a command', { ...CATALOG, 'aera.test.run': { ...CATALOG['aera.test.run'], commands: { 'component=router&suite=affected': { executable: '/bin/echo', argv: [], cwd: '', env: {}, timeoutMs: 5, maxOutputBytes: 5, shell: true } } } }],
    ['no commands at all', { ...CATALOG, 'aera.test.run': { ...CATALOG['aera.test.run'], commands: {} } }],
    ['an array document', [CATALOG]],
  ]
  for (const [name, value] of invalid) {
    it(`${name} → UNAVAILABLE (CATALOG_INVALID…)`, () => {
      const { file, sha } = writeCatalog(value)
      const loaded = loadGovernedEffectCatalog(file, sha)
      expect(loaded.status).toBe('UNAVAILABLE')
      expect(loaded.status === 'UNAVAILABLE' && loaded.reason).toMatch(/^CATALOG_INVALID/u)
    })
  }
})

// ---------------------------------------------------------------------------
// m-12: the sandbox gates every effect (vendored EffectBroker, broker.ts:236)
// ---------------------------------------------------------------------------

function brokerWorld(sandbox: SandboxPort | undefined) {
  const root = scratchDir('d0d1-wl-')
  writeFileSync(join(root, 'a.txt'), 'original\n')
  const calls: Array<Record<string, unknown>> = []
  const router: RouterReleasePort = {
    requestRelease(body) {
      calls.push(body)
      return Promise.reject(new Error('fake router: no release in D-0d1'))
    },
    reportOutcome() {
      return Promise.reject(new Error('fake router: no outcome in D-0d1'))
    },
  }
  const broker = new EffectBroker({
    aeraSessionId: 'aera-session-d0d1',
    location: LOCATION,
    workspaceRoot: root,
    workerEpochId: 'cis-epoch-1',
    currentEpoch: () => 'cis-epoch-1',
    catalog: pinned().catalog,
    router,
    credentials: { sessionToken: () => Promise.resolve('fake-session-token'), senderProof: () => Promise.resolve('fake-sender-proof') },
    journal: new FileBrokerJournal(join(scratchDir('d0d1-journal-'), 'journal.jsonl')),
    pinned: { caFingerprintSha256: 'a'.repeat(64), routerUriSan: 'spiffe://aera/router/local-effect' },
    ...(sandbox === undefined ? {} : { sandbox }),
    gitIgnore: { ignored: () => new Set<string>() },
    releaseTimeoutMs: 1_000,
  })
  return { root, calls, broker }
}

function governedRequests(): EffectIntent[] {
  return [
    okRequest(plan(intent('fs.read', { path: 'a.txt' }), { attempt: { ...ATTEMPT, ordinal: 1 } })),
    okRequest(plan(intent('fs.write', { path: 'a.txt', content: 'patched\n' }), { attempt: { ...ATTEMPT, ordinal: 2 } })),
    okRequest(plan(intent('exec.test', { argv: ['/bin/echo', 'router affected: 17 passed'] }), { attempt: { ...ATTEMPT, ordinal: 3 } })),
  ]
}

const establishedFake: SandboxPort = {
  contractVersion: SANDBOX_CONTRACT_VERSION,
  establish: () => Promise.resolve({ ok: true, profileDigest: 'fake' }),
  run: () => Promise.reject(new Error('fake sandbox never runs in D-0d1')),
}

describe('D-0d1 m-12: without an established sandbox, read, patch AND test are refused before the Router is asked', () => {
  it('no sandbox → every governed request REFUSED SANDBOX_NOT_PROVIDED; nothing asked, nothing written', async () => {
    const { root, calls, broker } = brokerWorld(undefined)
    for (const request of governedRequests()) {
      expect(await broker.execute(request)).toMatchObject({ status: 'REFUSED', reason: 'SANDBOX_NOT_PROVIDED' })
    }
    expect(calls).toHaveLength(0)
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('original\n')
  })

  it('the sandbox-exec port where sandbox-exec is unavailable → every governed request REFUSED SANDBOX_NOT_ESTABLISHED', async () => {
    const port = createSandboxExecPort({ platform: 'linux' })
    const { root, calls, broker } = brokerWorld(port)
    for (const request of governedRequests()) {
      expect(await broker.execute(request)).toMatchObject({ status: 'REFUSED', reason: 'SANDBOX_NOT_ESTABLISHED' })
    }
    expect(calls).toHaveLength(0)
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('original\n')
  })

  it('with an established sandbox the same requests pass resolution and the path check and reach the release request with the CAS target shapes', async () => {
    const { root, calls, broker } = brokerWorld(establishedFake)
    const results = []
    for (const request of governedRequests()) results.push(await broker.execute(request))
    expect(results.map(result => result.status)).toEqual(['RELEASE_UNAVAILABLE', 'RELEASE_UNAVAILABLE', 'RELEASE_UNAVAILABLE'])
    expect(calls).toHaveLength(3)
    const attempts = calls.map(call => call.attempt as Record<string, unknown>)
    expect(attempts.map(attempt => attempt.capability)).toEqual(['aera.repo.read', 'aera.repo.patch', 'aera.test.run'])
    expect(attempts.map(attempt => attempt.target)).toEqual([
      { kind: 'REPOSITORY_PATH', path: 'a.txt' },
      { kind: 'REPOSITORY_PATH', path: 'a.txt' },
      { kind: 'WORKING_LINE_TREE' },
    ])
    expect(attempts.map(attempt => attempt.idempotencyKey)).toEqual([`${EPOCH}:t2:1`, `${EPOCH}:t2:2`, `${EPOCH}:t2:3`])
    const resources = calls.map(call => (call.descriptor as { resource: { id: string } }).resource.id)
    expect(resources).toEqual([`${REPO}/${WL}/a.txt`, `${REPO}/${WL}/a.txt`, `${REPO}/${WL}`])
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('original\n')
  })
})

describe('D-0d1 sandbox port (port of the proof-driver sandboxExec.ts)', () => {
  it('establish: refuses off macOS or when sandbox-exec is absent; succeeds with a profile digest otherwise', async () => {
    expect(await createSandboxExecPort({ platform: 'linux', exists: () => true }).establish()).toEqual({ ok: false, reason: 'SANDBOX_EXEC_UNAVAILABLE' })
    expect(await createSandboxExecPort({ platform: 'darwin', exists: () => false }).establish()).toEqual({ ok: false, reason: 'SANDBOX_EXEC_UNAVAILABLE' })
    const checked: string[] = []
    const ok = await createSandboxExecPort({ platform: 'darwin', exists: path => { checked.push(path); return true } }).establish()
    expect(ok.ok && /^[a-f0-9]{64}$/u.test(ok.profileDigest)).toBe(true)
    expect(checked).toEqual([SANDBOX_EXEC])
    expect(SANDBOX_EXEC).toBe('/usr/bin/sandbox-exec')
    expect(createSandboxExecPort().contractVersion).toBe(SANDBOX_CONTRACT_VERSION)
  })

  it('profile: deny by default, no network, writes only the Working Line and /dev/null', () => {
    const profile = seatbeltProfile({ workspaceRoot: '/W/line', readablePaths: ['/opt/node'], writablePaths: [] })
    expect(profile).toContain('(deny default)')
    expect(profile).toContain('(deny network*)')
    expect(profile).toContain('(allow file-write* (subpath "/W/line") (literal "/dev/null"))')
    expect(profile).toContain('(subpath "/opt/node")')
    expect(() => seatbeltProfile({ workspaceRoot: '/W/"x', readablePaths: [], writablePaths: [] })).toThrow('SANDBOX_PATH_INVALID')
    expect(() => seatbeltProfile({ workspaceRoot: 'relative', readablePaths: [], writablePaths: [] })).toThrow('SANDBOX_PATH_INVALID')
  })

  it('run: refuses a networked spec, a relative executable, or a cwd outside the Working Line (including a sibling prefix) before spawning', async () => {
    const port = createSandboxExecPort({ platform: 'darwin', exists: () => true })
    const base = { executable: '/bin/echo', argv: ['x'], cwd: '/W/line', env: {}, workspaceRoot: '/W/line', readablePaths: [], writablePaths: [], network: 'NONE' as const, timeoutMs: 1_000, maxOutputBytes: 1_024 }
    await expect(port.run({ ...base, network: 'ANY' as unknown as 'NONE' })).rejects.toThrow('SANDBOX_SPEC_REFUSED')
    await expect(port.run({ ...base, executable: 'echo' })).rejects.toThrow('SANDBOX_SPEC_REFUSED')
    await expect(port.run({ ...base, cwd: '/W/line2' })).rejects.toThrow('SANDBOX_SPEC_REFUSED')
    await expect(port.run({ ...base, cwd: '/W' })).rejects.toThrow('SANDBOX_SPEC_REFUSED')
    await expect(port.run({ ...base, cwd: '/W/line/../other' })).rejects.toThrow('SANDBOX_SPEC_REFUSED')
  })
})
