import { useState, type DragEvent } from 'react'
import { createGrowthTask, deleteGrowthTask, updateGrowthTask } from '../../api'
import { semesterOptions, today, type Person } from '../../data/deals'
import {
  CHANNELS,
  GROWTH_STATUSES,
  GROWTH_TASK_TYPES,
  hasNoMovement,
  isOverdue,
  typeLabel,
  type GrowthStatus,
  type GrowthTask,
  type GrowthTaskInput,
  type GrowthTaskType,
} from '../../data/growth'
import { formatDate, messageOf } from '../../format'
import FormDialog, { inputClass } from '../dialogs/FormDialog'
import { chip } from '../chip'
import OwnerAvatar from '../OwnerAvatar'
import ViewToggle, { type View } from '../ViewToggle'
import { cell, headCell, table } from './common'

// Its own drag type, so a deal card can't be dropped on this board.
const TASK_DRAG_TYPE = 'application/x-lucid-growth-task'

type Props = {
  // Every semester's tasks, which the app loads with the deals; onTasks changes them.
  tasks: GrowthTask[]
  onTasks: (change: (tasks: GrowthTask[]) => GrowthTask[]) => void
  onOpenDeal: (id: string) => void // a card's business deal (docs/adr/0013)
  members: Person[]
  meId?: string
  query: string // the header's search
  semester: string // the header's, as on the pipeline; a new task is in it
  // New task, from the header: the dialog shows until onCreated.
  creating: boolean
  onCreated: () => void
}

const matches = (task: GrowthTask, query: string) => {
  const q = query.trim().toLowerCase()
  return !q || [task.title, task.notes, task.assignee?.name ?? '', ...task.channels].some((text) => text.toLowerCase().includes(q))
}

// The growth team's board (docs/adr/0012): one semester's tasks, with the pipeline's filter bar.
export default function GrowthPage({ tasks, onTasks, onOpenDeal, members, meId, query, semester, creating, onCreated }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<GrowthTask | null>(null)
  const [view, setView] = useState<View>('board')
  const [taskType, setTaskType] = useState<GrowthTaskType | 'all'>('all')
  const [assignee, setAssignee] = useState<'anyone' | 'mine' | 'unassigned'>('anyone')
  const [followUpOnly, setFollowUpOnly] = useState(false)
  const [showCanceled, setShowCanceled] = useState(false)

  const put = (task: GrowthTask) =>
    onTasks((ts) => (ts.some((t) => t.id === task.id) ? ts.map((t) => (t.id === task.id ? task : t)) : [...ts, task]))

  // A drag moves the card at once; if the save fails it goes back, with the reason.
  const move = (task: GrowthTask, status: GrowthStatus) => {
    setError(null)
    put({ ...task, status })
    updateGrowthTask(task.id, { status })
      .then(put)
      .catch((err: unknown) => {
        put(task)
        setError(`Couldn't move ${task.title}: ${messageOf(err)}`)
      })
  }

  const day = today()
  const shown = tasks.filter(
    (t) =>
      matches(t, query) &&
      t.semester === semester &&
      (taskType === 'all' || t.taskType === taskType) &&
      (assignee === 'anyone' || (assignee === 'mine' ? t.assignee?.id === meId : t.assignee === null)) &&
      (!followUpOnly || isOverdue(t, day) || hasNoMovement(t)) &&
      (showCanceled || t.status !== 'canceled'),
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        role="toolbar"
        aria-label="Filters"
        className="flex items-center gap-1.5 overflow-x-auto px-4 pt-4 pb-3 whitespace-nowrap md:flex-wrap md:px-6 [&>*]:shrink-0"
      >
        <ViewToggle view={view} onChange={setView} />
        {[{ id: 'all' as const, label: 'All types' }, ...GROWTH_TASK_TYPES].map((t) => (
          <button key={t.id} type="button" aria-pressed={taskType === t.id} onClick={() => setTaskType(t.id)} className={chip(taskType === t.id)}>
            {t.label}
          </button>
        ))}
        <span className="mx-1.5 h-4 w-px bg-gray-200" />
        {meId && (
          <button
            type="button"
            aria-pressed={assignee === 'mine'}
            onClick={() => setAssignee(assignee === 'mine' ? 'anyone' : 'mine')}
            className={chip(assignee === 'mine')}
          >
            On me
          </button>
        )}
        <button
          type="button"
          aria-pressed={assignee === 'unassigned'}
          onClick={() => setAssignee(assignee === 'unassigned' ? 'anyone' : 'unassigned')}
          className={chip(assignee === 'unassigned')}
        >
          Unassigned
        </button>
        <button type="button" aria-pressed={followUpOnly} onClick={() => setFollowUpOnly((on) => !on)} className={chip(followUpOnly)}>
          Needs follow-up
        </button>
        <button type="button" aria-pressed={showCanceled} onClick={() => setShowCanceled((on) => !on)} className={chip(showCanceled)}>
          Show canceled
        </button>
      </div>
      {query.trim() && (
        <p role="status" className="mx-4 mb-3 text-xs text-gray-600 md:mx-6">
          {shown.length === 0 ? 'No tasks' : `${shown.length} ${shown.length === 1 ? 'task' : 'tasks'}`} matching “{query.trim()}”
        </p>
      )}
      {error && (
        <p role="alert" className="mx-4 mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 md:mx-6">
          {error}
        </p>
      )}
      {view === 'list' ? (
        <TaskTable tasks={shown} today={day} onOpen={setEditing} />
      ) : (
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 pb-6 md:px-6">
          {GROWTH_STATUSES.filter((s) => showCanceled || s.id !== 'canceled').map((status) => (
            <Column
              key={status.id}
              label={status.label}
              color={status.color}
              tasks={shown.filter((t) => t.status === status.id)}
              today={day}
              onOpen={setEditing}
              onDrop={(id) => {
                const task = tasks.find((t) => t.id === id)
                if (task && task.status !== status.id) move(task, status.id)
              }}
            />
          ))}
        </div>
      )}
      {creating && (
        <TaskDialog
          task={null}
          semester={semester}
          members={members}
          meId={meId}
          onSave={async (input) => {
            put(await createGrowthTask(input))
            onCreated()
          }}
          onClose={onCreated}
        />
      )}
      {editing && (
        <TaskDialog
          task={editing}
          semester={editing.semester}
          onOpenDeal={(id) => {
            setEditing(null)
            onOpenDeal(id)
          }}
          members={members}
          meId={meId}
          onSave={async (input) => {
            put(await updateGrowthTask(editing.id, input))
            setEditing(null)
          }}
          onDelete={async () => {
            await deleteGrowthTask(editing.id)
            onTasks((ts) => ts.filter((t) => t.id !== editing.id))
            setEditing(null)
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function Column({
  label,
  color,
  tasks,
  today,
  onOpen,
  onDrop,
}: {
  label: string
  color: string
  tasks: GrowthTask[]
  today: string
  onOpen: (task: GrowthTask) => void
  onDrop: (id: string) => void
}) {
  const [over, setOver] = useState(false)
  const carries = (e: DragEvent) => e.dataTransfer.types.includes(TASK_DRAG_TYPE)
  return (
    <section
      aria-label={label}
      onDragOver={(e) => {
        if (!carries(e)) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
      }}
      onDrop={(e) => {
        setOver(false)
        if (!carries(e)) return
        e.preventDefault()
        onDrop(e.dataTransfer.getData(TASK_DRAG_TYPE))
      }}
      className={`flex w-64 shrink-0 flex-col rounded-xl p-2 transition-colors md:w-auto md:min-w-48 md:flex-1 md:basis-0 ${
        over ? 'bg-indigo-50 ring-2 ring-indigo-200' : 'bg-gray-100/70'
      }`}
    >
      <header className="flex items-center gap-2 px-1.5 pt-1 pb-2.5">
        <span className={`h-2 w-2 rounded-full ${color}`} aria-hidden />
        <h2 className="font-display text-xs font-bold text-gray-700">{label}</h2>
        <span className="rounded-full bg-surface px-1.5 text-[11px] font-semibold text-gray-500">{tasks.length}</span>
      </header>
      <div className="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto">
        {tasks.map((task) => (
          <button
            key={task.id}
            type="button"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(TASK_DRAG_TYPE, task.id)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onClick={() => onOpen(task)}
            className="w-full cursor-grab rounded-lg border border-gray-200 bg-surface p-3 text-left shadow-sm hover:border-indigo-200 hover:shadow focus-visible:outline-2 focus-visible:outline-indigo-500"
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-semibold text-gray-900">{task.title}</h3>
              {task.assignee ? (
                <OwnerAvatar owner={task.assignee} />
              ) : (
                <span className="rounded-full border border-dashed border-gray-300 px-1.5 py-0.5 text-[10px] text-gray-400">Unassigned</span>
              )}
            </div>
            <p className="mt-0.5 text-[11px] text-gray-500">
              {typeLabel(task.taskType)}
              {task.postDate && (
                <span className={isOverdue(task, today) ? 'font-semibold text-red-600' : ''}>
                  {' · '}
                  {formatDate(task.postDate)}
                  {isOverdue(task, today) && ' (overdue)'}
                </span>
              )}
            </p>
            {task.sourceDeal && <p className="mt-1 text-[11px] text-gray-500">From {task.sourceDeal.company}</p>}
            {task.channels.length > 0 && (
              <p className="mt-2 flex flex-wrap gap-1">
                {task.channels.map((c) => (
                  <span key={c} className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                    {c}
                  </span>
                ))}
              </p>
            )}
          </button>
        ))}
        {tasks.length === 0 && (
          <p className="rounded-lg border border-dashed border-gray-300 py-6 text-center text-[11px] text-gray-400">{over ? 'Drop here' : 'No tasks'}</p>
        )}
      </div>
    </section>
  )
}

const statusOrder = (t: GrowthTask) => GROWTH_STATUSES.findIndex((s) => s.id === t.status)

// The board as a table, like the pipeline's list: in status order, then by post date.
function TaskTable({ tasks, today, onOpen }: { tasks: GrowthTask[]; today: string; onOpen: (task: GrowthTask) => void }) {
  const rows = [...tasks].sort((a, b) => statusOrder(a) - statusOrder(b) || (a.postDate ?? '9999').localeCompare(b.postDate ?? '9999'))
  return (
    <div className="min-h-0 flex-1 overflow-auto px-6 pb-6">
      <table className={table}>
        <thead className="bg-gray-50 text-[11px] text-gray-500">
          <tr>
            {['Title', 'Type', 'Status', 'Assignee', 'Post date', 'Channels'].map((h) => (
              <th key={h} className={headCell}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} className="cursor-pointer align-top hover:bg-gray-50" onClick={() => onOpen(t)}>
              <td className={cell}>
                <button type="button" onClick={() => onOpen(t)} className="font-semibold text-gray-900 hover:text-indigo-700">
                  {t.title}
                </button>
              </td>
              <td className={`${cell} text-gray-500`}>{typeLabel(t.taskType)}</td>
              <td className={cell}>{GROWTH_STATUSES[statusOrder(t)].label}</td>
              <td className={cell}>{t.assignee?.name ?? '—'}</td>
              <td className={`${cell} whitespace-nowrap ${isOverdue(t, today) ? 'font-semibold text-red-600' : 'text-gray-500'}`}>
                {t.postDate ? formatDate(t.postDate) : '—'}
                {isOverdue(t, today) && ' (overdue)'}
              </td>
              <td className={`${cell} text-gray-500`}>{t.channels.join(', ') || '—'}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-8 text-center text-gray-400">
                No tasks
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function TaskDialog({
  task,
  onOpenDeal,
  semester: initialSemester,
  members,
  meId,
  onSave,
  onDelete,
  onClose,
}: {
  task: GrowthTask | null
  onOpenDeal?: (id: string) => void
  semester: string
  members: Person[]
  meId?: string
  onSave: (input: GrowthTaskInput) => Promise<void>
  onDelete?: () => Promise<void>
  onClose: () => void
}) {
  const [title, setTitle] = useState(task?.title ?? '')
  const [taskType, setTaskType] = useState(task?.taskType ?? 'event_post')
  const [semester, setSemester] = useState(initialSemester)
  const [assigneeId, setAssigneeId] = useState(task ? (task.assignee?.id ?? '') : (meId ?? ''))
  const [postDate, setPostDate] = useState(task?.postDate ?? '')
  const [channels, setChannels] = useState(task?.channels ?? [])
  const [status, setStatus] = useState(task?.status ?? 'backlog')
  const [notes, setNotes] = useState(task?.notes ?? '')
  // Growth members first: they're who the board is for.
  const people = [...members].sort((a, b) => Number(b.team === 'growth') - Number(a.team === 'growth'))

  return (
    <FormDialog
      title={task ? 'Edit task' : 'New task'}
      submitLabel={task ? 'Save' : 'Add task'}
      onSubmit={() =>
        onSave({ title: title.trim(), taskType, semester, assigneeId: assigneeId || null, postDate: postDate || null, channels, status, notes })
      }
      onDelete={onDelete}
      deleteWhat="task"
      onClose={onClose}
    >
      {task?.sourceDeal && (
        <p className="text-xs font-normal">
          From the business deal{' '}
          <button type="button" onClick={() => onOpenDeal?.(task.sourceDeal!.id)} className="font-semibold text-indigo-700 hover:underline">
            {task.sourceDeal.company}
          </button>
        </p>
      )}
      <label className="block">
        Title
        <input required data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          Type
          <select value={taskType} onChange={(e) => setTaskType(e.target.value as typeof taskType)} className={inputClass}>
            {GROWTH_TASK_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          Semester
          <select value={semester} onChange={(e) => setSemester(e.target.value)} className={inputClass}>
            {semesterOptions(semester).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="block">
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as GrowthStatus)} className={inputClass}>
            {GROWTH_STATUSES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          Assignee
          <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={inputClass}>
            <option value="">No one yet</option>
            {people.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          Post date
          <input type="date" value={postDate} onChange={(e) => setPostDate(e.target.value)} className={inputClass} />
        </label>
      </div>
      <fieldset>
        <legend>Channels</legend>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          {CHANNELS.map((c) => (
            <label key={c} className="flex items-center gap-1 font-normal">
              <input
                type="checkbox"
                checked={channels.includes(c)}
                onChange={(e) => setChannels(e.target.checked ? [...channels, c] : channels.filter((x) => x !== c))}
              />
              {c}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block">
        Notes and links
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
      </label>
    </FormDialog>
  )
}
