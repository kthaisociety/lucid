// The frontend talks only to its own backend, on the same origin (docs/adr/0001). No URLs are baked
// in at build time.

import type { Activity, Company, Contact, Deal, DealType, Person, Role } from './data/deals'

export type User = {
  sub: string
  email: string
  name: string
  // Who they are on the team (docs/adr/0003).
  memberId?: string
  role?: Role
  // What they do on the team, in their own words ("Partnerships Lead"); not a permission.
  title?: string
  // False for the dev user, who is always signed in (docs/pcr/0007).
  canSignOut?: boolean
  // Their mailbox (docs/adr/0006): off where Connect Gmail isn't set up; reconnect when Google no
  // longer honours the grant.
  gmail?: 'off' | 'connected' | 'not-connected' | 'reconnect'
  // Their Fathom (docs/adr/0008): off where Connect Fathom isn't set up.
  fathom?: 'off' | 'connected' | 'not-connected'
}

// Fired when the server answers 401: the session ended, so the app shows the sign-in page.
export const SIGNED_OUT = 'crm:signed-out'


// A failed API call. The message is the server's reason when it gave one (400s say what was wrong).
export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function call<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, {
    method,
    signal,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event(SIGNED_OUT))
    let reason = ''
    try {
      reason = (await res.json()).error ?? ''
    } catch {
      // Not JSON: fall back to the status alone.
    }
    throw new ApiError(res.status, reason ? `${reason} (${res.status})` : `Request failed (${res.status})`)
  }
  return res.status === 204 ? (undefined as T) : res.json()
}

export async function fetchMe(signal?: AbortSignal): Promise<User> {
  const res = await fetch('/api/me', { signal })
  if (!res.ok) {
    throw new ApiError(res.status, `Loading the signed-in user failed (${res.status})`)
  }
  return res.json()
}

// Forgets your mailbox and withdraws the CRM's access to it (docs/adr/0006).
export const disconnectGmail = () => call<void>('DELETE', '/api/gmail')

// Forgets your Fathom and deletes the webhook that brought your meetings in (docs/adr/0008).
export const disconnectFathom = () => call<void>('DELETE', '/api/fathom')

// Changes your own profile: your title. Your role is an admin's to give.
export const updateMe = (patch: { title: string }) => call<Person>('PATCH', '/api/me', patch)

// Ends this browser's session (docs/adr/0004).
export const signOut = () => call<void>('POST', '/auth/logout')

export const fetchDeals = (signal?: AbortSignal) => call<Deal[]>('GET', '/api/deals', undefined, signal)

export type ContactInput = { name: string; email: string; role: string }

// The company is an existing one (companyId) or a new one by name (company); the contact is an existing
// one (contactId), a new one (contact), or none.
export type NewLeadInput = {
  ownerId: string | null // null: no one has claimed it yet
  companyId?: string
  company?: string
  contactId?: string
  contact?: ContactInput
  dealType: DealType
  semester: string
  nextStep: string
}

export const fetchDeal = (id: string) => call<Deal>('GET', `/api/deals/${encodeURIComponent(id)}`)

export const createDeal = (lead: NewLeadInput) => call<Deal>('POST', '/api/deals', lead)

// The fields the deal panel edits; the API rejects any other. A new company without a new contact leaves
// the deal with none (a contact works at the deal's company), and links change only those given.
export type DealPatch = Partial<
  Pick<
    Deal,
    | 'status'
    | 'dealType'
    | 'eventType'
    | 'audience'
    | 'semester'
    | 'startDate'
    | 'endDate'
    | 'location'
    | 'nextStep'
    | 'nextStepDue'
    | 'feeSEK'
    | 'invoiceStatus'
    | 'invoiceDue'
    | 'rating'
    | 'notes'
  >
> & {
  companyId?: string
  contactId?: string | null
  ownerId?: string | null
  supportIds?: string[]
  links?: Deal['links']
}

export const updateDeal = (id: string, patch: DealPatch) =>
  call<Deal>('PATCH', `/api/deals/${encodeURIComponent(id)}`, patch)

export const addNote = (id: string, body: string) =>
  call<Activity>('POST', `/api/deals/${encodeURIComponent(id)}/notes`, { body })

export const fetchCompanies = (signal?: AbortSignal) => call<Company[]>('GET', '/api/companies', undefined, signal)
export const fetchContacts = (signal?: AbortSignal) => call<Contact[]>('GET', '/api/contacts', undefined, signal)

export type CompanyInput = Pick<Company, 'name' | 'website' | 'notes'>
export const createCompany = (company: CompanyInput) => call<Company>('POST', '/api/companies', company)
export const updateCompany = (id: string, patch: Partial<CompanyInput>) =>
  call<Company>('PATCH', `/api/companies/${encodeURIComponent(id)}`, patch)
export const deleteCompany = (id: string) => call<void>('DELETE', `/api/companies/${encodeURIComponent(id)}`)

export type ContactFields = Pick<Contact, 'companyId' | 'name' | 'email' | 'role'>
export const createContact = (contact: ContactFields) => call<Contact>('POST', '/api/contacts', contact)
export const updateContact = (id: string, patch: Partial<ContactFields>) =>
  call<Contact>('PATCH', `/api/contacts/${encodeURIComponent(id)}`, patch)
export const deleteContact = (id: string) => call<void>('DELETE', `/api/contacts/${encodeURIComponent(id)}`)

export const fetchMembers = (signal?: AbortSignal) => call<Person[]>('GET', '/api/members', undefined, signal)

// Admins only (the API answers 403 otherwise).
export type MemberInput = { email: string; name: string; role: Role; title?: string }
export const addMember = (member: MemberInput) => call<Person>('POST', '/api/members', member)
export const updateMember = (id: string, patch: Partial<Pick<MemberInput, 'name' | 'role' | 'title'>>) =>
  call<Person>('PATCH', `/api/members/${encodeURIComponent(id)}`, patch)
export const removeMember = (id: string) => call<void>('DELETE', `/api/members/${encodeURIComponent(id)}`)
// Makes the member an admin and you `stepDownTo` in one step (docs/adr/0005); answers with who you are now.
export const handOverAdmin = (id: string, stepDownTo: 'board' | 'member') =>
  call<Person>('POST', `/api/members/${encodeURIComponent(id)}/hand-over-admin`, { stepDownTo })
