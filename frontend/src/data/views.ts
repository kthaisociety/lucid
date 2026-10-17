// Companies, contacts and semester reports, with each company's and contact's deals gathered from the
// deal list.
import {
  STATUSES,
  compareSemesters,
  isConfirmed,
  isOpen,
  isUnpaid,
  lastTouchpoint,
  nudgeFor,
  type Company,
  type Contact,
  type Deal,
  type DealType,
  type Person,
  type Status,
} from './deals'

const latestOf = (dates: (string | null)[]) =>
  dates.reduce<string | null>((latest, d) => (d && (!latest || d > latest) ? d : latest), null)

const sumFees = (deals: Deal[]) => deals.reduce((sum, d) => sum + (d.feeSEK ?? 0), 0)

// Newest semester first; within one, the most recently added first.
const newestFirst = (a: Deal, b: Deal) => compareSemesters(a.semester, b.semester) || b.createdAt.localeCompare(a.createdAt)

function groupBy(deals: Deal[], key: (d: Deal) => string | undefined): Map<string, Deal[]> {
  const groups = new Map<string, Deal[]>()
  for (const deal of deals) {
    const k = key(deal)
    if (k) groups.set(k, [...(groups.get(k) ?? []), deal])
  }
  return groups
}

export type CompanyRow = {
  company: Company
  contacts: Contact[]
  deals: Deal[] // newest semester first
  open: number
  confirmedSEK: number
  owners: Person[]
  lastTouchpoint: string | null
}

export function companiesFrom(companies: Company[], contacts: Contact[], deals: Deal[]): CompanyRow[] {
  const dealsBy = groupBy(deals, (d) => d.companyId)
  return companies
    .map((company) => {
      const sorted = [...(dealsBy.get(company.id) ?? [])].sort(newestFirst)
      const owners = new Map<string, Person>()
      for (const d of sorted) if (d.owner) owners.set(d.owner.id, d.owner)
      return {
        company,
        contacts: contacts.filter((c) => c.companyId === company.id),
        deals: sorted,
        open: sorted.filter(isOpen).length,
        confirmedSEK: sumFees(sorted.filter(isConfirmed)),
        owners: [...owners.values()],
        lastTouchpoint: latestOf(sorted.map(lastTouchpoint)),
      }
    })
    .sort((a, b) => a.company.name.localeCompare(b.company.name))
}

export type ContactRow = {
  contact: Contact
  company: string
  deals: Deal[] // newest semester first
  lastTouchpoint: string | null
}

export function contactsFrom(contacts: Contact[], companies: Company[], deals: Deal[]): ContactRow[] {
  const dealsBy = groupBy(deals, (d) => d.contact?.id)
  const companyName = new Map(companies.map((c) => [c.id, c.name]))
  return contacts
    .map((contact) => {
      const sorted = [...(dealsBy.get(contact.id) ?? [])].sort(newestFirst)
      return {
        contact,
        company: companyName.get(contact.companyId) ?? '',
        deals: sorted,
        lastTouchpoint: latestOf(sorted.map(lastTouchpoint)),
      }
    })
    .sort((a, b) => (a.contact.name || a.contact.email).localeCompare(b.contact.name || b.contact.email))
}

export type Bar = { label: string; value: number; status?: Status }

export type SemesterReport = {
  semester: string
  deals: number
  open: number
  won: number // signed or finished
  canceled: number
  // Won out of decided (won + canceled), or null before anything is decided.
  winRate: number | null
  confirmedSEK: number
  paidSEK: number
  unpaidSEK: number
  pipelineSEK: number // fees agreed on deals still open
  byStatus: Bar[]
  confirmedByType: Bar[]
  byOwner: Bar[]
  needsFollowUp: Deal[]
}

export function reportFor(semester: string, all: Deal[], now = Date.now()): SemesterReport {
  const deals = all.filter((d) => d.semester === semester)
  const won = deals.filter(isConfirmed)
  const canceled = deals.filter((d) => d.status === 'canceled')
  const decided = won.length + canceled.length

  const count = (pick: (d: Deal) => string) => {
    const counts = new Map<string, number>()
    for (const d of deals) counts.set(pick(d), (counts.get(pick(d)) ?? 0) + 1)
    return counts
  }
  const statusCounts = count((d) => d.status)
  // By member, not name: two teammates can share a name. Shared names get their email to tell them apart.
  const ownerCounts = count((d) => d.owner?.id ?? '')
  const owners = new Map(deals.flatMap((d) => (d.owner ? [[d.owner.id, d.owner] as const] : [])))
  const ownerLabel = (id: string) => {
    const owner = owners.get(id)
    if (!owner) return 'Unassigned'
    const shared = [...owners.values()].some((o) => o.id !== id && o.name === owner.name)
    return shared ? `${owner.name} (${owner.email})` : owner.name
  }
  const types: DealType[] = ['Event', 'Partnership', 'Job Post']

  return {
    semester,
    deals: deals.length,
    open: deals.filter(isOpen).length,
    won: won.length,
    canceled: canceled.length,
    winRate: decided ? won.length / decided : null,
    confirmedSEK: sumFees(won),
    paidSEK: sumFees(won.filter((d) => d.invoiceStatus === 'paid')),
    unpaidSEK: sumFees(won.filter(isUnpaid)),
    pipelineSEK: sumFees(deals.filter(isOpen).filter((d) => !isConfirmed(d))),
    byStatus: STATUSES.map((s) => ({ label: s.label, value: statusCounts.get(s.id as Status) ?? 0, status: s.id as Status })),
    confirmedByType: types.map((t) => ({ label: t, value: sumFees(won.filter((d) => d.dealType === t)) })),
    byOwner: [...ownerCounts]
      .map(([id, value]) => ({ label: ownerLabel(id), value }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)),
    needsFollowUp: deals.filter((d) => nudgeFor(d, now) !== null),
  }
}

export type MyStats = {
  report: SemesterReport // of the semester's deals the member owns
  supporting: Deal[] // the semester's open deals they support
  waiting: Deal[] // their open deals with a nudge, the most pressing first
  history: SemesterReport[] // each semester they owned a deal in, newest first
}

const nudgeOrder = ['overdue', 'your-turn', 'no-reply', 'inactive']

// One member's numbers: what the Reports page shows for the team, for the deals they own.
export function myStatsFor(memberId: string, semester: string, all: Deal[], now = Date.now()): MyStats {
  const owned = all.filter((d) => d.owner?.id === memberId)
  const report = reportFor(semester, owned, now)
  const rank = (d: Deal) => {
    const nudge = nudgeFor(d, now)!
    return [nudgeOrder.indexOf(nudge.kind), -nudge.days] as const
  }
  const waiting = [...report.needsFollowUp].sort((a, b) => {
    const [ka, da] = rank(a)
    const [kb, db] = rank(b)
    return ka - kb || da - db
  })
  const semesters = [...new Set(owned.map((d) => d.semester))].sort(compareSemesters)
  return {
    report,
    supporting: all.filter((d) => d.semester === semester && isOpen(d) && d.support.some((p) => p.id === memberId)),
    waiting,
    history: semesters.map((s) => reportFor(s, owned, now)),
  }
}
