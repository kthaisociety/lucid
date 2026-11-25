import { expect, test } from 'vitest'
import { growthReportFor, postsByDay, suggestedPostDates, type GrowthTask } from './growth'

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
  sourceDeal: null,
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

test('posts go on their post date; canceled ones and undated tasks stay off the calendar', () => {
  const a = task({ id: 'a', postDate: '2026-12-01' })
  const b = task({ id: 'b', postDate: '2026-12-01', status: 'posted' })
  const days = postsByDay([a, b, task({ id: 'c', postDate: '2026-12-01', status: 'canceled' }), task({ id: 'd' })])
  expect([...days.keys()]).toEqual(['2026-12-01'])
  expect(days.get('2026-12-01')).toEqual([a, b])
})

test('post dates are suggested around an event, only those still ahead', () => {
  expect(suggestedPostDates('2026-12-20', '2026-12-21', '2026-11-25')).toEqual([
    { label: 'Announcement', date: '2026-11-29' },
    { label: 'Reminder', date: '2026-12-13' },
    { label: 'Last call', date: '2026-12-18' },
    { label: 'Recap', date: '2026-12-23' },
  ])
  expect(suggestedPostDates('2026-12-01', null, '2026-11-25').map((s) => s.label)).toEqual(['Last call', 'Recap'])
})
