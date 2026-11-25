import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
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
  assignee: kim,
  postDate: null,
  channels: [],
  status: 'backlog',
  notes: '',
  statusChangedAt: '2026-11-01T10:00:00Z',
  createdAt: '2026-11-01T10:00:00Z',
  ...fields,
})

function stubFetch(tasks: GrowthTask[]) {
  const posted: unknown[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body))
        posted.push(body)
        return Response.json(task({ id: 't-new', ...body, assignee: null }), { status: 201 })
      }
      return Response.json(path === '/api/growth/tasks' ? tasks : [])
    }),
  )
  return posted
}

test('tasks show in their status column, overdue ones marked', async () => {
  stubFetch([
    task({ postDate: '2020-01-01', channels: ['LinkedIn'] }),
    task({ id: 't-2', title: 'Recap series', taskType: 'content', status: 'draft', assignee: null }),
    task({ id: 't-3', title: 'Dropped', status: 'canceled' }),
  ])
  render(<GrowthPage members={[kim]} meId={kim.id} />)

  const backlog = await screen.findByRole('region', { name: 'Backlog' })
  expect(within(backlog).getByText('Hackathon post')).toBeTruthy()
  expect(within(backlog).getByText(/overdue/)).toBeTruthy()
  expect(within(backlog).getByText('LinkedIn')).toBeTruthy()
  expect(within(screen.getByRole('region', { name: 'Draft' })).getByText('Recap series')).toBeTruthy()
  // Canceled tasks show only on request.
  expect(screen.queryByText('Dropped')).toBeNull()
  fireEvent.click(screen.getByLabelText('Canceled'))
  expect(screen.getByText('Dropped')).toBeTruthy()
})

test('a new task is assigned to you and lands in Backlog', async () => {
  const posted = stubFetch([])
  render(<GrowthPage members={[kim]} meId={kim.id} />)

  fireEvent.click(await screen.findByRole('button', { name: /New task/ }))
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Job post for Granit' } })
  fireEvent.click(screen.getByLabelText('Instagram'))
  fireEvent.click(screen.getByRole('button', { name: 'Add task' }))

  expect(await within(screen.getByRole('region', { name: 'Backlog' })).findByText('Job post for Granit')).toBeTruthy()
  expect(posted[0]).toMatchObject({ title: 'Job post for Granit', assigneeId: kim.id, channels: ['Instagram'], status: 'backlog' })
})
