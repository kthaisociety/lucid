# 0012. A Growth board, with weekly email reminders

Status: Accepted

## Context
The growth team wants to manage its work in Lucid: posts for events, partnerships and job posts, other
content (recaps, series) and one-off projects. Its members check email more than any board, so they want
a weekly reminder by email to keep their cards up to date. Their plan rolls out in steps: first the board
and the reminders, then cards made from the business team's deals and the calendar.

Until now Lucid was the business team's alone (ADR 0003), and it sends nothing: ADR 0009's notifications are
still proposed. KTHAIS has an Amazon SES account that can send from a kthais.com address.

## Decision
- **Members belong to a team**, business or growth (`members.team`, business by default). An admin sets it
  on the Team page. The team decides who gets growth reminders and which workspace someone starts in:
  roles (ADR 0003) still decide what someone may do, and every member can see and edit both boards.
- **Two workspaces, Business and Growth**, switched in the header. Business has the pipeline, companies,
  contacts and the deal log's report; Growth has the growth board and its report. My page and Team are in
  both, and Team shows the workspace's team first. Everyone starts in their team's workspace; a switch is
  kept per browser, and a link to a page only one workspace has (the board, from a reminder) opens it.
  Both work the same way: a semester picker, board and list views, and the same filter bar and search.
- **Growth tasks** are their own table, not deals: a title, a type (event post, partnership post, job
  post, content, project), a semester (as a deal has, so a task a deal makes takes the deal's), an assignee, a post date, channels, a status and notes. Statuses: Backlog →
  Draft → Quality check → Scheduled → Posted, or Canceled (the business board's spelling). A project
  needn't go through every status. Channels are LinkedIn and Instagram, which the team mostly uses, and
  Facebook, TikTok, Newsletter and Website, until the team asks to drop them.
- **A weekly email reminder** goes to every growth member on Monday from 10:00 Stockholm time: their open
  cards, with any overdue (past their post date) or without movement (same status for 7 days), and a link
  to the board. A member with no open cards is asked to add theirs.
- **Reports are each workspace's**, for the semester picked. The board (ADR 0003) sees Reports, and the
  workspace decides which: the deal log's, or the growth board's (open, overdue, without movement, posted,
  by status, channel and member). As before, this is the UI only: every member can read both boards.
- **Email goes through SES's SMTP interface** with Go's standard library, so no AWS SDK. `SMTP_HOST`,
  `SMTP_USERNAME`, `SMTP_PASSWORD` (a secret, in OpenBao like the others) and `MAIL_FROM` turn reminders
  on; without them they're off.
- **Replicas send once.** Each reminder is claimed per member and week in Postgres before it's sent; a
  failed send gives the claim back so the next try, 15 minutes later, sends it.
- **Staging** sends reminders only if it's given SMTP settings, and its members are testers (ADR 0007).

## Consequences
- The growth team can use Lucid at once, without waiting on ADR 0009. Its settings are the ones ADR 0009's
  email proposal names, so the business digest can send through the same `growth.SMTP` when it's built.
- Lucid holds one more secret, which can only send mail as `MAIL_FROM`.
- A reminder is late, not lost, when the server is down on Monday morning: it goes when it's back that week.

## Later (the plan's step 2)
- A business deal marked "involves growth" makes a Backlog card when it reaches Agreement: done in ADR 0013.
- Growth posts on the calendar, with a warning for two posts on one day, and suggested post dates for events.
- A weekly summary built from the week's status changes, which needs a history of them.
