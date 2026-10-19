import { useState } from 'react'
import { KanbanSquare, List, Plus } from 'lucide-react'
import { DEAL_TYPES, nudgeFor, type Deal, type DealType, type Status } from '../data/deals'
import KanbanBoard from './kanban/KanbanBoard'
import DealTable from './list/DealTable'

type Props = {
  deals: Deal[] // the semester's, matching the search
  semester: string
  // Whether a search is narrowing the deals, and the newest other semester with deals, if any: for what
  // an empty semester says.
  searching: boolean
  otherSemester: string | null
  canAddLead: boolean
  onNewLead: () => void
  onSemester: (semester: string) => void
  meId: string | undefined
  onSelect: (id: string) => void
  onMove: (id: string, status: Status) => void
}

const chip = (active: boolean) =>
  `flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition ${
    active ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-gray-200 bg-surface text-gray-600 hover:bg-gray-50'
  }`

export default function PipelineView({
  deals,
  semester,
  searching,
  otherSemester,
  canAddLead,
  onNewLead,
  onSemester,
  meId,
  onSelect,
  onMove,
}: Props) {
  const [view, setView] = useState<'board' | 'list'>('board')
  const [dealType, setDealType] = useState<DealType | 'all'>('all')
  const [followUpOnly, setFollowUpOnly] = useState(false)
  const [owner, setOwner] = useState<'anyone' | 'mine' | 'unassigned'>('anyone')
  const [showCanceled, setShowCanceled] = useState(false)

  const visible = deals.filter(
    (deal) =>
      (dealType === 'all' || deal.dealType === dealType) &&
      (!followUpOnly || nudgeFor(deal) !== null) &&
      (owner === 'anyone' || (owner === 'mine' ? deal.owner?.id === meId : deal.owner === null)) &&
      (showCanceled || deal.status !== 'canceled'),
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        role="toolbar"
        aria-label="Filters"
        className="flex items-center gap-1.5 overflow-x-auto px-4 pt-4 pb-3 whitespace-nowrap md:flex-wrap md:px-6 [&>*]:shrink-0"
      >
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
              onClick={() => setView(id)}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold ${
                view === id ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              <Icon size={14} aria-hidden /> {label}
            </button>
          ))}
        </div>
        {(['all', ...DEAL_TYPES] as const).map((t) => (
          <button key={t} type="button" aria-pressed={dealType === t} onClick={() => setDealType(t)} className={chip(dealType === t)}>
            {t === 'all' ? 'All types' : t}
          </button>
        ))}
        <span className="mx-1.5 h-4 w-px bg-gray-200" />
        {meId && (
          <button
            type="button"
            aria-pressed={owner === 'mine'}
            onClick={() => setOwner(owner === 'mine' ? 'anyone' : 'mine')}
            className={chip(owner === 'mine')}
          >
            Mine
          </button>
        )}
        <button
          type="button"
          aria-pressed={owner === 'unassigned'}
          onClick={() => setOwner(owner === 'unassigned' ? 'anyone' : 'unassigned')}
          className={chip(owner === 'unassigned')}
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
      {deals.length === 0 && !searching && (
        <EmptySemester semester={semester} otherSemester={otherSemester} canAddLead={canAddLead} onNewLead={onNewLead} onSemester={onSemester} />
      )}
      {view === 'board' ? (
        <KanbanBoard deals={visible} showCanceled={showCanceled} onSelect={onSelect} onMove={onMove} />
      ) : (
        <DealTable deals={visible} onSelect={onSelect} />
      )}
    </div>
  )
}

// A semester with no deals: on the first day, how to start; later, where the deals are.
function EmptySemester({
  semester,
  otherSemester,
  canAddLead,
  onNewLead,
  onSemester,
}: {
  semester: string
  otherSemester: string | null
  canAddLead: boolean
  onNewLead: () => void
  onSemester: (semester: string) => void
}) {
  return (
    <section aria-label="No deals" className="mx-4 mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-gray-300 bg-surface px-4 py-3 md:mx-6">
      <div className="min-w-0 flex-1 text-xs text-gray-600">
        <p className="font-semibold text-gray-900">{otherSemester ? `No deals in ${semester} yet` : 'No deals yet'}</p>
        <p className="mt-0.5">
          {otherSemester
            ? 'Add one with New Lead, or look at another semester.'
            : 'Add the first lead with New Lead: the company, its contact if you know them, and the next step. Companies and contacts come along with it.'}
        </p>
      </div>
      {otherSemester && (
        <button
          type="button"
          onClick={() => onSemester(otherSemester)}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
        >
          Go to {otherSemester}
        </button>
      )}
      <button
        type="button"
        onClick={onNewLead}
        disabled={!canAddLead}
        className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
      >
        <Plus size={14} aria-hidden /> New Lead
      </button>
    </section>
  )
}
