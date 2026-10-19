import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Navigate, Route, Routes } from 'react-router'
import {
  addNote,
  createCompany,
  createContact,
  createDeal,
  deleteCompany,
  deleteContact,
  fetchCompanies,
  fetchContacts,
  fetchDeal,
  fetchDeals,
  fetchMe,
  fetchMembers,
  addMember,
  removeMember,
  handOverAdmin,
  updateMember,
  updateCompany,
  updateContact,
  updateDeal,
  updateMe,
  ApiError,
  SIGNED_OUT,
  signOut,
  disconnectFathom,
  disconnectGmail,
  type DealPatch,
  type NewLeadInput,
  type User,
} from './api'
import DealDetailDrawer from './components/drawer/DealDetailDrawer'
import NewLeadDialog from './components/drawer/NewLeadDialog'
import GmailBar from './components/layout/GmailBar'
import Header from './components/layout/Header'
import Sidebar, { MobileNav } from './components/layout/Sidebar'
import { useTheme } from './theme'
import CompaniesPage, { type CompanyActions } from './components/pages/CompaniesPage'
import ContactsPage, { type ContactActions } from './components/pages/ContactsPage'
import MyPage from './components/pages/MyPage'
import ReportsPage from './components/pages/ReportsPage'
import SignInPage from './components/pages/SignInPage'
import TeamPage, { type TeamActions } from './components/pages/TeamPage'
import PipelineView from './components/PipelineView'
import {
  compareSemesters,
  currentSemester,
  isConfirmed,
  isOpen,
  isUnpaid,
  type Company,
  type Contact,
  type Deal,
  type Person,
  canSeeReports,
} from './data/deals'
import { messageOf } from './format'
import { LocalEdits } from './dealSync'
import { useMinuteTick } from './hooks'

function matches(deal: Deal, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [
    deal.company,
    deal.notes,
    deal.nextStep,
    deal.contact?.name ?? '',
    deal.contact?.email ?? '',
    deal.owner?.name ?? '',
    ...deal.support.map((p) => p.name),
    ...deal.activities.flatMap((a) => [a.title, a.body, ...(a.bulletPoints ?? [])]),
  ].some((text) => text.toLowerCase().includes(q))
}

const sumFees = (deals: Deal[]) => deals.reduce((sum, deal) => sum + (deal.feeSEK ?? 0), 0)

type Data = { deals: Deal[]; companies: Company[]; contacts: Contact[]; members: Person[] }

const fetchAll = async (signal?: AbortSignal): Promise<Data> => {
  const [deals, companies, contacts, members] = await Promise.all([
    fetchDeals(signal),
    fetchCompanies(signal),
    fetchContacts(signal),
    fetchMembers(signal),
  ])
  return { deals, companies, contacts, members }
}

export default function App() {
  useMinuteTick()
  const [user, setUser] = useState<User | null>(null)
  const [theme, setTheme] = useTheme()
  const [userError, setUserError] = useState<string | null>(null)
  // No one is signed in, or the session ended: the sign-in page shows instead of the app.
  const [signedOut, setSignedOut] = useState(false)
  // How the last Connect Gmail ended, read once from ?gmail= and then taken off the address.
  const [gmailOutcome, setGmailOutcome] = useState(() => new URLSearchParams(window.location.search).get('gmail'))
  const [gmailLater, setGmailLater] = useState(false)
  // And the last Connect Fathom, from ?fathom= on My page.
  const [fathomOutcome, setFathomOutcome] = useState(() => new URLSearchParams(window.location.search).get('fathom'))
  useEffect(() => {
    if (!gmailOutcome && !fathomOutcome) return
    const url = new URL(window.location.href)
    url.searchParams.delete('gmail')
    url.searchParams.delete('fathom')
    window.history.replaceState(null, '', url)
  }, [gmailOutcome, fathomOutcome])
  const [data, setData] = useState<Data | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  // A save or refresh that failed, shown above the board; a failed refresh can be retried on its own.
  const [notice, setNotice] = useState<{ message: string; retry?: () => void } | null>(null)
  const [semester, setSemester] = useState(() => currentSemester())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [addingLead, setAddingLead] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetchMe(controller.signal)
      .then(setUser)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        if (err instanceof ApiError && err.status === 401) setSignedOut(true)
        else setUserError(messageOf(err))
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const onSignedOut = () => setSignedOut(true)
    window.addEventListener(SIGNED_OUT, onSignedOut)
    return () => window.removeEventListener(SIGNED_OUT, onSignedOut)
  }, [])

  // Reloads of everything, numbered: only the latest one's answer applies.
  const reloads = useRef(0)

  // Signing in adds you to the team. A team list that arrived before that finished lacks you: fetch it again.
  const missingMe = !!user?.memberId && !!data && !data.members.some((m) => m.id === user.memberId)
  useEffect(() => {
    if (!missingMe) return
    const ticket = reloads.current
    fetchMembers()
      .then((members) => {
        // A reload started since brings a newer list.
        if (ticket === reloads.current) setData((d) => d && { ...d, members })
      })
      .catch(() => {
        // The next refresh brings the team up to date.
      })
  }, [missingMe])

  // The server's latest version of each deal: a field whose save fails goes back to it.
  const serverDeals = useRef(new Map<string, Deal>())
  const remember = (deals: Deal[]) => {
    for (const deal of deals) serverDeals.current.set(deal.id, deal)
  }
  // Local edits, field by field, so server answers never undo a newer edit (dealSync.ts).
  const edits = useRef(new LocalEdits())
  // Requests for deals, numbered as they go out, and per deal the newest one whose answer was applied, so
  // an answer that was overtaken by a newer one can't bring back older shared details.
  const requests = useRef({ count: 0, applied: new Map<string, number>() })
  // Deals whose server version is unknown, because a save was overtaken and reading the deal again failed,
  // with the number of the last request out then: any answer to a later request is up to date.
  const unsure = useRef(new Map<string, number>())
  const applied = (deals: Deal[], request: number) => {
    for (const deal of deals) {
      requests.current.applied.set(deal.id, Math.max(request, requests.current.applied.get(deal.id) ?? 0))
      if (request > (unsure.current.get(deal.id) ?? Infinity)) unsure.current.delete(deal.id)
    }
  }

  const load = useCallback((signal?: AbortSignal) => {
    const request = ++requests.current.count
    fetchAll(signal)
      .then((fresh) => {
        remember(fresh.deals)
        applied(fresh.deals, request)
        setData(fresh)
      })
      .catch((err: unknown) => {
        if (signal?.aborted) return
        setLoadError(`Couldn't load deals: ${messageOf(err)}`)
      })
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [load])

  // Saves to one deal go out one at a time, in the order they were made, so the server ends up with the
  // last edit.
  const saveQueue = useRef(new Map<string, Promise<void>>())

  // After a change that shows in more than one place (a company's name is on its deals, a new lead may
  // add a company and contact), everything reloads. Only the latest reload applies, and in each deal it
  // keeps the fields edited since it started or still saving. If it fails, the notice offers to retry it.
  const reload = (): Promise<void> => {
    const ticket = ++reloads.current
    const takenAt = edits.current.now()
    const request = ++requests.current.count
    return fetchAll()
      .then((fresh) => {
        if (ticket !== reloads.current) return
        remember(fresh.deals)
        applied(fresh.deals, request)
        setData((current) => {
          const local = new Map(current?.deals.map((d) => [d.id, d]))
          return { ...fresh, deals: fresh.deals.map((deal) => edits.current.merge(deal, local.get(deal.id), takenAt)) }
        })
      })
      .catch((err: unknown) => setNotice({ message: `Couldn't refresh: ${messageOf(err)}`, retry: () => void reload() }))
  }

  const all = data?.deals ?? []
  const companies = data?.companies ?? []
  const contacts = data?.contacts ?? []
  const members = data?.members ?? []
  const isAdmin = user?.role === 'admin'
  // The current semester is always offered, even before it has deals.
  const semesters = [...new Set([currentSemester(), ...all.map((deal) => deal.semester)])].sort(compareSemesters)

  const replaceDeal = (id: string, change: (deal: Deal) => Deal) =>
    setData((d) => d && { ...d, deals: d.deals.map((deal) => (deal.id === id ? change(deal) : deal)) })

  // Reads one deal again and applies it, unless a newer answer for it has been applied meanwhile. If
  // that fails, the deal's server version is unknown until an answer asked for later arrives, and the
  // notice offers to read it again. Resolves to whether the read worked.
  const refreshDeal = async (id: string, company: string): Promise<boolean> => {
    const takenAt = edits.current.now()
    const request = ++requests.current.count
    try {
      const fresh = await fetchDeal(id)
      if ((requests.current.applied.get(id) ?? 0) > request) return true
      serverDeals.current.set(id, fresh)
      applied([fresh], request)
      replaceDeal(id, (deal) => edits.current.merge(fresh, deal, takenAt))
      return true
    } catch (err) {
      unsure.current.set(id, requests.current.count)
      setNotice({ message: `Couldn't refresh ${company}: ${messageOf(err)}`, retry: () => void refreshDeal(id, company) })
      return false
    }
  }

  // Edits show at once and save in the background. A save's answer updates the deal, except fields edited
  // since. If a save fails, each field it changed goes back to the server's value, unless a newer edit has
  // changed that field since; the error shows above the board.
  const saveDeal = (id: string, patch: DealPatch) => {
    const before = all.find((deal) => deal.id === id)
    if (!before) return
    const { companyId, contactId, ownerId, supportIds, links, ...fields } = patch
    const local: Partial<Deal> = { ...fields }
    if (companyId !== undefined && companyId !== before.companyId) {
      // The server leaves a deal moved to another company with no contact, unless it's given one there.
      local.companyId = companyId
      local.company = companies.find((c) => c.id === companyId)?.name ?? before.company
      local.contact = null
    }
    if (contactId !== undefined) local.contact = contacts.find((c) => c.id === contactId) ?? null
    if (ownerId !== undefined) local.owner = members.find((m) => m.id === ownerId) ?? null
    if (supportIds !== undefined) local.support = members.filter((m) => supportIds.includes(m.id))
    if (links !== undefined) local.links = { ...before.links, ...links }
    // The fields this edit sets locally (a contactId shows as the contact itself). They count as saving
    // from now, while queued too, so no refresh replaces them before the save is through.
    const keys = Object.keys(local) as (keyof Deal)[]
    const edit = edits.current.edit(id, keys)
    edits.current.startSaving(id, keys)
    replaceDeal(id, (deal) => ({ ...deal, ...local }))
    setNotice(null)

    const send = async () => {
      const takenAt = edits.current.now()
      const request = ++requests.current.count
      try {
        const saved = await updateDeal(id, patch)
        edits.current.doneSaving(id, keys)
        if ((requests.current.applied.get(id) ?? 0) > request) {
          // A newer answer was applied while this save was out (a refresh, say), so which of the two holds
          // the server's latest values is unclear: read the deal again rather than guess.
          void refreshDeal(id, before.company)
        } else {
          serverDeals.current.set(id, saved)
          applied([saved], request)
          replaceDeal(id, (deal) => edits.current.merge(saved, deal, takenAt))
        }
      } catch (err) {
        edits.current.doneSaving(id, keys)
        // Without a known server version to go back to, read the deal again; failing that, use the last known.
        if (unsure.current.has(id) && (await refreshDeal(id, before.company))) {
          setNotice({ message: `Couldn't save ${before.company}: ${messageOf(err)}` })
          return
        }
        const last = serverDeals.current.get(id) ?? before
        replaceDeal(id, (deal) => {
          const reverted = { ...deal }
          for (const key of keys) if (edits.current.isLatest(id, key, edit)) Object.assign(reverted, { [key]: last[key] })
          return reverted
        })
        // If the deal's server version is still unknown, the notice offers to read it again.
        const retry = unsure.current.has(id) ? () => void refreshDeal(id, before.company) : undefined
        setNotice({ message: `Couldn't save ${before.company}: ${messageOf(err)}`, retry })
      }
    }
    const queued = (saveQueue.current.get(id) ?? Promise.resolve()).then(send)
    saveQueue.current.set(id, queued)
    void queued.then(() => {
      // The last save in line clears the deal's queue.
      if (saveQueue.current.get(id) === queued) saveQueue.current.delete(id)
    })
  }

  // Resolves once the note is saved; the drawer keeps the text if it rejects.
  const saveNote = async (id: string, text: string) => {
    const note = await addNote(id, text)
    edits.current.edit(id, ['activities'])
    // Another answer may have brought the note already; it shows once.
    replaceDeal(id, (deal) =>
      deal.activities.some((a) => a.id === note.id) ? deal : { ...deal, activities: [...deal.activities, note] },
    )
  }

  // A new lead is owned by whoever adds it (the server records the signed-in user), so adding waits
  // until we know who that is.
  const addLead = async (lead: Omit<NewLeadInput, 'semester'>) => {
    if (!user) return
    const deal = await createDeal({ ...lead, semester })
    remember([deal])
    setData((d) => d && { ...d, deals: [...d.deals, deal] })
    setAddingLead(false)
    setSelectedId(deal.id)
    void reload()
  }

  // Each resolves once saved and the app has reloaded; a rejection carries the server's reason to the form.
  const companyActions: CompanyActions = {
    create: async (input) => {
      await createCompany(input)
      await reload()
    },
    update: async (id, input) => {
      await updateCompany(id, input)
      await reload()
    },
    remove: async (id) => {
      await deleteCompany(id)
      await reload()
    },
  }
  const teamActions: TeamActions = {
    add: async (member) => {
      await addMember(member)
      await reload()
    },
    setRole: async (id, role) => {
      await updateMember(id, { role })
      // Changing your own role changes what you can do here: Reports, and managing the team.
      if (id === user?.memberId) setUser(await fetchMe())
      await reload()
    },
    handOver: async (id, stepDownTo) => {
      await handOverAdmin(id, stepDownTo)
      setUser(await fetchMe())
      await reload()
    },
    remove: async (id) => {
      await removeMember(id)
      await reload()
    },
  }
  const contactActions: ContactActions = {
    create: async (fields) => {
      await createContact(fields)
      await reload()
    },
    update: async (id, fields) => {
      await updateContact(id, fields)
      await reload()
    },
    remove: async (id) => {
      await deleteContact(id)
      await reload()
    },
  }

  // Opens a deal from any page, switching to its semester so the board behind shows it.
  const openDeal = (id: string) => {
    const deal = all.find((d) => d.id === id)
    if (deal) setSemester(deal.semester)
    setSelectedId(id)
  }

  const inSemester = all.filter((deal) => deal.semester === semester)
  const selected = all.find((deal) => deal.id === selectedId)

  if (signedOut) return <SignInPage reason={new URLSearchParams(window.location.search).get('sign-in')} />

  const disconnect = async () => {
    try {
      await disconnectGmail()
      setUser(await fetchMe())
      await reload()
    } catch (err) {
      setNotice({ message: `Couldn't disconnect Gmail: ${messageOf(err)}` })
    }
  }

  const disconnectMeetings = async () => {
    try {
      await disconnectFathom()
      setUser(await fetchMe())
      await reload()
    } catch (err) {
      setNotice({ message: `Couldn't disconnect Fathom: ${messageOf(err)}` })
    }
  }

  const leave = async () => {
    try {
      await signOut()
      setSignedOut(true)
    } catch (err) {
      setNotice({ message: `Couldn't sign out: ${messageOf(err)}` })
    }
  }

  return (
    <div className="flex h-screen flex-col bg-gray-50 font-sans text-gray-900">
      <Header
        semesters={semesters}
        semester={semester}
        onSemesterChange={setSemester}
        query={query}
        onQueryChange={setQuery}
        openDeals={inSemester.filter(isOpen).length}
        confirmedSEK={sumFees(inSemester.filter(isConfirmed))}
        unpaidSEK={sumFees(inSemester.filter(isUnpaid))}
        // Adding waits for the deal list, so a late first load can't replace a lead added meanwhile.
        canAddLead={user !== null && data !== null}
        onNewLead={() => setAddingLead(true)}
      />
      <MobileNav user={user} theme={theme} onTheme={setTheme} onSignOut={() => void leave()} onDisconnectGmail={() => void disconnect()} />
      <GmailBar
        outcome={gmailOutcome}
        ask={(user?.gmail === 'not-connected' || user?.gmail === 'reconnect') && !gmailLater}
        reconnect={user?.gmail === 'reconnect'}
        onLater={() => setGmailLater(true)}
        onDismissOutcome={() => setGmailOutcome(null)}
      />
      <div className="flex min-h-0 flex-1">
        <Sidebar user={user} userError={userError} theme={theme} onTheme={setTheme} onSignOut={() => void leave()} onDisconnectGmail={() => void disconnect()} />
        <main className="flex min-w-0 flex-1 flex-col">
          {notice && (
            <p role="alert" className="mx-6 mt-4 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {notice.message}
              <span className="flex items-center gap-3">
                {notice.retry && (
                  <button
                    type="button"
                    onClick={() => {
                      const retry = notice.retry!
                      setNotice(null)
                      retry()
                    }}
                    className="font-semibold underline"
                  >
                    Retry
                  </button>
                )}
                <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)} className="text-red-500 hover:text-red-800">
                  <X size={14} aria-hidden />
                </button>
              </span>
            </p>
          )}
          {loadError ? (
            <div role="alert" className="m-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {loadError}
              <button
                type="button"
                onClick={() => {
                  setLoadError(null)
                  load()
                }}
                className="ml-3 font-semibold underline"
              >
                Retry
              </button>
            </div>
          ) : data === null ? (
            <p className="m-6 text-sm text-gray-500">Loading deals…</p>
          ) : (
            <Routes>
              <Route
                index
                element={
                  <PipelineView
                    deals={inSemester.filter((deal) => matches(deal, query))}
                    semester={semester}
                    searching={query.trim() !== ''}
                    otherSemester={[...new Set(all.map((d) => d.semester))].filter((s) => s !== semester).sort(compareSemesters)[0] ?? null}
                    canAddLead={user !== null}
                    onNewLead={() => setAddingLead(true)}
                    onSemester={setSemester}
                    meId={user?.memberId}
                    onSelect={setSelectedId}
                    onMove={(id, status) => saveDeal(id, { status })}
                  />
                }
              />
              <Route path="companies" element={<CompaniesPage companies={companies} contacts={contacts} deals={all} query={query} onSelect={openDeal} actions={companyActions} contactActions={contactActions} />} />
              <Route path="contacts" element={<ContactsPage companies={companies} contacts={contacts} deals={all} query={query} onSelect={openDeal} actions={contactActions} />} />
              <Route
                path="reports"
                element={
                  canSeeReports(user?.role) ? (
                    <ReportsPage deals={all} semester={semester} onSelect={openDeal} />
                  ) : (
                    <p className="m-6 text-sm text-gray-500">
                      {user ? 'Reports are for the board and admins.' : 'Loading…'}
                    </p>
                  )
                }
              />
              <Route
                path="me"
                element={
                  user ? (
                    <MyPage
                      user={user}
                      deals={all}
                      semester={semester}
                      onSelect={openDeal}
                      onSaveTitle={async (title) => {
                        await updateMe({ title })
                        setUser(await fetchMe())
                        // The team list and deals show the title too.
                        await reload()
                      }}
                      onSignOut={() => void leave()}
                      onDisconnectGmail={() => void disconnect()}
                      fathomOutcome={fathomOutcome}
                      onDismissFathomOutcome={() => setFathomOutcome(null)}
                      onDisconnectFathom={() => void disconnectMeetings()}
                    />
                  ) : (
                    <p className="m-6 text-sm text-gray-500">Loading…</p>
                  )
                }
              />
              <Route
                path="team"
                element={<TeamPage members={members} deals={all} meId={user?.memberId} isAdmin={isAdmin} actions={teamActions} />}
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          )}
        </main>
      </div>

      {selected && (
        <DealDetailDrawer
          key={selected.id}
          deal={selected}
          otherDeals={all
            .filter((deal) => deal.company === selected.company && deal.id !== selected.id)
            .sort((a, b) => compareSemesters(a.semester, b.semester))}
          onClose={() => setSelectedId(null)}
          companies={companies}
          companyContacts={contacts.filter((c) => c.companyId === selected.companyId)}
          members={members}
          meId={user?.memberId}
          onChange={(patch) => saveDeal(selected.id, patch)}
          onAddNote={(text) => saveNote(selected.id, text)}
          onSelect={openDeal}
        />
      )}
      {addingLead && user && (
        <NewLeadDialog
          semester={semester}
          companies={companies}
          contacts={contacts}
          members={members}
          meId={user.memberId}
          onCreate={addLead}
          onClose={() => setAddingLead(false)}
        />
      )}
    </div>
  )
}
