import { STATUSES, nudgeFor, statusLabel, type Deal } from '../../data/deals'
import { formatDate, formatDateRange } from '../../format'
import { DealTypeBadge, InvoiceBadge, NudgeBadge } from '../badges'
import Fee from '../Fee'

type Props = {
  deals: Deal[]
  onSelect: (id: string) => void
}

const order = (deal: Deal) => STATUSES.findIndex((s) => s.id === deal.status)

// The deal log as a table: one row per deal, in pipeline order.
export default function DealTable({ deals, onSelect }: Props) {
  const rows = [...deals].sort((a, b) => order(a) - order(b) || a.company.localeCompare(b.company))

  return (
    <div className="min-h-0 flex-1 overflow-auto px-6 pb-6">
      <table className="w-full min-w-[960px] border-separate border-spacing-0 overflow-hidden rounded-xl border border-gray-200 bg-surface text-left text-xs">
        <thead className="bg-gray-50 text-[11px] text-gray-500">
          <tr>
            {['Company', 'Type', 'Status', 'Owner', 'Date', 'Next step', 'Fee', 'Invoice'].map((h) => (
              <th key={h} className="border-b border-gray-200 px-3 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((deal) => {
            const nudge = nudgeFor(deal)
            return (
              <tr key={deal.id} className="cursor-pointer align-top hover:bg-gray-50" onClick={() => onSelect(deal.id)}>
                <td className="border-b border-gray-100 px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => onSelect(deal.id)}
                    className="font-semibold text-gray-900 hover:text-indigo-700"
                  >
                    {deal.company}
                  </button>
                </td>
                <td className="border-b border-gray-100 px-3 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <DealTypeBadge dealType={deal.dealType} />
                    <span className="text-gray-500">{deal.eventType}</span>
                  </div>
                </td>
                <td className="border-b border-gray-100 px-3 py-2.5 text-gray-700">{statusLabel(deal.status)}</td>
                <td className="border-b border-gray-100 px-3 py-2.5 text-gray-700">{deal.owner?.name ?? '—'}</td>
                <td className="border-b border-gray-100 px-3 py-2.5 whitespace-nowrap text-gray-500">
                  {formatDateRange(deal.startDate, deal.endDate) || '—'}
                </td>
                <td className="max-w-72 border-b border-gray-100 px-3 py-2.5 text-gray-700">
                  {deal.nextStep || '—'}
                  {deal.nextStepDue && <span className="text-gray-400"> · {formatDate(deal.nextStepDue)}</span>}
                  {nudge && (
                    <div className="mt-1">
                      <NudgeBadge nudge={nudge} />
                    </div>
                  )}
                </td>
                <td className="border-b border-gray-100 px-3 py-2.5 whitespace-nowrap">
                  <Fee deal={deal} />
                </td>
                <td className="border-b border-gray-100 px-3 py-2.5">
                  <InvoiceBadge deal={deal} />
                </td>
              </tr>
            )
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} className="px-3 py-8 text-center text-gray-400">
                No deals
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
