import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { today, type Deal } from '../../data/deals'
import { addDays, entriesByDay, type CalendarKind } from '../../data/views'
import { chip } from '../chip'
import { formatDate } from '../../format'
import { PageTitle } from './common'

type Props = {
  deals: Deal[] // every semester's
  meId?: string
  onSelect: (id: string) => void
}

const kinds: { kind: CalendarKind; label: string; style: string }[] = [
  { kind: 'event', label: 'Event', style: 'border-indigo-200 bg-indigo-50 text-indigo-700' },
  { kind: 'next-step', label: 'Next step due', style: 'border-amber-200 bg-amber-50 text-amber-800' },
  { kind: 'invoice', label: 'Invoice due', style: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
]
const styleOf = (kind: CalendarKind) => kinds.find((k) => k.kind === kind)!.style

const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function CalendarPage({ deals, meId, onSelect }: Props) {
  const todayDate = today()
  const [month, setMonth] = useState(todayDate.slice(0, 7)) // YYYY-MM
  const [onMe, setOnMe] = useState(false)

  const shown = onMe ? deals.filter((d) => d.owner?.id === meId || d.support.some((p) => p.id === meId)) : deals
  const days = entriesByDay(shown)

  const first = `${month}-01`
  const offset = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7 // Monday first
  const nextMonth = addDays(first, 32).slice(0, 7)
  const prevMonth = addDays(first, -1).slice(0, 7)
  const daysInMonth = Number(addDays(`${nextMonth}-01`, -1).slice(8))
  const cells = Array.from({ length: Math.ceil((offset + daysInMonth) / 7) * 7 }, (_, i) => addDays(first, i - offset))
  const title = new Date(`${first}T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  return (
    <div className="min-h-0 flex-1 overflow-auto px-4 pt-4 pb-6 md:px-6">
      <PageTitle title="Calendar" subtitle="Events, next steps and invoices due, for every semester." />

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <button type="button" aria-label="Previous month" onClick={() => setMonth(prevMonth)} className={chip(false)}>
          <ChevronLeft size={14} aria-hidden />
        </button>
        <h3 className="min-w-36 text-center text-sm font-semibold text-gray-900" aria-live="polite">
          {title}
        </h3>
        <button type="button" aria-label="Next month" onClick={() => setMonth(nextMonth)} className={chip(false)}>
          <ChevronRight size={14} aria-hidden />
        </button>
        <button type="button" onClick={() => setMonth(todayDate.slice(0, 7))} className={chip(false)}>
          Today
        </button>
        <span className="mx-1.5 h-4 w-px bg-gray-200" />
        {meId && (
          <button type="button" aria-pressed={onMe} onClick={() => setOnMe((on) => !on)} className={chip(onMe)}>
            On me
          </button>
        )}
        <span className="ml-auto flex flex-wrap gap-2">
          {kinds.map((k) => (
            <span key={k.kind} className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${k.style}`}>
              {k.label}
            </span>
          ))}
        </span>
      </div>

      <div className="overflow-x-auto">
        <div aria-label={title} className="grid min-w-[640px] grid-cols-7 gap-px overflow-hidden rounded-xl border border-gray-200 bg-gray-200">
          {weekdays.map((d) => (
            <div key={d} aria-hidden className="bg-gray-50 px-2 py-1.5 text-[11px] font-semibold text-gray-500">
              {d}
            </div>
          ))}
          {cells.map((day) => {
            const entries = days.get(day) ?? []
            const inMonth = day.startsWith(month)
            return (
              <section
                key={day}
                aria-label={formatDate(day)}
                className={`min-h-24 bg-surface p-1.5 ${inMonth ? '' : 'opacity-50'}`}
              >
                <p className={`mb-1 text-[11px] font-semibold ${day === todayDate ? 'inline-block rounded-full bg-indigo-600 px-1.5 text-white' : 'text-gray-500'}`}>
                  {Number(day.slice(8))}
                </p>
                <ul className="space-y-1">
                  {entries.map(({ deal, kind }) => (
                    <li key={`${deal.id}-${kind}`}>
                      <button
                        type="button"
                        onClick={() => onSelect(deal.id)}
                        title={`${deal.company}: ${kinds.find((k) => k.kind === kind)!.label}${kind === 'next-step' && deal.nextStep ? ` (${deal.nextStep})` : ''}`}
                        className={`block w-full truncate rounded border px-1.5 py-0.5 text-left text-[11px] font-medium ${styleOf(kind)}`}
                      >
                        {deal.company}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
