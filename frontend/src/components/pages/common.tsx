import { Pencil, Plus } from 'lucide-react'
import { daysSince } from '../../data/deals'

// Shared table look for the Companies and Contacts pages, matching the pipeline's list view.
export const table =
  'w-full min-w-[760px] border-separate border-spacing-0 overflow-hidden rounded-xl border border-gray-200 bg-surface text-left text-xs'
export const headCell = 'border-b border-gray-200 px-3 py-2 font-semibold'
export const cell = 'border-b border-gray-100 px-3 py-2.5 text-gray-700'

export function PageTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-3">
      <h2 className="font-display text-base font-bold text-gray-900">{title}</h2>
      <p className="text-xs text-gray-500">{subtitle}</p>
    </div>
  )
}

export function TouchedAgo({ at }: { at: string | null }) {
  if (!at) return <span className="text-gray-400">—</span>
  const days = daysSince(at)
  return <span>{days === 0 ? 'Today' : `${days} ${days === 1 ? 'day' : 'days'} ago`}</span>
}

export function AddButton({ label, onClick, disabled, title }: { label: string; onClick: () => void; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 bg-surface px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Plus size={14} aria-hidden /> {label}
    </button>
  )
}

export function EditButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
      <Pencil size={13} aria-hidden />
    </button>
  )
}
