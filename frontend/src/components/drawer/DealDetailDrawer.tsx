import { useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { ExternalLink, Mail, MessageSquare, StickyNote, Star, Users, X } from 'lucide-react'
import {
  AUDIENCES,
  DEAL_TYPES,
  EVENT_TYPES,
  INVOICE_STATUSES,
  STATUSES,
  currentSemester,
  daysSince,
  lastTouchpoint,
  nudgeFor,
  compareSemesters,
  statusLabel,
  type Activity,
  type Audience,
  type Company,
  type Contact,
  type DealType,
  type EventType,
  type Deal,
  type Person,
  type InvoiceStatus,
  type Status,
} from '../../data/deals'
import { formatDate } from '../../format'
import type { DealPatch } from '../../api'
import { useDraft, useModal } from '../../hooks'
import { DealTypeBadge, NudgeBadge } from '../badges'
import OwnerAvatar from '../OwnerAvatar'

type Props = {
  deal: Deal
  otherDeals: Deal[] // earlier or parallel deals with the same company
  companies: Company[] // where the deal can move to
  companyContacts: Contact[] // who the deal's contact can be
  members: Person[] // who can own the deal
  meId: string | undefined
  onClose: () => void
  onChange: (patch: DealPatch) => void
  onAddNote: (text: string) => Promise<void>
  onSelect: (id: string) => void
}

const activityIcons = { email: Mail, meeting: Users, note: StickyNote } satisfies Record<Activity['type'], unknown>
const sourceLabels: Record<Activity['source'], string | null> = {
  manual: null,
  email_sync: 'via Gmail',
  fathom: 'via Fathom',
}

// A synced email's link opens it in the Gmail of the member whose mailbox it was found in, named in the
// link: Gmail's ids are per mailbox, so it's no use to anyone else.
function gmailOwner(url: string): string | null {
  try {
    return new URL(url).searchParams.get('authuser')?.toLowerCase() ?? null
  } catch {
    return null
  }
}

const field =
  'w-full rounded-md border border-gray-200 bg-surface px-2 py-1 text-xs text-gray-800 focus:border-indigo-300 focus:outline-none'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="pt-1 text-gray-500">{label}</dt>
      <dd className="min-w-0 pt-1 text-gray-900">{children}</dd>
    </>
  )
}

export default function DealDetailDrawer({
  deal,
  otherDeals,
  companies,
  companyContacts,
  members,
  meId,
  onClose,
  onChange,
  onAddNote,
  onSelect,
}: Props) {
  const [note, setNote] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [noteError, setNoteError] = useState<string | null>(null)
  const [nextStep, setNextStep] = useDraft(deal.nextStep)
  const [fee, setFee] = useDraft(deal.feeSEK === null ? '' : String(deal.feeSEK))
  const [location, setLocation] = useDraft(deal.location)
  const [notes, setNotes] = useDraft(deal.notes)

  const dialog = useRef<HTMLElement>(null)
  useModal(dialog, onClose)

  const saveNote = async (e: FormEvent) => {
    e.preventDefault()
    const text = note.trim()
    if (!text || savingNote) return
    const submitted = note
    setSavingNote(true)
    setNoteError(null)
    try {
      await onAddNote(text)
      // Clear the box only if it still holds the saved note, not something typed since.
      setNote((current) => (current === submitted ? '' : current))
    } catch (err) {
      setNoteError(`Couldn't save the note: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSavingNote(false)
    }
  }

  // Text fields save when you leave them or press Enter, not on every keystroke.
  const saveNextStep = () => {
    if (nextStep !== deal.nextStep) onChange({ nextStep })
  }
  const saveFee = () => {
    if (fee === '') {
      if (deal.feeSEK !== null) onChange({ feeSEK: null })
      return
    }
    const value = Number(fee)
    // A fee is a whole number of 0 or more; anything else goes back to the saved fee.
    if (!Number.isInteger(value) || value < 0) {
      setFee(deal.feeSEK === null ? '' : String(deal.feeSEK))
      return
    }
    if (value !== deal.feeSEK) onChange({ feeSEK: value })
  }
  // An end date needs a start date and can't be before it, so moving the start past the end, or clearing
  // it, clears the end too.
  const saveStart = (startDate: string | null) => {
    if (deal.endDate && (!startDate || startDate > deal.endDate)) onChange({ startDate, endDate: null })
    else onChange({ startDate })
  }
  const blurOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur()
  }

  const nudge = nudgeFor(deal)
  const last = lastTouchpoint(deal)
  const lastDays = last ? daysSince(last) : null
  const timeline = [...deal.activities].sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  const mailto = deal.contact?.email
    ? `mailto:${deal.contact.email}?subject=${encodeURIComponent(`KTHAIS × ${deal.company}`)}`
    : undefined
  const supportIds = deal.support.map((p) => p.id)
  const canSupport = members.filter((m) => m.id !== deal.owner?.id && !supportIds.includes(m.id))

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label="Close details" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-black/30" />
      <aside
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={deal.company}
        className="relative flex h-full w-[440px] max-w-full flex-col border-l focus:outline-none border-gray-200 bg-surface shadow-xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-display text-base font-bold text-gray-900">{deal.company}</h2>
              <DealTypeBadge dealType={deal.dealType} />
            </div>
            <p className="mt-0.5 text-xs text-gray-500">
              {deal.eventType} · {deal.audience} · {deal.semester}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
            <X size={18} aria-hidden />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto pb-6">
          <div className="flex items-center gap-2 px-5 pt-4">
            {mailto ? (
              <a
                href={mailto}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                <Mail size={14} aria-hidden /> Send Email
              </a>
            ) : (
              <span className="rounded-lg border border-dashed border-gray-200 px-3 py-1.5 text-xs text-gray-400">No contact email</span>
            )}
            <label className="flex items-center gap-1.5 text-xs text-gray-500">
              Status
              <select
                value={deal.status}
                onChange={(e) => onChange({ status: e.target.value as Status })}
                className="rounded-lg border border-gray-200 bg-surface px-2 py-1.5 text-xs font-semibold text-gray-800"
              >
                {STATUSES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <section aria-label="Next step" className="mx-5 mt-4 rounded-lg border border-indigo-100 bg-indigo-50/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-gray-700">Next step</h3>
              {nudge && <NudgeBadge nudge={nudge} />}
            </div>
            <label className="sr-only" htmlFor="next-step">
              Next step
            </label>
            <input
              id="next-step"
              value={nextStep}
              onChange={(e) => setNextStep(e.target.value)}
              onBlur={saveNextStep}
              onKeyDown={blurOnEnter}
              placeholder="What happens next?"
              className={`${field} mt-2`}
            />
            <label className="mt-2 flex items-center gap-2 text-xs text-gray-500">
              Due
              <input
                type="date"
                value={deal.nextStepDue ?? ''}
                onChange={(e) => onChange({ nextStepDue: e.target.value || null })}
                className={`${field} w-auto`}
              />
            </label>
          </section>

          <dl className="mx-5 mt-4 grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-1.5 text-xs">
            <Row label="Company">
              <select
                aria-label="Company"
                value={deal.companyId}
                onChange={(e) => onChange({ companyId: e.target.value })}
                className={`${field} w-auto max-w-full`}
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Type">
              <span className="flex flex-wrap gap-1.5">
                <select
                  aria-label="Deal type"
                  value={deal.dealType}
                  onChange={(e) => onChange({ dealType: e.target.value as DealType })}
                  className={`${field} w-auto`}
                >
                  {DEAL_TYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
                <select
                  aria-label="Event type"
                  value={deal.eventType}
                  onChange={(e) => onChange({ eventType: e.target.value as EventType })}
                  className={`${field} w-auto`}
                >
                  {EVENT_TYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </span>
            </Row>
            <Row label="Audience">
              <select
                aria-label="Audience"
                value={deal.audience}
                onChange={(e) => onChange({ audience: e.target.value as Audience })}
                className={`${field} w-auto`}
              >
                {AUDIENCES.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </Row>
            <Row label="Semester">
              <select
                aria-label="Semester"
                value={deal.semester}
                onChange={(e) => onChange({ semester: e.target.value })}
                className={`${field} w-auto`}
              >
                {semesterOptions(deal.semester).map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Row>
            <Row label="Owner">
              <span className="flex flex-wrap items-center gap-2">
                {deal.owner && <OwnerAvatar owner={deal.owner} />}
                <select
                  aria-label="Owner"
                  value={deal.owner?.id ?? ''}
                  onChange={(e) => onChange({ ownerId: e.target.value || null })}
                  className={`${field} w-auto max-w-full`}
                >
                  <option value="">Unassigned</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                {meId && deal.owner?.id !== meId && (
                  <button
                    type="button"
                    onClick={() => onChange({ ownerId: meId })}
                    className="text-xs font-semibold text-indigo-700 hover:underline"
                  >
                    Assign to me
                  </button>
                )}
              </span>
            </Row>
            <Row label="Support">
              <span className="flex flex-wrap items-center gap-1.5">
                {deal.support.map((p) => (
                  <span key={p.id} className="flex items-center gap-1 rounded-full bg-gray-100 py-0.5 pr-1 pl-2 text-gray-700">
                    {p.name}
                    <button
                      type="button"
                      aria-label={`Remove ${p.name} from support`}
                      onClick={() => onChange({ supportIds: supportIds.filter((id) => id !== p.id) })}
                      className="rounded-full p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
                    >
                      <X size={10} aria-hidden />
                    </button>
                  </span>
                ))}
                {canSupport.length > 0 && (
                  <select
                    aria-label="Add support"
                    value=""
                    onChange={(e) => e.target.value && onChange({ supportIds: [...supportIds, e.target.value] })}
                    className={`${field} w-auto`}
                  >
                    <option value="">Add…</option>
                    {canSupport.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                )}
              </span>
            </Row>
            <Row label="Contact">
              <select
                aria-label="Contact"
                value={deal.contact?.id ?? ''}
                onChange={(e) => onChange({ contactId: e.target.value || null })}
                className={`${field} w-auto max-w-full`}
              >
                <option value="">No contact</option>
                {companyContacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || c.email}
                  </option>
                ))}
              </select>
              {deal.contact && (deal.contact.role || deal.contact.email) && (
                <p className="mt-0.5 text-gray-500">
                  {[deal.contact.role, deal.contact.email].filter(Boolean).join(' · ')}
                </p>
              )}
            </Row>
            <Row label="Date">
              <span className="flex flex-wrap items-center gap-1.5">
                <input
                  type="date"
                  aria-label="Start date"
                  value={deal.startDate ?? ''}
                  onChange={(e) => saveStart(e.target.value || null)}
                  className={`${field} w-auto`}
                />
                <span className="text-gray-400">to</span>
                <input
                  type="date"
                  aria-label="End date"
                  value={deal.endDate ?? ''}
                  min={deal.startDate ?? undefined}
                  disabled={!deal.startDate}
                  title={deal.startDate ? undefined : 'Set a start date first'}
                  onChange={(e) => onChange({ endDate: e.target.value || null })}
                  className={`${field} w-auto disabled:opacity-50`}
                />
              </span>
            </Row>
            <Row label="Location">
              <input
                aria-label="Location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                onBlur={() => location.trim() !== deal.location && onChange({ location: location.trim() })}
                onKeyDown={blurOnEnter}
                placeholder="TBA"
                className={field}
              />
            </Row>
            <Row label="Last touchpoint">
              {lastDays === null ? '—' : lastDays === 0 ? 'Today' : `${lastDays} ${lastDays === 1 ? 'day' : 'days'} ago`}
            </Row>
            <Row label="Fee (SEK)">
              <input
                type="number"
                aria-label="Fee (SEK)"
                min={0}
                step={1000}
                value={fee}
                placeholder="Not agreed"
                onChange={(e) => setFee(e.target.value)}
                onBlur={saveFee}
                onKeyDown={blurOnEnter}
                className={`${field} w-32`}
              />
            </Row>
            {deal.feeSEK !== 0 && (
              <Row label="Invoice">
                <span className="flex flex-wrap items-center gap-1.5">
                  <select
                    aria-label="Invoice"
                    value={deal.invoiceStatus ?? ''}
                    onChange={(e) => onChange({ invoiceStatus: (e.target.value || null) as InvoiceStatus | null })}
                    className={`${field} w-auto`}
                  >
                    <option value="">—</option>
                    {INVOICE_STATUSES.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <span className="text-gray-400">due</span>
                  <input
                    type="date"
                    aria-label="Invoice due"
                    value={deal.invoiceDue ?? ''}
                    onChange={(e) => onChange({ invoiceDue: e.target.value || null })}
                    className={`${field} w-auto`}
                  />
                </span>
              </Row>
            )}
            <Row label="Rating">
              <span className="flex items-center gap-0.5 text-amber-500" role="group" aria-label="Rating">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-label={`${n} out of 5`}
                    aria-pressed={deal.rating === n}
                    title={deal.rating === n ? 'Clear the rating' : undefined}
                    // The current rating again clears it.
                    onClick={() => onChange({ rating: deal.rating === n ? null : n })}
                    className="rounded p-0.5 hover:bg-amber-50"
                  >
                    <Star size={13} fill={deal.rating !== null && n <= deal.rating ? 'currentColor' : 'none'} aria-hidden />
                  </button>
                ))}
              </span>
            </Row>
            {LINKS.map(({ key, label }) => (
              <Row key={key} label={label}>
                <LinkField label={label} value={deal.links[key] ?? ''} onSave={(value) => onChange({ links: { [key]: value } })} />
              </Row>
            ))}
          </dl>

          <label className="mx-5 mt-4 block text-xs font-semibold text-gray-700">
            Notes
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => notes.trim() !== deal.notes && onChange({ notes: notes.trim() })}
              rows={3}
              placeholder="Anything worth knowing about this deal"
              className="mt-1.5 w-full resize-y rounded-lg border border-gray-200 bg-gray-50 p-2.5 text-xs font-normal text-gray-700 placeholder-gray-400 focus:border-indigo-300 focus:bg-surface focus:outline-none"
            />
          </label>

          {otherDeals.length > 0 && (
            <section aria-label="Other deals" className="mx-5 mt-4">
              <h3 className="text-xs font-semibold text-gray-700">Other deals with {deal.company}</h3>
              <ul className="mt-1.5 space-y-1">
                {otherDeals.map((other) => (
                  <li key={other.id}>
                    <button type="button" onClick={() => onSelect(other.id)} className="text-xs text-indigo-600 hover:underline">
                      {other.semester} · {other.eventType} · {statusLabel(other.status)}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <form onSubmit={saveNote} className="mx-5 mt-5">
            <label htmlFor="quick-note" className="flex items-center gap-1.5 text-xs font-semibold text-gray-700">
              <MessageSquare size={14} aria-hidden /> Quick note
            </label>
            <textarea
              id="quick-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="What happened? Call, reply, next step…"
              className="mt-1.5 w-full resize-none rounded-lg border border-gray-200 p-2.5 text-xs text-gray-800 placeholder-gray-400 focus:border-indigo-300 focus:outline-none"
            />
            {noteError && (
              <p role="alert" className="mt-1 text-xs text-red-600">
                {noteError}
              </p>
            )}
            <div className="mt-1.5 flex justify-end">
              <button
                type="submit"
                disabled={!note.trim() || savingNote}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-hover disabled:opacity-40"
              >
                {savingNote ? 'Saving…' : 'Save Note'}
              </button>
            </div>
          </form>

          <section aria-label="Timeline" className="mx-5 mt-4">
            <h3 className="text-xs font-semibold text-gray-700">Timeline</h3>
            <ol className="mt-3 space-y-4 border-l border-gray-200 pl-4">
              {timeline.map((activity) => {
                const Icon = activityIcons[activity.type]
                const source = sourceLabels[activity.source]
                return (
                  <li key={activity.id} className="relative">
                    <span className="absolute top-0 -left-[25px] flex h-[17px] w-[17px] items-center justify-center rounded-full border border-gray-200 bg-surface text-gray-500">
                      <Icon size={10} aria-hidden />
                    </span>
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-xs font-semibold text-gray-900">
                        {activity.direction && (
                          <span className="mr-1.5 rounded bg-gray-100 px-1 py-px text-[10px] font-medium text-gray-600">
                            {activity.direction === 'sent' ? 'Sent' : 'Received'}
                          </span>
                        )}
                        {activity.title}
                        {source && <span className="ml-1.5 font-normal text-gray-500">{source}</span>}
                      </p>
                      <time dateTime={activity.timestamp} className="shrink-0 text-[11px] text-gray-400">
                        {formatDate(activity.timestamp)}
                      </time>
                    </div>
                    {activity.body && <p className="mt-0.5 text-xs whitespace-pre-line text-gray-600">{activity.body}</p>}
                    {activity.bulletPoints && (
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-gray-600">
                        {activity.bulletPoints.map((point) => (
                          <li key={point}>{point}</li>
                        ))}
                      </ul>
                    )}
                    <OpenLink activity={activity} myEmail={members.find((m) => m.id === meId)?.email} members={members} />
                  </li>
                )
              })}
            </ol>
          </section>
        </div>
      </aside>
    </div>
  )
}

const LINKS = [
  { key: 'drive', label: 'Drive' },
  { key: 'contract', label: 'Contract' },
  { key: 'writeUp', label: 'Write-up' },
] as const satisfies { key: keyof Deal['links']; label: string }[]

// The semesters a deal can be moved to: last year's to two years ahead, newest first, and the deal's own.
function semesterOptions(own: string, now = new Date()): string[] {
  const year = now.getFullYear()
  const options = [year + 2, year + 1, year, year - 1].flatMap((y) => [`HT ${y}`, `VT ${y}`])
  if (!options.includes(own)) options.push(own)
  if (!options.includes(currentSemester(now))) options.push(currentSemester(now))
  return options.sort(compareSemesters)
}

// Only web addresses become links: anything else (a javascript: URL, say) is shown as text.
const isWebAddress = (value: string) => /^https?:\/\/[^/\s]/i.test(value)

// A link to a deal's folder or document: edited in place, saved when you leave the field, and opened from
// the icon beside it.
function LinkField({ label, value, onSave }: { label: string; value: string; onSave: (value: string) => void }) {
  const [draft, setDraft] = useDraft(value)
  return (
    <span className="flex items-center gap-1.5">
      <input
        type="url"
        aria-label={`${label} link`}
        value={draft}
        placeholder="https://…"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft.trim() !== value && onSave(draft.trim())}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className={field}
      />
      {isWebAddress(value) && (
        <a href={value} target="_blank" rel="noreferrer" aria-label={`Open ${label}`} className="shrink-0 text-indigo-600 hover:text-indigo-800">
          <ExternalLink size={13} aria-hidden />
        </a>
      )}
    </span>
  )
}

// Where a synced entry links back to: the Fathom recording, or the email in Gmail for the member whose
// mailbox it's in. Anyone else is told whose Gmail has it.
function OpenLink({ activity, myEmail, members }: { activity: Activity; myEmail: string | undefined; members: Person[] }) {
  // Only https: a synced link is never a javascript: or other scheme.
  if (!activity.url?.startsWith('https://')) return null
  const link = (label: string) => (
    <a
      href={activity.url}
      target="_blank"
      rel="noreferrer"
      className="mt-1 inline-block text-[11px] font-semibold text-indigo-700 hover:underline"
    >
      {label}
    </a>
  )
  if (activity.type !== 'email') return link('Open recording')
  const owner = gmailOwner(activity.url)
  if (!owner || owner === myEmail?.toLowerCase()) return link('Open in Gmail')
  const name = members.find((m) => m.email.toLowerCase() === owner)?.name ?? owner
  return <p className="mt-1 text-[11px] text-gray-500">In {name}’s Gmail</p>
}
