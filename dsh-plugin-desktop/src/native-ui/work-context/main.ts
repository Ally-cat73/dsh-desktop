/**
 * Aera Work Context page — WO-AGC-002 Remit C.
 *
 * Presentation only. This sandboxed page renders the serialised view model it
 * receives over `aera-work-context-state` CustomEvents and requests actions
 * ONLY by navigating to the private `aera-work-context:` scheme, which the
 * owning window intercepts in the main process. No node access, no store
 * paths, no write capability. All record content is rendered via textContent.
 */

import './style.css'

interface NodeRefView {
  readonly nodeId: string
  readonly label: string
  readonly sourcePath?: string
  readonly status: string
}

interface ParticipantView {
  readonly principalId: string
  readonly principalKind: string
  readonly displayName: string
  readonly statusLine: string
  readonly openSessionIds: readonly string[]
}

interface WorkingStateView {
  readonly repositoryId: string
  readonly localPath: string
  readonly branchRef: string
  readonly headRevision: string
  readonly dirtyState: string
  readonly observedAt: string
  readonly note: string
}

interface ContextView {
  readonly workOrderId: string
  readonly workOrderLabel?: string
  readonly participants: readonly ParticipantView[]
  readonly workingState?: WorkingStateView
  readonly workingStateUnavailableReason?: string
  readonly currentCanonicalState: readonly NodeRefView[]
  readonly governingDecisions: readonly NodeRefView[]
  readonly evidence: readonly NodeRefView[]
  readonly knownResiduals: readonly NodeRefView[]
  readonly authorityMode: string
  readonly authorityModeNote: string
  readonly executionActions: readonly { action: string, state: string, reason: string }[]
  readonly assembledAt: string
}

interface Availability { readonly store: string, readonly projection: string, readonly principal: string }

/**
 * The read-first Collab view — WO-AERA-CODE-COLLAB-READ-FIRST-SURFACE-001.
 *
 * Presentation only, like everything else on this page. Every string below was
 * worded in the main process by `aera-collab-code-view.ts`; nothing here
 * derives a sentence, a count or a state. All record content is rendered via
 * `textContent`.
 */
interface RailTabView { readonly section: string, readonly label: string, readonly count: number }
interface LineRowView {
  readonly codeWorkingLineId?: string
  readonly label: string
  readonly participant: string
  readonly topologySentence: string
  readonly topologyState: string
  readonly conflictSentence?: string
  readonly dirtyMarker?: string
  readonly checkpointCount: number
  readonly compareAvailable: boolean
  readonly provenance: string
  readonly provenanceNote?: string
  readonly technical: readonly string[]
}
interface ChangedFileRowView {
  readonly kindWord: string
  readonly path: string
  readonly previousPath?: string
  readonly counts?: string
  readonly bothLines: boolean
  readonly conflicted: boolean
  readonly structuralDelta: readonly string[]
  readonly accessibleName: string
}
interface CompareView {
  readonly heading: string
  readonly banner: string
  readonly from: { readonly side: string, readonly name: string }
  readonly to: { readonly side: string, readonly name: string }
  readonly directionSentence: string
  readonly headline: string
  readonly files: readonly ChangedFileRowView[]
  readonly unrepresentable: readonly string[]
  readonly structuralDeltaNote?: string
  readonly technical: readonly string[]
  readonly computedAt: string
}
interface CollabParticipantRowView {
  readonly displayName: string
  readonly principalKind: string
  readonly statusLine: string
  readonly lineLabels: readonly string[]
  readonly technical: readonly string[]
}
interface ActivityRowView {
  readonly actor: string, readonly summary: string, readonly when: string
  readonly detail?: string, readonly technical?: string
}
interface CheckpointRowView {
  readonly name: string, readonly origin: string, readonly who: string, readonly when: string
  readonly verifiabilityNote?: string, readonly summary?: string, readonly technical: string
}
interface CollabCodeView {
  readonly workOrderId: string
  readonly workOrderTitle?: string
  readonly repositories: readonly string[]
  readonly authorityMode: string
  readonly authorityModeNote: string
  readonly assembledAt: string
  readonly participants: readonly CollabParticipantRowView[]
  readonly lines: readonly LineRowView[]
  readonly linesEmptyReason?: string
  readonly rail: readonly RailTabView[]
  readonly activity: readonly ActivityRowView[]
  readonly checkpoints: readonly CheckpointRowView[]
  readonly checkpointsEmptyReason?: string
  readonly evidence: readonly { readonly label: string, readonly status: string, readonly technical?: string }[]
  readonly liveProviderState?: { readonly recorded?: string, readonly live?: string, readonly unavailableReason?: string }
  readonly discussionNote: string
  readonly archivedCount: number
  readonly compare?: CompareView
  readonly projectedAt: string
}

type StateDetail =
  | { kind: 'idle', availability: Availability, activeView?: string, notice?: string }
  | {
      kind: 'context', availability: Availability, view: ContextView,
      activeView?: string, collab?: CollabCodeView, notice?: string,
    }
  | { kind: 'busy', message: string }
  | { kind: 'error', code: string, reason: string }

const root = document.getElementById('root')
if (root === null) throw new Error('missing #root')

function act(action: string, params?: Readonly<Record<string, string>>): void {
  const url = new URL(`aera-work-context://${action}`)
  for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value)
  window.location.href = url.href
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className !== undefined && className !== '') node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function nodeList(title: string, refs: readonly NodeRefView[]): HTMLElement {
  const section = el('div')
  section.append(el('h2', '', title))
  if (refs.length === 0) {
    section.append(el('div', 'muted', 'None recorded.'))
    return section
  }
  const list = el('ul')
  for (const ref of refs) {
    const item = el('li')
    item.append(el('span', '', ref.label))
    item.append(el('span', 'status', ref.status))
    if (ref.sourcePath !== undefined) {
      item.append(document.createTextNode(' '))
      const link = el('a', 'src', ref.sourcePath)
      link.addEventListener('click', () => { act('open-source', { path: ref.sourcePath ?? '' }) })
      item.append(link)
    }
    const id = el('div', 'muted', ref.nodeId)
    id.style.fontSize = '11px'
    item.append(id)
    list.append(item)
  }
  section.append(list)
  return section
}

function openControls(currentId?: string): HTMLElement {
  const panel = el('div', 'panel')
  const row = el('div', 'row')
  const input = el('input')
  input.type = 'text'
  input.id = 'work-order-id'
  input.placeholder = 'WorkOrderId (e.g. WO-AERA-…)'
  if (currentId !== undefined) input.value = currentId
  const openButton = el('button', '', 'Open Work Context')
  openButton.id = 'open-context'
  openButton.addEventListener('click', () => {
    if (input.value.trim() !== '') act('open', { workOrderId: input.value.trim() })
  })
  row.append(input, openButton)
  panel.append(row)
  return panel
}

function availabilityPanel(availability: Availability): HTMLElement {
  const panel = el('div', 'panel')
  panel.append(el('h2', '', 'Availability'))
  for (const [label, value] of [
    ['Store', availability.store],
    ['Projection', availability.projection],
    ['Principal', availability.principal],
  ] as const) {
    panel.append(el('div', value.startsWith('UNAVAILABLE') ? 'warn' : 'muted', `${label}: ${value}`))
  }
  return panel
}


/**
 * TECHNICAL DETAILS — disclosure level 5, Notes' grammar exactly.
 *
 * An ordinary `aria-expanded` button over the region it controls, never open
 * by default, carrying nothing a reader needs in order to understand the state
 * they are reading. Shas, refs, merge bases, ids and the exact failing command
 * live here and nowhere else (§38).
 */
function technicalDetails(lines: readonly string[]): HTMLElement | undefined {
  if (lines.length === 0) return undefined
  const wrap = el('div', 'technical')
  const toggle = el('button', 'technical-toggle', 'Technical details')
  const body = el('div', 'technical-body')
  body.hidden = true
  toggle.setAttribute('aria-expanded', 'false')
  for (const line of lines) body.append(el('div', 'stamp muted', line))
  toggle.addEventListener('click', () => {
    body.hidden = !body.hidden
    toggle.setAttribute('aria-expanded', body.hidden ? 'false' : 'true')
  })
  wrap.append(toggle, body)
  return wrap
}

/** The two views of one window. A view is a projection, never a second app. */
function viewSwitch(active: string): HTMLElement {
  const group = el('div', 'row view-switch')
  group.setAttribute('role', 'group')
  group.setAttribute('aria-label', 'Work Context view')
  for (const [value, label] of [['CONTEXT', 'Context'], ['COLLAB', 'Collab']] as const) {
    const button = el('button', active === value ? 'active' : '', label)
    button.id = `view-${value.toLowerCase()}`
    button.setAttribute('aria-pressed', String(active === value))
    button.addEventListener('click', () => { act('view', { view: value }) })
    group.append(button)
  }
  return group
}

/** One Working Line row. The topology sentence is the product. */
function lineRow(line: LineRowView, index: number): HTMLElement {
  const item = el('div', 'line-row')
  const head = el('div', 'row')
  head.append(el('span', 'line-label', line.label))
  head.append(el('span', 'status', line.participant))
  if (line.checkpointCount > 0) {
    head.append(el('span', 'status', `${String(line.checkpointCount)} checkpoints`))
  }
  if (line.compareAvailable) {
    const compare = el('button', 'compare', 'Compare')
    compare.setAttribute('aria-label', `Compare ${line.label} with the accepted integration state`)
    compare.addEventListener('click', () => { act('compare', { line: String(index) }) })
    head.append(compare)
  }
  item.append(head)
  // The topology sentence: one human sentence, no Git arithmetic.
  item.append(el('div', 'topology', line.topologySentence))
  /*
   * The textual-conflict fact, SEPARATELY LABELLED and never folded into the
   * topology sentence. It carries a non-colour signal (the leading glyph and
   * the word) so it survives greyscale.
   */
  if (line.conflictSentence !== undefined) {
    item.append(el('div', 'conflict', `\u26A0 ${line.conflictSentence}`))
  }
  if (line.dirtyMarker !== undefined) item.append(el('div', 'muted', line.dirtyMarker))
  if (line.provenanceNote !== undefined) item.append(el('div', 'muted', line.provenanceNote))
  const technical = technicalDetails(line.technical)
  if (technical !== undefined) item.append(technical)
  return item
}

/** The Compare reading. It REPLACES the line list; nothing writable is mounted. */
function comparePanel(compare: CompareView): HTMLElement {
  const panel = el('div', 'panel compare')
  const head = el('div', 'row')
  head.append(el('h2', '', compare.heading))
  const done = el('button', '', 'Done')
  done.addEventListener('click', () => { act('close-compare') })
  head.append(done)
  panel.append(head)
  panel.append(el('div', 'compare-banner', compare.banner))

  // FROM → TO, explicit, with the direction spelled out.
  const operands = el('div', 'row operands')
  operands.setAttribute('role', 'group')
  operands.setAttribute('aria-label', 'Comparison operands')
  const from = el('div', 'operand')
  from.append(el('div', 'muted', 'Compare from'))
  from.append(el('div', '', compare.from.name))
  const to = el('div', 'operand')
  to.append(el('div', 'muted', 'Compare to'))
  to.append(el('div', '', compare.to.name))
  operands.append(from, el('span', 'arrow', '\u2192'), to)
  panel.append(operands)
  panel.append(el('div', 'muted', compare.directionSentence))
  panel.append(el('div', 'headline', compare.headline))

  panel.append(el('h2', '', 'Changed files'))
  if (compare.files.length === 0) {
    panel.append(el('div', 'muted', 'No files differ between these two states.'))
  }
  const list = el('ul', 'files')
  for (const file of compare.files) {
    const row = el('li', 'file-row')
    row.setAttribute('aria-label', file.accessibleName)
    // The KIND is a WORD, never colour alone.
    row.append(el('span', 'kind', file.kindWord))
    row.append(el('span', 'path stamp', file.previousPath === undefined
      ? file.path
      : `${file.previousPath} \u2192 ${file.path}`))
    if (file.counts !== undefined) row.append(el('span', 'counts muted', file.counts))
    if (file.bothLines) row.append(el('span', 'status', '\u21C4 changed on both lines'))
    if (file.conflicted) row.append(el('span', 'status conflict', '\u26A0 cannot merge automatically'))
    for (const delta of file.structuralDelta) {
      row.append(el('div', 'structural muted', `Structural delta \u00B7 ${delta}`))
    }
    list.append(row)
  }
  panel.append(list)

  for (const entry of compare.unrepresentable) panel.append(el('div', 'warn', entry))
  if (compare.structuralDeltaNote !== undefined) {
    panel.append(el('div', 'muted', compare.structuralDeltaNote))
  }
  const technical = technicalDetails(compare.technical)
  if (technical !== undefined) panel.append(technical)
  return panel
}

/** The counted rail. One section at a time, and SHUT by default. */
let openRailSection: string | null = null

function railPanel(collab: CollabCodeView): HTMLElement {
  const panel = el('div', 'panel')
  const tabs = el('div', 'row rail')
  tabs.setAttribute('role', 'group')
  tabs.setAttribute('aria-label', 'Collab details')
  for (const tab of collab.rail) {
    const button = el('button', openRailSection === tab.section ? 'active' : '', tab.label)
    button.setAttribute('aria-expanded', String(openRailSection === tab.section))
    if (tab.count > 0) button.append(el('span', 'status', String(tab.count)))
    button.addEventListener('click', () => {
      openRailSection = openRailSection === tab.section ? null : tab.section
      act('refresh')
    })
    tabs.append(button)
  }
  panel.append(tabs)
  const body = el('div', 'rail-body')
  switch (openRailSection) {
    case 'ACTIVITY': {
      if (collab.activity.length === 0) {
        body.append(el('div', 'muted', 'Nothing has been recorded on this Work Order yet.'))
      }
      for (const row of collab.activity) {
        const entry = el('div', 'activity-row')
        entry.append(el('span', 'actor', row.actor))
        entry.append(el('span', '', ` ${row.summary}`))
        entry.append(el('span', 'muted when', ` ${row.when}`))
        if (row.detail !== undefined) entry.append(el('div', 'muted', row.detail))
        const technical = technicalDetails(row.technical === undefined ? [] : [row.technical])
        if (technical !== undefined) entry.append(technical)
        body.append(entry)
      }
      break
    }
    case 'CHECKPOINTS': {
      if (collab.checkpoints.length === 0) {
        body.append(el('div', 'muted', collab.checkpointsEmptyReason ?? 'No checkpoints yet.'))
      }
      for (const row of collab.checkpoints) {
        const entry = el('div', 'activity-row')
        entry.append(el('span', 'actor', row.name))
        entry.append(el('span', 'status', row.origin))
        entry.append(el('span', 'muted', ` ${row.who} \u00B7 ${row.when}`))
        if (row.summary !== undefined) entry.append(el('div', '', row.summary))
        // CP-5: stated on every row that uses the weakest arm.
        if (row.verifiabilityNote !== undefined) entry.append(el('div', 'warn', row.verifiabilityNote))
        const technical = technicalDetails([row.technical])
        if (technical !== undefined) entry.append(technical)
        body.append(entry)
      }
      break
    }
    case 'CHANGED_FILES': {
      body.append(el('div', 'muted', collab.compare === undefined
        ? 'Open Compare on a Working Line to see which files differ between it and the accepted integration state.'
        : `${String(collab.compare.files.length)} files differ. The inventory is in the comparison above.`))
      break
    }
    case 'EVIDENCE': {
      if (collab.evidence.length === 0) body.append(el('div', 'muted', 'No evidence is bound to this Work Order yet.'))
      for (const entry of collab.evidence) {
        const row = el('div', 'activity-row')
        row.append(el('span', '', entry.label))
        row.append(el('span', 'status', entry.status))
        const technical = technicalDetails(entry.technical === undefined ? [] : [entry.technical])
        if (technical !== undefined) row.append(technical)
        body.append(row)
      }
      if (collab.liveProviderState !== undefined) {
        const live = el('div', 'live')
        live.append(el('h2', '', 'Live provider state'))
        /*
         * §27 — two SEPARATELY TIMESTAMPED facts, never merged. Historical
         * evidence says what was true then; the provider says what is true now.
         */
        if (collab.liveProviderState.recorded !== undefined) {
          live.append(el('div', 'muted', collab.liveProviderState.recorded))
        }
        if (collab.liveProviderState.live !== undefined) {
          live.append(el('div', '', collab.liveProviderState.live))
        }
        if (collab.liveProviderState.unavailableReason !== undefined) {
          live.append(el('div', 'warn', collab.liveProviderState.unavailableReason))
        }
        body.append(live)
      }
      break
    }
    case 'DISCUSSION': {
      body.append(el('div', 'muted', collab.discussionNote))
      break
    }
    case 'ARCHIVED': {
      body.append(el('div', 'muted', collab.archivedCount === 0
        ? 'No Working Lines are archived. Archiving hides a line from the default listing; it is never a deletion and it is always reversible.'
        : `${String(collab.archivedCount)} archived Working Line(s). Archived lines stay fully readable.`))
      break
    }
    default:
      break
  }
  if (openRailSection !== null) panel.append(body)
  return panel
}

/** The read-first Collab view. */
function renderCollab(collab: CollabCodeView): HTMLElement {
  const wrap = el('div')

  const head = el('div', 'panel')
  head.append(el('div', 'stamp', collab.workOrderId))
  if (collab.workOrderTitle !== undefined) head.append(el('div', '', collab.workOrderTitle))
  if (collab.repositories.length > 0) {
    head.append(el('div', 'muted', collab.repositories.join(' \u00B7 ')))
  }
  head.append(el('div', 'muted', `Assembled ${collab.assembledAt}`))
  // §11: the authority stamp, verbatim.
  head.append(el('div', 'stamp muted', `Authority: ${collab.authorityMode} ${collab.authorityModeNote}`.trim()))
  wrap.append(head)

  const body = el('div', 'collab-body')

  const people = el('div', 'panel')
  people.append(el('h2', '', 'Participants'))
  if (collab.participants.length === 0) people.append(el('div', 'muted', 'None recorded.'))
  for (const person of collab.participants) {
    const row = el('div', 'participant-row')
    row.append(el('span', '', person.displayName))
    row.append(el('span', 'status', person.principalKind))
    // §8: never Online, never Editing.
    row.append(el('div', 'muted', person.statusLine))
    for (const label of person.lineLabels) row.append(el('div', 'muted', label))
    /*
     * §38 (BUILD_NOTES D-4): the principal id used to sit inline on this row
     * in the shipping Context panel. It is a raw identifier, so it now lives
     * one disclosure level away, like every other raw id on this surface.
     */
    const technical = technicalDetails(person.technical)
    if (technical !== undefined) row.append(technical)
    people.append(row)
  }
  body.append(people)

  const right = el('div', 'collab-right')
  if (collab.compare !== undefined) {
    right.append(comparePanel(collab.compare))
  } else {
    const linesPanel = el('div', 'panel')
    linesPanel.append(el('h2', '', 'Working Lines'))
    if (collab.lines.length === 0) {
      linesPanel.append(el('div', 'muted', collab.linesEmptyReason ?? 'No Working Lines yet.'))
    }
    collab.lines.forEach((line, index) => { linesPanel.append(lineRow(line, index)) })
    right.append(linesPanel)
  }
  body.append(right)
  wrap.append(body)

  wrap.append(railPanel(collab))
  wrap.append(el('div', 'muted', `Projected ${collab.projectedAt}`))
  return wrap
}

function render(detail: StateDetail): void {
  const previousId = (document.getElementById('work-order-id') as HTMLInputElement | null)?.value
  root!.replaceChildren()
  const collabActive = detail.kind !== 'busy' && detail.kind !== 'error' && detail.activeView === 'COLLAB'
  root!.append(el('h1', '', collabActive ? 'Aera Collab' : 'Aera Work Context'))
  if (detail.kind === 'idle' || detail.kind === 'context') {
    root!.append(viewSwitch(detail.activeView ?? 'CONTEXT'))
  }

  if (detail.kind === 'busy') {
    root!.append(el('div', 'muted', detail.message))
    return
  }
  if (detail.kind === 'error') {
    root!.append(openControls(previousId))
    root!.append(el('div', 'error', `${detail.code}: ${detail.reason}`))
    const back = el('button', '', 'Refresh')
    back.addEventListener('click', () => { act('refresh') })
    root!.append(back)
    return
  }

  if (detail.kind === 'idle') {
    root!.append(el('div', 'muted', collabActive
      ? 'No Work Order is open. Collab is a viewpoint over work that already exists — open a canonical Work Order by its WorkOrderId. Opening never creates one.'
      : 'No WorkContext is open. Open an existing canonical Work Order by its WorkOrderId — opening never creates one.'))
    root!.append(openControls(previousId))
    root!.append(availabilityPanel(detail.availability))
    if (detail.notice !== undefined) root!.append(el('div', 'muted', detail.notice))
    return
  }

  if (collabActive) {
    if (detail.collab === undefined) {
      root!.append(el('div', 'warn', 'The Collab view could not be assembled for this Work Order.'))
      root!.append(availabilityPanel(detail.availability))
      return
    }
    root!.append(renderCollab(detail.collab))
    root!.append(availabilityPanel(detail.availability))
    const collabNotice = el('div', 'muted')
    collabNotice.id = 'notice'
    if (detail.notice !== undefined) collabNotice.textContent = detail.notice
    root!.append(collabNotice)
    return
  }

  const view = detail.view
  const head = el('div', 'panel')
  head.append(el('div', 'stamp', view.workOrderId))
  if (view.workOrderLabel !== undefined) head.append(el('div', '', view.workOrderLabel))
  head.append(el('div', 'muted', `Assembled ${view.assembledAt}`))
  head.append(el('div', 'stamp muted', `Authority: ${view.authorityMode} ${view.authorityModeNote}`.trim()))
  const actions = el('div', 'row')
  const refresh = el('button', '', 'Refresh')
  refresh.addEventListener('click', () => { act('refresh') })
  const closeContext = el('button', '', 'Close context')
  closeContext.id = 'close-context'
  closeContext.addEventListener('click', () => { act('close-context') })
  actions.append(refresh, closeContext)
  head.append(actions)
  root!.append(head)

  const participants = el('div', 'panel')
  participants.append(el('h2', '', 'Participants'))
  if (view.participants.length === 0) participants.append(el('div', 'muted', 'None recorded.'))
  const plist = el('ul')
  for (const participant of view.participants) {
    const item = el('li')
    item.append(el('span', '', `${participant.displayName} `))
    item.append(el('span', 'status', participant.principalKind))
    item.append(el('div', 'muted', participant.statusLine))
    /*
     * §38 (WO-AERA-CODE-COLLAB-READ-FIRST-SURFACE-001, BUILD_NOTES D-4): the
     * raw principal id is an internal identifier and no longer sits on the
     * default row. It remains fully available, one explicit request away, in
     * the same disclosure grammar the rest of this surface uses.
     */
    const pidDisclosure = technicalDetails([participant.principalId])
    if (pidDisclosure !== undefined) item.append(pidDisclosure)
    plist.append(item)
  }
  participants.append(plist)
  root!.append(participants)

  const working = el('div', 'panel')
  working.append(el('h2', '', 'Working state'))
  if (view.workingState !== undefined) {
    const ws = view.workingState
    working.append(el('div', 'stamp', `${ws.repositoryId} @ ${ws.branchRef} ${ws.headRevision.slice(0, 12)} [${ws.dirtyState}]`))
    working.append(el('div', 'muted', ws.localPath))
    working.append(el('div', 'muted', `Observed ${ws.observedAt} — ${ws.note}`))
  } else {
    working.append(el('div', 'warn', view.workingStateUnavailableReason ?? 'Working state unavailable.'))
  }
  root!.append(working)

  const graph = el('div', 'panel')
  graph.append(nodeList('Current canonical state', view.currentCanonicalState))
  graph.append(nodeList('Governing decisions', view.governingDecisions))
  graph.append(nodeList('Evidence', view.evidence))
  graph.append(nodeList('Known residuals', view.knownResiduals))
  root!.append(graph)

  const record = el('div', 'panel')
  record.append(el('h2', '', 'Record progress'))
  const noteRow = el('div', 'row')
  const note = el('textarea')
  note.id = 'progress-note'
  note.placeholder = 'Bounded progress note (1–4000 characters)'
  const noteButton = el('button', '', 'Record note')
  noteButton.id = 'record-note'
  noteButton.addEventListener('click', () => {
    if (note.value.trim() !== '') act('note', { text: note.value })
  })
  noteRow.append(note, noteButton)
  record.append(noteRow)
  const evidenceRow = el('div', 'row')
  const nodeId = el('input')
  nodeId.type = 'text'
  nodeId.id = 'evidence-node-id'
  nodeId.placeholder = 'Existing evidence nodeId'
  const summary = el('input')
  summary.type = 'text'
  summary.id = 'evidence-summary'
  summary.placeholder = 'Reference summary (optional)'
  const evidenceButton = el('button', '', 'Reference evidence')
  evidenceButton.id = 'record-evidence'
  evidenceButton.addEventListener('click', () => {
    if (nodeId.value.trim() !== '') act('evidence', { nodeId: nodeId.value.trim(), summary: summary.value })
  })
  evidenceRow.append(nodeId, summary, evidenceButton)
  record.append(evidenceRow)
  root!.append(record)

  const execution = el('div', 'panel')
  execution.append(el('h2', '', 'Execution'))
  for (const action of view.executionActions) {
    execution.append(el('div', 'warn', `${action.action}: ${action.state} — ${action.reason}`))
  }
  root!.append(execution)

  root!.append(availabilityPanel(detail.availability))
  const notice = el('div', 'muted')
  notice.id = 'notice'
  if (detail.notice !== undefined) notice.textContent = detail.notice
  root!.append(notice)
}

window.addEventListener('aera-work-context-state', (event) => {
  render((event as CustomEvent).detail as StateDetail)
})

render({
  kind: 'idle',
  availability: {
    store: 'Loading…',
    projection: 'Loading…',
    principal: 'Loading…',
  },
})
