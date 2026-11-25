import { KanbanSquare, List } from 'lucide-react'

export type View = 'board' | 'list'

// Board or list, at the start of a filter bar (the pipeline's, the growth board's).
export default function ViewToggle({ view, onChange }: { view: View; onChange: (view: View) => void }) {
  return (
    <div className="mr-2 flex rounded-lg border border-gray-200 bg-surface p-0.5">
      {(
        [
          ['board', 'Board', KanbanSquare],
          ['list', 'List', List],
        ] as const
      ).map(([id, label, Icon]) => (
        <button
          key={id}
          type="button"
          aria-pressed={view === id}
          onClick={() => onChange(id)}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold ${
            view === id ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-800'
          }`}
        >
          <Icon size={14} aria-hidden /> {label}
        </button>
      ))}
    </div>
  )
}
