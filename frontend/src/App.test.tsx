import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import App from './App'
import { stubApi, type FakeApi } from './test/fakeApi'
import { lastSemester, thisSemester } from './test/fixtures'

let api: FakeApi

beforeEach(() => {
  api = stubApi()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const renderAt = (path = '/') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )

// Renders the pipeline and waits for the deals to load.
async function renderApp() {
  renderAt()
  await screen.findByText('Kvarnholmen AI')
}

const column = (label: string) => screen.getByRole('region', { name: label })
const card = (company: string) => within(screen.getByRole('main')).getByRole('button', { name: new RegExp(company) })
const open = (company: string) => {
  fireEvent.click(card(company))
  return screen.getByRole('dialog', { name: company })
}
const patches = () => api.requests.filter((r) => r.method === 'PATCH')
// Lets queued saves go out, so a check that nothing was sent can't pass just by running too early.
const settle = () => act(async () => {})

test('shows the signed-in user', async () => {
  renderAt()

  expect(await screen.findByText('Signed in as dev@kthais.com')).toBeInTheDocument()
})

test('shows the sign-in page when no one is signed in', async () => {
  api = stubApi({ me: async () => new Response('', { status: 401 }) })

  renderAt()

  expect(await screen.findByRole('link', { name: 'Sign in with Google' })).toHaveAttribute('href', '/auth/login')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test('the sign-in page says why the last sign-in was refused', async () => {
  api = stubApi({ me: async () => new Response('', { status: 401 }) })
  window.history.replaceState(null, '', '/?sign-in=not-on-team')

  renderAt()

  expect(await screen.findByRole('alert')).toHaveTextContent('You’re not on the business team yet. Ask an admin to add you')
  window.history.replaceState(null, '', '/')
})

test('signing out shows the sign-in page', async () => {
  api = stubApi({ signedIn: true })
  await renderApp()

  fireEvent.click(within(screen.getByRole('complementary')).getByRole('button', { name: 'Sign out' }))

  expect(await screen.findByRole('link', { name: 'Sign in with Google' })).toBeInTheDocument()
  expect(api.requests.some((r) => r.method === 'POST' && r.path === '/auth/logout')).toBe(true)
})

test('phones can sign out too', async () => {
  api = stubApi({ signedIn: true })
  await renderApp()

  fireEvent.click(within(screen.getByRole('navigation', { name: 'Pages' })).getByRole('button', { name: 'Sign out' }))

  expect(await screen.findByRole('link', { name: 'Sign in with Google' })).toBeInTheDocument()
})

test('the dev user has no sign-out', async () => {
  await renderApp()

  expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
})

test('a session that ends while the app is open shows the sign-in page', async () => {
  await renderApp()
  api.fail('PATCH', /^\/api\/deals\//, 401, 'sign-in required')
  open('Lumen Health')

  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'discussing' } })

  expect(await screen.findByRole('link', { name: 'Sign in with Google' })).toBeInTheDocument()
})

test('shows the current semester by status, with its totals', async () => {
  await renderApp()

  expect(screen.getByLabelText('Semester')).toHaveValue(thisSemester)
  expect(within(column('Agreement')).getByText('Kvarnholmen AI')).toBeInTheDocument()
  expect(within(column('Signed')).getByText('Granit Consulting')).toBeInTheDocument()
  expect(screen.queryByText('Polar Systems')).not.toBeInTheDocument()
  expect(screen.getByText('Open Deals:')).toHaveTextContent('Open Deals: 9')
  expect(screen.getByText('Confirmed:')).toHaveTextContent('Confirmed: 40,000 SEK')
  expect(screen.getByText('Unpaid:')).toHaveTextContent('Unpaid: 40,000 SEK')
})

test('switching semester shows that semester’s deals', async () => {
  await renderApp()

  fireEvent.change(screen.getByLabelText('Semester'), { target: { value: lastSemester } })

  expect(within(column('Finished')).getByText('Polar Systems')).toBeInTheDocument()
  expect(screen.queryByText('Kvarnholmen AI')).not.toBeInTheDocument()
  expect(screen.getByText('Unpaid:')).toHaveTextContent('Unpaid: 30,000 SEK')
})

test('says so when the deals fail to load, and retries', async () => {
  api.fail('GET', /^\/api\/deals$/, 500)
  renderAt()

  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load deals: something went wrong (500)")

  api.failures.length = 0
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByText('Kvarnholmen AI')).toBeInTheDocument()
})

test('nudges overdue next steps and inactive deals', async () => {
  await renderApp()

  expect(card('Kvarnholmen AI')).toHaveTextContent('Next step overdue: 2 days')
  expect(card('Lumen Health')).toHaveTextContent('Follow-up due: 6 days inactive')
  expect(card('Saltsjö Insurance')).not.toHaveTextContent(/overdue|Follow-up due/)
})

test('a quick note is saved, logs to the timeline and clears the inactivity nudge', async () => {
  await renderApp()
  const drawer = open('Lumen Health')

  fireEvent.change(within(drawer).getByLabelText('Quick note'), { target: { value: 'Got the intro, call on Friday' } })
  fireEvent.click(within(drawer).getByRole('button', { name: 'Save Note' }))

  expect(await within(drawer).findByText('Got the intro, call on Friday')).toBeInTheDocument()
  expect(within(drawer).getByLabelText('Quick note')).toHaveValue('')
  expect(card('Lumen Health')).not.toHaveTextContent('Follow-up due')
  expect(api.requests).toContainEqual({
    method: 'POST',
    path: '/api/deals/lumen/notes',
    body: { body: 'Got the intro, call on Friday' },
  })
})

test('a note that fails to save stays in the box, with the reason', async () => {
  api.fail('POST', /\/notes$/, 400, 'a note needs text')
  await renderApp()
  const drawer = open('Lumen Health')

  fireEvent.change(within(drawer).getByLabelText('Quick note'), { target: { value: 'Got the intro' } })
  fireEvent.click(within(drawer).getByRole('button', { name: 'Save Note' }))

  expect(await within(drawer).findByRole('alert')).toHaveTextContent("Couldn't save the note: a note needs text (400)")
  expect(within(drawer).getByLabelText('Quick note')).toHaveValue('Got the intro')
  expect(card('Lumen Health')).toHaveTextContent('Follow-up due')
})

test('changing the status moves the card and saves it', async () => {
  await renderApp()
  open('Lumen Health')

  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'discussing' } })
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(within(column('Discussing')).getByText('Lumen Health')).toBeInTheDocument()
  expect(within(column('Lead')).queryByText('Lumen Health')).not.toBeInTheDocument()
  await waitFor(() => expect(patches()).toEqual([{ method: 'PATCH', path: '/api/deals/lumen', body: { status: 'discussing' } }]))
})

test('a change that fails to save goes back, with the reason', async () => {
  api.fail('PATCH', /^\/api\/deals\//, 500)
  await renderApp()
  open('Lumen Health')

  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'discussing' } })

  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save Lumen Health: something went wrong (500)")
  expect(screen.getByLabelText('Status')).toHaveValue('lead')
  expect(within(column('Lead')).getByText('Lumen Health')).toBeInTheDocument()
})

test('moving the due date clears the overdue nudge', async () => {
  await renderApp()
  const drawer = open('Kvarnholmen AI')

  fireEvent.change(within(drawer).getByLabelText('Due'), { target: { value: '2099-01-01' } })

  expect(card('Kvarnholmen AI')).not.toHaveTextContent('overdue')
  await waitFor(() => expect(patches()[0]?.body).toEqual({ nextStepDue: '2099-01-01' }))
})

test('the next step saves when you leave the field, not on every keystroke', async () => {
  await renderApp()
  const drawer = open('Lumen Health')
  const field = within(drawer).getByRole('textbox', { name: 'Next step' })

  fireEvent.change(field, { target: { value: 'Book' } })
  fireEvent.change(field, { target: { value: 'Book a call' } })
  await settle()
  expect(patches()).toEqual([])

  fireEvent.blur(field)
  await waitFor(() => expect(patches()).toEqual([{ method: 'PATCH', path: '/api/deals/lumen', body: { nextStep: 'Book a call' } }]))
  expect(card('Lumen Health')).toHaveTextContent('Book a call')
})

test('Send Email opens a mail to the deal contact', async () => {
  await renderApp()
  const drawer = open('Granit Consulting')

  expect(within(drawer).getByRole('link', { name: 'Send Email' })).toHaveAttribute(
    'href',
    expect.stringMatching(/^mailto:lina\.dahl@example\.com\?subject=/),
  )
})

test('the drawer links to other deals with the same company', async () => {
  await renderApp()
  const drawer = open('Granit Consulting')

  fireEvent.click(within(drawer).getByRole('button', { name: new RegExp(`${lastSemester} · Panel discussion`) }))

  const filter = screen.getAllByLabelText('Semester').find((el) => !el.closest('[role="dialog"]'))
  expect(filter).toHaveValue(lastSemester)
  const other = screen.getByRole('dialog', { name: 'Granit Consulting' })
  expect(within(other).getByLabelText('Event type')).toHaveValue('Panel discussion')
  expect(within(other).getByLabelText('Semester')).toHaveValue(lastSemester)
})

test('search filters by company, contact and notes', async () => {
  await renderApp()

  fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'founders' } })

  expect(screen.getByText('Fjällbacka Ventures')).toBeInTheDocument()
  expect(screen.queryByText('Lumen Health')).not.toBeInTheDocument()
})

test('filters for follow-ups and shows canceled deals on request', async () => {
  await renderApp()
  expect(screen.queryByText('Brygga Capital')).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Show canceled' }))
  expect(within(column('Canceled')).getByText('Brygga Capital')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Needs follow-up' }))
  expect(screen.getByText('Lumen Health')).toBeInTheDocument()
  expect(screen.queryByText('Saltsjö Insurance')).not.toBeInTheDocument()
})

test('the list view shows the deal log as a table', async () => {
  await renderApp()

  fireEvent.click(screen.getByRole('button', { name: 'List' }))

  const row = screen.getByRole('row', { name: /Granit Consulting/ })
  expect(row).toHaveTextContent('Signed')
  expect(row).toHaveTextContent('40,000 SEK')
  expect(row).toHaveTextContent('Not sent')
})

async function addLead(fields: Record<string, string>) {
  await screen.findByText('Signed in as dev@kthais.com')
  fireEvent.click(screen.getByRole('button', { name: 'New Lead' }))
  const form = screen.getByRole('dialog', { name: /^New lead/ })
  for (const [label, value] of Object.entries(fields)) {
    fireEvent.change(within(form).getByLabelText(label), { target: { value } })
  }
  fireEvent.click(within(form).getByRole('button', { name: 'Add lead' }))
  return form
}

test('a new lead is saved to Lead in the selected semester, owned by the signed-in user', async () => {
  await renderApp()

  await addLead({ Company: 'Nordljus AB', 'Next step': 'Send intro email' })

  expect(await screen.findByRole('dialog', { name: 'Nordljus AB' })).toHaveTextContent('Dev User')
  expect(within(column('Lead')).getByText('Nordljus AB')).toBeInTheDocument()
  expect(api.requests).toContainEqual({
    method: 'POST',
    path: '/api/deals',
    body: { ownerId: 'm-dev', company: 'Nordljus AB', dealType: 'Event', semester: thisSemester, nextStep: 'Send intro email' },
  })
})

test('a lead that fails to save keeps the form open, with the reason', async () => {
  api.fail('POST', /^\/api\/deals$/, 500)
  await renderApp()

  const form = await addLead({ Company: 'Nordljus AB' })

  expect(await within(form).findByRole('alert')).toHaveTextContent('something went wrong (500)')
  expect(within(form).getByLabelText('Company')).toHaveValue('Nordljus AB')
})

test('a signed fee with no invoice status counts as unpaid', async () => {
  await renderApp()
  open('Kvarnholmen AI')

  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'signed' } })

  expect(screen.getByText('Confirmed:')).toHaveTextContent('Confirmed: 60,000 SEK')
  expect(screen.getByText('Unpaid:')).toHaveTextContent('Unpaid: 60,000 SEK')
})

test('New Lead waits for the signed-in user', async () => {
  let signIn: (res: Response) => void = () => {}
  api = stubApi({ me: () => new Promise<Response>((resolve) => (signIn = resolve)) })
  await renderApp()

  expect(screen.getByRole('button', { name: 'New Lead' })).toBeDisabled()

  signIn(new Response(JSON.stringify({ sub: 'dev', email: 'dev@kthais.com', name: 'Dev User' })))
  await screen.findByText('Signed in as dev@kthais.com')
  expect(screen.getByRole('button', { name: 'New Lead' })).toBeEnabled()
})

test('New Lead stays disabled when sign-in fails', async () => {
  api = stubApi({ me: async () => new Response('', { status: 500 }) })
  renderAt()

  await screen.findByText('Loading the signed-in user failed (500)')
  expect(screen.getByRole('button', { name: 'New Lead' })).toBeDisabled()
})

test('a negative fee is not saved', async () => {
  await renderApp()
  const drawer = open('Granit Consulting')
  const fee = within(drawer).getByLabelText('Fee (SEK)')

  fireEvent.change(fee, { target: { value: '-1000' } })
  fireEvent.blur(fee)

  expect(fee).toHaveValue(40000)
  await settle()
  expect(patches()).toEqual([])
  expect(screen.getByText('Confirmed:')).toHaveTextContent('Confirmed: 40,000 SEK')
})

test('Send Email needs a contact email', async () => {
  await renderApp()

  await addLead({ Company: 'Nordljus AB', 'Contact name': 'Kim Ek' })

  const drawer = await screen.findByRole('dialog', { name: 'Nordljus AB' })
  expect(within(drawer).queryByRole('link', { name: 'Send Email' })).not.toBeInTheDocument()
  expect(within(drawer).getByText('No contact email')).toBeInTheDocument()
})

test('the drawer takes focus, keeps Tab inside, and returns focus on Escape', async () => {
  await renderApp()
  card('Lumen Health').focus()
  const drawer = open('Lumen Health')
  expect(drawer).toHaveFocus()

  const close = within(drawer).getByRole('button', { name: 'Close' })
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
  expect(drawer).not.toHaveFocus()
  expect(drawer).toContainElement(document.activeElement as HTMLElement)

  close.focus()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(card('Lumen Health')).toHaveFocus()
})

test('the New Lead form focuses Company first', async () => {
  await renderApp()
  await screen.findByText('Signed in as dev@kthais.com')
  fireEvent.click(screen.getByRole('button', { name: 'New Lead' }))

  expect(screen.getByLabelText('Company')).toHaveFocus()
})

test('nudges update when the tab becomes visible again', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  await renderApp()
  expect(card('Vinga Voice')).not.toHaveTextContent('overdue')

  vi.setSystemTime(Date.now() + 2 * 24 * 60 * 60 * 1000)
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })

  expect(card('Vinga Voice')).toHaveTextContent('Next step overdue: 2 days')
})

// jsdom has no DataTransfer; this is the part drag and drop uses.
function fakeDataTransfer() {
  const data: Record<string, string> = {}
  return {
    setData: (type: string, value: string) => void (data[type] = value),
    getData: (type: string) => data[type] ?? '',
    get types() {
      return Object.keys(data)
    },
    effectAllowed: 'all',
    dropEffect: 'none',
  }
}

function drag(company: string, to: string) {
  const dataTransfer = fakeDataTransfer()
  const target = column(to)
  fireEvent.dragStart(card(company), { dataTransfer })
  fireEvent.dragOver(target, { dataTransfer })
  fireEvent.drop(target, { dataTransfer })
  fireEvent.dragEnd(card(company), { dataTransfer })
}

test('dragging a card to another column changes its status and saves it', async () => {
  await renderApp()

  drag('Lumen Health', 'Discussing')

  expect(within(column('Discussing')).getByText('Lumen Health')).toBeInTheDocument()
  expect(within(column('Lead')).queryByText('Lumen Health')).not.toBeInTheDocument()
  await waitFor(() => expect(patches()).toEqual([{ method: 'PATCH', path: '/api/deals/lumen', body: { status: 'discussing' } }]))
})

test('dropping a card back on its own column saves nothing', async () => {
  await renderApp()

  drag('Lumen Health', 'Lead')

  expect(within(column('Lead')).getByText('Lumen Health')).toBeInTheDocument()
  await settle()
  expect(patches()).toEqual([])
})

test('dropping something that is not a deal is ignored', async () => {
  await renderApp()
  const dataTransfer = fakeDataTransfer()
  dataTransfer.setData('text/plain', 'lumen')

  fireEvent.dragOver(column('Signed'), { dataTransfer })
  fireEvent.drop(column('Signed'), { dataTransfer })

  expect(within(column('Lead')).getByText('Lumen Health')).toBeInTheDocument()
  await settle()
  expect(patches()).toEqual([])
})

test('a drag that fails to save puts the card back, with the reason', async () => {
  api.fail('PATCH', /^\/api\/deals\//, 500)
  await renderApp()

  drag('Lumen Health', 'Signed')

  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save Lumen Health: something went wrong (500)")
  expect(within(column('Lead')).getByText('Lumen Health')).toBeInTheDocument()
  expect(within(column('Signed')).queryByText('Lumen Health')).not.toBeInTheDocument()
})

test('a column lights up while a deal is dragged over it', async () => {
  await renderApp()
  const dataTransfer = fakeDataTransfer()
  fireEvent.dragStart(card('Lumen Health'), { dataTransfer })

  fireEvent.dragOver(column('Signed'), { dataTransfer })
  expect(column('Signed')).toHaveClass('ring-2')

  fireEvent.dragLeave(column('Signed'), { dataTransfer, relatedTarget: document.body })
  expect(column('Signed')).not.toHaveClass('ring-2')
})

const goTo = (page: string) =>
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: page }))

test('the sidebar moves between pages and marks the current one', async () => {
  await renderApp()

  goTo('Companies')

  expect(screen.getByRole('heading', { name: 'Companies' })).toBeInTheDocument()
  expect(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Companies' })).toHaveAttribute(
    'aria-current',
    'page',
  )
})

test('an unknown page goes to the pipeline', async () => {
  renderAt('/nope')

  expect(await screen.findByText('Kvarnholmen AI')).toBeInTheDocument()
})

test('Companies groups every semester’s deals by company and opens one', async () => {
  renderAt('/companies')
  const granit = await screen.findByRole('button', { name: 'Granit Consulting' })
  const row = granit.closest('tr')!
  expect(row).toHaveTextContent('2') // deals
  expect(row).toHaveTextContent('55,000 SEK') // 40,000 signed this semester + 15,000 last

  fireEvent.click(granit)
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`${lastSemester} · Panel discussion`) }))

  const deal = screen.getByRole('dialog', { name: 'Granit Consulting' })
  expect(within(deal).getByLabelText('Event type')).toHaveValue('Panel discussion')
  expect(within(deal).getByLabelText('Semester')).toHaveValue(lastSemester)
})

test('Contacts lists the people from deals, with their email', async () => {
  renderAt('/contacts')

  const lina = await screen.findByRole('button', { name: 'Lina Dahl' })
  const row = lina.closest('tr')!
  expect(row).toHaveTextContent('Granit Consulting')
  expect(within(row).getByRole('link', { name: /lina\.dahl@example\.com/ })).toHaveAttribute('href', 'mailto:lina.dahl@example.com')

  fireEvent.click(lina)
  expect(screen.getByRole('dialog', { name: 'Granit Consulting' })).toBeInTheDocument()
})

test('search filters companies and contacts', async () => {
  renderAt('/companies')
  await screen.findByRole('button', { name: 'Granit Consulting' })

  fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'lumen' } })

  expect(screen.getByRole('button', { name: 'Lumen Health' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Granit Consulting' })).not.toBeInTheDocument()
})

test('Reports sums up the semester and lists who needs a follow-up', async () => {
  renderAt('/reports')

  expect(await screen.findByRole('heading', { name: `Report · ${thisSemester}` })).toBeInTheDocument()
  expect(screen.getByText('Win rate', { selector: 'p' }).parentElement).toHaveTextContent('67%')
  expect(screen.getByText('In the pipeline', { selector: 'p' }).parentElement).toHaveTextContent('60,000 SEK')
  const followUp = screen.getByRole('region', { name: 'Needs follow-up' })
  expect(followUp).toHaveTextContent('Needs follow-up (3)')

  fireEvent.click(within(followUp).getByRole('button', { name: 'Lumen Health' }))
  expect(screen.getByRole('dialog', { name: 'Lumen Health' })).toBeInTheDocument()
})

test('a new lead keeps the contact’s role, and Contacts shows it', async () => {
  await renderApp()

  await addLead({ Company: 'Nordljus AB', 'Contact name': 'Kim Ek', 'Contact email': 'kim@example.com', 'Contact role': 'Head of Talent' })

  const drawer = await screen.findByRole('dialog', { name: 'Nordljus AB' })
  expect(within(drawer).getByLabelText('Contact')).toHaveDisplayValue('Kim Ek')
  expect(drawer).toHaveTextContent('Head of Talent · kim@example.com')
  fireEvent.keyDown(document, { key: 'Escape' })
  goTo('Contacts')
  expect((await screen.findByRole('button', { name: 'Kim Ek' })).closest('tr')).toHaveTextContent('Head of Talent')
})

test('a new lead at an existing company can pick one of its contacts', async () => {
  await renderApp()
  await screen.findByText('Signed in as dev@kthais.com')
  fireEvent.click(screen.getByRole('button', { name: 'New Lead' }))
  const form = screen.getByRole('dialog', { name: /^New lead/ })

  fireEvent.change(within(form).getByLabelText('Company'), { target: { value: 'granit consulting' } })
  expect(form).toHaveTextContent('Existing company, 1 contact')
  fireEvent.change(within(form).getByLabelText('Contact'), { target: { value: 'p-lina-dahl-example-com' } })
  fireEvent.click(within(form).getByRole('button', { name: 'Add lead' }))

  const drawer = await screen.findByRole('dialog', { name: 'Granit Consulting' })
  expect(within(drawer).getByLabelText('Contact')).toHaveDisplayValue('Lina Dahl')
  expect(api.requests).toContainEqual({
    method: 'POST',
    path: '/api/deals',
    body: {
      ownerId: 'm-dev',
      companyId: 'c-granit-consulting',
      contactId: 'p-lina-dahl-example-com',
      dealType: 'Event',
      semester: thisSemester,
      nextStep: '',
    },
  })
  expect(api.companies.filter((c) => c.name === 'Granit Consulting')).toHaveLength(1)
})

test('the deal panel changes the deal’s contact to another at the company', async () => {
  api.contacts.push({ id: 'p-sam', companyId: 'c-granit-consulting', name: 'Sam Berg', email: 'sam@example.com', role: 'CFO' })
  await renderApp()
  const drawer = open('Granit Consulting')

  fireEvent.change(within(drawer).getByLabelText('Contact'), { target: { value: 'p-sam' } })

  expect(drawer).toHaveTextContent('CFO · sam@example.com')
  await waitFor(() => expect(patches()).toEqual([{ method: 'PATCH', path: '/api/deals/granit', body: { contactId: 'p-sam' } }]))
})

test('a contact change that fails to save goes back', async () => {
  api.contacts.push({ id: 'p-sam', companyId: 'c-granit-consulting', name: 'Sam Berg', email: 'sam@example.com', role: 'CFO' })
  api.fail('PATCH', /^\/api\/deals\//, 500)
  await renderApp()
  const drawer = open('Granit Consulting')

  fireEvent.change(within(drawer).getByLabelText('Contact'), { target: { value: 'p-sam' } })

  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save Granit Consulting")
  expect(within(drawer).getByLabelText('Contact')).toHaveDisplayValue('Lina Dahl')
})

const dialogNamed = (name: string | RegExp) => screen.findByRole('dialog', { name })

test('Companies adds, renames and deletes companies', async () => {
  renderAt('/companies')
  await screen.findByRole('button', { name: 'Granit Consulting' })

  fireEvent.click(screen.getByRole('button', { name: 'New company' }))
  let form = await dialogNamed('New company')
  fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Aurora AB' } })
  fireEvent.click(within(form).getByRole('button', { name: 'Add company' }))
  const aurora = await screen.findByRole('button', { name: 'Aurora AB' })
  expect(aurora.closest('tr')).toHaveTextContent('No deals yet')

  // A company with deals can be renamed, and its deals follow; it can't be deleted.
  fireEvent.click(screen.getByRole('button', { name: 'Edit Granit Consulting' }))
  form = await dialogNamed('Edit Granit Consulting')
  expect(within(form).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Granit AB' } })
  fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
  expect(await screen.findByRole('button', { name: 'Granit AB' })).toBeInTheDocument()
  expect(api.deals.find((d) => d.id === 'granit')?.company).toBe('Granit AB')

  // A company without deals can be deleted, after asking again.
  fireEvent.click(screen.getByRole('button', { name: 'Edit Aurora AB' }))
  form = await dialogNamed('Edit Aurora AB')
  fireEvent.click(within(form).getByRole('button', { name: 'Delete' }))
  fireEvent.click(within(form).getByRole('button', { name: 'Delete company' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Aurora AB' })).not.toBeInTheDocument())
})

test('a duplicate company name shows the reason and keeps the form', async () => {
  renderAt('/companies')
  await screen.findByRole('button', { name: 'Granit Consulting' })

  fireEvent.click(screen.getByRole('button', { name: 'New company' }))
  const form = await dialogNamed('New company')
  fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'granit consulting' } })
  fireEvent.click(within(form).getByRole('button', { name: 'Add company' }))

  expect(await within(form).findByRole('alert')).toHaveTextContent('there is already a company called granit consulting (409)')
  expect(within(form).getByLabelText('Name')).toHaveValue('granit consulting')
})

test('a contact can be added from their company', async () => {
  renderAt('/companies')
  fireEvent.click(await screen.findByRole('button', { name: 'Vinga Voice' }))
  expect(screen.getByRole('list', { name: 'Contacts at Vinga Voice' })).toHaveTextContent('Adam Roos')

  fireEvent.click(screen.getByRole('button', { name: 'Add contact' }))
  const form = await dialogNamed('New contact')
  expect(within(form).getByLabelText('Company')).toHaveDisplayValue('Vinga Voice')
  fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Mia Lind' } })
  fireEvent.click(within(form).getByRole('button', { name: 'Add contact' }))

  await waitFor(() => expect(screen.getByRole('list', { name: 'Contacts at Vinga Voice' })).toHaveTextContent('Mia Lind'))
})

test('Contacts edits a contact everywhere, and deletes one without deals', async () => {
  api.contacts.push({ id: 'p-sam', companyId: 'c-granit-consulting', name: 'Sam Berg', email: 'sam@example.com', role: 'CFO' })
  renderAt('/contacts')
  await screen.findByRole('button', { name: 'Lina Dahl' })

  fireEvent.click(screen.getByRole('button', { name: 'Edit Lina Dahl' }))
  let form = await dialogNamed('Edit Lina Dahl')
  expect(within(form).getByLabelText('Company')).toBeDisabled()
  expect(within(form).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  fireEvent.change(within(form).getByLabelText('Role'), { target: { value: 'Head of Talent' } })
  fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Lina Dahl' }).closest('tr')).toHaveTextContent('Head of Talent'))

  fireEvent.click(screen.getByRole('button', { name: 'Lina Dahl' }))
  expect(screen.getByRole('dialog', { name: 'Granit Consulting' })).toHaveTextContent('Head of Talent')
  fireEvent.keyDown(document, { key: 'Escape' })

  fireEvent.click(screen.getByRole('button', { name: 'Edit Sam Berg' }))
  form = await dialogNamed('Edit Sam Berg')
  fireEvent.click(within(form).getByRole('button', { name: 'Delete' }))
  fireEvent.click(within(form).getByRole('button', { name: 'Delete contact' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Sam Berg' })).not.toBeInTheDocument())
})

test('a contact email already in use shows the reason', async () => {
  renderAt('/contacts')
  await screen.findByRole('button', { name: 'Lina Dahl' })

  fireEvent.click(screen.getByRole('button', { name: 'New contact' }))
  const form = await dialogNamed('New contact')
  fireEvent.change(within(form).getByLabelText('Email'), { target: { value: 'LINA.DAHL@example.com' } })
  fireEvent.click(within(form).getByRole('button', { name: 'Add contact' }))

  expect(await within(form).findByRole('alert')).toHaveTextContent('LINA.DAHL@example.com is already a contact (409)')
})

test('saves to a deal go out in order, and a failed one keeps a newer edit', async () => {
  api.failOnce('PATCH', /^\/api\/deals\/lumen$/)
  await renderApp()
  open('Lumen Health')

  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'discussing' } })
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'signed' } })

  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save Lumen Health")
  await waitFor(() => expect(patches().map((p) => p.body)).toEqual([{ status: 'discussing' }, { status: 'signed' }]))
  expect(screen.getByLabelText('Status')).toHaveValue('signed')
  expect(api.deals.find((d) => d.id === 'lumen')?.status).toBe('signed')
})

test('a failed save goes back to what the server last confirmed', async () => {
  await renderApp()
  open('Lumen Health')

  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'discussing' } })
  await waitFor(() => expect(patches()).toHaveLength(1))
  api.failOnce('PATCH', /^\/api\/deals\/lumen$/)
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'signed' } })

  expect(await screen.findByRole('alert')).toBeInTheDocument()
  expect(screen.getByLabelText('Status')).toHaveValue('discussing')
})

test('New Lead waits for the deal list, so a late load can’t hide a new lead', async () => {
  const deals = api.hold('GET', /^\/api\/deals$/)
  render(
    <MemoryRouter>
      <App />
    </MemoryRouter>,
  )
  await screen.findByText('Signed in as dev@kthais.com')
  expect(screen.getByRole('button', { name: 'New Lead' })).toBeDisabled()

  await act(() => deals.release())
  expect(await screen.findByText('Kvarnholmen AI')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'New Lead' })).toBeEnabled()
})

test('a note saving in the background doesn’t erase what you type next', async () => {
  const save = api.hold('POST', /\/notes$/)
  await renderApp()
  const drawer = open('Lumen Health')
  const box = within(drawer).getByLabelText('Quick note')

  fireEvent.change(box, { target: { value: 'First note' } })
  fireEvent.click(within(drawer).getByRole('button', { name: 'Save Note' }))
  fireEvent.change(box, { target: { value: 'Second thought' } })
  await act(() => save.release())

  expect(await within(drawer).findByText('First note')).toBeInTheDocument()
  expect(box).toHaveValue('Second thought')
})

test('the New Lead form stays open until its lead is saved', async () => {
  const save = api.hold('POST', /^\/api\/deals$/)
  await renderApp()
  const form = await addLead({ Company: 'Nordljus AB' })

  fireEvent.keyDown(document, { key: 'Escape' })
  expect(form).toBeInTheDocument()

  await act(() => save.release())
  expect(await screen.findByRole('dialog', { name: 'Nordljus AB' })).toBeInTheDocument()
  expect(screen.queryByRole('dialog', { name: 'New lead' })).not.toBeInTheDocument()
})

test('a refresh that started before an edit doesn’t undo it', async () => {
  await renderApp()
  const refresh = api.hold('GET', /^\/api\/deals$/)
  await addLead({ Company: 'Nordljus AB' })
  const drawer = await screen.findByRole('dialog', { name: 'Nordljus AB' })

  fireEvent.change(within(drawer).getByLabelText('Status'), { target: { value: 'discussing' } })
  await waitFor(() => expect(patches()).toHaveLength(1))
  await act(() => refresh.release())

  expect(within(drawer).getByLabelText('Status')).toHaveValue('discussing')
  expect(within(column('Discussing')).getByText('Nordljus AB')).toBeInTheDocument()
})

test('a form can’t be closed while it deletes', async () => {
  const deleting = api.hold('DELETE', /^\/api\/companies\//)
  renderAt('/companies')
  await screen.findByRole('button', { name: 'Granit Consulting' })
  fireEvent.click(screen.getByRole('button', { name: 'New company' }))
  let form = await dialogNamed('New company')
  fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Aurora AB' } })
  fireEvent.click(within(form).getByRole('button', { name: 'Add company' }))
  await screen.findByRole('button', { name: 'Aurora AB' })

  fireEvent.click(screen.getByRole('button', { name: 'Edit Aurora AB' }))
  form = await dialogNamed('Edit Aurora AB')
  fireEvent.click(within(form).getByRole('button', { name: 'Delete' }))
  fireEvent.click(within(form).getByRole('button', { name: 'Delete company' }))
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(form).toBeInTheDocument()
  expect(within(form).getByRole('button', { name: 'Deleting…' })).toBeDisabled()

  await act(() => deleting.release())
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.queryByRole('button', { name: 'Aurora AB' })).not.toBeInTheDocument()
})

test('a contact edited elsewhere shows on a deal that’s still saving', async () => {
  const saving = api.hold('PATCH', /^\/api\/deals\/granit$/)
  await renderApp()
  open('Granit Consulting')
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'finished' } })
  fireEvent.keyDown(document, { key: 'Escape' })

  goTo('Contacts')
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Lina Dahl' }))
  const form = await dialogNamed('Edit Lina Dahl')
  fireEvent.change(within(form).getByLabelText('Email'), { target: { value: 'lina@granit.example.com' } })
  fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await act(() => saving.release())

  goTo('Pipeline')
  const drawer = open('Granit Consulting')
  expect(within(drawer).getByLabelText('Status')).toHaveValue('finished')
  expect(within(drawer).getByRole('link', { name: 'Send Email' })).toHaveAttribute(
    'href',
    expect.stringMatching(/^mailto:lina@granit\.example\.com\?/),
  )
})

test('a refresh that fails after a save can be retried on its own', async () => {
  renderAt('/companies')
  await screen.findByRole('button', { name: 'Granit Consulting' })
  api.failOnce('GET', /^\/api\/companies$/)

  fireEvent.click(screen.getByRole('button', { name: 'New company' }))
  const form = await dialogNamed('New company')
  fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Aurora AB' } })
  fireEvent.click(within(form).getByRole('button', { name: 'Add company' }))

  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't refresh")
  expect(screen.queryByRole('button', { name: 'Aurora AB' })).not.toBeInTheDocument()
  const posts = api.requests.filter((r) => r.method === 'POST').length

  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByRole('button', { name: 'Aurora AB' })).toBeInTheDocument()
  expect(api.requests.filter((r) => r.method === 'POST')).toHaveLength(posts) // the company isn't added twice
})

test('a new lead can start unassigned', async () => {
  await renderApp()

  await addLead({ Company: 'Nordljus AB', Owner: '' })

  const drawer = await screen.findByRole('dialog', { name: 'Nordljus AB' })
  expect(within(drawer).getByLabelText('Owner')).toHaveDisplayValue('Unassigned')
  expect(api.requests.find((r) => r.method === 'POST' && r.path === '/api/deals')?.body).toMatchObject({ ownerId: null })
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(card('Nordljus AB')).toHaveTextContent('Unassigned')
})

test('anyone can claim an unassigned lead, in any stage', async () => {
  await renderApp()
  expect(card('Stadsnät Labs')).toHaveTextContent('Unassigned')
  const drawer = open('Stadsnät Labs')

  fireEvent.click(within(drawer).getByRole('button', { name: 'Assign to me' }))

  expect(within(drawer).getByLabelText('Owner')).toHaveDisplayValue('Dev User')
  expect(within(drawer).queryByRole('button', { name: 'Assign to me' })).not.toBeInTheDocument()
  await waitFor(() => expect(patches()).toEqual([{ method: 'PATCH', path: '/api/deals/stadsnat', body: { ownerId: 'm-dev' } }]))
  expect(card('Stadsnät Labs')).not.toHaveTextContent('Unassigned')
})

test('a deal can be handed to someone else, or unassigned', async () => {
  await renderApp()
  const drawer = open('Granit Consulting')

  fireEvent.change(within(drawer).getByLabelText('Owner'), { target: { value: 'm-iris' } })
  expect(within(drawer).getByLabelText('Owner')).toHaveDisplayValue('Iris Wallin')

  fireEvent.change(within(drawer).getByLabelText('Owner'), { target: { value: '' } })
  await waitFor(() => expect(patches().map((p) => p.body)).toEqual([{ ownerId: 'm-iris' }, { ownerId: null }]))
  expect(card('Granit Consulting')).toHaveTextContent('Unassigned')
})

test('the board filters to my deals or unassigned ones', async () => {
  await renderApp()

  fireEvent.click(screen.getByRole('button', { name: 'Unassigned' }))
  expect(screen.getByText('Stadsnät Labs')).toBeInTheDocument()
  expect(screen.queryByText('Granit Consulting')).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Unassigned' }))
  open('Lumen Health')
  fireEvent.click(screen.getByRole('button', { name: 'Assign to me' }))
  fireEvent.keyDown(document, { key: 'Escape' })

  fireEvent.click(screen.getByRole('button', { name: 'Mine' }))
  expect(screen.getByText('Lumen Health')).toBeInTheDocument()
  expect(screen.queryByText('Stadsnät Labs')).not.toBeInTheDocument()
  expect(screen.queryByText('Granit Consulting')).not.toBeInTheDocument()
})

test('Team lists the business team; admins add members and change roles', async () => {
  renderAt('/team')

  const iris = (await screen.findByText('Iris Wallin')).closest('tr')!
  expect(within(iris).getByLabelText('Role of Iris Wallin')).toHaveDisplayValue('Member')
  expect(within(screen.getByRole('table')).getByText('Dev User').closest('tr')).toHaveTextContent('(you)')

  fireEvent.change(within(iris).getByLabelText('Role of Iris Wallin'), { target: { value: 'board' } })
  await waitFor(() => expect(api.members.find((m) => m.id === 'm-iris')?.role).toBe('board'))

  fireEvent.click(screen.getByRole('button', { name: 'Add member' }))
  const form = await dialogNamed('Add member')
  fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Mia Lind' } })
  fireEvent.change(within(form).getByLabelText('Email'), { target: { value: 'mia@example.com' } })
  fireEvent.click(within(form).getByRole('button', { name: 'Add member' }))
  const mia = (await screen.findByText('Mia Lind')).closest('tr')!

  // Someone without deals can be removed; someone with deals can't.
  expect(within(iris).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  fireEvent.click(within(mia).getByRole('button', { name: 'Delete' }))
  fireEvent.click(within(mia).getByRole('button', { name: 'Delete Mia Lind' }))
  await waitFor(() => expect(screen.queryByText('Mia Lind')).not.toBeInTheDocument())
})

test('an admin hands over to a new head of business, and steps down to board', async () => {
  renderAt('/team')
  await screen.findByText('Iris Wallin')

  fireEvent.click(screen.getByRole('button', { name: 'Hand over admin' }))
  const form = await dialogNamed('Hand over admin')
  fireEvent.change(within(form).getByLabelText('New admin'), { target: { value: 'm-iris' } })
  expect(within(form).getByLabelText('You become')).toHaveValue('board')
  fireEvent.click(within(form).getByRole('button', { name: 'Hand over' }))

  await waitFor(() => expect(screen.queryByRole('button', { name: 'Add member' })).not.toBeInTheDocument())
  expect(screen.queryByRole('dialog', { name: 'Hand over admin' })).not.toBeInTheDocument()
  expect(api.members.find((m) => m.id === 'm-iris')?.role).toBe('admin')
  expect(screen.getByText('Iris Wallin').closest('tr')).toHaveTextContent('Admin')
  expect(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Reports' })).toBeInTheDocument()
})

test('a Fathom meeting shows its summary, action items and a link to the recording', async () => {
  await renderApp()
  const drawer = open('Fjällbacka Ventures')

  const meeting = within(drawer).getByText('Intro call').closest('li')!
  expect(meeting).toHaveTextContent('via Fathom')
  expect(meeting).toHaveTextContent('Prefer an evening format')
  expect(within(meeting).getByRole('link', { name: 'Open recording' })).toHaveAttribute('href', 'https://fathom.video/share/made-up')
})

test('a member who hasn’t connected Gmail is asked to, until they put it off', async () => {
  api = stubApi({ gmail: 'not-connected' })
  await renderApp()

  expect(within(screen.getByRole('complementary')).getByRole('link', { name: 'Connect Gmail' })).toBeInTheDocument()
  const bar = screen.getByText(/Connect your Gmail/).closest('div')!
  expect(within(bar).getByRole('link', { name: 'Connect Gmail' })).toHaveAttribute('href', '/auth/gmail/connect')

  fireEvent.click(within(bar).getByRole('button', { name: 'Later' }))
  expect(screen.queryByText(/Connect your Gmail/)).not.toBeInTheDocument()
  expect(within(screen.getByRole('complementary')).getByRole('link', { name: 'Connect Gmail' })).toBeInTheDocument()
})

test('without Connect Gmail set up, nobody is asked', async () => {
  await renderApp()

  expect(screen.queryByText(/Connect your Gmail/)).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Connect Gmail' })).not.toBeInTheDocument()
})

test('coming back from Google says how connecting went, once', async () => {
  api = stubApi({ gmail: 'connected' })
  window.history.replaceState(null, '', '/?gmail=connected')
  await renderApp()

  expect(screen.getByRole('status')).toHaveTextContent('Gmail connected')
  expect(window.location.search).toBe('')
  fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name: 'Dismiss' }))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

test('connecting someone else’s mailbox is explained', async () => {
  api = stubApi({ gmail: 'not-connected' })
  window.history.replaceState(null, '', '/?gmail=wrong-account')
  await renderApp()

  expect(screen.getByRole('status')).toHaveTextContent('Connect the Gmail of the account you’re signed in with')
  window.history.replaceState(null, '', '/')
})

test('a connected member can disconnect their Gmail', async () => {
  api = stubApi({ gmail: 'connected' })
  await renderApp()
  const sidebar = screen.getByRole('complementary')
  expect(sidebar).toHaveTextContent('Gmail connected')

  fireEvent.click(within(sidebar).getByRole('button', { name: 'Disconnect' }))

  expect(await within(sidebar).findByRole('link', { name: 'Connect Gmail' })).toBeInTheDocument()
  expect(api.requests.some((r) => r.method === 'DELETE' && r.path === '/api/gmail')).toBe(true)
})

test('phones can connect and disconnect Gmail too', async () => {
  api = stubApi({ gmail: 'connected' })
  await renderApp()
  const phone = screen.getByRole('navigation', { name: 'Pages' })

  fireEvent.click(within(phone).getByRole('button', { name: 'Disconnect Gmail' }))

  expect(await within(phone).findByRole('link', { name: 'Connect Gmail' })).toHaveAttribute('href', '/auth/gmail/connect')
})

test('a synced email shows which way it went, and opens in Gmail', async () => {
  await renderApp()
  const drawer = open('Fjällbacka Ventures')

  const email = within(drawer).getByText('Re: Founders dinner').closest('li')!
  expect(email).toHaveTextContent('Received')
  expect(email).toHaveTextContent('via Gmail')
  expect(email).toHaveTextContent('Could you send a one-pager')
  expect(within(email).getByRole('link', { name: 'Open in Gmail' })).toHaveAttribute('href', expect.stringContaining('mail.google.com'))
})

test('an email in a teammate’s Gmail says whose, instead of a link that can’t open', async () => {
  api.deals.find((d) => d.id === 'fjallbacka')!.activities.find((a) => a.id === 'fjallbacka-3')!.url =
    'https://mail.google.com/mail/?authuser=noah.ek%40example.com#all/made-up'
  await renderApp()
  const drawer = open('Fjällbacka Ventures')

  const email = within(drawer).getByText('Re: Founders dinner').closest('li')!
  expect(within(email).queryByRole('link', { name: 'Open in Gmail' })).not.toBeInTheDocument()
  expect(email).toHaveTextContent('In Noah Ek’s Gmail')
})

test('when Google withdraws access, the member is asked to reconnect', async () => {
  api = stubApi({ gmail: 'reconnect' })
  await renderApp()

  const bar = screen.getByText(/Google stopped letting Lucid read your Gmail/).closest('div')!
  expect(within(bar).getByRole('link', { name: 'Reconnect Gmail' })).toHaveAttribute('href', '/auth/gmail/connect')
  expect(within(screen.getByRole('complementary')).getByRole('link', { name: 'Reconnect Gmail' })).toBeInTheDocument()
})

test('the board says when a company is waiting on our reply', async () => {
  const deal = api.deals.find((d) => d.id === 'fjallbacka')!
  deal.activities = deal.activities.filter((a) => a.type === 'email')
  await renderApp()

  expect(within(card('Fjällbacka Ventures')).getByText('Clara replied 3 days ago: your turn')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Needs follow-up' }))
  expect(card('Fjällbacka Ventures')).toBeInTheDocument()
})

test('Team shows who has connected Gmail', async () => {
  api = stubApi({ gmail: 'connected' })
  renderAt('/team')

  const me = (await within(await screen.findByRole('table')).findByText('Dev User')).closest('tr')!
  expect(me).toHaveTextContent('Connected')
  expect(screen.getByText('Iris Wallin').closest('tr')).toHaveTextContent('Not yet')
})

test('a role change the server refuses shows why', async () => {
  api.fail('PATCH', /^\/api\/members\//, 409, 'the team needs at least one admin')
  renderAt('/team')

  const alva = (await screen.findByText('Alva Lindqvist')).closest('tr')!
  fireEvent.change(within(alva).getByLabelText('Role of Alva Lindqvist'), { target: { value: 'member' } })

  expect(await screen.findByRole('alert')).toHaveTextContent('the team needs at least one admin (409)')
})

test('members see the team but can’t change it', async () => {
  api = stubApi({ role: 'member' })
  renderAt('/team')

  const iris = (await screen.findByText('Iris Wallin')).closest('tr')!
  expect(iris).toHaveTextContent('Member')
  expect(within(iris).queryByRole('combobox')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Add member' })).not.toBeInTheDocument()
  expect(await screen.findByText('member', { selector: 'aside span' })).toBeInTheDocument()
})

test('Reports are for the board and admins', async () => {
  for (const role of ['admin', 'board'] as const) {
    api = stubApi({ role })
    renderAt('/reports')
    expect(await screen.findByRole('heading', { name: `Report · ${thisSemester}` })).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Reports' })).toBeInTheDocument()
    cleanup()
  }
})

test('members don’t see Reports', async () => {
  api = stubApi({ role: 'member' })
  renderAt('/reports')

  expect(await screen.findByText('Reports are for the board and admins.')).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: /^Report/ })).not.toBeInTheDocument()
  expect(within(screen.getByRole('navigation', { name: 'Main' })).queryByRole('link', { name: 'Reports' })).not.toBeInTheDocument()
  expect(within(screen.getByRole('navigation', { name: 'Pages' })).queryByRole('link', { name: 'Reports' })).not.toBeInTheDocument()
})

test('a failed edit goes back to the last successful save, even one a refresh overtook', async () => {
  const save = api.hold('PATCH', /^\/api\/deals\/lumen$/, { late: true })
  await renderApp()
  open('Lumen Health')
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'discussing' } })
  fireEvent.keyDown(document, { key: 'Escape' })

  // A refresh reads before the save commits, and is answered first.
  await addLead({ Company: 'Nordljus AB' })
  await screen.findByRole('dialog', { name: 'Nordljus AB' })
  fireEvent.keyDown(document, { key: 'Escape' })
  await act(() => save.release())
  await waitFor(() => expect(api.deals.find((d) => d.id === 'lumen')?.status).toBe('discussing'))

  api.failOnce('PATCH', /^\/api\/deals\/lumen$/)
  open('Lumen Health')
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'signed' } })

  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save Lumen Health")
  expect(screen.getByLabelText('Status')).toHaveValue('discussing')
})

test('a note shows once when another answer brings it first', async () => {
  const note = api.hold('POST', /\/notes$/)
  await renderApp()
  const drawer = open('Lumen Health')

  fireEvent.change(within(drawer).getByLabelText('Quick note'), { target: { value: 'Called them' } })
  fireEvent.click(within(drawer).getByRole('button', { name: 'Save Note' }))
  await waitFor(() => expect(api.requests.some((r) => r.path.endsWith('/notes'))).toBe(true))
  fireEvent.change(within(drawer).getByLabelText('Status'), { target: { value: 'discussing' } })
  await waitFor(() => expect(within(drawer).getAllByText('Called them')).toHaveLength(1))
  await act(() => note.release())

  await waitFor(() => expect(within(drawer).getByLabelText('Quick note')).toHaveValue(''))
  expect(within(drawer).getAllByText('Called them')).toHaveLength(1)
})

test('on a first sign-in, the team includes you once signing in has added you', async () => {
  api = stubApi({ firstSignIn: true })
  const signIn = api.hold('GET', /^\/api\/me$/, { late: true })
  renderAt('/team')
  await screen.findByText('Iris Wallin')
  expect(within(screen.getByRole('table')).queryByText('Dev User')).not.toBeInTheDocument()

  await act(() => signIn.release())

  expect(await within(screen.getByRole('table')).findByText('Dev User')).toBeInTheDocument()
})

test('changing your own role changes what you can do at once', async () => {
  renderAt('/team')
  const me = (await within(await screen.findByRole('table')).findByText('Dev User')).closest('tr')!
  expect(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Reports' })).toBeInTheDocument()

  fireEvent.change(within(me).getByLabelText('Role of Dev User'), { target: { value: 'member' } })

  await waitFor(() =>
    expect(within(screen.getByRole('navigation', { name: 'Main' })).queryByRole('link', { name: 'Reports' })).not.toBeInTheDocument(),
  )
  expect(screen.queryByRole('button', { name: 'Add member' })).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Role of Iris Wallin')).not.toBeInTheDocument()
})

test('a failed edit goes back to a teammate’s newer value, not an overtaken save', async () => {
  const save = api.hold('PATCH', /^\/api\/deals\/lumen$/)
  await renderApp()
  open('Lumen Health')
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'discussing' } })
  fireEvent.keyDown(document, { key: 'Escape' })
  await waitFor(() => expect(patches()).toHaveLength(1))

  // A teammate moves the deal on, and a refresh reads that before the save's answer arrives.
  api.deals.find((d) => d.id === 'lumen')!.status = 'agreement'
  await addLead({ Company: 'Nordljus AB' })
  await screen.findByRole('dialog', { name: 'Nordljus AB' })
  fireEvent.keyDown(document, { key: 'Escape' })
  await act(() => save.release())
  await waitFor(() => expect(within(column('Agreement')).getByText('Lumen Health')).toBeInTheDocument())

  api.failOnce('PATCH', /^\/api\/deals\/lumen$/)
  open('Lumen Health')
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'signed' } })

  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save Lumen Health")
  expect(screen.getByLabelText('Status')).toHaveValue('agreement')
})

test('on a first sign-in, a late team list doesn’t replace a newer one', async () => {
  api = stubApi({ firstSignIn: true })
  const signIn = api.hold('GET', /^\/api\/me$/, { late: true })
  renderAt('/team')
  await screen.findByText('Iris Wallin')
  const lateTeam = api.hold('GET', /^\/api\/members$/, { once: true })
  await act(() => signIn.release())
  await waitFor(() => expect(api.requests.filter((r) => r.path === '/api/members')).toHaveLength(2))

  // An admin adds someone, and the reload after it is answered before the list asked for on sign-in.
  fireEvent.click(screen.getByRole('button', { name: 'Add member' }))
  const form = await dialogNamed('Add member')
  fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Mia Lind' } })
  fireEvent.change(within(form).getByLabelText('Email'), { target: { value: 'mia@example.com' } })
  fireEvent.click(within(form).getByRole('button', { name: 'Add member' }))
  await screen.findByText('Mia Lind')
  await act(() => lateTeam.release())
  await settle()

  expect(screen.getByText('Mia Lind')).toBeInTheDocument()
})

test('a failed edit reads the deal again when the last save’s value is unknown', async () => {
  const save = api.hold('PATCH', /^\/api\/deals\/lumen$/, { late: true })
  await renderApp()
  open('Lumen Health')
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'discussing' } })
  fireEvent.keyDown(document, { key: 'Escape' })

  // A refresh reads before the save commits and is answered first; reading the deal again then fails.
  await addLead({ Company: 'Nordljus AB' })
  await screen.findByRole('dialog', { name: 'Nordljus AB' })
  fireEvent.keyDown(document, { key: 'Escape' })
  api.failOnce('GET', /^\/api\/deals\/lumen$/)
  await act(() => save.release())
  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't refresh Lumen Health")
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()

  api.failOnce('PATCH', /^\/api\/deals\/lumen$/)
  open('Lumen Health')
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'signed' } })

  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Couldn't save Lumen Health"))
  await waitFor(() => expect(screen.getByLabelText('Status')).toHaveValue('discussing'))
})

test('My page shows who you are, your Gmail, and how your deals are going', async () => {
  api = stubApi({ signedIn: true, gmail: 'connected' })
  // Dev takes over Maja's deals, as owner and as support.
  const dev = { id: 'm-dev', name: 'Dev User', email: 'dev@kthais.com' }
  for (const deal of api.deals) {
    if (deal.owner?.id === 'm-maja') deal.owner = dev
    deal.support = deal.support.map((p) => (p.id === 'm-maja' ? dev : p))
  }
  renderAt('/me')

  const profile = await screen.findByRole('region', { name: 'Profile' })
  expect(profile).toHaveTextContent('Dev User')
  expect(profile).toHaveTextContent('Admin')
  expect(within(profile).getByRole('button', { name: 'Disconnect Gmail' })).toBeInTheDocument()
  expect(within(profile).getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  expect(await screen.findByRole('heading', { name: `Your deals · ${thisSemester}` })).toBeInTheDocument()
  expect(screen.getByText('Confirmed', { selector: 'p' }).parentElement).toHaveTextContent('40,000 SEK')
  expect(screen.getByRole('region', { name: 'Your semesters' })).toHaveTextContent(lastSemester)

  // Lumen Health has gone quiet and Dev doesn't own it, so it isn't waiting on them.
  expect(screen.getByRole('region', { name: 'Waiting on you' })).not.toHaveTextContent('Lumen Health')
  fireEvent.click(within(screen.getByRole('region', { name: 'Supporting' })).getByRole('button', { name: 'Lumen Health' }))
  expect(screen.getByRole('dialog', { name: 'Lumen Health' })).toBeInTheDocument()
})

test('My page lists your deals that need you, and opens them', async () => {
  for (const deal of api.deals) if (deal.company === 'Kvarnholmen AI') deal.owner = { id: 'm-dev', name: 'Dev User', email: 'dev@kthais.com' }
  renderAt('/me')

  const waiting = await screen.findByRole('region', { name: 'Waiting on you' })
  expect(waiting).toHaveTextContent('Waiting on you (1)')
  fireEvent.click(within(waiting).getByRole('button', { name: 'Kvarnholmen AI' }))
  expect(screen.getByRole('dialog', { name: 'Kvarnholmen AI' })).toBeInTheDocument()
})

test('My page offers to connect or reconnect Gmail', async () => {
  api = stubApi({ gmail: 'reconnect' })
  renderAt('/me')

  const profile = await screen.findByRole('region', { name: 'Profile' })
  expect(within(profile).getByRole('link', { name: 'Reconnect Gmail' })).toHaveAttribute('href', '/auth/gmail/connect')
  expect(within(profile).queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument() // the dev user
})

test('you set your own title on My page, and the team sees it', async () => {
  renderAt('/me')
  const title = await screen.findByLabelText('Your title')

  fireEvent.change(title, { target: { value: ' Partnerships Lead ' } })
  fireEvent.blur(title)

  await waitFor(() => expect(api.requests.filter((r) => r.path === '/api/me' && r.method === 'PATCH').map((r) => r.body)).toEqual([{ title: 'Partnerships Lead' }]))
  await waitFor(() => expect(screen.getByLabelText('Your title')).toHaveValue('Partnerships Lead'))
  goTo('Team')
  const me = (await screen.findByText('(you)')).closest('tr')!
  expect(me).toHaveTextContent('Partnerships Lead')
})

test('a title that fails to save goes back, with the reason', async () => {
  renderAt('/me')
  const title = await screen.findByLabelText('Your title')
  api.fail('PATCH', /^\/api\/me$/, 400, 'a title is limited to 100 characters')

  fireEvent.change(title, { target: { value: 'Head of Everything' } })
  fireEvent.blur(title)

  expect(await screen.findByRole('alert')).toHaveTextContent('a title is limited to 100 characters')
  expect(title).toHaveValue('')
})

test('an admin gives a new member a title', async () => {
  renderAt('/team')
  fireEvent.click(await screen.findByRole('button', { name: 'Add member' }))
  const form = await dialogNamed('Add member')
  fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Mia Lind' } })
  fireEvent.change(within(form).getByLabelText('Email'), { target: { value: 'mia@example.com' } })
  fireEvent.change(within(form).getByLabelText(/Title/), { target: { value: 'Head of Business' } })
  fireEvent.click(within(form).getByRole('button', { name: 'Add member' }))

  const mia = (await screen.findByText('Mia Lind')).closest('tr')!
  expect(mia).toHaveTextContent('Head of Business')
})

test('typing while your title saves keeps the newer text, and saves it next', async () => {
  renderAt('/me')
  const title = await screen.findByLabelText('Your title')
  const saving = api.hold('PATCH', /^\/api\/me$/, { once: true })

  fireEvent.change(title, { target: { value: 'Partnerships Lead' } })
  fireEvent.blur(title)
  fireEvent.focus(title)
  fireEvent.change(title, { target: { value: 'Partnerships Lead, Europe' } })
  await saving.release()
  await waitFor(() => expect(api.members.find((m) => m.id === 'm-dev')?.title).toBe('Partnerships Lead'))
  await settle()

  expect(title).toHaveValue('Partnerships Lead, Europe')
  fireEvent.blur(title)
  await waitFor(() => expect(screen.getByLabelText('Your title')).toHaveValue('Partnerships Lead, Europe'))
  expect(api.requests.filter((r) => r.path === '/api/me' && r.method === 'PATCH').map((r) => r.body)).toEqual([
    { title: 'Partnerships Lead' },
    { title: 'Partnerships Lead, Europe' },
  ])
})

test('a failed title save doesn’t erase what you typed since', async () => {
  renderAt('/me')
  const title = await screen.findByLabelText('Your title')
  api.failOnce('PATCH', /^\/api\/me$/, 500, 'something went wrong')
  const saving = api.hold('PATCH', /^\/api\/me$/, { once: true })

  fireEvent.change(title, { target: { value: 'Head of Everything' } })
  fireEvent.blur(title)
  fireEvent.change(title, { target: { value: 'Partnerships Lead' } })
  await saving.release()

  expect(await screen.findByRole('alert')).toHaveTextContent('something went wrong')
  expect(title).toHaveValue('Partnerships Lead')
})

test('the deal panel edits the deal’s details', async () => {
  await renderApp()
  const drawer = open('Granit Consulting')

  fireEvent.change(within(drawer).getByLabelText('Deal type'), { target: { value: 'Partnership' } })
  fireEvent.change(within(drawer).getByLabelText('Event type'), { target: { value: 'Workshop' } })
  fireEvent.change(within(drawer).getByLabelText('Audience'), { target: { value: 'Internal' } })
  const location = within(drawer).getByLabelText('Location')
  fireEvent.change(location, { target: { value: ' KTH Library ' } })
  fireEvent.blur(location)
  fireEvent.change(within(drawer).getByLabelText('Invoice due'), { target: { value: '2027-01-15' } })
  fireEvent.click(within(drawer).getByRole('button', { name: '4 out of 5' }))
  const notes = within(drawer).getByLabelText('Notes')
  fireEvent.change(notes, { target: { value: 'Covers food.' } })
  fireEvent.blur(notes)

  await waitFor(() =>
    expect(patches().map((p) => p.body)).toEqual([
      { dealType: 'Partnership' },
      { eventType: 'Workshop' },
      { audience: 'Internal' },
      { location: 'KTH Library' },
      { invoiceDue: '2027-01-15' },
      { rating: 4 },
      { notes: 'Covers food.' },
    ]),
  )
  expect(api.deals.find((d) => d.id === 'granit')).toMatchObject({
    dealType: 'Partnership',
    eventType: 'Workshop',
    audience: 'Internal',
    location: 'KTH Library',
    invoiceDue: '2027-01-15',
    rating: 4,
    notes: 'Covers food.',
  })
  expect(within(drawer).getByRole('button', { name: '4 out of 5' })).toHaveAttribute('aria-pressed', 'true')

  fireEvent.click(within(drawer).getByRole('button', { name: '4 out of 5' }))
  await waitFor(() => expect(patches().at(-1)?.body).toEqual({ rating: null }))
})

test('moving the start date past the end clears the end, and the end needs a start', async () => {
  await renderApp()
  const drawer = open('Granit Consulting')
  const start = within(drawer).getByLabelText('Start date')
  const end = within(drawer).getByLabelText('End date')

  fireEvent.change(end, { target: { value: '2026-12-05' } })
  fireEvent.change(start, { target: { value: '2026-12-10' } })
  expect(end).toHaveValue('')

  fireEvent.change(start, { target: { value: '' } })
  expect(end).toBeDisabled()
  await waitFor(() =>
    expect(patches().map((p) => p.body)).toEqual([
      { endDate: '2026-12-05' },
      { startDate: '2026-12-10', endDate: null },
      { startDate: null },
    ]),
  )
})

test('the deal panel moves a deal to another company, without its contact', async () => {
  await renderApp()
  const drawer = open('Granit Consulting')

  const saving = api.hold('PATCH', /\/api\/deals\/granit/)
  fireEvent.change(within(drawer).getByLabelText('Company'), { target: { value: 'c-kvarnholmen-ai' } })

  // At once, before the server answers.
  const moved = screen.getByRole('dialog', { name: 'Kvarnholmen AI' })
  expect(within(moved).getByLabelText('Contact')).toHaveDisplayValue('No contact')
  expect(moved).not.toHaveTextContent('lina.dahl@example.com')
  await saving.release()
  await waitFor(() => expect(patches().map((p) => p.body)).toEqual([{ companyId: 'c-kvarnholmen-ai' }]))
  expect(api.deals.find((d) => d.id === 'granit')).toMatchObject({ company: 'Kvarnholmen AI', contact: null })
})

test('the deal panel adds and removes support, leaving out the owner', async () => {
  await renderApp()
  const drawer = open('Granit Consulting')
  const add = within(drawer).getByLabelText('Add support')
  expect(within(add).queryByRole('option', { name: 'Maja Holm' })).not.toBeInTheDocument() // the owner
  expect(within(add).queryByRole('option', { name: 'Oskar Berg' })).not.toBeInTheDocument() // already supports

  fireEvent.change(add, { target: { value: 'm-iris' } })
  expect(drawer).toHaveTextContent('Iris Wallin')
  fireEvent.click(within(drawer).getByRole('button', { name: 'Remove Oskar Berg from support' }))

  await waitFor(() =>
    expect(patches().map((p) => p.body)).toEqual([{ supportIds: ['m-oskar', 'm-iris'] }, { supportIds: ['m-iris'] }]),
  )
  expect(api.deals.find((d) => d.id === 'granit')?.support.map((p) => p.name)).toEqual(['Iris Wallin'])
})

test('the deal panel edits links, and opens only web addresses', async () => {
  await renderApp()
  const drawer = open('Granit Consulting')
  expect(within(drawer).getByRole('link', { name: 'Open Contract' })).toHaveAttribute('href', 'https://drive.example.com/granit-contract')

  const drive = within(drawer).getByLabelText('Drive link')
  fireEvent.change(drive, { target: { value: 'https://drive.example.com/granit' } })
  fireEvent.blur(drive)
  const contract = within(drawer).getByLabelText('Contract link')
  fireEvent.change(contract, { target: { value: '' } })
  fireEvent.blur(contract)

  await waitFor(() =>
    expect(patches().map((p) => p.body)).toEqual([{ links: { drive: 'https://drive.example.com/granit' } }, { links: { contract: '' } }]),
  )
  expect(within(drawer).getByRole('link', { name: 'Open Drive' })).toHaveAttribute('href', 'https://drive.example.com/granit')
  expect(within(drawer).queryByRole('link', { name: 'Open Contract' })).not.toBeInTheDocument()

  // The server refuses anything but a web address; until it answers, it isn't a link either.
  api.fail('PATCH', /\/api\/deals\/granit/, 400, 'links.writeUp must be a web address (https://…)')
  const writeUp = within(drawer).getByLabelText('Write-up link')
  fireEvent.change(writeUp, { target: { value: 'javascript:alert(1)' } })
  fireEvent.blur(writeUp)
  expect(within(drawer).queryByRole('link', { name: 'Open Write-up' })).not.toBeInTheDocument()
  expect(await screen.findByText(/must be a web address/)).toBeInTheDocument()
  expect(writeUp).toHaveValue('')
})

test('title saves go out one at a time, so the newest one wins', async () => {
  renderAt('/me')
  const title = await screen.findByLabelText('Your title')
  const first = api.hold('PATCH', /^\/api\/me$/, { late: true, once: true })
  const sent = () => api.requests.filter((r) => r.path === '/api/me' && r.method === 'PATCH').map((r) => r.body)

  fireEvent.change(title, { target: { value: 'Partnerships Lead' } })
  fireEvent.blur(title)
  fireEvent.change(title, { target: { value: 'Head of Business' } })
  fireEvent.blur(title)
  await settle()
  expect(sent()).toEqual([{ title: 'Partnerships Lead' }]) // the newer one waits

  await first.release()
  await waitFor(() => expect(sent()).toEqual([{ title: 'Partnerships Lead' }, { title: 'Head of Business' }]))
  await waitFor(() => expect(api.members.find((m) => m.id === 'm-dev')?.title).toBe('Head of Business'))
  await waitFor(() => expect(title).toHaveValue('Head of Business'))
})

test('going back to the saved title while another save is under way saves it too', async () => {
  api.members.find((m) => m.id === 'm-dev')!.title = 'Partnerships Lead'
  renderAt('/me')
  const title = await screen.findByLabelText('Your title')
  await waitFor(() => expect(title).toHaveValue('Partnerships Lead'))
  const first = api.hold('PATCH', /^\/api\/me$/, { late: true, once: true })

  fireEvent.change(title, { target: { value: 'Head of Business' } })
  fireEvent.blur(title)
  fireEvent.change(title, { target: { value: 'Partnerships Lead' } })
  fireEvent.blur(title)
  await first.release()

  await waitFor(() => expect(api.members.find((m) => m.id === 'm-dev')?.title).toBe('Partnerships Lead'))
  await waitFor(() => expect(title).toHaveValue('Partnerships Lead'))
})

test('My page connects and disconnects Fathom', async () => {
  api = stubApi({ signedIn: true, fathom: 'connected' })
  renderAt('/me')
  const profile = await screen.findByRole('region', { name: 'Profile' })
  expect(profile).toHaveTextContent('Fathom connected')

  fireEvent.click(within(profile).getByRole('button', { name: 'Disconnect Fathom' }))

  const connect = await within(profile).findByRole('link', { name: 'Connect Fathom' })
  expect(connect).toHaveAttribute('href', '/auth/fathom/connect')
  expect(api.requests.some((r) => r.method === 'DELETE' && r.path === '/api/fathom')).toBe(true)
})

test('My page says how connecting Fathom went, once', async () => {
  window.history.replaceState(null, '', '/me?fathom=no-access')
  api = stubApi({ signedIn: true, fathom: 'not-connected' })
  renderAt('/me')

  const status = await screen.findByText(/Fathom wasn’t connected/)
  expect(window.location.search).toBe('')
  fireEvent.click(within(status).getByRole('button', { name: 'Dismiss' }))
  expect(screen.queryByText(/Fathom wasn’t connected/)).not.toBeInTheDocument()
  window.history.replaceState(null, '', '/')
})

test('without Connect Fathom, My page and Team say nothing of it', async () => {
  renderAt('/me')
  expect(await screen.findByRole('region', { name: 'Profile' })).not.toHaveTextContent('Fathom')
  goTo('Team')
  expect(await screen.findByRole('table')).not.toHaveTextContent('Fathom')
})

test('Team shows who has connected Fathom', async () => {
  api = stubApi({ fathom: 'connected' })
  renderAt('/team')

  const table = await screen.findByRole('table')
  expect(within(table).getByRole('columnheader', { name: 'Fathom' })).toBeInTheDocument()
  const me = within(table).getByText('(you)').closest('tr')!
  expect(me).toHaveTextContent('Connected')
  expect(within(table).getByText('Iris Wallin').closest('tr')).toHaveTextContent('Not yet')
})
