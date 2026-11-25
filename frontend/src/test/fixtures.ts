// Made-up deals for frontend tests (docs/pcr/0005): fictional companies and people, @example.com emails,
// invented fees. Dates are relative to today, so follow-up nudges look the same whenever tests run.
// cmd/seed has the same deals for local development.
import { DAY, currentSemester, today, type Activity, type Company, type Contact, type Deal, type Person } from '../data/deals'

// Semesters relative to today, so the current one always has the open deals.
const previous = (semester: string) => {
  const [term, year] = semester.split(' ')
  return term === 'HT' ? `VT ${year}` : `HT ${Number(year) - 1}`
}
export const thisSemester = currentSemester()
export const lastSemester = previous(thisSemester)
export const earlierSemester = previous(lastSemester)

// Helpers for dates relative to today.
const daysFromNow = (n: number) => today(new Date(Date.now() + n * DAY))
const hoursAgo = (n: number) => new Date(Date.now() - n * 60 * 60 * 1000).toISOString()
const daysAgo = (n: number) => hoursAgo(n * 24)

const alva: Person = { id: 'm-alva', name: 'Alva Lindqvist', email: 'alva.lindqvist@example.com', role: 'admin' }
const oskar: Person = { id: 'm-oskar', name: 'Oskar Berg', email: 'oskar.berg@example.com', role: 'board' }
const maja: Person = { id: 'm-maja', name: 'Maja Holm', email: 'maja.holm@example.com', role: 'board' }
const noah: Person = { id: 'm-noah', name: 'Noah Ek', email: 'noah.ek@example.com', role: 'member' }
const iris: Person = { id: 'm-iris', name: 'Iris Wallin', email: 'iris.wallin@example.com', role: 'member' }

// The team, with the dev user every test signs in as (test/fakeApi.ts).
export const devMember: Person = { id: 'm-dev', name: 'Dev User', email: 'dev@kthais.com', role: 'admin' }
export const fixtureMembers: Person[] = [alva, devMember, iris, maja, noah, oskar]

const base = {
  startDate: null,
  endDate: null,
  location: '',
  support: [],
  contact: null,
  nextStep: '',
  nextStepDue: null,
  feeSEK: null,
  invoiceStatus: null,
  invoiceDue: null,
  links: {},
  rating: null,
  notes: '',
  createdAt: '2026-01-01T00:00:00Z',
} satisfies Partial<Deal>

const note = (id: string, title: string, at: string, body = ''): Activity => ({
  id,
  type: 'note',
  source: 'manual',
  title,
  timestamp: at,
  body,
})

// Deals as written below: company by name and contact by details. The companies and contacts tables are
// worked out from them at the bottom, with stable ids.
type RawDeal = Omit<Deal, 'companyId' | 'contact' | 'involvesGrowth' | 'growthTask'> & { contact: Omit<Contact, 'id' | 'companyId'> | null }

const rawDeals: RawDeal[] = [
  {
    ...base,
    id: 'fjallbacka',
    company: 'Fjällbacka Ventures',
    dealType: 'Event',
    eventType: 'After-Work',
    audience: 'External',
    semester: thisSemester,
    status: 'discussing',
    owner: alva,
    support: [noah],
    contact: { name: 'Clara Nord', email: 'clara.nord@example.com', role: 'Community Lead' },
    nextStep: 'Send the one-pager: dinner or hackathon sponsorship',
    nextStepDue: daysFromNow(2),
    notes: 'Deciding between a founders dinner and sponsoring the autumn hackathon.',
    activities: [
      {
        id: 'fjallbacka-1',
        type: 'meeting',
        source: 'fathom',
        url: 'https://fathom.video/share/made-up',
        title: 'Intro call',
        timestamp: daysAgo(6),
        body: 'Good fit; they want visibility with founders.',
        bulletPoints: ['Prefer an evening format', 'Budget decided per event', 'Want a one-pager to take internally'],
      },
      {
        id: 'fjallbacka-3',
        type: 'email',
        source: 'email_sync',
        direction: 'received',
        url: 'https://mail.google.com/mail/?authuser=dev%40kthais.com#all/made-up',
        title: 'Re: Founders dinner',
        timestamp: daysAgo(3),
        body: 'Thanks! Could you send a one-pager we can share internally?',
      },
      note('fjallbacka-2', 'Drafted one-pager', daysAgo(1), 'Draft shared with Noah for review.'),
    ],
  },
  {
    ...base,
    id: 'kvarnholmen',
    company: 'Kvarnholmen AI',
    dealType: 'Event',
    eventType: 'After-Work',
    audience: 'External',
    semester: thisSemester,
    status: 'agreement',
    startDate: '2026-11-05',
    location: 'KTH Innovation',
    owner: oskar,
    support: [iris],
    contact: { name: 'Hugo Sjöberg', email: 'hugo.sjoberg@example.com', role: 'Partner' },
    nextStep: 'Send contract for signing; get KTHAIS added as event co-host',
    nextStepDue: daysFromNow(-2),
    feeSEK: 20_000,
    notes: 'Agreed on format and fee on the last call.',
    activities: [
      {
        id: 'kvarnholmen-1',
        type: 'email',
        source: 'manual',
        title: 'Confirmed fee and date',
        timestamp: daysAgo(3),
        body: '20,000 SEK, after-work on 5 November at KTH Innovation.',
      },
    ],
  },
  {
    ...base,
    id: 'granit',
    company: 'Granit Consulting',
    dealType: 'Event',
    eventType: 'Lunch Lecture',
    audience: 'External',
    semester: thisSemester,
    status: 'signed',
    startDate: '2026-12-04',
    location: 'Granit office',
    owner: maja,
    support: [oskar],
    contact: { name: 'Lina Dahl', email: 'lina.dahl@example.com', role: 'Recruitment Manager' },
    nextStep: 'Send invoice (30-day terms) and plan logistics for 4 Dec',
    nextStepDue: daysFromNow(5),
    feeSEK: 40_000,
    invoiceStatus: 'not_sent',
    links: { contract: 'https://drive.example.com/granit-contract' },
    notes: 'Signed: 40,000 SEK, and Granit covers food and venue. 30-day payment terms.',
    activities: [note('granit-1', 'Contract signed', daysAgo(2), 'Both parties signed.')],
  },
  {
    ...base,
    id: 'stromma',
    company: 'Strömma Robotics',
    dealType: 'Event',
    eventType: 'Hackathon',
    audience: 'External',
    semester: thisSemester,
    status: 'agreement',
    startDate: '2026-11-09',
    endDate: '2026-11-13',
    owner: alva,
    contact: { name: 'Viktor Lund', email: 'viktor.lund@example.com', role: 'Head of Engineering' },
    nextStep: 'Agree the challenge brief',
    nextStepDue: daysFromNow(4),
    feeSEK: 40_000,
    invoiceStatus: 'not_sent',
    notes: 'Co-hosted robotics hackathon; another company may join as a second sponsor.',
    activities: [note('stromma-1', 'Shared draft brief', daysAgo(2))],
  },
  {
    ...base,
    id: 'lumen',
    company: 'Lumen Health',
    dealType: 'Event',
    eventType: 'Hackathon',
    audience: 'Unclear',
    semester: thisSemester,
    status: 'lead',
    owner: noah,
    support: [maja],
    contact: { name: 'Ella Berg', email: 'ella.berg@example.com', role: 'CTO' },
    nextStep: 'Ask a board member for an intro after the exam period',
    notes: 'Healthcare hackathon idea.',
    activities: [note('lumen-1', 'Added as a lead', daysAgo(6), 'Heard about them at a meetup.')],
  },
  {
    ...base,
    id: 'saltsjo',
    company: 'Saltsjö Insurance',
    dealType: 'Job Post',
    eventType: 'Job post',
    audience: 'External',
    semester: thisSemester,
    status: 'discussing',
    owner: iris,
    contact: { name: 'Per Ström', email: 'per.strom@example.com', role: 'Talent Partner' },
    nextStep: 'Offer a job post or thesis listing',
    nextStepDue: daysFromNow(1),
    notes: 'Thesis and part-time AI roles in insurance.',
    activities: [note('saltsjo-1', 'Replied to their questions', daysAgo(1))],
  },
  {
    ...base,
    id: 'stadsnat',
    company: 'Stadsnät Labs',
    dealType: 'Partnership',
    eventType: 'TBA',
    audience: 'Unclear',
    semester: thisSemester,
    status: 'lead',
    owner: null, // no one has claimed it yet
    contact: { name: 'Sara Kvist', email: 'sara.kvist@example.com', role: 'Innovation Manager' },
    nextStep: 'Await reply to follow-up email',
    notes: 'Met at a career fair. Want to reach students; open to an event or exposure.',
    activities: [
      {
        id: 'stadsnat-1',
        type: 'email',
        source: 'manual',
        title: 'Follow-up email',
        timestamp: daysAgo(9),
        body: 'Followed up on the career-fair conversation.',
      },
    ],
  },
  {
    ...base,
    id: 'ekdahl',
    company: 'Ekdahl Advokatbyrå',
    dealType: 'Partnership',
    eventType: 'Other',
    audience: 'Internal',
    semester: thisSemester,
    status: 'discussing',
    owner: maja,
    support: [noah],
    contact: { name: 'Jonas Falk', email: 'jonas.falk@example.com', role: 'Associate' },
    nextStep: 'Agree project scope',
    nextStepDue: daysFromNow(3),
    feeSEK: 0,
    notes: 'No fee: legal advice and contract templates in exchange for a legal-AI project.',
    activities: [note('ekdahl-1', 'Scope email received', daysAgo(2))],
  },
  {
    ...base,
    id: 'vinga',
    company: 'Vinga Voice',
    dealType: 'Job Post',
    eventType: 'Job post',
    audience: 'External',
    semester: thisSemester,
    status: 'lead',
    owner: iris,
    contact: { name: 'Adam Roos', email: 'adam.roos@example.com', role: 'Founder' },
    nextStep: 'Reply and offer a job post',
    nextStepDue: daysFromNow(0),
    notes: 'Internships and jobs in AI voice.',
    activities: [note('vinga-1', 'Inbound email', hoursAgo(20), 'Asked about posting internships.')],
  },
  {
    ...base,
    id: 'codewise',
    company: 'Codewise',
    dealType: 'Event',
    eventType: 'Workshop',
    audience: 'External',
    semester: thisSemester,
    status: 'finished',
    startDate: '2026-09-03',
    location: 'KTH Innovation',
    owner: alva,
    support: [iris],
    feeSEK: 0,
    rating: 4,
    notes: 'Free workshop; good turnout.',
    activities: [note('codewise-1', 'Event done', '2026-09-03T18:00:00Z')],
  },
  {
    ...base,
    id: 'brygga',
    company: 'Brygga Capital',
    dealType: 'Event',
    eventType: 'Lunch Lecture',
    audience: 'Unclear',
    semester: thisSemester,
    status: 'canceled',
    owner: noah,
    invoiceStatus: 'cancelled',
    notes: 'They pulled out after a reorganisation.',
    activities: [note('brygga-1', 'Canceled', '2026-09-20T10:00:00Z')],
  },
  {
    ...base,
    id: 'polar',
    company: 'Polar Systems',
    dealType: 'Event',
    eventType: 'Hackathon',
    audience: 'External',
    semester: lastSemester,
    status: 'finished',
    startDate: '2026-02-07',
    endDate: '2026-02-08',
    location: 'KTH Innovation',
    owner: oskar,
    support: [alva, maja],
    feeSEK: 30_000,
    invoiceStatus: 'waiting',
    invoiceDue: daysFromNow(-10),
    rating: 5,
    notes: 'Theme: agents.',
    activities: [note('polar-1', 'Invoice sent', '2026-03-01T09:00:00Z')],
  },
  {
    ...base,
    id: 'kista',
    company: 'Kista Quantum',
    dealType: 'Job Post',
    eventType: 'Job post',
    audience: 'External',
    semester: lastSemester,
    status: 'finished',
    startDate: '2026-02-25',
    owner: iris,
    feeSEK: 12_000,
    invoiceStatus: 'paid',
    activities: [note('kista-1', 'Payment received', '2026-03-20T09:00:00Z')],
  },
  {
    ...base,
    id: 'granit-vt',
    company: 'Granit Consulting',
    dealType: 'Event',
    eventType: 'Panel discussion',
    audience: 'External',
    semester: lastSemester,
    status: 'finished',
    startDate: '2026-01-26',
    location: 'Granit office',
    owner: maja,
    feeSEK: 15_000,
    invoiceStatus: 'paid',
    rating: 4,
    activities: [note('granit-vt-1', 'Panel held', '2026-01-26T19:00:00Z')],
  },
  {
    ...base,
    id: 'arkipelag',
    company: 'Arkipelag Analytics',
    dealType: 'Event',
    eventType: 'Hackathon',
    audience: 'External',
    semester: earlierSemester,
    status: 'finished',
    startDate: '2025-09-22',
    endDate: '2025-10-02',
    location: 'KTH Innovation',
    owner: alva,
    feeSEK: 20_000,
    invoiceStatus: 'paid',
    rating: 5,
    activities: [note('arkipelag-1', 'Payment received', '2025-11-01T09:00:00Z')],
  },
]

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-')

export const fixtureCompanies: Company[] = [...new Set(rawDeals.map((d) => d.company))].map((name) => ({
  id: `c-${slug(name)}`,
  name,
  website: '',
  notes: '',
}))

export const fixtureContacts: Contact[] = []
export const fixtureDeals: Deal[] = rawDeals.map((raw) => {
  const companyId = `c-${slug(raw.company)}`
  let contact: Contact | null = null
  if (raw.contact) {
    contact = fixtureContacts.find((c) => c.email === raw.contact!.email) ?? null
    if (!contact) {
      contact = { id: `p-${slug(raw.contact.email || raw.contact.name)}`, companyId, ...raw.contact }
      fixtureContacts.push(contact)
    }
  }
  return { involvesGrowth: false, growthTask: null, ...raw, companyId, contact }
})
