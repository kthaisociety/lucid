import { STATUSES, byAttention, type Deal, type Status } from '../../data/deals'
import KanbanColumn from './KanbanColumn'

type Props = {
  deals: Deal[]
  showCanceled: boolean
  onSelect: (id: string) => void
  onMove: (id: string, status: Status) => void
}

export default function KanbanBoard({ deals, showCanceled, onSelect, onMove }: Props) {
  const ordered = [...deals].sort(byAttention())
  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 pb-6 md:px-6">
      {STATUSES.filter((s) => showCanceled || s.id !== 'canceled').map((status) => (
        <KanbanColumn
          key={status.id}
          status={status.id}
          label={status.label}
          deals={ordered.filter((deal) => deal.status === status.id)}
          onSelect={onSelect}
          onMove={onMove}
        />
      ))}
    </div>
  )
}
