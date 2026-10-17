import { useState, type DragEvent } from 'react'
import type { Deal, Status } from '../../data/deals'
import { formatSEK } from '../../format'
import { statusColors } from '../statusColors'
import DealCard from './DealCard'
import { DEAL_DRAG_TYPE } from './drag'

type Props = {
  status: Status
  label: string
  deals: Deal[]
  onSelect: (id: string) => void
  onMove: (id: string, status: Status) => void
}

const carriesDeal = (e: DragEvent) => e.dataTransfer.types.includes(DEAL_DRAG_TYPE)

export default function KanbanColumn({ status, label, deals, onSelect, onMove }: Props) {
  const [over, setOver] = useState(false)
  const total = deals.reduce((sum, deal) => sum + (deal.feeSEK ?? 0), 0)

  const onDragOver = (e: DragEvent) => {
    if (!carriesDeal(e)) return
    e.preventDefault() // allows the drop
    e.dataTransfer.dropEffect = 'move'
    setOver(true)
  }
  const onDragLeave = (e: DragEvent<HTMLElement>) => {
    // Moving between the column's own cards fires dragleave too; only leaving the column counts.
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
  }
  const onDrop = (e: DragEvent) => {
    setOver(false)
    if (!carriesDeal(e)) return
    e.preventDefault()
    const id = e.dataTransfer.getData(DEAL_DRAG_TYPE)
    // A card dropped back on its own column stays put, without a save.
    if (id && !deals.some((deal) => deal.id === id)) onMove(id, status)
  }

  return (
    <section
      aria-label={label}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`flex w-64 shrink-0 flex-col rounded-xl p-2 transition-colors md:w-auto md:min-w-56 md:flex-1 md:basis-0 ${
        over ? 'bg-indigo-50 ring-2 ring-indigo-200' : 'bg-gray-100/70'
      }`}
    >
      <header className="flex items-center justify-between px-1.5 pt-1 pb-2.5">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${statusColors[status]}`} aria-hidden />
          <h2 className="font-display text-xs font-bold text-gray-700">{label}</h2>
          <span className="rounded-full bg-surface px-1.5 text-[11px] font-semibold text-gray-500">
            {deals.length}
          </span>
        </div>
        <span className="text-[11px] font-medium text-gray-500">{formatSEK(total)}</span>
      </header>
      <div className="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto">
        {deals.map((deal) => (
          <DealCard key={deal.id} deal={deal} onSelect={onSelect} />
        ))}
        {deals.length === 0 && (
          <p
            className={`rounded-lg border border-dashed py-6 text-center text-[11px] ${
              over ? 'border-indigo-300 text-indigo-500' : 'border-gray-300 text-gray-400'
            }`}
          >
            {over ? 'Drop here' : 'No deals'}
          </p>
        )}
      </div>
    </section>
  )
}
