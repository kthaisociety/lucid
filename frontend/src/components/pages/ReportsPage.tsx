import { compareSemesters, nudgeFor, type Deal } from '../../data/deals'
import { reportFor, type Bar } from '../../data/views'
import { formatSEK } from '../../format'
import { NudgeBadge } from '../badges'
import { statusColors } from '../statusColors'
import { PageTitle, cell, headCell } from './common'

type Props = {
  deals: Deal[] // every semester's
  semester: string
  onSelect: (id: string) => void
}

const percent = (rate: number | null) => (rate === null ? '—' : `${Math.round(rate * 100)}%`)

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-surface p-4">
      <p className="text-[11px] font-medium text-gray-500">{label}</p>
      <p className="font-display mt-1 text-xl font-bold text-gray-900">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-gray-400">{hint}</p>}
    </div>
  )
}

// One series of horizontal bars. The title names the series, so there is no legend; every bar carries its
// value as text, so nothing depends on color alone.
function BarList({ title, bars, format = String }: { title: string; bars: Bar[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...bars.map((b) => b.value))
  return (
    <section aria-label={title} className="rounded-xl border border-gray-200 bg-surface p-4">
      <h3 className="text-xs font-semibold text-gray-700">{title}</h3>
      <ul className="mt-3 space-y-2">
        {bars.map((bar) => (
          <li key={bar.label} title={`${bar.label}: ${format(bar.value)}`} className="grid grid-cols-[7rem_1fr_auto] items-center gap-3">
            <span className="truncate text-xs text-gray-600">{bar.label}</span>
            <span className="h-2.5">
              {bar.value > 0 && (
                <span
                  className={`block h-full rounded-r ${bar.status ? statusColors[bar.status] : 'bg-indigo-500'}`}
                  style={{ width: `${Math.max(2, (bar.value / max) * 100)}%` }}
                />
              )}
            </span>
            <span className="text-right text-xs font-semibold text-gray-900 tabular-nums">{format(bar.value)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function ReportsPage({ deals, semester, onSelect }: Props) {
  const report = reportFor(semester, deals)
  const semesters = [...new Set(deals.map((d) => d.semester))].sort(compareSemesters)
  const history = semesters.map((s) => reportFor(s, deals))

  return (
    <div className="min-h-0 flex-1 overflow-auto px-6 pt-4 pb-6">
      <PageTitle title={`Report · ${semester}`} subtitle="How the semester is going. Pick another semester at the top." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile label="Confirmed" value={formatSEK(report.confirmedSEK)} hint={`${report.won} signed or finished`} />
        <Tile label="Paid" value={formatSEK(report.paidSEK)} />
        <Tile label="Unpaid" value={formatSEK(report.unpaidSEK)} hint="Confirmed, not yet paid" />
        <Tile label="In the pipeline" value={formatSEK(report.pipelineSEK)} hint="Fees on deals not yet signed" />
        <Tile label="Win rate" value={percent(report.winRate)} hint={`${report.won} won, ${report.canceled} canceled`} />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <BarList title="Deals by status" bars={report.byStatus} />
        <BarList title="Confirmed fees by deal type" bars={report.confirmedByType} format={formatSEK} />
        <BarList title="Deals by owner" bars={report.byOwner} />
      </div>

      <section aria-label="Needs follow-up" className="mt-3 rounded-xl border border-gray-200 bg-surface p-4">
        <h3 className="text-xs font-semibold text-gray-700">Needs follow-up ({report.needsFollowUp.length})</h3>
        {report.needsFollowUp.length === 0 ? (
          <p className="mt-2 text-xs text-gray-400">Nothing overdue or gone quiet. Nice.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {report.needsFollowUp.map((deal) => (
              <li key={deal.id} className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => onSelect(deal.id)} className="text-xs font-semibold text-indigo-700 hover:underline">
                  {deal.company}
                </button>
                <NudgeBadge nudge={nudgeFor(deal)!} />
                <span className="text-xs text-gray-500">{deal.owner?.name}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Semesters compared" className="mt-3">
        <h3 className="mb-2 text-xs font-semibold text-gray-700">Semesters compared</h3>
        <table className="w-full min-w-[640px] border-separate border-spacing-0 overflow-hidden rounded-xl border border-gray-200 bg-surface text-left text-xs">
          <thead className="bg-gray-50 text-[11px] text-gray-500">
            <tr>
              {['Semester', 'Deals', 'Won', 'Canceled', 'Win rate', 'Confirmed', 'Paid'].map((h) => (
                <th key={h} className={headCell}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {history.map((r) => (
              <tr key={r.semester} className={r.semester === semester ? 'bg-indigo-50/50' : undefined}>
                <td className={`${cell} font-semibold text-gray-900`}>{r.semester}</td>
                <td className={cell}>{r.deals}</td>
                <td className={cell}>{r.won}</td>
                <td className={cell}>{r.canceled}</td>
                <td className={cell}>{percent(r.winRate)}</td>
                <td className={`${cell} whitespace-nowrap`}>{formatSEK(r.confirmedSEK)}</td>
                <td className={`${cell} whitespace-nowrap`}>{formatSEK(r.paidSEK)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
