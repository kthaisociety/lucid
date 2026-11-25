# 0015. A weekly summary of the growth board, from its status changes

Status: Accepted

## Context
The growth team updates its cards once a week, after Monday's reminder (ADR 0012), and wants a summary of
the week built from those updates rather than written by hand: what moved, what reached a milestone, and
what didn't move. The board only knew each card's current status and when it last changed.

## Decision
- **Status changes are recorded** in `growth_task_events`: a card made (from no status), or moved from one
  status to another, and when. Made on the board, by a deal (ADR 0013) or moved: every path records it, in
  the same transaction as the change. Cards already on the board were recorded as made when they last moved.
- **A summary by email on Friday from 15:00 Stockholm time** to every growth member, the same for all,
  covering the last 7 days. Per card it takes the week's first and last status, so a card moved twice shows
  where it ended, and one moved and back isn't listed:
  - **Reached a milestone**: ended in Scheduled or Posted.
  - **Moved**: any other change.
  - **New cards**: made this week, marking those from a business deal.
  - **Needs attention**: open cards that are overdue or haven't moved for 7 days, with who has them.
- **Sent like the reminder**: claimed per member, week and kind (`growth_reminders.kind`), so replicas send
  it once; a failed send is tried again 15 minutes later. A server down all of Friday to Sunday skips it.
- **SES through its SMTP interface, with the IAM user's access key** Platform gave Lucid (`AWS_ACCESS_KEY_ID`,
  `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `SES_SENDER`, `SES_REPLY_TO`). The SMTP password is derived from the
  secret key as AWS documents, so there's still no AWS SDK. This replaces ADR 0012's `SMTP_*` settings, which
  were never deployed.

## Consequences
- The growth team gets Monday's nudge and Friday's picture without anyone writing either.
- The history also allows a report of the semester's flow later (time in each status), not built now.
- The IAM user should only be allowed `ses:SendRawEmail`: its key is otherwise as powerful as its policy.
