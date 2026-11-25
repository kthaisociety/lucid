import { today } from '../../data/deals'
import { formatDate } from '../../format'
import { growthReportFor, hasNoMovement, isOverdue, type GrowthTask } from '../../data/growth'
import { PageTitle } from './common'
import { BarList, Tile } from './stats'

// The growth team's report on a semester (docs/adr/0012), the growth workspace's Reports.
export default function GrowthReport({ tasks, semester }: { tasks: GrowthTask[]; semester: string }) {
  const day = today()
  const report = growthReportFor(tasks, day)
  return (
    <div className="min-h-0 flex-1 overflow-auto px-6 pt-4 pb-6">
      <PageTitle title={`Growth report · ${semester}`} subtitle="How the semester's posts are going. Pick another semester at the top." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Open tasks" value={String(report.open)} />
        <Tile label="Overdue" value={String(report.overdue)} hint="Past their post date" />
        <Tile label="No movement" value={String(report.noMovement)} hint="Same status for 7 days or more" />
        <Tile label="Posted" value={String(report.posted)} />
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <BarList title="Tasks by status" bars={report.byStatus} />
        <BarList title="Posts by channel" hint="Posted or scheduled" bars={report.byChannel} />
        <BarList title="Open tasks by member" bars={report.byMember} />
      </div>
      <section aria-label="Needs follow-up" className="mt-3 rounded-xl border border-gray-200 bg-surface p-4">
        <h3 className="text-xs font-semibold text-gray-700">Needs follow-up ({report.needsFollowUp.length})</h3>
        {report.needsFollowUp.length === 0 ? (
          <p className="mt-2 text-xs text-gray-400">Nothing overdue or stuck. Nice.</p>
        ) : (
          <ul className="mt-2 space-y-1.5 text-xs">
            {report.needsFollowUp.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-gray-900">{t.title}</span>
                {isOverdue(t, day) && <span className="text-red-600">Overdue since {formatDate(t.postDate!)}</span>}
                {hasNoMovement(t) && <span className="text-amber-700">No movement</span>}
                <span className="text-gray-500">{t.assignee?.name ?? 'Unassigned'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
