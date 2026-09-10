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

type StateDetail =
  | { kind: 'idle', availability: Availability, notice?: string }
  | { kind: 'context', availability: Availability, view: ContextView, notice?: string }
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

function render(detail: StateDetail): void {
  const previousId = (document.getElementById('work-order-id') as HTMLInputElement | null)?.value
  root!.replaceChildren()
  root!.append(el('h1', '', 'Aera Work Context'))

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
    root!.append(el('div', 'muted', 'No WorkContext is open. Open an existing canonical Work Order by its WorkOrderId — opening never creates one.'))
    root!.append(openControls(previousId))
    root!.append(availabilityPanel(detail.availability))
    if (detail.notice !== undefined) root!.append(el('div', 'muted', detail.notice))
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
    const pid = el('div', 'muted', participant.principalId)
    pid.style.fontSize = '11px'
    item.append(pid)
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
