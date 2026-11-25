// The growth team's board (docs/adr/0012): its tasks, shaped as the API returns them
// (internal/deals/growth.go).
import type { Person } from './deals'

export type GrowthStatus = 'backlog' | 'draft' | 'quality_check' | 'scheduled' | 'posted' | 'canceled'

export const GROWTH_STATUSES: { id: GrowthStatus; label: string; color: string }[] = [
  { id: 'backlog', label: 'Backlog', color: 'bg-slate-400' },
  { id: 'draft', label: 'Draft', color: 'bg-sky-500' },
  { id: 'quality_check', label: 'Quality check', color: 'bg-amber-500' },
  { id: 'scheduled', label: 'Scheduled', color: 'bg-violet-500' },
  { id: 'posted', label: 'Posted', color: 'bg-emerald-500' },
  { id: 'canceled', label: 'Canceled', color: 'bg-rose-400' },
]

export type GrowthTaskType = 'event_post' | 'partnership_post' | 'job_post' | 'content' | 'project'

export const GROWTH_TASK_TYPES: { id: GrowthTaskType; label: string }[] = [
  { id: 'event_post', label: 'Event post' },
  { id: 'partnership_post', label: 'Partnership post' },
  { id: 'job_post', label: 'Job post' },
  { id: 'content', label: 'Content' },
  { id: 'project', label: 'Project' },
]

export const CHANNELS = ['LinkedIn', 'Instagram', 'Facebook', 'TikTok', 'Newsletter', 'Website'] as const
export type Channel = (typeof CHANNELS)[number]

export type GrowthTask = {
  id: string
  title: string
  taskType: GrowthTaskType
  assignee: Person | null
  postDate: string | null
  channels: Channel[]
  status: GrowthStatus
  notes: string
  statusChangedAt: string
  createdAt: string
}

// What a new task or an edit sends; the API rejects any other field.
export type GrowthTaskInput = Partial<
  Pick<GrowthTask, 'title' | 'taskType' | 'postDate' | 'channels' | 'status' | 'notes'> & { assigneeId: string | null }
>

export const typeLabel = (type: GrowthTaskType) => GROWTH_TASK_TYPES.find((t) => t.id === type)?.label ?? type

// Open tasks past their post date are overdue, as in the weekly reminder.
export const isOverdue = (task: GrowthTask, today: string) =>
  task.postDate !== null && task.postDate < today && task.status !== 'posted' && task.status !== 'canceled'
