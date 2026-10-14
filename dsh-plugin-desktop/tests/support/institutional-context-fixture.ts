/*
 * PORTED TEST FIXTURE — WO-AERA-AUTONOMOUS-FACTORY-CONTEXT-CONVERGENCE-002 G2.
 *
 * A verbatim copy of aera-stack
 * packages/participation-runtime/src/testing/institutionalContextFixture.ts at
 * e36d7cc0cfd4238a0d2fce4d28289ca190a7d5da. The stack file is excluded from the
 * vendored dist, so it cannot be imported here. Only the two relative imports
 * of ContextNavigator and ParticipationStore are changed, to the vendored
 * '@aera/participation-runtime'. Equivalence is asserted by
 * tests/aera-collab-institutional-context.spec.ts, which compiles this store
 * and compares the sha256 of the IMPLEMENTER packet with the stack runner
 * output for the same commit.
 */
import type { AeraPrincipalId } from '@aera/cis-contracts'
import {
  ENGINEERING_WORK_GRAPH_PROJECTION_VERSION,
  EVIDENTIARY_WORK_GRAPH_VERSION,
  NO_RECORDED_SOURCE_HASH,
  attributeChange,
  deriveEwgNodeId,
  type DelegationRef,
  type EngineeringWorkGraphProjectionV1,
  type EwgEdge,
  type EwgNode,
  type EwgNodeId,
  type ParticipationSession,
} from '@aera/evidentiary-work-graph-contracts'
import { assertValidProjection, type EwgProvenanceRef } from '@aera/evidentiary-work-graph'
import {
  repositoryId,
  type AcceptedIntegrationStateId,
  type AttributionCorrectionId,
  type CodeCheckpointId,
  type CodeWorkingLineId,
  type DecisionId,
  type EvidenceId,
  type IntegrationReceiptId,
  type RepositoryId,
} from '@aera/participation-contracts'
import { ContextNavigator, ParticipationStore } from '@aera/participation-runtime'

/**
 * # Factory context fixture — WO-AERA-AUTONOMOUS-FACTORY-CONTEXT-CONVERGENCE-002
 *
 * Seam proposal §4.6. A deterministic participation store holding every §14
 * and §18 condition, built ONLY through the public `ParticipationStore` write
 * API (the same calls the product makes). Nothing here writes a record file
 * directly.
 *
 * Test-only: `src/testing/**` is excluded from the package build
 * (`tsconfig.build.json`) and is not reachable from `src/index.ts`.
 *
 * Two §4.6 states cannot be produced through the write API, because the store
 * refuses them at write time:
 *
 * - a DANGLING REPOSITORY BINDING (`bindWorkOrderRepository` requires the
 *   resource to exist, and nothing removes a resource);
 * - a DECISION citing missing evidence (`recordDecision` refuses unknown
 *   evidence ids).
 *
 * The fixture therefore carries the closest API-reachable equivalents — a
 * checkpoint citing a missing evidence id (`mintCheckpoint` does not resolve
 * evidence ids) — and tests that need a missing repository resource derive it
 * from a COPY of this store, never from this builder.
 *
 * Narrative written by the implementer principal carries `SENTINEL-*` markers
 * so tests can assert, by exact string, where it may and may not appear.
 */

export const FIXTURE_NOW = '2026-10-01T00:00:00.000Z'

const principal = (n: number): AeraPrincipalId =>
  `aera:participant:10000000-0000-4000-8000-${String(n).padStart(12, '0')}` as AeraPrincipalId

export const FIXTURE_PRINCIPALS = {
  owner: principal(1),
  controller: principal(2),
  implementer: principal(3),
  reviewer: principal(4),
} as const

export const FIXTURE_WORK_ORDERS = {
  authorising: 'WO-FIXTURE-FACTORY-AUTHORITY-001',
  target: 'WO-FIXTURE-FACTORY-TARGET-002',
  predecessor: 'WO-FIXTURE-FACTORY-PREDECESSOR-001',
  minimal: 'WO-FIXTURE-FACTORY-MINIMAL-003',
  reviewOnly: 'WO-FIXTURE-FACTORY-REVIEW-ONLY-004',
} as const

export const FIXTURE_REPOSITORIES = {
  stack: repositoryId('aera-stack'),
  fork: repositoryId('aera-stack-fork'),
} as const

export const FIXTURE_REVISIONS = {
  origin: 'a1a1a1a1a1a1',
  rootCheckpoint: 'b2b2b2b2b2b2',
  firstSlice: 'c3c3c3c3c3c3',
  candidate: 'd4d4d4d4d4d4',
  squashResult: 'f6f6f6f6f6f6',
  mergeResult: '070707070707',
  reviewOnlyCandidate: '1a2b3c4d5e6f',
} as const

export const FIXTURE_BRANCHES = {
  root: 'feature/context-root',
  derivedOriginal: 'feature/context-compiler-v1',
  derivedRelocated: 'feature/context-compiler-v2',
} as const

/** Exact narrative strings written by the implementer principal. */
export const FIXTURE_SENTINELS = {
  progressNote: 'SENTINEL-PROGRESS-NOTE: all tests pass, ready to merge',
  workSubmitted: 'SENTINEL-WORK-SUBMITTED: candidate submitted for review, implementation complete',
  testRecorded: 'SENTINEL-TEST-RECORDED: implementer test run passed',
  checkpointSummary: 'SENTINEL-CP2-SUMMARY: implementation complete and correct',
  checkpointLabel: 'SENTINEL-CP2-LABEL',
  analyticalSubject: 'SENTINEL-ANALYTICAL-SUBJECT: this proves the design is correct',
  analyticalBody: 'SENTINEL-ANALYTICAL-BODY: the implementer reasoned that every invariant holds',
  executionSubject: 'SENTINEL-EXECUTION-SUBJECT: unit suite run by the implementer',
  executionBody: 'SENTINEL-EXECUTION-BODY: 412 tests green on the implementer machine',
  selfVerificationSubject: 'SENTINEL-SELF-VERIFICATION-SUBJECT: implementer verified its own work',
  stateEvidence: 'SENTINEL-WO-STATE-EVIDENCE: implementer declares the order complete',
} as const

export const FIXTURE_ACCEPTED_STATE = 'aera:accepted_integration_state:fixture-dev-v1' as AcceptedIntegrationStateId
export const FIXTURE_MISSING_EVIDENCE_ID = 'aera:evidence:fixture-missing-0001' as EvidenceId

export interface FactoryContextFixtureIds {
  readonly directory: string
  readonly workOrders: typeof FIXTURE_WORK_ORDERS
  readonly principals: typeof FIXTURE_PRINCIPALS
  readonly repositories: typeof FIXTURE_REPOSITORIES
  readonly sessions: { readonly controller: string; readonly implementer: string; readonly reviewer: string }
  readonly lines: { readonly root: CodeWorkingLineId; readonly derived: CodeWorkingLineId }
  readonly checkpoints: { readonly root: CodeCheckpointId; readonly first: CodeCheckpointId; readonly stale: CodeCheckpointId }
  readonly decisions: { readonly superseded: DecisionId; readonly current: DecisionId; readonly revoked: DecisionId }
  readonly evidence: {
    readonly sourceOld: EvidenceId
    readonly sourceNew: EvidenceId
    readonly observational: EvidenceId
    readonly analyticalImplementer: EvidenceId
    readonly analyticalController: EvidenceId
    readonly decisionEvidence: EvidenceId
    readonly executionImplementer: EvidenceId
    readonly passAFindings: EvidenceId
    readonly wrongRevisionFindings: EvidenceId
    readonly implementerVerification: EvidenceId
    readonly reviewOnlyVerification: EvidenceId
  }
  readonly receipts: { readonly squash: IntegrationReceiptId; readonly merge: IntegrationReceiptId }
  readonly events: {
    readonly progressNote: string
    readonly workSubmitted: string
    readonly testRecorded: string
    readonly openBreak: string
    readonly repairedBreak: string
    readonly repair: string
  }
  readonly correction: AttributionCorrectionId
  readonly candidate: {
    readonly repositoryId: RepositoryId
    readonly candidateRevision: string
    readonly baseRevision: string
    readonly codeWorkingLineId: CodeWorkingLineId
  }
  readonly graph: {
    readonly targetNode: EwgNodeId
    readonly parentNode: EwgNodeId
    readonly currentDecisionNode: EwgNodeId
    readonly supersededDecisionNode: EwgNodeId
  }
}

const payload = (id: string, intent: string): string =>
  ['AERA-WORK-ORDER-STANDARD-003 v3.0', '', `WORK ORDER: ${id}`, 'OWNER: Fixture Owner', '', intent, '', 'END.'].join('\n')

/**
 * Build the fixture store in `directory` (which the caller creates, e.g. with
 * `mkdtempSync`). Deterministic: the clock advances one second per store
 * write-stamp from `FIXTURE_NOW` unless `options.now` is supplied.
 */
export function buildFactoryContextFixture(directory: string, options: { readonly now?: () => string } = {}): FactoryContextFixtureIds {
  let tick = 0
  const now = options.now ?? (() => new Date(Date.parse(FIXTURE_NOW) + (tick += 1000)).toISOString())
  const store = new ParticipationStore(directory, { now })
  const P = FIXTURE_PRINCIPALS
  const WO = FIXTURE_WORK_ORDERS
  const REPO = FIXTURE_REPOSITORIES
  const REV = FIXTURE_REVISIONS
  const S = FIXTURE_SENTINELS

  // ---- principals --------------------------------------------------------
  store.registerHumanParticipant({ principalId: P.owner, displayName: 'Fixture Owner' })
  store.projectAgentPrincipal({ principalId: P.controller, displayName: 'Fixture Controller', agentRole: 'ORCHESTRATOR', createdBy: P.owner, createdAt: FIXTURE_NOW })
  store.projectAgentPrincipal({ principalId: P.implementer, displayName: 'Fixture Implementer', agentRole: 'IMPLEMENTER', createdBy: P.owner, createdAt: FIXTURE_NOW })
  store.projectAgentPrincipal({ principalId: P.reviewer, displayName: 'Fixture Reviewer', agentRole: 'REVIEWER', createdBy: P.owner, createdAt: FIXTURE_NOW })

  // ---- work orders -------------------------------------------------------
  const owner = { principalId: P.owner, displayName: 'Fixture Owner' }
  const source = (messageId: string) => ({ nativeSessionId: 'fixture-native-session', messageId, eventSequence: 1, submittedAt: FIXTURE_NOW })
  store.registerWorkOrder({
    workOrderId: WO.authorising,
    title: 'Fixture authorising order',
    exactPayload: payload(WO.authorising, 'Authorise the fixture participants to record institutional facts.'),
    authorityClass: 'OWNER_SUPPLIED', lifecycleStatus: 'ACTIVE', owner, source: source('m-auth'),
  })
  store.registerWorkOrder({
    workOrderId: WO.predecessor,
    title: 'Fixture predecessor order',
    exactPayload: payload(WO.predecessor, 'Expose institutional context to agents through the graph.'),
    authorityClass: 'OWNER_SUPPLIED', lifecycleStatus: 'ACTIVE', owner, source: source('m-pred'),
  })
  store.registerWorkOrder({
    workOrderId: WO.target,
    title: 'Fixture context convergence order',
    parentWorkOrderId: WO.authorising,
    exactPayload: payload(WO.target, 'Give agents role-shaped institutional context from typed records, with independent review isolated from implementer narrative.'),
    authorityClass: 'OWNER_SUPPLIED', lifecycleStatus: 'ACTIVE', owner, source: source('m-target'),
  })
  store.registerWorkOrder({ workOrderId: WO.minimal, title: 'Fixture minimal order' })
  store.registerWorkOrder({ workOrderId: WO.reviewOnly, title: 'Fixture review-only order' })

  // ---- sessions ----------------------------------------------------------
  const delegation = (delegationId: string): DelegationRef => ({
    delegationId, delegatorPrincipalId: P.owner, authorityMode: 'RECORDED_NOT_ENFORCED',
  })
  const open = (principalId: AeraPrincipalId, delegationId: string): ParticipationSession =>
    store.openSession({ principalId, workOrderId: WO.authorising, delegationRef: delegation(delegationId) })
  const controllerSession = open(P.controller, 'delegation-fixture-controller')
  const implementerSession = open(P.implementer, 'delegation-fixture-implementer')
  const reviewerSession = open(P.reviewer, 'delegation-fixture-reviewer')
  const asController = { sessionId: controllerSession.sessionId, authorisingWorkOrderId: WO.authorising }
  const asImplementer = { sessionId: implementerSession.sessionId, authorisingWorkOrderId: WO.authorising }
  const asReviewer = { sessionId: reviewerSession.sessionId, authorisingWorkOrderId: WO.authorising }

  // ---- work order state series --------------------------------------------
  store.recordWorkOrderState({ ...asController, workOrderId: WO.target, lifecycleState: 'ACTIVE', evidence: 'owner admission message m-target' })
  store.recordWorkOrderState({ ...asController, workOrderId: WO.predecessor, lifecycleState: 'ACTIVE', evidence: 'owner admission message m-pred' })
  store.recordWorkOrderState({
    ...asController, workOrderId: WO.predecessor, lifecycleState: 'SUPERSEDED',
    relatesTo: { relationship: 'SUPERSEDED_BY', workOrderId: WO.target },
    evidence: 'owner ruling recorded as decision on the target order',
  })

  // ---- repositories (two similarly named) ---------------------------------
  store.registerRepositoryResource({
    ...asController, repositoryId: REPO.stack, displayName: 'Fixture aera-stack',
    provider: { provider: 'github', owner: 'fixture-org', name: 'aera-stack' },
    canonicalBranch: 'dev', verification: 'OWNER_DECLARED',
  })
  store.registerRepositoryResource({
    ...asController, repositoryId: REPO.fork, displayName: 'Fixture aera-stack-fork',
    provider: { provider: 'github', owner: 'fixture-org', name: 'aera-stack-fork' },
    canonicalBranch: 'main', verification: 'OWNER_DECLARED',
  })
  store.bindWorkOrderRepository({ ...asController, workOrderId: WO.target, repositoryId: REPO.stack, role: 'PRIMARY' })
  store.bindWorkOrderRepository({ ...asController, workOrderId: WO.target, repositoryId: REPO.fork, role: 'AFFECTED', note: 'downstream fork' })

  // ---- Working Lines and checkpoints (implementer) ------------------------
  const target = { kind: 'ACCEPTED_INTEGRATION_STATE' as const, repositoryId: REPO.stack, targetRef: 'dev' }
  const root = store.openWorkingLine({
    ...asImplementer, workOrderId: WO.target, repositoryId: REPO.stack,
    originAcceptedStateId: FIXTURE_ACCEPTED_STATE, originRevision: REV.origin,
    integrationTarget: target, expectedTargetRevision: REV.origin,
    label: 'Context root line', branchRef: FIXTURE_BRANCHES.root,
  }).line
  const rootCheckpoint = store.mintCheckpoint({
    ...asImplementer, codeWorkingLineId: root.codeWorkingLineId,
    stateRef: { kind: 'COMMIT', revision: REV.rootCheckpoint }, origin: 'MANUAL_CHECKPOINT',
    summary: 'Root line baseline', label: 'R1',
  }).checkpoint
  const derived = store.deriveWorkingLine({
    ...asImplementer, workOrderId: WO.target, parentCheckpointId: rootCheckpoint.checkpointId,
    integrationTarget: target, expectedTargetRevision: REV.origin,
    label: 'Context compiler line', branchRef: FIXTURE_BRANCHES.derivedOriginal,
  }).line
  store.updateWorkingLineLocation({ ...asImplementer, codeWorkingLineId: derived.codeWorkingLineId, branchRef: FIXTURE_BRANCHES.derivedRelocated, note: 'branch renamed' })
  const first = store.mintCheckpoint({
    ...asImplementer, codeWorkingLineId: derived.codeWorkingLineId,
    stateRef: { kind: 'COMMIT', revision: REV.firstSlice }, origin: 'MANUAL_CHECKPOINT',
    evidenceIds: [FIXTURE_MISSING_EVIDENCE_ID], summary: 'First compiler slice', label: 'C1',
  }).checkpoint
  const stale = store.mintCheckpoint({
    ...asImplementer, codeWorkingLineId: derived.codeWorkingLineId,
    stateRef: { kind: 'REF', ref: FIXTURE_BRANCHES.derivedRelocated, observedRevision: REV.candidate, observedAt: '2026-01-01T00:00:00.000Z' },
    origin: 'SUBMISSION', summary: S.checkpointSummary, label: S.checkpointLabel,
  }).checkpoint
  store.updateWorkingLineLocation({ ...asImplementer, codeWorkingLineId: derived.codeWorkingLineId, branchRef: null, note: 'branch deleted after submission' })

  // ---- typed evidence and decisions ---------------------------------------
  const sourceOld = store.recordTypedEvidence({
    ...asController, workOrderId: WO.target, evidenceClass: 'SOURCE_EVIDENCE',
    subject: 'Design document says agent context is read from graph events',
    sourceRef: 'docs/design.md', links: { repositoryIds: [REPO.stack] }, recordedAt: '2026-03-01T00:00:00.000Z',
  }).evidence
  const sourceNew = store.recordTypedEvidence({
    ...asController, workOrderId: WO.target, evidenceClass: 'SOURCE_EVIDENCE',
    subject: 'Design document says agent context is read from typed records',
    sourceRef: 'docs/design.md', links: { repositoryIds: [REPO.fork] }, recordedAt: '2026-04-01T00:00:00.000Z',
  }).evidence
  const observational = store.recordTypedEvidence({
    ...asController, workOrderId: WO.target, evidenceClass: 'OBSERVATIONAL_EVIDENCE',
    subject: 'Observed shared notes referenced from both repositories',
    links: { repositoryIds: [REPO.stack, REPO.fork], resourceRefs: ['docs/shared-notes.md'] },
  }).evidence
  const analyticalImplementer = store.recordTypedEvidence({
    ...asImplementer, workOrderId: WO.target, evidenceClass: 'ANALYTICAL_EVIDENCE',
    subject: S.analyticalSubject, body: S.analyticalBody, performedBy: P.implementer,
    analyticalProvenance: { producer: P.implementer, inputs: ['docs/design.md'], producedAt: FIXTURE_NOW },
  }).evidence
  const analyticalController = store.recordTypedEvidence({
    ...asController, workOrderId: WO.target, evidenceClass: 'ANALYTICAL_EVIDENCE',
    subject: 'Risk analysis: the compiler could leak narrative into review',
    analyticalProvenance: { producer: 'model:fixture-analyst', modelId: 'fixture-model', inputs: [sourceNew.evidenceId], producedAt: FIXTURE_NOW, confidence: 0.6 },
  }).evidence

  const seamOptions = [
    { optionId: 'extend-work-context', label: 'Extend WorkContextV1' },
    { optionId: 'new-compiler', label: 'Add a separate read-only compiler' },
  ]
  const superseded = store.recordDecision({
    ...asController, workOrderId: WO.target, subject: 'Agent context delivery seam',
    options: seamOptions, selectedOptionId: 'extend-work-context',
    rationale: 'Reuse the existing resolver.', evidenceIds: [sourceOld.evidenceId],
    decidedBy: P.owner,
  }).decision
  const current = store.recordDecision({
    ...asController, workOrderId: WO.target, subject: 'Agent context delivery seam',
    options: seamOptions, selectedOptionId: 'new-compiler',
    rationale: 'An additive seam leaves every existing contract unchanged.',
    evidenceIds: [sourceNew.evidenceId], codeWorkingLineIds: [derived.codeWorkingLineId],
    supersedesDecisionId: superseded.decisionId, authorisedEffects: ['implement the compiler on the derived line'],
    decidedBy: P.owner,
  }).decision
  store.supersedeDecision({ ...asController, decisionId: superseded.decisionId, status: 'SUPERSEDED', supersededByDecisionId: current.decisionId })
  const revoked = store.recordDecision({
    ...asController, workOrderId: WO.target, subject: 'Accept the first compiler slice',
    options: [{ optionId: 'accept', label: 'Accept the first slice' }, { optionId: 'reject', label: 'Reject the first slice' }],
    selectedOptionId: 'accept', checkpointIds: [first.checkpointId], decidedBy: P.owner,
  }).decision
  store.supersedeDecision({ ...asController, decisionId: revoked.decisionId, status: 'REVOKED', note: 'first slice rejected on review' })

  const decisionEvidence = store.recordTypedEvidence({
    ...asController, workOrderId: WO.target, evidenceClass: 'DECISION_EVIDENCE',
    subject: 'Owner ruling selecting the separate compiler', sourceRef: 'rulings/context-seam.md',
    links: { decisionIds: [current.decisionId] }, performedBy: P.owner,
  }).evidence
  const executionImplementer = store.recordTypedEvidence({
    ...asImplementer, workOrderId: WO.target, evidenceClass: 'EXECUTION_EVIDENCE',
    subject: S.executionSubject, body: S.executionBody, outcome: 'PASS', performedBy: P.implementer,
    sourceRef: 'logs/implementer-unit-suite.log', links: { repositoryIds: [REPO.stack], checkpointIds: [stale.checkpointId] },
  }).evidence
  const passAFindings = store.recordTypedEvidence({
    ...asReviewer, workOrderId: WO.target, evidenceClass: 'VERIFICATION_EVIDENCE',
    subject: 'Independent Pass A findings', outcome: 'FAIL', performedBy: P.reviewer,
    body: 'Reconstructed the candidate independently; integration receipt R1 lacks tree equivalence.',
    sourceRef: `review/pass-a-findings@${REV.candidate}.md`, links: { repositoryIds: [REPO.stack] },
  }).evidence
  const wrongRevisionFindings = store.recordTypedEvidence({
    ...asReviewer, workOrderId: WO.target, evidenceClass: 'VERIFICATION_EVIDENCE',
    subject: 'Pass A findings for an earlier candidate', outcome: 'FAIL', performedBy: P.reviewer,
    sourceRef: `review/pass-a-findings@${REV.firstSlice}.md`, links: { repositoryIds: [REPO.stack] },
  }).evidence
  const implementerVerification = store.recordTypedEvidence({
    ...asImplementer, workOrderId: WO.target, evidenceClass: 'VERIFICATION_EVIDENCE',
    subject: S.selfVerificationSubject, outcome: 'PASS', performedBy: P.implementer,
    sourceRef: `review/self-check@${REV.candidate}.md`,
  }).evidence
  const reviewOnlyVerification = store.recordTypedEvidence({
    ...asReviewer, workOrderId: WO.reviewOnly, evidenceClass: 'VERIFICATION_EVIDENCE',
    subject: 'Independent review verdict', outcome: 'PASS', performedBy: P.reviewer,
    sourceRef: `review/verdict@${REV.reviewOnlyCandidate}.md`,
  }).evidence

  // ---- the implementer's own completion claim on the order ----------------
  store.recordWorkOrderState({ ...asImplementer, workOrderId: WO.target, lifecycleState: 'COMPLETED', evidence: S.stateEvidence })

  // ---- integration receipts -----------------------------------------------
  const squash = store.recordIntegrationReceipt({
    ...asController, workOrderId: WO.target, sourceCodeWorkingLineId: root.codeWorkingLineId,
    sourceCheckpointId: rootCheckpoint.checkpointId, sourceRevision: REV.rootCheckpoint,
    targetRepositoryId: REPO.stack, targetRef: 'dev', method: 'SQUASH',
    resultingRevision: REV.squashResult, resourceRef: 'pr:101',
  }).receipt
  const merge = store.recordIntegrationReceipt({
    ...asController, workOrderId: WO.target, sourceCodeWorkingLineId: root.codeWorkingLineId,
    sourceCheckpointId: rootCheckpoint.checkpointId, sourceRevision: REV.rootCheckpoint,
    targetRepositoryId: REPO.fork, targetRef: 'main', method: 'MERGE_COMMIT',
    resultingRevision: REV.mergeResult, resourceRef: 'pr:7',
    treeEquivalence: { acceptedTreeDigest: 'tree-0a0a', mergedTreeDigest: 'tree-0a0a', equivalent: true, verifiedAt: FIXTURE_NOW, method: 'git-write-tree' },
    performedBy: P.owner,
  }).receipt

  // ---- participation events (narrative) -----------------------------------
  const onTarget = (session: ParticipationSession) => attributeChange({ session, workOrderId: WO.target })
  const progressNote = store.appendEvent({ eventKind: 'CHANGE_RECORDED', workOrderId: WO.target, attribution: onTarget(implementerSession), summary: S.progressNote })
  const workSubmitted = store.appendEvent({ eventKind: 'WORK_SUBMITTED', workOrderId: WO.target, attribution: onTarget(implementerSession), summary: S.workSubmitted })
  const testRecorded = store.appendEvent({ eventKind: 'TEST_RECORDED', workOrderId: WO.target, attribution: onTarget(implementerSession), summary: S.testRecorded, testResult: 'PASS' })
  const repairedBreak = store.appendEvent({ eventKind: 'BREAK_REPORTED', workOrderId: WO.target, attribution: onTarget(controllerSession), summary: 'Break reported: fixture lint failure on the root line' })
  const repair = store.appendEvent({ eventKind: 'REPAIR_RECORDED', workOrderId: WO.target, attribution: onTarget(controllerSession), summary: 'Repair recorded: lint failure fixed', repairsEventId: repairedBreak.eventId })
  const openBreak = store.appendEvent({ eventKind: 'BREAK_REPORTED', workOrderId: WO.target, attribution: onTarget(controllerSession), summary: 'Break reported: integration receipt for pr:101 has no tree-equivalence proof' })

  // ---- attribution correction on the first checkpoint ---------------------
  const correction = store.recordAttributionCorrection({
    ...asController, workOrderId: WO.target, subjectRecordKind: 'CODE_CHECKPOINT',
    subjectRecordId: first.checkpointId, correctedLeg: 'MINTED_BY', statedPrincipalId: P.implementer,
    truePerformedBy: P.controller, reason: 'The controller minted this checkpoint on the implementer session.',
  }).correction

  return {
    directory,
    workOrders: WO,
    principals: P,
    repositories: REPO,
    sessions: { controller: controllerSession.sessionId, implementer: implementerSession.sessionId, reviewer: reviewerSession.sessionId },
    lines: { root: root.codeWorkingLineId, derived: derived.codeWorkingLineId },
    checkpoints: { root: rootCheckpoint.checkpointId, first: first.checkpointId, stale: stale.checkpointId },
    decisions: { superseded: superseded.decisionId, current: current.decisionId, revoked: revoked.decisionId },
    evidence: {
      sourceOld: sourceOld.evidenceId,
      sourceNew: sourceNew.evidenceId,
      observational: observational.evidenceId,
      analyticalImplementer: analyticalImplementer.evidenceId,
      analyticalController: analyticalController.evidenceId,
      decisionEvidence: decisionEvidence.evidenceId,
      executionImplementer: executionImplementer.evidenceId,
      passAFindings: passAFindings.evidenceId,
      wrongRevisionFindings: wrongRevisionFindings.evidenceId,
      implementerVerification: implementerVerification.evidenceId,
      reviewOnlyVerification: reviewOnlyVerification.evidenceId,
    },
    receipts: { squash: squash.integrationReceiptId, merge: merge.integrationReceiptId },
    events: {
      progressNote: progressNote.eventId,
      workSubmitted: workSubmitted.eventId,
      testRecorded: testRecorded.eventId,
      openBreak: openBreak.eventId,
      repairedBreak: repairedBreak.eventId,
      repair: repair.eventId,
    },
    correction: correction.correctionId,
    candidate: {
      repositoryId: REPO.stack,
      candidateRevision: REV.candidate,
      baseRevision: REV.origin,
      codeWorkingLineId: derived.codeWorkingLineId,
    },
    graph: FIXTURE_GRAPH_NODES,
  }
}

const graphProvenance: EwgProvenanceRef = {
  sourcePath: 'fixture/adr.md',
  sourceHash: NO_RECORDED_SOURCE_HASH,
  provenanceQuality: 'LEGACY_NO_RECORDED_HASH',
}

export const FIXTURE_GRAPH_NODES = {
  targetNode: deriveEwgNodeId('WORK_ORDER', FIXTURE_WORK_ORDERS.target),
  parentNode: deriveEwgNodeId('WORK_ORDER', FIXTURE_WORK_ORDERS.authorising),
  currentDecisionNode: deriveEwgNodeId('ARCHITECTURE_DECISION', 'ADR-FIXTURE-TYPED-RECORDS'),
  supersededDecisionNode: deriveEwgNodeId('ARCHITECTURE_DECISION', 'ADR-FIXTURE-GRAPH-EVENTS'),
} as const

/**
 * A small validated graph: the parent order GOVERNS the target, the target
 * GOVERNS two architecture decisions, and one decision SUPERSEDES the other
 * by a written statement.
 */
export function buildFactoryContextProjection(): EngineeringWorkGraphProjectionV1 {
  const p = graphProvenance
  const G = FIXTURE_GRAPH_NODES
  const nodes: EwgNode[] = [
    { nodeId: G.parentNode, kind: 'WORK_ORDER', assertedBy: p, workOrderId: FIXTURE_WORK_ORDERS.authorising, label: 'Fixture authorising order' },
    { nodeId: G.targetNode, kind: 'WORK_ORDER', assertedBy: p, workOrderId: FIXTURE_WORK_ORDERS.target, label: 'Fixture context convergence order', parentWorkOrderId: FIXTURE_WORK_ORDERS.authorising },
    { nodeId: G.currentDecisionNode, kind: 'ARCHITECTURE_DECISION', assertedBy: p, decisionId: 'ADR-FIXTURE-TYPED-RECORDS', label: 'Agent context is compiled from typed records' },
    { nodeId: G.supersededDecisionNode, kind: 'ARCHITECTURE_DECISION', assertedBy: p, decisionId: 'ADR-FIXTURE-GRAPH-EVENTS', label: 'Agent context is read from graph events' },
  ]
  const edges: EwgEdge[] = [
    { kind: 'GOVERNS', from: G.parentNode, to: G.targetNode, assertedBy: p },
    { kind: 'GOVERNS', from: G.targetNode, to: G.currentDecisionNode, assertedBy: p },
    { kind: 'GOVERNS', from: G.targetNode, to: G.supersededDecisionNode, assertedBy: p },
    {
      kind: 'SUPERSEDES', from: G.currentDecisionNode, to: G.supersededDecisionNode, assertedBy: p, evidenceRef: p,
      supersessionStatement: 'ADR-FIXTURE-TYPED-RECORDS supersedes ADR-FIXTURE-GRAPH-EVENTS by written ruling',
    },
  ]
  const projection: EngineeringWorkGraphProjectionV1 = {
    projectionVersion: ENGINEERING_WORK_GRAPH_PROJECTION_VERSION,
    graphVersion: EVIDENTIARY_WORK_GRAPH_VERSION,
    rebuiltAt: FIXTURE_NOW,
    sourceManifest: [{ sourcePath: 'fixture/adr.md', sourceHash: NO_RECORDED_SOURCE_HASH }],
    nodes,
    edges,
  }
  assertValidProjection(projection)
  return projection
}

export function buildFactoryContextNavigator(): ContextNavigator {
  return new ContextNavigator(buildFactoryContextProjection())
}
