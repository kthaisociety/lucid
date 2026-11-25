import { useEffect, useState, type DragEvent } from 'react'
import { createGrowthTask, deleteGrowthTask, fetchGrowthTasks, updateGrowthTask } from '../../api'
import { today, type Person } from '../../data/deals'
import {
  CHANNELS,
  GROWTH_STATUSES,
  GROWTH_TASK_TYPES,
  isOverdue,
  typeLabel,
  type GrowthStatus,
  type GrowthTask,
  type GrowthTaskInput,
} from '../../data/growth'
import { formatDate, messageOf } from '../../format'
import FormDialog, { inputClass } from '../dialogs/FormDialog'
import OwnerAvatar from '../OwnerAvatar'
import { AddButton, PageTitle } from './common'

// Its own drag type, so a deal card can't be dropped on this board.
const TASK_DRAG_TYPE = 'application/x-lucid-growth-task'

type Props = { members: Person[]; meId?: string }

// The growth team's board (docs/adr/0012). It loads its own tasks: the deal log doesn't need them.
export default function GrowthPage({ members, meId }: Props) {
  const [tasks, setTasks] = useState<GrowthTask[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<GrowthTask | 'new' | null>(null)
  const [showCanceled, setShowCanceled] = useState(false)
  const [onMe, setOnMe] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetchGrowthTasks(controller.signal)
      .then(setTasks)
      .catch((err: unknown) => controller.signal.aborted || setError(`Couldn't load the board: ${messageOf(err)}`))
    return () => controller.abort()
  }, [])

  const put = (task: GrowthTask) =>
    setTasks((ts) => (ts?.some((t) => t.id === task.id) ? ts.map((t) => (t.id === task.id ? task : t)) : [...(ts ?? []), task]))

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

  if (tasks === null) return <p className="m-6 text-sm text-gray-500">{error ?? 'Loading the board…'}</p>
  const shown = onMe ? tasks.filter((t) => t.assignee?.id === meId) : tasks
  const day = today()

  return (
    <div className="flex min-h-0 flex-1 flex-col pt-4">
      <div className="flex items-start justify-between gap-3 px-4 md:px-6">
        <PageTitle title="Growth" subtitle="The growth team's posts, content and projects. Each growth member gets a reminder by email on Mondays." />
        <div className="flex shrink-0 items-center gap-3 text-xs text-gray-600">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={onMe} onChange={(e) => setOnMe(e.target.checked)} /> On me
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={showCanceled} onChange={(e) => setShowCanceled(e.target.checked)} /> Canceled
          </label>
          <AddButton label="New task" onClick={() => setEditing('new')} />
        </div>
      </div>
      {error && (
        <p role="alert" className="mx-4 mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 md:mx-6">
          {error}
        </p>
      )}
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
      {editing && (
        <TaskDialog
          task={editing === 'new' ? null : editing}
          members={members}
          meId={meId}
          onSave={async (input) => {
            put(editing === 'new' ? await createGrowthTask(input) : await updateGrowthTask(editing.id, input))
            setEditing(null)
          }}
          onDelete={
            editing === 'new'
              ? undefined
              : async () => {
                  await deleteGrowthTask(editing.id)
                  setTasks((ts) => ts && ts.filter((t) => t.id !== editing.id))
                  setEditing(null)
                }
          }
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

function TaskDialog({
  task,
  members,
  meId,
  onSave,
  onDelete,
  onClose,
}: {
  task: GrowthTask | null
  members: Person[]
  meId?: string
  onSave: (input: GrowthTaskInput) => Promise<void>
  onDelete?: () => Promise<void>
  onClose: () => void
}) {
  const [title, setTitle] = useState(task?.title ?? '')
  const [taskType, setTaskType] = useState(task?.taskType ?? 'event_post')
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
        onSave({ title: title.trim(), taskType, assigneeId: assigneeId || null, postDate: postDate || null, channels, status, notes })
      }
      onDelete={onDelete}
      deleteWhat="task"
      onClose={onClose}
    >
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
