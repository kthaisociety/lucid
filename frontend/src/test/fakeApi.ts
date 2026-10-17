// An in-memory stand-in for the Go API, behind a stubbed fetch (docs/pcr/0002: tests never call real
// services). It starts from the fixtures and answers the same routes the app calls, with the server's
// rules: unique company names and contact emails, a deal's contact at its company, and no deleting a
// company or contact that deals point at.
import { vi } from 'vitest'
import type { Activity, Company, Contact, Deal, Person, Role } from '../data/deals'
import { devMember, fixtureCompanies, fixtureContacts, fixtureDeals, fixtureMembers } from './fixtures'

export const devUser = { sub: 'dev', email: 'dev@kthais.com', name: 'Dev User' }

type Failure = { method: string; path: RegExp; status: number; error: string; once: boolean }

export type FakeApi = {
  deals: Deal[]
  members: Person[]
  companies: Company[]
  contacts: Contact[]
  requests: { method: string; path: string; body: unknown }[]
  // Make matching requests fail until cleared with `failures.length = 0`, or only the next one.
  failures: Failure[]
  fail: (method: string, path: RegExp, status?: number, error?: string) => void
  failOnce: (method: string, path: RegExp, status?: number, error?: string) => void
  // Hold back the answers to matching requests until release() is called, to test what happens meanwhile.
  // A held request normally takes effect when it arrives; with `late` it takes effect only on release,
  // like a write that commits after other requests have read. With `once`, only the next matching request
  // is held.
  hold: (method: string, path: RegExp, options?: { late?: boolean; once?: boolean }) => { release: () => Promise<void> }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const error = (status: number, message: string) => json({ error: message }, status)

let nextId = 0
const id = (prefix: string) => `${prefix}-new-${nextId++}`

type Body = Record<string, unknown>

// `role` is the dev user's role on the team: admin unless a test says otherwise. With `firstSignIn`, the
// dev user joins the team only when /api/me is first called, as the real server does.
// With `signedIn`, the dev user signed in for real and can sign out (docs/adr/0004); without it, they're
// the dev user, always signed in.
// With `gmail`, Connect Gmail is on and the dev user's mailbox is in that state (docs/adr/0006).
export function stubApi(
  options: {
    me?: () => Promise<Response>
    role?: Role
    firstSignIn?: boolean
    signedIn?: boolean
    gmail?: 'connected' | 'not-connected' | 'reconnect'
  } = {},
): FakeApi {
  const role = options.role ?? 'admin'
  const team = structuredClone(fixtureMembers).map((m) => (m.id === devMember.id ? { ...m, role } : m))
  const api: FakeApi = {
    deals: structuredClone(fixtureDeals),
    members: options.firstSignIn ? team.filter((m) => m.id !== devMember.id) : team,
    companies: structuredClone(fixtureCompanies),
    contacts: structuredClone(fixtureContacts),
    requests: [],
    failures: [],
    fail(method, path, status = 500, message = 'something went wrong') {
      api.failures.push({ method, path, status, error: message, once: false })
    },
    failOnce(method, path, status = 500, message = 'something went wrong') {
      api.failures.push({ method, path, status, error: message, once: true })
    },
    hold(method, path, { late = false, once = false } = {}) {
      let release: () => void = () => {}
      const gate = new Promise<void>((resolve) => (release = resolve))
      holds.push({ method, path, gate, late, once })
      return {
        release: async () => {
          release()
          await gate
        },
      }
    },
  }
  const holds: { method: string; path: RegExp; gate: Promise<void>; late: boolean; once: boolean }[] = []
  const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
  const emailTaken = (email: string, except?: string) =>
    email !== '' && api.contacts.some((c) => c.id !== except && sameText(c.email, email))

  // Deals carry their company's name and their contact, as the server's JSON does.
  const refreshDeals = () => {
    for (const d of api.deals) {
      d.company = api.companies.find((c) => c.id === d.companyId)?.name ?? d.company
      if (d.contact) d.contact = api.contacts.find((c) => c.id === d.contact!.id) ?? null
    }
  }

  let signedOut = false
  let gmail = options.gmail ?? 'off'
  // Where Connect Gmail is on, the team list says who has connected.
  const withGmail = (members: Person[]) =>
    gmail === 'off' ? members : members.map((m) => ({ ...m, gmailConnected: m.id === devMember.id && gmail === 'connected' }))
  const handle = async (method: string, path: string, body: Body): Promise<Response> => {
    const failure = api.failures.find((f) => f.method === method && f.path.test(path))
    if (failure?.once) api.failures.splice(api.failures.indexOf(failure), 1)
    if (failure) return error(failure.status, failure.error)

    if (method === 'POST' && path === '/auth/logout') {
      signedOut = true
      return new Response(null, { status: 204 })
    }
    if (signedOut) return error(401, 'sign-in required')
    if (method === 'GET' && path === '/api/me') {
      if (!api.members.some((m) => m.id === devMember.id)) api.members.push({ ...devMember, role })
      const me = api.members.find((m) => m.id === devMember.id)!
      return options.me
        ? options.me()
        : json({ ...devUser, memberId: me.id, role: me.role, title: me.title ?? '', canSignOut: !!options.signedIn, gmail })
    }
    if (method === 'PATCH' && path === '/api/me') {
      // Only the title: a role is an admin's to give, and the name comes from sign-in.
      if (Object.keys(body).some((k) => k !== 'title')) return error(400, `${Object.keys(body).find((k) => k !== 'title')} can't be changed`)
      const me = api.members.find((m) => m.id === devMember.id)!
      me.title = (body.title as string).trim()
      return json(me)
    }
    if (method === 'GET' && path === '/api/members') return json(withGmail(api.members))
    if (method === 'DELETE' && path === '/api/gmail') {
      gmail = 'not-connected'
      return new Response(null, { status: 204 })
    }
    if (method === 'GET' && path === '/api/deals') return json(api.deals)
    if (method === 'GET' && path === '/api/companies') return json(api.companies)
    if (method === 'GET' && path === '/api/contacts') return json(api.contacts)

    if (method === 'POST' && path === '/api/deals') {
      let company = api.companies.find((c) => c.id === body.companyId || (body.company && sameText(c.name, body.company as string)))
      if (!company) {
        company = { id: id('c'), name: (body.company as string).trim(), website: '', notes: '' }
        api.companies.push(company)
      }
      let contact: Contact | null = null
      if (body.contactId) {
        contact = api.contacts.find((c) => c.id === body.contactId) ?? null
        if (contact?.companyId !== company.id) return error(400, `that contact isn't at ${company.name}`)
      } else if (body.contact) {
        const input = body.contact as Omit<Contact, 'id' | 'companyId'>
        contact = api.contacts.find((c) => input.email && sameText(c.email, input.email)) ?? null
        if (contact && contact.companyId !== company.id) return error(409, `${input.email} is already a contact elsewhere`)
        if (!contact) {
          contact = { id: id('p'), companyId: company.id, ...input }
          api.contacts.push(contact)
        }
      }
      const deal: Deal = {
        id: id('deal'),
        companyId: company.id,
        company: company.name,
        dealType: body.dealType as Deal['dealType'],
        eventType: body.dealType === 'Job Post' ? 'Job post' : 'TBA',
        audience: 'Unclear',
        semester: body.semester as string,
        status: 'lead',
        startDate: null,
        endDate: null,
        location: '',
        owner: api.members.find((m) => m.id === body.ownerId) ?? null,
        support: [],
        contact,
        nextStep: (body.nextStep as string) ?? '',
        nextStepDue: null,
        feeSEK: null,
        invoiceStatus: null,
        invoiceDue: null,
        links: {},
        rating: null,
        notes: '',
        createdAt: new Date().toISOString(),
        activities: [
          { id: id('a'), type: 'note', source: 'manual', title: 'Added as a lead', timestamp: new Date().toISOString(), body: '' },
        ],
      }
      api.deals.push(deal)
      return json(deal, 201)
    }

    const handOver = path.match(/^\/api\/members\/([^/]+)\/hand-over-admin$/)
    if (handOver && method === 'POST') {
      const me = api.members.find((m) => m.id === devMember.id)!
      if (me.role !== 'admin') return error(403, 'only admins can hand over admin')
      const next = api.members.find((m) => m.id === handOver[1])
      if (!next) return error(404, 'team member not found')
      next.role = 'admin'
      me.role = body.stepDownTo as Role
      return json(me)
    }

    const member = path.match(/^\/api\/members(?:\/([^/]+))?$/)
    if (member && method !== 'GET') {
      if (role !== 'admin') return error(403, 'only admins can change the team')
      if (method === 'POST') {
        if (api.members.some((m) => sameText(m.email, body.email as string))) return error(409, `${body.email} is already on the team`)
        const added = { id: id('m'), ...body } as Person
        api.members.push(added)
        return json(added, 201)
      }
      const found = api.members.find((m) => m.id === member[1])
      if (!found) return error(404, 'team member not found')
      const admins = api.members.filter((m) => m.role === 'admin').length
      if (found.role === 'admin' && admins === 1 && (method === 'DELETE' || (body.role !== undefined && body.role !== 'admin'))) {
        return error(409, 'the team needs at least one admin')
      }
      if (method === 'PATCH') {
        Object.assign(found, body)
        return json(found)
      }
      if (api.deals.some((d) => d.owner?.id === found.id || d.support.some((p) => p.id === found.id))) {
        return error(409, `${found.name} owns or supports deals; reassign them first`)
      }
      api.members = api.members.filter((m) => m !== found)
      return new Response(null, { status: 204 })
    }

    if (method === 'POST' && path === '/api/companies') {
      if (api.companies.some((c) => sameText(c.name, body.name as string))) {
        return error(409, `there is already a company called ${body.name}`)
      }
      const company = { id: id('c'), website: '', notes: '', ...body } as Company
      api.companies.push(company)
      return json(company, 201)
    }
    if (method === 'POST' && path === '/api/contacts') {
      if (emailTaken(body.email as string)) return error(409, `${body.email} is already a contact`)
      const contact = { id: id('p'), ...body } as Contact
      api.contacts.push(contact)
      return json(contact, 201)
    }

    const company = path.match(/^\/api\/companies\/([^/]+)$/)
    if (company) {
      const found = api.companies.find((c) => c.id === decodeURIComponent(company[1]))
      if (!found) return error(404, 'company not found')
      if (method === 'PATCH') {
        if (body.name && api.companies.some((c) => c !== found && sameText(c.name, body.name as string))) {
          return error(409, `there is already a company called ${body.name}`)
        }
        Object.assign(found, body)
        refreshDeals()
        return json(found)
      }
      if (method === 'DELETE') {
        const count = api.deals.filter((d) => d.companyId === found.id).length
        if (count) return error(409, `the company has ${count} deals; it can only be deleted without any`)
        api.companies = api.companies.filter((c) => c !== found)
        api.contacts = api.contacts.filter((c) => c.companyId !== found.id)
        return new Response(null, { status: 204 })
      }
    }

    const contact = path.match(/^\/api\/contacts\/([^/]+)$/)
    if (contact) {
      const found = api.contacts.find((c) => c.id === decodeURIComponent(contact[1]))
      if (!found) return error(404, 'contact not found')
      const count = api.deals.filter((d) => d.contact?.id === found.id).length
      if (method === 'PATCH') {
        if (body.email !== undefined && emailTaken(body.email as string, found.id)) return error(409, `${body.email} is already a contact`)
        if (body.companyId && body.companyId !== found.companyId && count) return error(409, 'the contact is on deals with their current company')
        Object.assign(found, body)
        refreshDeals()
        return json(found)
      }
      if (method === 'DELETE') {
        if (count) return error(409, `the contact is on ${count} deals; change their contact first`)
        api.contacts = api.contacts.filter((c) => c !== found)
        return new Response(null, { status: 204 })
      }
    }

    const match = path.match(/^\/api\/deals\/([^/]+)(\/notes)?$/)
    const deal = match && api.deals.find((d) => d.id === decodeURIComponent(match[1]))
    if (match && !deal) return error(404, 'deal not found')
    if (deal && method === 'GET' && !match[2]) return json(deal)
    if (deal && method === 'PATCH' && !match[2]) {
      const { companyId, contactId, ownerId, supportIds, links, ...fields } = body
      if (companyId !== undefined && companyId !== deal.companyId) {
        const company = api.companies.find((c) => c.id === companyId)
        if (!company) return error(400, 'companyId is not a company')
        Object.assign(deal, { companyId: company.id, company: company.name, contact: null })
      }
      if (supportIds !== undefined) {
        const support = (supportIds as string[]).map((sid) => api.members.find((m) => m.id === sid))
        if (support.includes(undefined)) return error(400, "someone picked isn't on the team anymore")
        deal.support = support as Person[]
      }
      if (links !== undefined) deal.links = { ...deal.links, ...(links as Deal['links']) }
      if (ownerId !== undefined) {
        const next = ownerId === null ? null : api.members.find((m) => m.id === ownerId)
        if (next === undefined) return error(400, 'ownerId is not a team member')
        deal.owner = next
      }
      if (contactId !== undefined) {
        const next = contactId === null ? null : api.contacts.find((c) => c.id === contactId)
        if (next === undefined || (next && next.companyId !== deal.companyId)) return error(400, 'that contact isn’t at the company')
        deal.contact = next
      }
      Object.assign(deal, fields)
      return json(deal)
    }
    if (deal && method === 'POST' && match[2]) {
      const note: Activity = {
        id: id('a'),
        type: 'note',
        source: 'manual',
        title: 'Quick note',
        timestamp: new Date().toISOString(),
        body: body.body as string,
      }
      deal.activities.push(note)
      return json(note, 201)
    }
    return error(404, 'not found')
  }

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(init.body as string) : undefined
      api.requests.push({ method, path: input, body })
      // A held request is answered as of when it arrived, like a slow server: the response waits, the
      // data it carries doesn't.
      const held = holds.find((h) => h.method === method && h.path.test(input))
      if (held?.once) holds.splice(holds.indexOf(held), 1)
      if (held?.late) await held.gate
      const response = await handle(method, input, body ?? {})
      if (held && !held.late) await held.gate
      return response
    }),
  )
  return api
}
