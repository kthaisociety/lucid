import { AlertTriangle, Clock, Mail } from 'lucide-react'
import type { Deal, DealType, Nudge } from '../data/deals'
import { invoiceLabel } from '../data/deals'

const dealTypeStyles: Record<DealType, string> = {
  Event: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  Partnership: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Job Post': 'bg-amber-50 text-amber-700 border-amber-200',
  MoU: 'bg-sky-50 text-sky-700 border-sky-200',
}

export function DealTypeBadge({ dealType }: { dealType: DealType }) {
  return (
    <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${dealTypeStyles[dealType]}`}>
      {dealType}
    </span>
  )
}

const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`

// What each nudge says. Our turn (overdue, their email waiting) is red; waiting on them, amber.
function nudgeText(nudge: Nudge): string {
  switch (nudge.kind) {
    case 'overdue':
      return `Next step overdue: ${days(nudge.days)}`
    case 'your-turn':
      return `${nudge.who ?? 'They'} replied ${days(nudge.days)} ago: your turn`
    case 'no-reply':
      return nudge.who ? `No reply from ${nudge.who} for ${days(nudge.days)}` : `No reply for ${days(nudge.days)}`
    case 'inactive':
      return `Follow-up due: ${nudge.days} days inactive`
  }
}

export function NudgeBadge({ nudge }: { nudge: Nudge }) {
  const urgent = nudge.kind === 'overdue' || nudge.kind === 'your-turn'
  const Icon = nudge.kind === 'overdue' ? Clock : nudge.kind === 'inactive' ? AlertTriangle : Mail
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
        urgent ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800'
      }`}
    >
      <Icon size={12} aria-hidden />
      {nudgeText(nudge)}
    </span>
  )
}

export function InvoiceBadge({ deal }: { deal: Deal }) {
  const label = invoiceLabel(deal)
  if (!label) return null
  const style =
    deal.feeSEK === 0
      ? 'text-gray-500 bg-gray-50 border-gray-200'
      : {
          not_sent: 'text-orange-700 bg-orange-50 border-orange-200',
          waiting: 'text-sky-700 bg-sky-50 border-sky-200',
          paid: 'text-emerald-700 bg-emerald-50 border-emerald-200',
          cancelled: 'text-gray-500 bg-gray-50 border-gray-200',
        }[deal.invoiceStatus ?? 'cancelled']
  return <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${style}`}>{label}</span>
}
