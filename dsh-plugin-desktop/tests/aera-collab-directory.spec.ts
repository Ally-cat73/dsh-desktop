/**
 * Collab directory tests — WO-AERA-CODE-COLLAB-READ-FIRST-SURFACE-001.
 *
 * The picker exists so a person never has to know a WorkOrderId. These tests
 * hold it to that: a partial title, a partial id and a repository name each
 * find the work, an empty query shows what is actually live, and a miss says
 * so in words instead of showing a blank list that reads as "broken".
 */
import { describe, expect, it } from 'vitest'
import {
  COLLAB_DIRECTORY_MAX_ROWS,
  projectCollabDirectory,
  type CollabDirectorySource,
} from '../src/aera-collab-directory.ts'

interface Row {
  readonly workOrderId: string
  readonly title: string
  readonly lifecycleState: string
  readonly authorityClass?: string
  readonly repositories?: readonly (readonly [string, string])[]
  readonly activityAt?: string
}

function source(rows: readonly Row[]): CollabDirectorySource {
  return {
    listWorkOrders: () => rows.map(row => ({ workOrderId: row.workOrderId, title: row.title })),
    effectiveWorkOrderState: (workOrderId) => {
      const row = rows.find(entry => entry.workOrderId === workOrderId)
      return row === undefined
        ? undefined
        : { lifecycleState: row.lifecycleState, authorityClass: row.authorityClass ?? 'OWNER_SUPPLIED' }
    },
    listRepositoryBindings: () => rows.flatMap(row =>
      (row.repositories ?? []).map(([repositoryId, role]) => ({
        workOrderId: row.workOrderId,
        repositoryId,
        role,
      }))),
    lastMeaningfulActivityAt: (workOrderId) =>
      rows.find(entry => entry.workOrderId === workOrderId)?.activityAt,
  }
}

const FIXTURE = source([
  {
    workOrderId: 'WO-AERA-CODE-COLLAB-READ-FIRST-SURFACE-001',
    title: 'AERA CODE COLLAB READ-FIRST SURFACE V1',
    lifecycleState: 'ACTIVE',
    repositories: [['aera-repo:aera-stack', 'PRIMARY'], ['aera-repo:dsh-desktop', 'AFFECTED']],
    activityAt: '2026-09-17T20:00:00.000Z',
  },
  {
    workOrderId: 'WO-AERA-CODE-EDITOR-ENGINE-RESOURCE-BENCHMARK-001',
    title: 'CODEMIRROR 6 VS MONACO RESOURCE COST',
    lifecycleState: 'ACTIVE',
    activityAt: '2026-09-17T12:00:00.000Z',
  },
  {
    workOrderId: 'WO-AERA-COLLAB-STABLE-REPOSITORY-RESOURCE-IDENTITY-001',
    title: 'STABLE REPOSITORY RESOURCE IDENTITY',
    lifecycleState: 'SUPERSEDED',
    repositories: [['aera-repo:aera-stack', 'PRIMARY']],
    activityAt: '2026-09-16T10:00:00.000Z',
  },
])

describe('Collab directory', () => {
  it('lists work that is actually in progress when nothing is typed', () => {
    const view = projectCollabDirectory(FIXTURE)

    expect(view.listing).toBe('ACTIVE')
    expect(view.rows.map(row => row.workOrderId)).toEqual([
      'WO-AERA-CODE-COLLAB-READ-FIRST-SURFACE-001',
      'WO-AERA-CODE-EDITOR-ENGINE-RESOURCE-BENCHMARK-001',
    ])
    // Recorded activity orders the list; a SUPERSEDED order is not "in progress".
    expect(view.totalWorkOrders).toBe(3)
  })

  it('finds this order from a fragment of its id', () => {
    const view = projectCollabDirectory(FIXTURE, { query: 'read-first' })

    expect(view.listing).toBe('MATCHES')
    expect(view.rows.map(row => row.workOrderId))
      .toEqual(['WO-AERA-CODE-COLLAB-READ-FIRST-SURFACE-001'])
    expect(view.rows[0]?.matchedOn).toEqual(['ID', 'TITLE'])
    expect(view.rows[0]?.primaryRepositoryId).toBe('aera-repo:aera-stack')
  })

  it('finds work by repository, including orders that are no longer active', () => {
    const view = projectCollabDirectory(FIXTURE, { query: 'aera-stack' })

    expect(view.rows.map(row => row.workOrderId)).toEqual([
      'WO-AERA-CODE-COLLAB-READ-FIRST-SURFACE-001',
      'WO-AERA-COLLAB-STABLE-REPOSITORY-RESOURCE-IDENTITY-001',
    ])
    expect(view.rows.every(row => row.matchedOn.includes('REPOSITORY'))).toBe(true)
  })

  it('matches a title fragment without regard to case', () => {
    expect(projectCollabDirectory(FIXTURE, { query: 'codemirror' }).rows.map(row => row.workOrderId))
      .toEqual(['WO-AERA-CODE-EDITOR-ENGINE-RESOURCE-BENCHMARK-001'])
  })

  it('says why a search found nothing instead of showing a bare empty list', () => {
    const view = projectCollabDirectory(FIXTURE, { query: 'nothing-matches-this' })

    expect(view.rows).toEqual([])
    expect(view.emptyReason).toContain('Nothing matches')
    expect(view.emptyReason).toContain('3 Work Orders are recorded')
  })

  it('says so when no work is in progress rather than looking broken', () => {
    const view = projectCollabDirectory(source([
      { workOrderId: 'WO-DONE-001', title: 'Finished', lifecycleState: 'COMPLETED' },
    ]))

    expect(view.rows).toEqual([])
    expect(view.emptyReason).toContain('No Work Order is currently ACTIVE')
  })

  it('never hands a picker an unbounded list, and says when it cut one', () => {
    const many = Array.from({ length: COLLAB_DIRECTORY_MAX_ROWS + 5 }, (_, index) => ({
      workOrderId: `WO-BULK-${String(index).padStart(3, '0')}`,
      title: 'Bulk',
      lifecycleState: 'ACTIVE',
    }))
    const view = projectCollabDirectory(source(many))

    expect(view.rows).toHaveLength(COLLAB_DIRECTORY_MAX_ROWS)
    expect(view.truncated).toBe(true)
  })

  it('orders deterministically when nothing has recorded activity', () => {
    const rows = source([
      { workOrderId: 'WO-B', title: 'b', lifecycleState: 'ACTIVE' },
      { workOrderId: 'WO-A', title: 'a', lifecycleState: 'ACTIVE' },
    ])

    expect(projectCollabDirectory(rows).rows.map(row => row.workOrderId)).toEqual(['WO-A', 'WO-B'])
    // The same query twice is the same answer: no ranking model, no clock.
    expect(projectCollabDirectory(rows)).toEqual(projectCollabDirectory(rows))
  })

  it('carries no exactPayload into the renderer', () => {
    const view = projectCollabDirectory(FIXTURE, { query: 'read-first' })

    for (const row of view.rows) {
      expect(Object.keys(row).sort()).toEqual([
        'authorityClass', 'lastActivityAt', 'lifecycleState', 'matchedOn',
        'primaryRepositoryId', 'repositoryIds', 'title', 'workOrderId',
      ])
    }
  })
})
