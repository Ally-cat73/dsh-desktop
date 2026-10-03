/**
 * The vendored participation packages must be the ones this candidate was
 * written against.
 *
 * Round-1 review BL-2: they were two commits stale, so the desktop suite's
 * 1279 passes were obtained against a superseded runtime — §29's deterministic
 * activity naming and the whole §32–§36 admission path were absent from the
 * artifact the product actually loads, while the source said otherwise. A
 * staleness that silent needs a test, not a habit.
 *
 * This asserts on the INSTALLED vendored dist, not on the source tree.
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** The dist the product actually loads, in the installed vendored package. */
const RUNTIME_DIST = join(
  dirname(fileURLToPath(import.meta.url)),
  '../node_modules/@aera/participation-runtime/dist/index.js',
)

/**
 * Symbols this candidate depends on. Each entry names the finding or section
 * that made it load-bearing, so a future failure says why it matters.
 */
const RUNTIME_SYMBOLS: readonly (readonly [string, string])[] = [
  ['projectThreadActivityBlocks', '§28 thread activity block'],
  ['collabThreadOpenedSummary', 'R7-3 exact-match event summaries'],
  ['collabMessagePostedSummaryPrefix', 'R7-3 exact-match event summaries'],
  ['projectCodeCollabSurface', 'the Collaborate projection'],
  ['projectInstitutionalMemory', 'the Record projection'],
]

const CONTRACTS_SYMBOLS: readonly (readonly [string, string])[] = [
  ['draftExecutionCommitment', '§33 admission spec'],
  ['classifyCoordinationStatement', '§32 chatter vs execution commitment'],
  ['executionCommitmentSubject', 'shared subject format'],
  ['projectThreadForAgent', '§45 bounded agent projection'],
  ['DELIVERY_ATTACH_POINTS', 'owner Option A attach points'],
]

describe('the vendored participation packages', () => {
  it('export every runtime symbol this candidate depends on', async () => {
    const runtime = await import('@aera/participation-runtime') as Record<string, unknown>
    const missing = RUNTIME_SYMBOLS
      .filter(([name]) => runtime[name] === undefined)
      .map(([name, why]) => `${name} (${why})`)
    expect(missing).toEqual([])
  })

  it('carry the §32–§36 admission method on the store class itself', async () => {
    const runtime = await import('@aera/participation-runtime') as Record<string, unknown>
    const store = runtime['ParticipationStore'] as { prototype: Record<string, unknown> } | undefined
    expect(store).toBeDefined()
    // A method, not a free function: absence here is exactly the BL-2 shape.
    expect(typeof store?.prototype['admitCoordinationExecution']).toBe('function')
  })

  it('export every contracts symbol this candidate depends on', async () => {
    const contracts = await import('@aera/participation-contracts') as Record<string, unknown>
    const missing = CONTRACTS_SYMBOLS
      .filter(([name]) => contracts[name] === undefined)
      .map(([name, why]) => `${name} (${why})`)
    expect(missing).toEqual([])
  })

  it('carry the §29 naming, which lives inside the projection rather than on the export face', () => {
    const source = readFileSync(RUNTIME_DIST, 'utf8')
    // `evidenceClassBlockTitle` is module-private, so its presence is asserted
    // through the strings it produces — which is what a reader would see.
    expect(source).toContain('Independent verification and acceptance')
    expect(source).toContain('function evidenceClassBlockTitle')
  })

  it('no longer carry the strings the superseded runtime produced', () => {
    const source = readFileSync(RUNTIME_DIST, 'utf8')
    /*
     * "Status unavailable" (§21) and the SESSION_MINUTE-only naming were the
     * two visible symptoms of the stale artifact. Their absence is a cheap,
     * specific staleness canary.
     */
    expect(source).toContain('Independent verification and acceptance')
    expect(source).not.toContain('Status unavailable')
  })
})

/*
 * D-0a (WO-AERA-CODE-CLAUDE-CODE-GOVERNED-WORKER-INTEGRATION-001): the
 * local-effect closure the Worker-host client is built on.
 *
 * The packages come from one reviewed aera-stack candidate (controller CD-3),
 * not from dev. Each tarball is pinned by sha256 in VENDOR_MANIFEST.json, and
 * the INSTALLED dist must equal the vendored dist by tree digest, so neither a
 * swapped tarball nor a stale install can pass silently.
 */
const TESTS_DIR = dirname(fileURLToPath(import.meta.url))
const DESKTOP_DIR = join(TESTS_DIR, '..')
const VENDOR_DIR = join(DESKTOP_DIR, 'vendor/aera')
const MANIFEST_PATH = join(VENDOR_DIR, 'VENDOR_MANIFEST.json')

/** CD-3: sentinel/cr40-cas-seam at its reviewed HEAD. */
const D0A_SOURCE_COMMIT = '25fadd1e399131cb3b2c57766a3a279518142ad3'
const D0A_SOURCE_BRANCH = 'sentinel/cr40-cas-seam'

/**
 * O-1 U-D (O1_PROVENANCE_SPEC_V2 §8.2): @aera/local-effect-admission is
 * re-vendored from the G1-approved U-S candidate (attest v2 + provenance
 * manifest). Its dependencies are unchanged at that commit and stay at D-0a.
 */
const O1_SOURCE_COMMIT = '3e868bd57c91fcf96630f70d8e5dcac00000ceba'
const O1_SOURCE_BRANCH = 'sentinel/o1-provenance'
const O1_PACKAGES: readonly string[] = ['@aera/local-effect-admission']
const expectedSourceCommit = (pkg: string): string => O1_PACKAGES.includes(pkg) ? O1_SOURCE_COMMIT : D0A_SOURCE_COMMIT

/** The runtime closure of @aera/local-effect-admission and @aera/effect-broker. */
const D0A_PACKAGES = [
  '@aera/authority-client',
  '@aera/authority-contracts',
  '@aera/cis-contracts',
  '@aera/cis-issuer',
  '@aera/effect-broker',
  '@aera/local-effect-admission',
  '@aera/local-effect-authority',
  '@aera/sentinel-contracts',
] as const

/** Vendored before D-0a and deliberately not re-vendored by it. */
const UNTOUCHED_PACKAGES = [
  '@aera/evidentiary-work-graph',
  '@aera/evidentiary-work-graph-contracts',
  '@aera/harness',
  '@aera/participation-contracts',
  '@aera/participation-runtime',
] as const

interface ManifestEntry {
  readonly package: string
  readonly tarball: string
  readonly sha256: string
  readonly distTreeDigest: string | null
  readonly sourceCommit: string | null
  readonly licenseMember: boolean
  readonly sourceBranch?: string
}
interface VendorManifest {
  readonly schema: string
  readonly sourceRepository: string
  readonly sourceBranch: string
  readonly sourceCommit: string
  readonly distTreeDigestAlgorithm: string
  readonly tarballs: readonly ManifestEntry[]
}

const tarballName = (pkg: string): string => `${pkg.replace('@', '').replace('/', '-')}-0.1.0.tgz`
const sha256Hex = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex')
const readManifest = (): VendorManifest => JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as VendorManifest
const installedDir = (pkg: string): string => join(DESKTOP_DIR, 'node_modules', pkg)

/**
 * Tree digest of a dist directory: sha256 over the sorted lines
 * `<sha256(file)>  <path relative to dist, '/'-separated>\n`.
 * The manifest records the same digest computed over the tarball's
 * `package/dist/` members.
 */
function distTreeDigest(distDir: string): string {
  const lines: string[] = []
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      const rel = prefix === '' ? name : `${prefix}/${name}`
      if (statSync(full).isDirectory()) walk(full, rel)
      else lines.push(`${sha256Hex(readFileSync(full))}  ${rel}\n`)
    }
  }
  walk(distDir, '')
  lines.sort((a, b) => {
    const pa = a.slice(66), pb = b.slice(66)
    return pa < pb ? -1 : pa > pb ? 1 : 0
  })
  return sha256Hex(lines.join(''))
}

/**
 * Symbols the D-0b…D-0d units and U8 import. Each names the unit that needs it.
 */
const LE_CLOSURE_SYMBOLS: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  '@aera/cis-contracts': [
    ['canonicalAgentCredentialProofBytes', 'D-0c challenge/begin/continue proof bytes'],
    ['canonicalAgentSenderProofPayload', 'D-0c sender-proof payload'],
    ['AGENT_SENDER_PROOF_PURPOSE', 'D-0c sender-proof purpose'],
    ['AGENT_SENDER_PROOF_TYPE', 'D-0c sender-proof type'],
    ['AGENT_CREDENTIAL_PROOF_PURPOSES', 'D-0c credential proof purposes'],
    ['CIS_AGENT_ROUTES', 'D-0c relay routes'],
    ['isAeraWorkerEpochId', 'D-0c Epoch id guard'],
    ['issueAeraWorkerEpochId', 'Epoch id format (fixtures)'],
    ['isWorkerEpochRecordShape', 'D-0c persisted Epoch record'],
    ['WORKER_EPOCH_STATUSES', 'D-0c Epoch status'],
    ['isAgentSenderProofClaims', 'D-0c sender-proof claims guard'],
    ['isAeraPrincipalId', 'existing desktop import'],
    ['issueAeraPrincipalId', 'existing desktop test import'],
  ],
  '@aera/local-effect-admission': [
    ['createAgentSenderProof', 'D-0c sender proof'],
    ['attemptBodyDigest', 'D-0c sender proof body digest'],
    ['newSenderProofNonce', 'D-0c / U8 nonce'],
    ['sha256Ref', 'D-0c digest refs'],
    ['MODEL_INVOCATION_ATTEST_ROUTE', 'U8 attest route'],
    ['MODEL_INVOCATION_ATTESTATION_SCHEMA', 'U8 attest schema'],
    ['MODEL_INVOCATION_ATTESTATION_KEYS', 'U8 parity vector'],
    ['modelInvocationEffectDigest', 'U8 parity vector'],
    ['MODEL_INVOCATION_ATTESTATION_SCHEMA_V2', 'O-1 U-D attest v2'],
    ['MODEL_INVOCATION_ATTESTATION_V2_KEYS', 'O-1 U-D attest v2 closed keys'],
    ['MODEL_PROVENANCE_MANIFEST_SCHEMA', 'O-1 U-D provenance manifest'],
    ['MODEL_PROVENANCE_CLASSES', 'O-1 U-D manifest classes'],
    ['MODEL_PROVENANCE_RECORD_TOOL', 'O-1 U-D record tool'],
    ['MODEL_PROVENANCE_OBSERVATION_TOOLS', 'O-1 U-D observation tools'],
    ['MODEL_PROVENANCE_MAX_ENTRIES', 'O-1 U-D manifest bound'],
    ['MODEL_PROVENANCE_MAX_TURN_SEQ', 'O-1 U-D turnSeq bound'],
    ['isModelInvocationAttestationV2', 'O-1 U-D body self-check'],
    ['isModelProvenanceManifest', 'O-1 U-D manifest self-check'],
    ['modelProvenanceDigest', 'O-1 U-D effect-digest parity'],
  ],
  '@aera/effect-broker': [
    ['createPinnedRouterTransport', 'D-0c attest transport, D-0d2 attempts/outcomes'],
    ['createPinnedRouterRelayClient', 'D-0c relay client'],
    ['caFingerprintSha256', 'D-0c CA pin at composition'],
    ['EffectBroker', 'D-0d2 broker'],
    ['FileBrokerJournal', 'D-0d2 journal'],
    ['assertCapabilityCatalog', 'D-0d1 catalog pin'],
    ['requireSandbox', 'D-0d1 sandbox gate'],
  ],
}

/**
 * Every export of the cis-contracts copy vendored before D-0a. The
 * replacement must be a superset: the participation packages and the
 * desktop were written against these.
 */
const PRE_D0A_CIS_CONTRACTS_EXPORTS = [
  'AUTHENTICATION_METHODS', 'BINDING_LIFECYCLE_STATES', 'BINDING_LIFECYCLE_TRANSITIONS',
  'BINDING_VERIFICATION_STATES', 'CIS_STABLE_ID_KINDS', 'COLLAB_ACTOR_TYPES',
  'FAIL_CLOSED_SESSION_VALIDATION', 'FORBIDDEN_SESSION_CLAIM_KEYS', 'IDENTITY_EVIDENCE_KINDS',
  'IDENTITY_LIFECYCLE_STATES', 'INITIAL_REVOCATION_GENERATION', 'LEGACY_EVIDENCE_ADAPTERS',
  'ORG_ROLE_PROJECTIONS', 'PERMITTED_ORGANISATION_CONTEXT_KEYS', 'PERMITTED_SESSION_CLAIM_KEYS',
  'PRINCIPAL_KINDS', 'PRINCIPAL_KIND_ACTOR_PROJECTION', 'PROVIDER_VERIFICATION_FAILURES',
  'REGISTERED_AUTH_PROVIDER_IDS', 'REVOCATION_GENERATION_COMPARISONS', 'SESSION_INVALID_REASONS',
  'STABLE_ID_PATTERN', 'UUID_V4_PATTERN', 'assertAeraPrincipalId', 'assertBindingUniqueness',
  'assertNoAuthorityClaims', 'assertPermittedActorProjection', 'canonicalEvidence',
  'compareRevocationGeneration', 'deriveCanonicalClaims', 'hasNoAuthorityClaims',
  'isAeraOrganisationId', 'isAeraPrincipalId', 'isAeraSessionClaimsShape', 'isAeraSessionId',
  'isAuthProviderId', 'isAuthenticationMethod', 'isBindingLifecycleState',
  'isBindingVerificationState', 'isCanonicalCisSessionEvidence', 'isCollabActorType',
  'isContactChannelShaped', 'isExternalIdentityBindingId', 'isIdentityLifecycleState',
  'isLegacyAdapterEvidence', 'isLegacyEvidenceAdapter', 'isOrgRoleProjection',
  'isPermittedActorProjection', 'isPermittedBindingTransition', 'isPrincipalKind',
  'isRegisteredAuthProviderId', 'isRevocationGeneration', 'isRevocationGenerationCurrent',
  'isSessionValid', 'isUsableForAuthentication', 'issueAeraOrganisationId', 'issueAeraPrincipalId',
  'issueAeraSessionId', 'issueExternalIdentityBindingId', 'legacyEvidence',
  'nextRevocationGeneration', 'parseCisStableId', 'permittedActorTypes', 'sessionInvalid',
  'sessionValid', 'unsafeMarkCanonicalSessionClaims_Wave2IssuanceOnly', 'validateBindingUniqueness',
] as const

describe('D-0a: the vendored local-effect closure', () => {
  it('has a manifest naming the reviewed candidate as its source', () => {
    expect(existsSync(MANIFEST_PATH)).toBe(true)
    const manifest = readManifest()
    expect(manifest.schema).toBe('aera.desktop.vendor-manifest.v1')
    expect(manifest.sourceRepository).toBe('aera-stack')
    expect(manifest.sourceBranch).toBe(D0A_SOURCE_BRANCH)
    expect(manifest.sourceCommit).toBe(D0A_SOURCE_COMMIT)
  })

  it('pins every vendored tarball, and only those on disk, by sha256', () => {
    const manifest = readManifest()
    const onDisk = readdirSync(VENDOR_DIR).filter((name) => name.endsWith('.tgz')).sort()
    const listed = manifest.tarballs.map((entry) => entry.tarball).sort()
    expect(listed).toEqual(onDisk)
    expect(onDisk).toEqual([...D0A_PACKAGES, ...UNTOUCHED_PACKAGES].map(tarballName).sort())
    for (const entry of manifest.tarballs) {
      expect(entry.tarball).toBe(tarballName(entry.package))
      expect(sha256Hex(readFileSync(join(VENDOR_DIR, entry.tarball))), entry.tarball).toBe(entry.sha256)
    }
  })

  it('records the source commit for each D-0a package (O-1 U-D for admission), and none for the untouched ones', () => {
    const byPackage = new Map(readManifest().tarballs.map((entry) => [entry.package, entry]))
    for (const pkg of D0A_PACKAGES) {
      expect(byPackage.get(pkg)?.sourceCommit, pkg).toBe(expectedSourceCommit(pkg))
      if (O1_PACKAGES.includes(pkg)) expect(byPackage.get(pkg)?.sourceBranch, pkg).toBe(O1_SOURCE_BRANCH)
      expect(byPackage.get(pkg)?.licenseMember, pkg).toBe(true)
      expect(byPackage.get(pkg)?.distTreeDigest, pkg).toMatch(/^[0-9a-f]{64}$/)
    }
    for (const pkg of UNTOUCHED_PACKAGES) {
      // Not re-vendored by D-0a; provenance predates the manifest.
      expect(byPackage.get(pkg)?.sourceCommit, pkg).toBeNull()
    }
  })

  it('installed every D-0a package from exactly the vendored bytes', () => {
    const byPackage = new Map(readManifest().tarballs.map((entry) => [entry.package, entry]))
    for (const pkg of D0A_PACKAGES) {
      const dir = installedDir(pkg)
      expect(distTreeDigest(join(dir, 'dist')), pkg).toBe(byPackage.get(pkg)?.distTreeDigest)
      // The 8686d2654c rule: SEE LICENSE IN LICENSE needs a LICENSE artefact.
      expect(existsSync(join(dir, 'LICENSE')), `${pkg} LICENSE`).toBe(true)
    }
  })

  it('resolves every D-0a package only from the vendored tarball, never a registry', () => {
    const desktop = JSON.parse(readFileSync(join(DESKTOP_DIR, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
    }
    const root = JSON.parse(readFileSync(join(DESKTOP_DIR, '../package.json'), 'utf8')) as {
      resolutions: Record<string, string>
    }
    for (const pkg of D0A_PACKAGES) {
      expect(desktop.dependencies[pkg], pkg).toBe(`file:./vendor/aera/${tarballName(pkg)}`)
      // Nested `@aera/*: 0.1.0` ranges inside the tarballs must not reach npm.
      expect(root.resolutions[pkg], pkg).toBe(`file:./dsh-plugin-desktop/vendor/aera/${tarballName(pkg)}`)
    }
  })

  it('exports every symbol the Worker-host local-effect units depend on', async () => {
    const missing: string[] = []
    for (const [pkg, symbols] of Object.entries(LE_CLOSURE_SYMBOLS)) {
      const mod = await import(/* @vite-ignore */ pkg) as Record<string, unknown>
      for (const [name, why] of symbols) {
        if (mod[name] === undefined) missing.push(`${pkg}.${name} (${why})`)
      }
    }
    expect(missing).toEqual([])
  })

  it('keeps the attest and relay constants the units are written against', async () => {
    const admission = await import('@aera/local-effect-admission') as Record<string, unknown>
    const cis = await import('@aera/cis-contracts') as Record<string, unknown>
    expect(admission['MODEL_INVOCATION_ATTEST_ROUTE']).toBe('/v1/local-effects/model-invocations/attest')
    expect(cis['AGENT_SENDER_PROOF_PURPOSE']).toBe('aera.local-effect.sender-proof.v1')
    expect(typeof cis['canonicalAgentSenderProofPayload']).toBe('function')
    expect(typeof cis['canonicalAgentCredentialProofBytes']).toBe('function')
  })

  it('replaced cis-contracts with a superset of the copy it replaced', async () => {
    const cis = await import('@aera/cis-contracts') as Record<string, unknown>
    const removed = PRE_D0A_CIS_CONTRACTS_EXPORTS.filter((name) => !(name in cis))
    expect(removed).toEqual([])
  })
})
