import { expect, test } from 'vitest'
import { fixtureCompanies, fixtureContacts, fixtureDeals, lastSemester, thisSemester } from '../test/fixtures'
import type { Deal } from './deals'
import { companiesFrom, contactsFrom, myStatsFor, reportFor } from './views'

test('a company gathers its deals from every semester, newest first, and its contacts', () => {
  const granit = companiesFrom(fixtureCompanies, fixtureContacts, fixtureDeals).find((r) => r.company.name === 'Granit Consulting')!

  expect(granit.deals.map((d) => d.semester)).toEqual([thisSemester, lastSemester])
  expect(granit.confirmedSEK).toBe(55_000)
  expect(granit.open).toBe(1)
  expect(granit.owners.map((p) => p.name)).toEqual(['Maja Holm'])
  expect(granit.contacts.map((c) => c.name)).toEqual(['Lina Dahl'])
})

test('a company without deals is still listed', () => {
  const rows = companiesFrom([...fixtureCompanies, { id: 'c-new', name: 'Aurora AB', website: '', notes: '' }], fixtureContacts, fixtureDeals)

  expect(rows.find((r) => r.company.name === 'Aurora AB')).toMatchObject({ company: { name: 'Aurora AB' }, deals: [], open: 0, lastTouchpoint: null })
})

test('contacts list their company and deals', () => {
  const lina = contactsFrom(fixtureContacts, fixtureCompanies, fixtureDeals).find((r) => r.contact.email === 'lina.dahl@example.com')!

  expect(lina.company).toBe('Granit Consulting')
  expect(lina.contact.role).toBe('Recruitment Manager')
  expect(lina.deals.map((d) => d.company)).toEqual(['Granit Consulting'])
})

test('a semester report adds up fees, wins and follow-ups', () => {
  const report = reportFor(thisSemester, fixtureDeals)

  expect(report).toMatchObject({
    deals: 11,
    won: 2,
    canceled: 1,
    confirmedSEK: 40_000,
    paidSEK: 0,
    unpaidSEK: 40_000,
    pipelineSEK: 60_000,
  })
  expect(report.winRate).toBeCloseTo(2 / 3)
  expect(report.needsFollowUp.map((d) => d.company).sort()).toEqual(['Kvarnholmen AI', 'Lumen Health', 'Stadsnät Labs'])
  expect(report.byStatus.find((b) => b.label === 'Lead')?.value).toBe(3)
})

test('a semester with nothing decided has no win rate', () => {
  expect(reportFor('VT 2000', fixtureDeals).winRate).toBeNull()
})

test('within a semester, the most recently added deal comes first', () => {
  const older = { ...fixtureDeals[0], id: 'older', createdAt: '2026-09-01T00:00:00Z' }
  const newer = { ...older, id: 'newer', createdAt: '2026-10-01T00:00:00Z' }
  const company = fixtureCompanies.find((c) => c.id === older.companyId)!

  expect(companiesFrom([company], [], [older, newer])[0].deals.map((d) => d.id)).toEqual(['newer', 'older'])
})

test('reports count teammates who share a name separately', () => {
  const kim1 = { id: 'm-kim1', name: 'Kim Ek', email: 'kim1@example.com' }
  const kim2 = { id: 'm-kim2', name: 'Kim Ek', email: 'kim2@example.com' }
  const deals = [
    { ...fixtureDeals[0], id: 'a', owner: kim1 },
    { ...fixtureDeals[0], id: 'b', owner: kim1 },
    { ...fixtureDeals[0], id: 'c', owner: kim2 },
  ]

  expect(reportFor(fixtureDeals[0].semester, deals).byOwner).toEqual([
    { label: 'Kim Ek (kim1@example.com)', value: 2 },
    { label: 'Kim Ek (kim2@example.com)', value: 1 },
  ])
})

test('a member’s stats count the deals they own, and list the ones they support', () => {
  const maja = myStatsFor('m-maja', thisSemester, fixtureDeals)

  expect(maja.report).toMatchObject({ deals: 2, open: 2, won: 1, confirmedSEK: 40_000 })
  expect(maja.supporting.map((d) => d.company)).toEqual(['Lumen Health'])
  expect(maja.history.map((r) => [r.semester, r.confirmedSEK])).toEqual([
    [thisSemester, 40_000],
    [lastSemester, 15_000],
  ])
  expect(myStatsFor('m-nobody', thisSemester, fixtureDeals)).toMatchObject({ report: { deals: 0 }, supporting: [], waiting: [], history: [] })
})

test('what waits on a member comes most pressing first: overdue, their turn, no reply, then quiet', () => {
  const now = Date.parse('2026-10-20T12:00:00Z')
  const daysAgo = (n: number) => new Date(now - n * 86_400_000).toISOString()
  const base = { ...fixtureDeals[0], owner: { id: 'm-me', name: 'Me', email: 'me@example.com' }, semester: thisSemester, status: 'discussing' as const, nextStepDue: null }
  const email = (direction: 'sent' | 'received', at: string) => [{ id: 'e', type: 'email' as const, source: 'email_sync' as const, title: 'Re: hi', body: '', timestamp: at, direction }]
  const deals: Deal[] = [
    { ...base, id: 'quiet', company: 'Quiet', activities: [{ ...email('sent', daysAgo(10))[0], type: 'note', direction: undefined }] },
    { ...base, id: 'late1', company: 'Late by 1', nextStepDue: '2026-10-19', activities: [] },
    { ...base, id: 'turn', company: 'Their email', activities: email('received', daysAgo(3)) },
    { ...base, id: 'noreply', company: 'Our email', activities: email('sent', daysAgo(6)) },
    { ...base, id: 'late5', company: 'Late by 5', nextStepDue: '2026-10-15', activities: [] },
  ]

  expect(myStatsFor('m-me', thisSemester, deals, now).waiting.map((d) => d.id)).toEqual(['late5', 'late1', 'turn', 'noreply', 'quiet'])
})
