import { Briefcase, Megaphone, Plus, Search } from 'lucide-react'
import { TEAMS, type Team } from '../../data/deals'
import { formatSEK } from '../../format'
import Logo from '../Logo'

type Props = {
  semesters: string[]
  semester: string
  onSemesterChange: (semester: string) => void
  query: string
  onQueryChange: (query: string) => void
  openDeals: number
  confirmedSEK: number
  unpaidSEK: number
  canAddLead: boolean
  onNewLead: () => void
  // Which team's pages show (docs/adr/0012). The totals and New Lead are the deal log's; Growth has New Task.
  workspace: Team
  onWorkspace: (team: Team) => void
  onNewTask: () => void
}

export default function Header(props: Props) {
  const { semesters, semester, onSemesterChange, query, onQueryChange, openDeals, confirmedSEK, unpaidSEK } = props
  const { canAddLead, onNewLead, workspace, onWorkspace, onNewTask } = props
  const business = workspace === 'business'

  return (
    <header className="z-20 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-gray-200 bg-surface px-4 md:px-6">
      <div className="flex min-w-0 items-center gap-3 md:gap-4">
        <div className="flex items-center gap-2.5 sm:border-r sm:border-gray-200 sm:pr-4">
          <Logo className="shrink-0 shadow-sm" />
          <div className="hidden sm:block">
            <h1 className="font-display text-sm leading-tight font-bold text-gray-900">Lucid</h1>
            <p className="text-[11px] font-medium text-gray-500">Corporate Outreach CRM</p>
          </div>
        </div>
        <div role="group" aria-label="Workspace" className="flex shrink-0 gap-0.5 rounded-lg border border-gray-200 bg-gray-100 p-1">
          {TEAMS.map((t) => {
            const Icon = t.id === 'growth' ? Megaphone : Briefcase
            const active = workspace === t.id
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={active}
                onClick={() => onWorkspace(t.id)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition ${
                  active
                    ? `${t.id === 'growth' ? 'bg-violet-600' : 'bg-indigo-600'} text-white shadow-sm`
                    : 'text-gray-600 hover:bg-surface hover:text-gray-900'
                }`}
              >
                <Icon size={14} aria-hidden />
                {t.label}
              </button>
            )
          })}
        </div>
        <label className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 py-0.5 pl-2.5 text-xs font-semibold text-gray-700">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          <span className="sr-only">Semester</span>
          <select
            value={semester}
            onChange={(e) => onSemesterChange(e.target.value)}
            className="bg-transparent py-0.5 pr-1 font-semibold focus:outline-none"
          >
            {semesters.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="hidden w-72 items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-gray-400 focus-within:border-indigo-300 md:flex">
          <Search size={14} aria-hidden />
          <input
            type="search"
            aria-label="Search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={business ? 'Search companies, contacts, notes...' : 'Search tasks, notes, people...'}
            className="w-full border-none bg-transparent text-xs text-gray-800 placeholder-gray-400 focus:outline-none"
          />
        </label>
      </div>
      {!business && (
        <button
          type="button"
          onClick={onNewTask}
          aria-label="New Task"
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap text-white transition hover:bg-primary-hover sm:px-3.5"
        >
          <Plus size={14} aria-hidden />
          <span className="hidden sm:inline">New Task</span>
        </button>
      )}
      {business && (
        <div className="flex shrink-0 items-center gap-4">
          <div className="hidden items-center gap-2 xl:flex">
            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-600">
              Open Deals: <strong className="font-semibold text-gray-900">{openDeals}</strong>
            </div>
            <div className="rounded-md border border-emerald-100 bg-emerald-50 px-3 py-1 text-xs text-emerald-800">
              Confirmed: <strong className="font-bold">{formatSEK(confirmedSEK)}</strong>
            </div>
            <div className="rounded-md border border-orange-100 bg-orange-50 px-3 py-1 text-xs text-orange-800">
              Unpaid: <strong className="font-bold">{formatSEK(unpaidSEK)}</strong>
            </div>
          </div>
          <button
            type="button"
            onClick={onNewLead}
            disabled={!canAddLead}
            title={canAddLead ? undefined : 'Available once you are signed in'}
            aria-label="New Lead"
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50 sm:px-3.5"
          >
            <Plus size={14} aria-hidden />
            <span className="hidden sm:inline">New Lead</span>
          </button>
        </div>
      )}
    </header>
  )
}
