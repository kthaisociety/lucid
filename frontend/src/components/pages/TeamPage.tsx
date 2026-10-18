import { useState } from 'react'
import type { MemberInput } from '../../api'
import { ROLES, isOpen, type Deal, type Person, type Role } from '../../data/deals'
import { messageOf } from '../../format'
import FormDialog, { DeleteButton, inputClass } from '../dialogs/FormDialog'
import OwnerAvatar from '../OwnerAvatar'
import { AddButton, PageTitle, cell, headCell, table } from './common'

export type TeamActions = {
  add: (member: MemberInput) => Promise<void>
  setRole: (id: string, role: Role) => Promise<void>
  remove: (id: string) => Promise<void>
  // Makes the member an admin, and you board or member (docs/adr/0005).
  handOver: (id: string, stepDownTo: 'board' | 'member') => Promise<void>
}

type Props = {
  members: Person[]
  deals: Deal[] // every semester's
  meId: string | undefined
  isAdmin: boolean
  actions: TeamActions
}

const roleLabel = (role: Role | undefined) => ROLES.find((r) => r.id === role)?.label ?? 'Member'

export default function TeamPage({ members, deals, meId, isAdmin, actions }: Props) {
  const [adding, setAdding] = useState(false)
  const [handingOver, setHandingOver] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Where Connect Gmail is on, who has connected (docs/adr/0006).
  const showGmail = members.some((m) => m.gmailConnected !== undefined)
  // And Connect Fathom (docs/adr/0008).
  const showFathom = members.some((m) => m.fathomConnected !== undefined)

  const changeRole = (id: string, role: Role) => {
    setError(null)
    actions.setRole(id, role).catch((err: unknown) => setError(messageOf(err)))
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto px-6 pt-4 pb-6">
      <div className="flex items-start justify-between gap-3">
        <PageTitle
          title="Team"
          subtitle={
            isAdmin
              ? 'The business team. Add people before they sign in, so leads can be assigned to them.'
              : 'The business team. Admins add people and change roles.'
          }
        />
        {isAdmin && (
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setHandingOver(true)}
              className="rounded-lg border border-gray-200 bg-surface px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
            >
              Hand over admin
            </button>
            <AddButton label="Add member" onClick={() => setAdding(true)} />
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}
      <table className={table}>
        <thead className="bg-gray-50 text-[11px] text-gray-500">
          <tr>
            {['Name', 'Email', 'Role', ...(showGmail ? ['Gmail'] : []), ...(showFathom ? ['Fathom'] : []), 'Open deals', 'All deals', ''].map((h, i) => (
              <th key={i} className={headCell}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {members.map((member) => {
            const owned = deals.filter((d) => d.owner?.id === member.id)
            const supports = deals.some((d) => d.support.some((p) => p.id === member.id))
            return (
              <tr key={member.id} className="hover:bg-gray-50">
                <td className={cell}>
                  <span className="flex items-center gap-2 font-semibold text-gray-900">
                    <OwnerAvatar owner={member} />
                    <span>
                      {member.name}
                      {member.id === meId && <span className="ml-1 font-normal text-gray-400">(you)</span>}
                      {member.title && <span className="block text-[11px] font-normal text-gray-500">{member.title}</span>}
                    </span>
                  </span>
                </td>
                <td className={`${cell} text-gray-500`}>{member.email}</td>
                <td className={cell}>
                  {isAdmin ? (
                    <select
                      aria-label={`Role of ${member.name}`}
                      value={member.role ?? 'member'}
                      onChange={(e) => changeRole(member.id, e.target.value as Role)}
                      className="rounded-md border border-gray-200 bg-surface px-2 py-1 text-xs"
                    >
                      {ROLES.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    roleLabel(member.role)
                  )}
                </td>
                {showGmail && (
                  <td className={`${cell} whitespace-nowrap`}>
                    {member.gmailConnected ? <span className="text-emerald-700">Connected</span> : <span className="text-gray-500">Not yet</span>}
                  </td>
                )}
                {showFathom && (
                  <td className={`${cell} whitespace-nowrap`}>
                    {member.fathomConnected ? <span className="text-emerald-700">Connected</span> : <span className="text-gray-500">Not yet</span>}
                  </td>
                )}
                <td className={cell}>{owned.filter(isOpen).length || '—'}</td>
                <td className={cell}>{owned.length || '—'}</td>
                <td className={`${cell} text-right`}>
                  {isAdmin && member.id !== meId && owned.length === 0 && !supports && (
                    <DeleteButton what={member.name} onDelete={() => actions.remove(member.id)} />
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-gray-400">
        Someone who owns or supports deals stays on the team until their deals are reassigned.
      </p>

      {handingOver && (
        <HandOverDialog
          others={members.filter((m) => m.id !== meId)}
          onHandOver={async (id, stepDownTo) => {
            await actions.handOver(id, stepDownTo)
            setHandingOver(false)
          }}
          onClose={() => setHandingOver(false)}
        />
      )}
      {adding && (
        <AddMemberDialog
          onAdd={async (member) => {
            await actions.add(member)
            setAdding(false)
          }}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  )
}

function AddMemberDialog({ onAdd, onClose }: { onAdd: (member: MemberInput) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('member')
  const [title, setTitle] = useState('')
  return (
    <FormDialog
      title="Add member"
      submitLabel="Add member"
      onSubmit={() => onAdd({ name: name.trim(), email: email.trim(), role, title: title.trim() })}
      onClose={onClose}
    >
      <label className="block">
        Name
        <input required data-autofocus value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </label>
      <label className="block">
        Email
        <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
      </label>
      <label className="block">
        Title <span className="font-normal text-gray-400">(optional)</span>
        <input
          value={title}
          maxLength={100}
          placeholder="e.g. Partnerships Lead"
          onChange={(e) => setTitle(e.target.value)}
          className={inputClass}
        />
      </label>
      <label className="block">
        Role
        <select value={role} onChange={(e) => setRole(e.target.value as Role)} className={inputClass}>
          {ROLES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
    </FormDialog>
  )
}

function HandOverDialog({
  others,
  onHandOver,
  onClose,
}: {
  others: Person[]
  onHandOver: (id: string, stepDownTo: 'board' | 'member') => Promise<void>
  onClose: () => void
}) {
  const [to, setTo] = useState('')
  const [stepDownTo, setStepDownTo] = useState<'board' | 'member'>('board')
  return (
    <FormDialog title="Hand over admin" submitLabel="Hand over" onSubmit={() => onHandOver(to, stepDownTo)} onClose={onClose}>
      <p className="text-xs text-gray-600">
        For a new head of business: they become an admin, and you step down, in one go. Nobody needs to change the
        app’s configuration.
      </p>
      <label className="block">
        New admin
        <select required data-autofocus value={to} onChange={(e) => setTo(e.target.value)} className={inputClass}>
          <option value="">Pick a team member…</option>
          {others.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.email})
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        You become
        <select value={stepDownTo} onChange={(e) => setStepDownTo(e.target.value as 'board' | 'member')} className={inputClass}>
          <option value="board">Board</option>
          <option value="member">Member</option>
        </select>
      </label>
    </FormDialog>
  )
}
