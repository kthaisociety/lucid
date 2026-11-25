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
  semester: string // as a deal's, e.g. "HT 2026"
  assignee: Person | null
  postDate: string | null
  channels: Channel[]
  status: GrowthStatus
  notes: string
  sourceDeal: { id: string; company: string } | null // the business deal that made it (docs/adr/0013)
  statusChangedAt: string
  createdAt: string
}

// What a new task or an edit sends; the API rejects any other field.
export type GrowthTaskInput = Partial<
  Pick<GrowthTask, 'title' | 'taskType' | 'semester' | 'postDate' | 'channels' | 'status' | 'notes'> & { assigneeId: string | null }
>

export const typeLabel = (type: GrowthTaskType) => GROWTH_TASK_TYPES.find((t) => t.id === type)?.label ?? type

// Open tasks past their post date are overdue, as in the weekly reminder.
export const isOverdue = (task: GrowthTask, today: string) =>
  task.postDate !== null && task.postDate < today && task.status !== 'posted' && task.status !== 'canceled'

const DAY = 24 * 60 * 60 * 1000
// A task with the same status this long has no movement, as in the weekly reminder.
const STALE_DAYS = 7

const isOpenTask = (t: GrowthTask) => t.status !== 'posted' && t.status !== 'canceled'
export const hasNoMovement = (t: GrowthTask, now = Date.now()) =>
  isOpenTask(t) && now - new Date(t.statusChangedAt).getTime() >= STALE_DAYS * DAY

export type GrowthReport = {
  open: number
  overdue: number
  noMovement: number
  posted: number
  byStatus: { label: string; value: number }[]
  byChannel: { label: string; value: number }[] // posted or scheduled
  byMember: { label: string; value: number }[] // open tasks
  needsFollowUp: GrowthTask[] // open, and overdue or without movement
}

// The growth team's report on a semester's tasks (docs/adr/0012), as the deal log's is on its deals.
export function growthReportFor(tasks: GrowthTask[], today: string, now = Date.now()): GrowthReport {
  const open = tasks.filter(isOpenTask)
  const count = (labels: string[], of: (label: string) => number) =>
    labels.map((label) => ({ label, value: of(label) })).filter((b) => b.value > 0)
  const out = tasks.filter((t) => t.status === 'posted' || t.status === 'scheduled')
  const assignees = [...new Set(open.map((t) => t.assignee?.name ?? 'Unassigned'))].sort()
  return {
    open: open.length,
    overdue: open.filter((t) => isOverdue(t, today)).length,
    noMovement: open.filter((t) => hasNoMovement(t, now)).length,
    posted: tasks.filter((t) => t.status === 'posted').length,
    byStatus: GROWTH_STATUSES.map((s) => ({ label: s.label, value: tasks.filter((t) => t.status === s.id).length })),
    byChannel: count([...CHANNELS], (c) => out.filter((t) => t.channels.includes(c as Channel)).length),
    byMember: count(assignees, (name) => open.filter((t) => (t.assignee?.name ?? 'Unassigned') === name).length),
    needsFollowUp: open.filter((t) => isOverdue(t, today) || hasNoMovement(t, now)),
  }
}
