import { expect, test } from 'vitest'
import { fixtureDeals } from '../test/fixtures'
import { byAttention, calendarDaysBetween, compareSemesters, currentSemester, isUnpaid, needsWrapUp, nudgeFor, type Deal } from './deals'

const now = new Date('2026-10-13T12:00:00').getTime()
const deal = (patch: Partial<Deal>): Deal => ({
  ...fixtureDeals[0],
  status: 'discussing',
  nextStepDue: null,
  activities: [{ id: 'a', type: 'note', source: 'manual', title: '', body: '', timestamp: '2026-10-12T12:00:00' }],
  ...patch,
})

test('an overdue next step wins over inactivity', () => {
  const old = [{ id: 'a', type: 'note' as const, source: 'manual' as const, title: '', body: '', timestamp: '2026-10-01T12:00:00' }]
  expect(nudgeFor(deal({ nextStepDue: '2026-10-10', activities: old }), now)).toEqual({ kind: 'overdue', days: 3 })
})

test('a next step due today is not overdue', () => {
  expect(nudgeFor(deal({ nextStepDue: '2026-10-13' }), now)).toBeNull()
})

test('nudges after 4 days without a touchpoint', () => {
  const at = (timestamp: string) => [{ id: 'a', type: 'note' as const, source: 'manual' as const, title: '', body: '', timestamp }]
  expect(nudgeFor(deal({ activities: at('2026-10-10T12:00:00') }), now)).toBeNull()
  expect(nudgeFor(deal({ activities: at('2026-10-09T12:00:00') }), now)).toEqual({ kind: 'inactive', days: 4 })
})

test('finished and canceled deals never nudge', () => {
  expect(nudgeFor(deal({ status: 'finished', nextStepDue: '2026-01-01' }), now)).toBeNull()
  expect(nudgeFor(deal({ status: 'canceled', nextStepDue: '2026-01-01' }), now)).toBeNull()
})

test('sorts semesters newest first', () => {
  expect(['HT 2025', 'HT 2026', 'VT 2026'].sort(compareSemesters)).toEqual(['HT 2026', 'VT 2026', 'HT 2025'])
})

test('counts overdue days by calendar date, across a clock change', () => {
  // Stockholm springs forward on 29 March 2026: the night of 29→30 March is 23 hours long.
  expect(calendarDaysBetween('2026-03-29', '2026-03-30')).toBe(1)
  expect(calendarDaysBetween('2026-03-28', '2026-03-31')).toBe(3)
  const justAfterMidnight = new Date('2026-03-30T00:30:00').getTime()
  expect(nudgeFor(deal({ nextStepDue: '2026-03-29' }), justAfterMidnight)).toEqual({ kind: 'overdue', days: 1 })
})

test('a confirmed fee is unpaid until marked paid or cancelled', () => {
  const signed = (invoiceStatus: Deal['invoiceStatus']) => deal({ status: 'signed', feeSEK: 20_000, invoiceStatus })
  expect(isUnpaid(signed(null))).toBe(true)
  expect(isUnpaid(signed('not_sent'))).toBe(true)
  expect(isUnpaid(signed('waiting'))).toBe(true)
  expect(isUnpaid(signed('paid'))).toBe(false)
  expect(isUnpaid(signed('cancelled'))).toBe(false)
  expect(isUnpaid(deal({ status: 'discussing', feeSEK: 20_000, invoiceStatus: null }))).toBe(false)
})

test('the current semester is VT from January and HT from July', () => {
  expect(currentSemester(new Date(2026, 0, 10))).toBe('VT 2026')
  expect(currentSemester(new Date(2026, 5, 30))).toBe('VT 2026')
  expect(currentSemester(new Date(2026, 6, 1))).toBe('HT 2026')
  expect(currentSemester(new Date(2026, 11, 31))).toBe('HT 2026')
})

// Emails say whose turn it is (docs/adr/0006): one nudge per deal, in this order.
const email = (direction: 'sent' | 'received', timestamp: string) => ({
  id: `e-${timestamp}`,
  type: 'email' as const,
  source: 'email_sync' as const,
  direction,
  title: 'Re: Lunch lecture',
  body: '',
  timestamp,
})
const note = (timestamp: string) => ({ id: `n-${timestamp}`, type: 'note' as const, source: 'manual' as const, title: '', body: '', timestamp })
const withContact = (activities: Deal['activities']) =>
  deal({ contact: { id: 'p-lina', companyId: 'c-granit', name: 'Lina Dahl', email: 'lina.dahl@example.com', role: '' }, activities })

test('their email unanswered for 2 days: your turn', () => {
  expect(nudgeFor(withContact([email('received', '2026-10-12T12:00:00')]), now)).toBeNull()
  expect(nudgeFor(withContact([email('received', '2026-10-11T12:00:00')]), now)).toEqual({ kind: 'your-turn', days: 2, who: 'Lina' })
})

test('our email unanswered for 5 days: no reply, and no inactivity nudge before then', () => {
  expect(nudgeFor(withContact([email('sent', '2026-10-09T12:00:00')]), now)).toBeNull()
  expect(nudgeFor(withContact([email('sent', '2026-10-08T12:00:00')]), now)).toEqual({ kind: 'no-reply', days: 5, who: 'Lina' })
})

test('only the latest touchpoint counts: a reply, a note or a meeting after an email', () => {
  const sent = email('sent', '2026-10-01T12:00:00')
  expect(nudgeFor(withContact([sent, email('received', '2026-10-12T12:00:00')]), now)).toBeNull()
  // A note after their email: nobody owes a reply, so it's the 4-day inactivity rule from the note.
  expect(nudgeFor(withContact([email('received', '2026-10-01T12:00:00'), note('2026-10-12T12:00:00')]), now)).toBeNull()
  expect(nudgeFor(withContact([email('received', '2026-10-01T12:00:00'), note('2026-10-08T12:00:00')]), now)).toEqual({
    kind: 'inactive',
    days: 5,
  })
})

test('an overdue next step still comes first', () => {
  expect(nudgeFor({ ...withContact([email('received', '2026-10-01T12:00:00')]), nextStepDue: '2026-10-12' }, now)).toEqual({
    kind: 'overdue',
    days: 1,
  })
})

test('without a contact, the nudge says "they"', () => {
  expect(nudgeFor(deal({ contact: null, activities: [email('received', '2026-10-10T12:00:00')] }), now)).toEqual({
    kind: 'your-turn',
    days: 3,
    who: null,
  })
})

test('deals needing attention come first: nudges by how pressing, then the nearest next step, then the newest', () => {
  const at = (timestamp: string) => [{ id: 'a', type: 'note' as const, source: 'manual' as const, title: '', body: '', timestamp }]
  const email = (direction: 'sent' | 'received', timestamp: string) => [
    { id: 'e', type: 'email' as const, source: 'email_sync' as const, title: '', body: '', timestamp, direction },
  ]
  const deals = [
    deal({ id: 'none-old', createdAt: '2026-09-01T00:00:00Z' }),
    deal({ id: 'due-later', nextStepDue: '2026-10-30' }),
    deal({ id: 'quiet', activities: at('2026-10-01T12:00:00') }),
    deal({ id: 'none-new', createdAt: '2026-10-01T00:00:00Z' }),
    deal({ id: 'late-1', nextStepDue: '2026-10-12' }),
    deal({ id: 'turn', activities: email('received', '2026-10-10T12:00:00') }),
    deal({ id: 'due-soon', nextStepDue: '2026-10-15' }),
    deal({ id: 'late-5', nextStepDue: '2026-10-08' }),
    deal({ id: 'no-reply', activities: email('sent', '2026-10-06T12:00:00') }),
  ]

  expect(deals.sort(byAttention(now)).map((d) => d.id)).toEqual([
    'late-5',
    'late-1',
    'turn',
    'no-reply',
    'quiet',
    'due-soon',
    'due-later',
    'none-new',
    'none-old',
  ])
})

test('finished deals with something left come first, then the latest', () => {
  const finished = (patch: Partial<Deal>) =>
    deal({ status: 'finished', feeSEK: 10_000, invoiceStatus: 'paid', rating: 4, ...patch })
  const deals = [
    finished({ id: 'done-old', endDate: '2026-09-01' }),
    finished({ id: 'unrated', rating: null, endDate: '2026-08-01' }),
    finished({ id: 'done-new', startDate: '2026-10-01', endDate: null }),
    finished({ id: 'unpaid', invoiceStatus: 'waiting', endDate: '2026-07-01' }),
  ]

  expect(deals.map(needsWrapUp)).toEqual([false, true, false, true])
  expect(deals.sort(byAttention(now)).map((d) => d.id)).toEqual(['unrated', 'unpaid', 'done-new', 'done-old'])
  expect(needsWrapUp(finished({ feeSEK: 0, invoiceStatus: null }))).toBe(false) // free and rated
})

test('two nudges alike: the nearer next step first, not the newer deal', () => {
  const quiet = [{ id: 'a', type: 'note' as const, source: 'manual' as const, title: '', body: '', timestamp: '2026-10-01T12:00:00' }]
  const undatedNewer = deal({ id: 'undated', activities: quiet, createdAt: '2026-10-05T00:00:00Z' })
  const dueToday = deal({ id: 'due-today', activities: quiet, nextStepDue: '2026-10-13', createdAt: '2026-09-01T00:00:00Z' })

  expect([undatedNewer, dueToday].sort(byAttention(now)).map((d) => d.id)).toEqual(['due-today', 'undated'])
})

test('sorting open, finished and canceled deals together keeps each kind in its order', () => {
  const lead = (id: string, nextStepDue: string) => deal({ id, status: 'lead', nextStepDue })
  const unrated = deal({ id: 'finished', status: 'finished', rating: null, startDate: null, endDate: null })
  const canceled = deal({ id: 'canceled', status: 'canceled' })

  const sorted = [lead('late-3', '2026-10-10'), unrated, canceled, lead('late-5', '2026-10-08')].sort(byAttention(now))

  expect(sorted.map((d) => d.id)).toEqual(['late-5', 'late-3', 'finished', 'canceled'])
})
