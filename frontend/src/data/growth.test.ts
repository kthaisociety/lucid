import { expect, test } from 'vitest'
import { growthReportFor, type GrowthTask } from './growth'

const now = new Date('2026-11-25T12:00:00Z').getTime()
const task = (fields: Partial<GrowthTask>): GrowthTask => ({
  id: Math.random().toString(),
  title: 'Post',
  taskType: 'event_post',
  semester: 'HT 2026',
  assignee: { id: 'm-kim', name: 'Kim Ek', email: 'kim@example.com' },
  postDate: null,
  channels: [],
  status: 'backlog',
  notes: '',
  statusChangedAt: '2026-11-24T10:00:00Z',
  createdAt: '2026-11-01T10:00:00Z',
  ...fields,
})

test('the growth report counts open, overdue, stale and posted tasks', () => {
  const overdue = task({ postDate: '2026-11-20', status: 'draft', channels: ['LinkedIn'] })
  const stale = task({ statusChangedAt: '2026-11-10T10:00:00Z', assignee: null })
  const report = growthReportFor(
    [
      overdue,
      stale,
      task({ status: 'posted', postDate: '2026-11-15', channels: ['LinkedIn', 'Instagram'] }),
      task({ status: 'posted', postDate: '2026-09-01', channels: ['Instagram'] }),
      task({ status: 'scheduled', postDate: '2026-12-01', channels: ['Instagram'] }),
      task({ status: 'canceled', postDate: '2026-11-01' }), // not overdue: canceled
    ],
    '2026-11-25',
    now,
  )
  expect(report).toMatchObject({ open: 3, overdue: 1, noMovement: 1, posted: 2 })
  expect(report.byChannel).toEqual([
    { label: 'LinkedIn', value: 1 },
    { label: 'Instagram', value: 3 },
  ])
  expect(report.byMember).toEqual([
    { label: 'Kim Ek', value: 2 },
    { label: 'Unassigned', value: 1 },
  ])
  expect(report.needsFollowUp).toEqual([overdue, stale])
})
