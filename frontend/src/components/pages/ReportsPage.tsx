import { compareSemesters, nudgeFor, type Deal, type Person } from '../../data/deals'
import { reportFor, workloadFor } from '../../data/views'
import { formatSEK, percent } from '../../format'
import { NudgeBadge } from '../badges'
import { PageTitle, cell, headCell } from './common'
import { BarList, Tile } from './stats'

type Props = {
  deals: Deal[] // every semester's
  members: Person[] // the team, for how the work is shared out
  semester: string
  onSelect: (id: string) => void
}

export default function ReportsPage({ deals, members, semester, onSelect }: Props) {
  const report = reportFor(semester, deals)
  const workload = workloadFor(semester, deals, members)
  const semesters = [...new Set(deals.map((d) => d.semester))].sort(compareSemesters)
  const history = semesters.map((s) => reportFor(s, deals))
  const maxConfirmed = Math.max(1, ...history.map((r) => r.confirmedSEK))

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
        <BarList
          title="Deals by member"
          hint="Deals each member owns (dark) and supports (light). A deal counts for everyone on it."
          bars={report.byMember}
        />
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

      <section aria-label="Team workload" className="mt-3 overflow-x-auto">
        <h3 className="text-xs font-semibold text-gray-700">Team workload</h3>
        <p className="mb-2 text-[11px] text-gray-500">How the semester’s open deals are shared out, to spot who could use a hand.</p>
        <table className="w-full min-w-[640px] border-separate border-spacing-0 overflow-hidden rounded-xl border border-gray-200 bg-surface text-left text-xs">
          <thead className="bg-gray-50 text-[11px] text-gray-500">
            <tr>
              {['Member', 'Owns', 'Supports', 'Waiting on them', 'Next steps this week'].map((h) => (
                <th key={h} className={headCell}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {workload.rows.map((r) => (
              <tr key={r.member.id}>
                <td className={`${cell} font-semibold text-gray-900`}>{r.member.name}</td>
                <td className={cell}>{r.owns || '—'}</td>
                <td className={cell}>{r.supports || '—'}</td>
                <td className={r.waiting ? `${cell} font-semibold text-amber-700` : cell}>{r.waiting || '—'}</td>
                <td className={cell}>{r.dueThisWeek || '—'}</td>
              </tr>
            ))}
            {workload.unassigned > 0 && (
              <tr>
                <td className={`${cell} text-gray-500 italic`}>Unassigned</td>
                <td className={cell}>{workload.unassigned}</td>
                <td className={cell} colSpan={3} />
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section aria-label="Semesters compared" className="mt-3">
        <h3 className="mb-2 text-xs font-semibold text-gray-700">Semesters compared</h3>
        <figure aria-label="Confirmed and paid fees by semester" className="mb-3 rounded-xl border border-gray-200 bg-surface p-4">
          <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500">
            <span className="font-semibold text-gray-700">Confirmed fees by semester</span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-indigo-500" aria-hidden /> Paid
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-indigo-200" aria-hidden /> Not paid
            </span>
          </figcaption>
          <ol className="mt-3 flex items-end gap-3 overflow-x-auto">
            {[...history].reverse().map((r) => {
              const label = `${r.semester}: ${formatSEK(r.confirmedSEK)} confirmed, ${formatSEK(r.paidSEK)} paid`
              return (
                <li key={r.semester} aria-label={label} title={label} className="flex min-w-14 flex-1 flex-col items-center gap-1">
                  <span className="text-[11px] font-semibold text-gray-900 tabular-nums">{formatSEK(r.confirmedSEK)}</span>
                  <span className="flex h-32 w-full max-w-12 flex-col justify-end">
                    {r.confirmedSEK > 0 && (
                      <span className="flex flex-col overflow-hidden rounded-t" style={{ height: `${Math.max(2, (r.confirmedSEK / maxConfirmed) * 100)}%` }}>
                        <span className="block flex-1 bg-indigo-200" />
                        <span className="block bg-indigo-500" style={{ height: `${(r.paidSEK / r.confirmedSEK) * 100}%` }} />
                      </span>
                    )}
                  </span>
                  <span className={`text-[11px] ${r.semester === semester ? 'font-bold text-indigo-700' : 'text-gray-600'}`}>{r.semester}</span>
                </li>
              )
            })}
          </ol>
        </figure>
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
