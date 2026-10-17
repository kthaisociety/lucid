import { useState } from 'react'
import { LogOut, Mail } from 'lucide-react'
import type { User } from '../../api'
import { ROLES, nudgeFor, statusLabel, type Deal } from '../../data/deals'
import { myStatsFor } from '../../data/views'
import { formatSEK, messageOf, percent } from '../../format'
import { useDraft } from '../../hooks'
import { NudgeBadge } from '../badges'
import OwnerAvatar from '../OwnerAvatar'
import { PageTitle, cell, headCell } from './common'
import { BarList, Tile } from './stats'

type Props = {
  user: User
  deals: Deal[] // every semester's
  semester: string
  onSelect: (id: string) => void
  onSaveTitle: (title: string) => Promise<void>
  onSignOut: () => void
  onDisconnectGmail: () => void
}

// Your title on the team, in your own words: saved when you leave the field. Only a description: what
// you may do is your role, which an admin gives.
function TitleField({ title, onSave }: { title: string; onSave: (title: string) => Promise<void> }) {
  const [draft, setDraft] = useDraft(title)
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    const next = draft.trim()
    if (next === title) return
    setError(null)
    try {
      await onSave(next)
    } catch (err) {
      setDraft(title)
      setError(`Couldn't save your title: ${messageOf(err)}`)
    }
  }
  return (
    <>
      <input
        aria-label="Your title"
        value={draft}
        maxLength={100}
        placeholder="Add your title, e.g. Partnerships Lead"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className="-ml-1 mt-0.5 w-full max-w-xs rounded-md border border-transparent px-1 py-0.5 text-xs text-gray-700 placeholder-gray-400 hover:border-gray-200 focus:border-indigo-300 focus:outline-none"
      />
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </>
  )
}

// Where the member's mailbox stands, and what they can do about it (docs/adr/0006).
function GmailStatus({ gmail, onDisconnect }: { gmail: User['gmail']; onDisconnect: () => void }) {
  if (!gmail || gmail === 'off') return null
  const action = 'rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold hover:bg-gray-50'
  return (
    <p className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
      <Mail size={14} aria-hidden />
      {gmail === 'connected' && (
        <>
          Gmail connected: emails with contacts land on their deals.
          <button type="button" onClick={onDisconnect} className={`${action} text-gray-700 hover:text-red-600`}>
            Disconnect Gmail
          </button>
        </>
      )}
      {gmail === 'not-connected' && (
        <>
          Gmail isn’t connected.
          <a href="/auth/gmail/connect" className={`${action} text-indigo-700`}>
            Connect Gmail
          </a>
        </>
      )}
      {gmail === 'reconnect' && (
        <>
          Google stopped letting Lucid read your Gmail.
          <a href="/auth/gmail/connect" className={`${action} text-amber-700`}>
            Reconnect Gmail
          </a>
        </>
      )}
    </p>
  )
}

function DealLink({ deal, onSelect }: { deal: Deal; onSelect: (id: string) => void }) {
  return (
    <button type="button" onClick={() => onSelect(deal.id)} className="text-xs font-semibold text-indigo-700 hover:underline">
      {deal.company}
    </button>
  )
}

// The signed-in member's own page: who they are, their mailbox, and how their deals are going.
export default function MyPage({ user, deals, semester, onSelect, onSaveTitle, onSignOut, onDisconnectGmail }: Props) {
  const role = ROLES.find((r) => r.id === user.role)?.label
  const stats = user.memberId ? myStatsFor(user.memberId, semester, deals) : null

  return (
    <div className="min-h-0 flex-1 overflow-auto px-4 pt-4 pb-6 md:px-6">
      <section aria-label="Profile" className="flex flex-wrap items-center gap-4 rounded-xl border border-gray-200 bg-white p-4">
        <OwnerAvatar owner={{ id: user.memberId ?? user.sub, name: user.name || user.email, email: user.email }} />
        <div className="min-w-0 flex-1">
          <h2 className="font-display flex items-center gap-2 text-base font-bold text-gray-900">
            {user.name || user.email}
            {role && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">{role}</span>}
          </h2>
          {user.memberId && <TitleField title={user.title ?? ''} onSave={onSaveTitle} />}
          <p className="truncate text-xs text-gray-500">{user.email}</p>
        </div>
        {user.canSignOut && (
          <button
            type="button"
            onClick={onSignOut}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          >
            <LogOut size={14} aria-hidden /> Sign out
          </button>
        )}
        {user.gmail && user.gmail !== 'off' && (
          <div className="basis-full">
            <GmailStatus gmail={user.gmail} onDisconnect={onDisconnectGmail} />
          </div>
        )}
      </section>

      {!stats ? (
        <p className="mt-4 text-sm text-gray-500">Your deals show here once you’re on the team.</p>
      ) : (
        <>
          <div className="mt-5">
            <PageTitle title={`Your deals · ${semester}`} subtitle="The deals you own. Pick another semester at the top." />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Tile label="Open deals" value={String(stats.report.open)} hint={`${stats.report.deals} this semester`} />
            <Tile label="Confirmed" value={formatSEK(stats.report.confirmedSEK)} hint={`${stats.report.won} signed or finished`} />
            <Tile label="In the pipeline" value={formatSEK(stats.report.pipelineSEK)} hint="Fees on deals not yet signed" />
            <Tile
              label="Win rate"
              value={percent(stats.report.winRate)}
              hint={`${stats.report.won} won, ${stats.report.canceled} canceled`}
            />
            <Tile label="Supporting" value={String(stats.supporting.length)} hint="Open deals you help on" />
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <section aria-label="Waiting on you" className="rounded-xl border border-gray-200 bg-white p-4">
              <h3 className="text-xs font-semibold text-gray-700">Waiting on you ({stats.waiting.length})</h3>
              {stats.waiting.length === 0 ? (
                <p className="mt-2 text-xs text-gray-400">Nothing overdue or gone quiet. Nice.</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {stats.waiting.map((deal) => (
                    <li key={deal.id} className="flex flex-wrap items-center gap-2">
                      <DealLink deal={deal} onSelect={onSelect} />
                      <NudgeBadge nudge={nudgeFor(deal)!} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <BarList title="Your deals by status" bars={stats.report.byStatus} />
          </div>

          {stats.supporting.length > 0 && (
            <section aria-label="Supporting" className="mt-3 rounded-xl border border-gray-200 bg-white p-4">
              <h3 className="text-xs font-semibold text-gray-700">Supporting</h3>
              <ul className="mt-2 space-y-1.5">
                {stats.supporting.map((deal) => (
                  <li key={deal.id} className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    <DealLink deal={deal} onSelect={onSelect} />
                    {statusLabel(deal.status)}
                    {deal.owner ? ` · owned by ${deal.owner.name}` : ' · unassigned'}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {stats.history.length > 0 && (
            <section aria-label="Your semesters" className="mt-3 overflow-x-auto">
              <h3 className="mb-2 text-xs font-semibold text-gray-700">Your semesters</h3>
              <table className="w-full min-w-[560px] border-separate border-spacing-0 overflow-hidden rounded-xl border border-gray-200 bg-white text-left text-xs">
                <thead className="bg-gray-50 text-[11px] text-gray-500">
                  <tr>
                    {['Semester', 'Deals', 'Won', 'Win rate', 'Confirmed', 'Paid'].map((h) => (
                      <th key={h} className={headCell}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stats.history.map((r) => (
                    <tr key={r.semester} className={r.semester === semester ? 'bg-indigo-50/50' : undefined}>
                      <td className={`${cell} font-semibold text-gray-900`}>{r.semester}</td>
                      <td className={cell}>{r.deals}</td>
                      <td className={cell}>{r.won}</td>
                      <td className={cell}>{percent(r.winRate)}</td>
                      <td className={`${cell} whitespace-nowrap`}>{formatSEK(r.confirmedSEK)}</td>
                      <td className={`${cell} whitespace-nowrap`}>{formatSEK(r.paidSEK)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </div>
  )
}
