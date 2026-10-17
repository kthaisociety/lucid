import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { nudgeFor, type Deal } from '../../data/deals'
import { formatDate, formatDateRange } from '../../format'
import { DealTypeBadge, InvoiceBadge, NudgeBadge } from '../badges'
import OwnerAvatar from '../OwnerAvatar'
import Fee from '../Fee'
import { DEAL_DRAG_TYPE } from './drag'

type Props = {
  deal: Deal
  onSelect: (id: string) => void
}

export default function DealCard({ deal, onSelect }: Props) {
  const [dragging, setDragging] = useState(false)
  const nudge = nudgeFor(deal)
  const when = formatDateRange(deal.startDate, deal.endDate)

  return (
    <button
      type="button"
      onClick={() => onSelect(deal.id)}
      // Drag a card onto another column to change its status (KanbanColumn handles the drop).
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DEAL_DRAG_TYPE, deal.id)
        e.dataTransfer.effectAllowed = 'move'
        setDragging(true)
      }}
      onDragEnd={() => setDragging(false)}
      className={`w-full cursor-grab rounded-lg border border-gray-200 bg-surface p-3 text-left shadow-sm transition hover:border-indigo-200 hover:shadow focus-visible:outline-2 focus-visible:outline-indigo-500 active:cursor-grabbing ${
        dragging ? 'opacity-40' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">{deal.company}</h3>
        <DealTypeBadge dealType={deal.dealType} />
      </div>
      <p className="mt-0.5 text-[11px] text-gray-500">
        {deal.eventType}
        {when && ` · ${when}`}
      </p>

      {nudge && (
        <div className="mt-2">
          <NudgeBadge nudge={nudge} />
        </div>
      )}

      {deal.nextStep && (
        <p className="mt-2 flex gap-1.5 text-xs text-gray-700">
          <ArrowRight size={12} className="mt-0.5 shrink-0 text-gray-400" aria-hidden />
          <span className="line-clamp-2">
            {deal.nextStep}
            {deal.nextStepDue && <span className="text-gray-400"> · {formatDate(deal.nextStepDue)}</span>}
          </span>
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
        <div className="flex items-center gap-1.5 whitespace-nowrap">
          <Fee deal={deal} />
          {(deal.status === 'signed' || deal.status === 'finished') && <InvoiceBadge deal={deal} />}
        </div>
        <div className="ml-auto flex -space-x-0.5">
          {!deal.owner && (
            <span className="rounded-full border border-dashed border-gray-300 px-1.5 py-0.5 text-[10px] text-gray-400">Unassigned</span>
          )}
          {[deal.owner, ...deal.support].filter((p) => p !== null).map((person) => (
            <OwnerAvatar key={person.id} owner={person} />
          ))}
        </div>
      </div>
    </button>
  )
}
