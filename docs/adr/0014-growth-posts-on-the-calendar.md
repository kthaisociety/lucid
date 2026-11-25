# 0014. Growth posts on the calendar

Status: Accepted

## Context
The Calendar shows the deal log's dates: events, next steps due and invoices due. The growth team plans its
posts by date, and wants them on a calendar too: with channels, a warning when two posts fall on one day
(which they sort out themselves, never a block), and suggested post dates for events. Each team mostly
needs its own dates, but the growth team plans posts around the business team's events.

## Decision
- **One Calendar page, following the workspace (ADR 0012).** Business shows the deal log's dates, as before.
  Growth shows the growth board's tasks on their post date, with their channels; canceled ones and tasks
  without a post date stay off. Cards are made on the board, not on the calendar: clicking a post opens its
  card there.
- **"Both teams"** on the calendar shows the two together, rather than a third, combined page.
- **Two or more posts on one day are flagged** on that day ("2 posts"). Nothing stops them.
- **Suggested post dates for an event's card** (one made from an event deal, ADR 0013): an announcement
  three weeks before the event, a reminder one week before, a last call two days before, and a recap two
  days after it ends, those still ahead. One click sets the post date.

## Consequences
- The growth team sees its plan by date, and can see the events it's posting about with Both teams.
- Deals don't record when registration closes, so the reminder stands in for it; the suggestions move to it
  once deals have that date.
- The conflict warning counts posts on any channel: two posts on different channels on one day are flagged
  too, which the team may decide is fine.
