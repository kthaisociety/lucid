import { BarChart3, Building2, KanbanSquare, LogOut, Mail, UserCog, Users } from 'lucide-react'
import { NavLink } from 'react-router'
import type { User } from '../../api'
import { canSeeReports } from '../../data/deals'
import type { ThemeChoice } from '../../theme'
import OwnerAvatar from '../OwnerAvatar'
import ThemeSwitch from './ThemeSwitch'

type Props = {
  user: User | null
  userError: string | null
  theme: ThemeChoice
  onTheme: (theme: ThemeChoice) => void
  onSignOut: () => void
  onDisconnectGmail: () => void
}

const pages = [
  { label: 'Pipeline', icon: KanbanSquare, path: '/' },
  { label: 'Companies', icon: Building2, path: '/companies' },
  { label: 'Contacts', icon: Users, path: '/contacts' },
  { label: 'Reports', icon: BarChart3, path: '/reports', boardOnly: true },
  { label: 'Team', icon: UserCog, path: '/team' },
]

// The pages this user's role opens.
const pagesFor = (user: User | null) => pages.filter((p) => !p.boardOnly || canSeeReports(user?.role))

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm ${
    isActive ? 'bg-gray-100 font-semibold text-gray-900' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
  }`

export default function Sidebar({ user, userError, theme, onTheme, onSignOut, onDisconnectGmail }: Props) {
  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-gray-200 bg-surface p-3 md:flex">
      <nav aria-label="Main" className="flex flex-col gap-0.5">
        {pagesFor(user).map(({ label, icon: Icon, path }) => (
          <NavLink key={path} to={path} end className={linkClass}>
            <Icon size={16} aria-hidden />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Where Connect Gmail is on, the user chip below says where it stands instead. */}
      <div className="mt-auto">
        {(!user?.gmail || user.gmail === 'off') && (
          <p
            title="Soon, emails with a contact will land on the deal's timeline on their own. Until then, add a quick note after each touchpoint: it resets the follow-up timer."
            className="flex items-center gap-1.5 px-2.5 pb-3 text-[11px] text-gray-500"
          >
            <Mail size={12} aria-hidden /> Email sync: coming soon
          </p>
        )}
        <div className="px-2.5 pb-3">
          <ThemeSwitch theme={theme} onChange={onTheme} />
        </div>
      </div>

      <div className="border-t border-gray-100 pt-3 text-[11px] text-gray-500">
        {user && (
          <div className="flex items-center gap-2">
            <OwnerAvatar owner={{ id: user.memberId ?? user.sub, name: user.name || user.email, email: user.email }} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-gray-900">{user.name || user.email}</p>
              <p className="sr-only">Signed in as {user.email}</p>
              <p className="truncate" title={user.email} aria-hidden>
                {user.email}
              </p>
            </div>
            {user.canSignOut && (
              <button
                type="button"
                onClick={onSignOut}
                aria-label="Sign out"
                title="Sign out"
                className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
              >
                <LogOut size={14} aria-hidden />
              </button>
            )}
          </div>
        )}
        {user?.role && (
          <span className="mt-2 inline-block rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600 capitalize">
            {user.role}
          </span>
        )}
        {user?.gmail === 'connected' && (
          <p className="mt-2 flex items-center gap-1.5">
            <Mail size={12} aria-hidden /> Gmail connected
            <button type="button" onClick={onDisconnectGmail} className="ml-auto text-gray-500 hover:text-red-600">
              Disconnect
            </button>
          </p>
        )}
        {user?.gmail === 'not-connected' && (
          <a href="/auth/gmail/connect" className="mt-2 flex items-center gap-1.5 text-indigo-700 hover:underline">
            <Mail size={12} aria-hidden /> Connect Gmail
          </a>
        )}
        {user?.gmail === 'reconnect' && (
          <a href="/auth/gmail/connect" className="mt-2 flex items-center gap-1.5 text-amber-700 hover:underline">
            <Mail size={12} aria-hidden /> Reconnect Gmail
          </a>
        )}
        {userError && <p className="text-red-600">{userError}</p>}
        {!user && !userError && <p>Loading…</p>}
      </div>
    </aside>
  )
}

// The sidebar is hidden on narrow screens; this row of tabs takes its place, with the account actions
// the sidebar's user chip has: Gmail, and signing out.
export function MobileNav({
  user,
  theme,
  onTheme,
  onSignOut,
  onDisconnectGmail,
}: {
  user: User | null
  theme: ThemeChoice
  onTheme: (theme: ThemeChoice) => void
  onSignOut: () => void
  onDisconnectGmail: () => void
}) {
  return (
    <nav aria-label="Pages" className="flex gap-1 overflow-x-auto border-b border-gray-200 bg-surface px-4 py-2 md:hidden">
      {pagesFor(user).map(({ label, path }) => (
        <NavLink
          key={path}
          to={path}
          end
          className={({ isActive }) =>
            `shrink-0 rounded-md px-2.5 py-1 text-xs ${isActive ? 'bg-gray-100 font-semibold text-gray-900' : 'text-gray-600'}`
          }
        >
          {label}
        </NavLink>
      ))}
      <span className="ml-auto flex shrink-0 items-center gap-1">
        <ThemeSwitch theme={theme} onChange={onTheme} />
        {user?.gmail === 'connected' && (
          <button type="button" onClick={onDisconnectGmail} className="rounded-md px-2.5 py-1 text-xs text-gray-600">
            Disconnect Gmail
          </button>
        )}
        {(user?.gmail === 'not-connected' || user?.gmail === 'reconnect') && (
          <a href="/auth/gmail/connect" className="rounded-md px-2.5 py-1 text-xs text-indigo-700">
            {user.gmail === 'reconnect' ? 'Reconnect Gmail' : 'Connect Gmail'}
          </a>
        )}
        {user?.canSignOut && (
          <button type="button" onClick={onSignOut} className="rounded-md px-2.5 py-1 text-xs text-gray-600">
            Sign out
          </button>
        )}
      </span>
    </nav>
  )
}
