import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { Deal } from '../../data/deals'
import type { GrowthTask } from '../../data/growth'
import GrowthPage from './GrowthPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const kim = { id: 'm-kim', name: 'Kim Ek', email: 'kim@example.com', team: 'growth' as const }
const task = (fields: Partial<GrowthTask>): GrowthTask => ({
  id: 't-1',
  title: 'Hackathon post',
  taskType: 'event_post',
  semester: 'HT 2026',
  assignee: kim,
  postDate: null,
  channels: [],
  status: 'backlog',
  notes: '',
  sourceDeal: null,
  statusChangedAt: '2020-01-01T10:00:00Z',
  createdAt: '2020-01-01T10:00:00Z',
  ...fields,
})

// The server: a new task comes back as sent.
function stubFetch() {
  const posted: unknown[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_path: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      posted.push(body)
      return Response.json(task({ id: 't-new', ...body, assignee: null }), { status: 201 })
    }),
  )
  return posted
}

// The page with its tasks kept as the app keeps them.
function Board({ initial, query = '', creating = false, onCreated = () => {} }: { initial: GrowthTask[]; query?: string; creating?: boolean; onCreated?: () => void }) {
  const [tasks, setTasks] = useState(initial)
  return (
    <GrowthPage
      tasks={tasks}
      onTasks={(change) => setTasks(change)}
      onOpenDeal={() => {}}
      deals={[]}
      members={[kim]}
      meId={kim.id}
      query={query}
      semester="HT 2026"
      creating={creating}
      onCreated={onCreated}
    />
  )
}

test('the semester’s tasks show in their status column, overdue ones marked', () => {
  render(
    <Board
      initial={[
        task({ postDate: '2020-01-01', channels: ['LinkedIn'] }),
        task({ id: 't-2', title: 'Recap series', taskType: 'content', status: 'draft', assignee: null }),
        task({ id: 't-3', title: 'Dropped', status: 'canceled' }),
        task({ id: 't-4', title: 'Spring post', semester: 'VT 2027' }),
      ]}
    />,
  )

  const backlog = screen.getByRole('region', { name: 'Backlog' })
  expect(within(backlog).getByText('Hackathon post')).toBeTruthy()
  expect(within(backlog).getByText(/overdue/)).toBeTruthy()
  expect(within(backlog).getByText('LinkedIn')).toBeTruthy()
  expect(within(screen.getByRole('region', { name: 'Draft' })).getByText('Recap series')).toBeTruthy()
  expect(screen.queryByText('Spring post')).toBeNull()
  // Canceled tasks show only on request.
  expect(screen.queryByText('Dropped')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Show canceled' }))
  expect(screen.getByText('Dropped')).toBeTruthy()
})

test('a new task is assigned to you, in the semester shown, and lands in Backlog', async () => {
  const posted = stubFetch()
  let created = false
  render(<Board initial={[]} creating onCreated={() => (created = true)} />)

  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Job post for Granit' } })
  fireEvent.click(screen.getByLabelText('Instagram'))
  fireEvent.click(screen.getByRole('button', { name: 'Add task' }))

  expect(await within(screen.getByRole('region', { name: 'Backlog' })).findByText('Job post for Granit')).toBeTruthy()
  expect(posted[0]).toMatchObject({ title: 'Job post for Granit', semester: 'HT 2026', assigneeId: kim.id, channels: ['Instagram'], status: 'backlog' })
  expect(created).toBe(true)
})

test('the filters, search and list work as on the pipeline', () => {
  const initial = [
    task({ postDate: '2020-01-01', statusChangedAt: new Date().toISOString() }),
    task({ id: 't-2', title: 'Recap series', taskType: 'content', status: 'draft', assignee: null, statusChangedAt: new Date().toISOString() }),
  ]
  const { rerender } = render(<Board initial={initial} />)

  fireEvent.click(screen.getByRole('button', { name: 'Content' }))
  expect(screen.queryByText('Hackathon post')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'All types' }))
  fireEvent.click(screen.getByRole('button', { name: 'Needs follow-up' }))
  expect(screen.queryByText('Recap series')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Needs follow-up' }))
  fireEvent.click(screen.getByRole('button', { name: 'Unassigned' }))
  expect(screen.queryByText('Hackathon post')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Unassigned' }))

  rerender(<Board initial={initial} query="recap" />)
  expect(screen.getByRole('status')).toHaveTextContent('1 task matching “recap”')

  fireEvent.click(screen.getByRole('button', { name: 'List' }))
  const rows = screen.getAllByRole('row')
  expect(rows).toHaveLength(2)
  expect(within(rows[1]).getByText('Draft')).toBeTruthy()
})

test('a card made from an event suggests post dates around it', () => {
  const start = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const event = { id: 'd-1', dealType: 'Event', startDate: start, endDate: null } as unknown as Deal
  render(
    <GrowthPage
      tasks={[task({ sourceDeal: { id: 'd-1', company: 'Nordljus AB' } })]}
      onTasks={() => {}}
      onOpenDeal={() => {}}
      deals={[event]}
      openTaskId="t-1"
      members={[kim]}
      meId={kim.id}
      query=""
      semester="HT 2026"
      creating={false}
      onCreated={() => {}}
    />,
  )
  const dialog = screen.getByRole('dialog', { name: 'Edit task' })
  expect(within(dialog).getByText('Nordljus AB')).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: /^Announcement/ }))
  expect((within(dialog).getByLabelText('Post date') as HTMLInputElement).value).toBe(
    new Date(Date.parse(`${start}T00:00:00Z`) - 21 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  )
})
