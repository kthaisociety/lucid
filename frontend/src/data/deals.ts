// The deal model mirrors the business team's deal log (one row per deal, with status, next step, fee
// and invoice). The API returns deals in this shape (internal/deals/model.go).

export type Status = 'lead' | 'discussing' | 'agreement' | 'signed' | 'finished' | 'canceled'

// Board columns, in pipeline order. Canceled deals are shown only on request.
export const STATUSES: { id: Status; label: string }[] = [
  { id: 'lead', label: 'Lead' },
  { id: 'discussing', label: 'Discussing' },
  { id: 'agreement', label: 'Agreement' },
  { id: 'signed', label: 'Signed' },
  { id: 'finished', label: 'Finished' },
  { id: 'canceled', label: 'Canceled' },
]

export type DealType = 'Event' | 'Partnership' | 'Job Post'
export const DEAL_TYPES: DealType[] = ['Event', 'Partnership', 'Job Post']

export type EventType =
  | 'Workshop'
  | 'Hackathon'
  | 'After-Work'
  | 'Lunch Lecture'
  | 'Networking event'
  | 'Panel discussion'
  | 'Company visit'
  | 'Study-trip'
  | 'Job post'
  | 'Other'
  | 'TBA'

export const EVENT_TYPES: EventType[] = [
  'Workshop',
  'Hackathon',
  'After-Work',
  'Lunch Lecture',
  'Networking event',
  'Panel discussion',
  'Company visit',
  'Study-trip',
  'Job post',
  'Other',
  'TBA',
]

export type Audience = 'Internal' | 'External' | 'Unclear'
export const AUDIENCES: Audience[] = ['Internal', 'External', 'Unclear']

export type InvoiceStatus = 'not_sent' | 'waiting' | 'paid' | 'cancelled'

export const INVOICE_STATUSES: { id: InvoiceStatus; label: string }[] = [
  { id: 'not_sent', label: 'Not sent' },
  { id: 'waiting', label: 'Waiting for payment' },
  { id: 'paid', label: 'Paid' },
  { id: 'cancelled', label: 'Cancelled' },
]

// What a team member may do (docs/adr/0003): admins also manage the team.
export type Role = 'admin' | 'board' | 'member'
export const ROLES: { id: Role; label: string }[] = [
  { id: 'admin', label: 'Admin' },
  { id: 'board', label: 'Board' },
  { id: 'member', label: 'Member' },
]

// Reports are for the board and admins (docs/adr/0003).
export const canSeeReports = (role: Role | undefined) => role === 'admin' || role === 'board'

// A business-team member: a deal's owner or support, or someone on the Team page. Their title
// ("Partnerships Lead") only describes them; their role is what they may do. gmailConnected is there only
// where Connect Gmail is on (docs/adr/0006).
export type Person = {
  id: string
  name: string
  email: string
  role?: Role
  title?: string
  gmailConnected?: boolean
  fathomConnected?: boolean // there only where Connect Fathom is on (docs/adr/0008)
}

export type Company = { id: string; name: string; website: string; notes: string }

// A person at a company. A deal's contact always works at the deal's company.
export type Contact = { id: string; companyId: string; name: string; email: string; role: string }

export type Activity = {
  id: string
  type: 'email' | 'meeting' | 'note'
  // Where the entry came from: email sync and Fathom add entries of their own (docs/adr/0006).
  source: 'manual' | 'email_sync' | 'fathom'
  title: string
  timestamp: string
  body: string
  bulletPoints?: string[]
  // A synced entry's origin: the Fathom recording, or the email in Gmail.
  url?: string
  // A synced email's: sent by the team, or received from outside.
  direction?: 'sent' | 'received'
}

export type Deal = {
  id: string
  companyId: string
  company: string // the company's name
  dealType: DealType
  eventType: EventType
  audience: Audience
  semester: string // "HT 2026" (autumn) or "VT 2026" (spring)
  status: Status
  startDate: string | null
  endDate: string | null
  location: string
  owner: Person | null
  support: Person[]
  contact: Contact | null
  nextStep: string
  nextStepDue: string | null
  feeSEK: number | null // null: not agreed yet; 0: free event
  invoiceStatus: InvoiceStatus | null
  invoiceDue: string | null
  links: { drive?: string; contract?: string; writeUp?: string }
  rating: number | null // 1–5, after the deal is finished
  notes: string
  activities: Activity[]
  createdAt: string // when it was added, for ordering deals within a semester
}

export const DAY = 24 * 60 * 60 * 1000

// A deal with no touchpoint for this many days gets a follow-up nudge.
export const FOLLOW_UP_AFTER_DAYS = 4
// After an email (docs/adr/0006): how long their email waits for our reply, and ours for theirs.
export const YOUR_TURN_AFTER_DAYS = 2
export const NO_REPLY_AFTER_DAYS = 5

export const isOpen = (deal: Deal) => deal.status !== 'finished' && deal.status !== 'canceled'

export function lastTouchpoint(deal: Deal): string | null {
  return deal.activities.reduce<string | null>((latest, a) => (!latest || a.timestamp > latest ? a.timestamp : latest), null)
}

export function daysSince(iso: string, now = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / DAY))
}

// Today's date as YYYY-MM-DD, in local time.
export function today(now = new Date()): string {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

// Whole calendar days from one YYYY-MM-DD date to another. Counted on dates, not elapsed hours, so a
// clock change (a 23- or 25-hour day) can't shift the count.
export function calendarDaysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY)
}

// Why an open deal needs attention. After an email, `who` is the contact's first name (null without a
// contact), for "Lina replied 2 days ago".
export type Nudge =
  | { kind: 'overdue' | 'inactive'; days: number }
  | { kind: 'your-turn' | 'no-reply'; days: number; who: string | null }

// Why an open deal needs attention, if it does: one nudge, the first that applies (docs/adr/0006).
// 1. An overdue next step.
// 2. Their email is the latest touchpoint, unanswered for YOUR_TURN_AFTER_DAYS: our turn.
// 3. Our email is the latest touchpoint, unanswered for NO_REPLY_AFTER_DAYS. Until then nothing: we're
//    waiting on them, so the inactivity nudge doesn't apply.
// 4. Otherwise (a note, a meeting or nothing last: nobody owes a reply), no touchpoint for
//    FOLLOW_UP_AFTER_DAYS.
export function nudgeFor(deal: Deal, now = Date.now()): Nudge | null {
  if (!isOpen(deal)) return null
  const todayDate = today(new Date(now))
  if (deal.nextStepDue && deal.nextStepDue < todayDate) {
    return { kind: 'overdue', days: calendarDaysBetween(deal.nextStepDue, todayDate) }
  }
  const latest = latestActivity(deal)
  const idle = latest ? daysSince(latest.timestamp, now) : 0
  if (latest?.type === 'email' && latest.direction) {
    const who = deal.contact?.name.trim().split(/\s+/)[0] || null
    if (latest.direction === 'received') {
      return idle >= YOUR_TURN_AFTER_DAYS ? { kind: 'your-turn', days: idle, who } : null
    }
    return idle >= NO_REPLY_AFTER_DAYS ? { kind: 'no-reply', days: idle, who } : null
  }
  return idle >= FOLLOW_UP_AFTER_DAYS ? { kind: 'inactive', days: idle } : null
}

function latestActivity(deal: Deal): Activity | null {
  return deal.activities.reduce<Activity | null>((latest, a) => (!latest || a.timestamp > latest.timestamp ? a : latest), null)
}

// Signed or finished: the company has committed to the fee.
export const isConfirmed = (deal: Deal) => deal.status === 'signed' || deal.status === 'finished'

// A confirmed fee no one has recorded as paid (or cancelled). An invoice status left unset counts too:
// nothing has been invoiced yet.
export const isUnpaid = (deal: Deal) =>
  isConfirmed(deal) && (deal.feeSEK ?? 0) > 0 && deal.invoiceStatus !== 'paid' && deal.invoiceStatus !== 'cancelled'

export function statusLabel(status: Status): string {
  return STATUSES.find((s) => s.id === status)?.label ?? status
}

export function invoiceLabel(deal: Deal): string | null {
  if (deal.feeSEK === 0) return 'Free event'
  return INVOICE_STATUSES.find((s) => s.id === deal.invoiceStatus)?.label ?? null
}

// Newest first: "HT 2026" (autumn) comes after "VT 2026" (spring).
export function compareSemesters(a: string, b: string): number {
  const key = (s: string) => {
    const [term, year] = s.split(' ')
    return Number(year) * 2 + (term === 'HT' ? 1 : 0)
  }
  return key(b) - key(a)
}

// The semester a date falls in: VT (spring) from January, HT (autumn) from July.
export function currentSemester(now = new Date()): string {
  return `${now.getMonth() >= 6 ? 'HT' : 'VT'} ${now.getFullYear()}`
}
