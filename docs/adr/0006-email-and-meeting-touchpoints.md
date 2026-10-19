# 0006. Emails and meetings become touchpoints on their own

Status: Accepted; "there's no staging" superseded by 0007; "Fathom: the team's workspace" superseded by 0008

## Context
A deal's timeline and its follow-up nudge (no touchpoint for 4 days) only know what members type in as
quick notes. The real conversation with a company happens in each member's own @kthais.com Gmail and in
meetings recorded by Fathom. When a member forgets a note, the nudge is wrong; when the team changes each
year, the history stays in someone's inbox. `activities` already has `type` (`email`, `meeting`),
`source` (`email_sync`, `fathom`) and `external_id` for this.

A forwarding or BCC address was ruled out: it only catches mail a member remembers to copy, and never the
company's replies.

## Decision

### Gmail: every member connects their own mailbox
- Every member is expected to connect, but Google lets only each person grant access to their own
  mailbox (short of domain-wide delegation, which would open every kthais.com mailbox to the app, and is
  ruled out). So after signing in, a member who hasn't connected sees a **Connect Gmail** bar until they
  do, and admins see on the Team page who has. **Disconnect** revokes the grant and deletes the stored
  token at once.
- Connecting is a second, separate Google consent from the same Internal OAuth client (ADR 0004), for
  `gmail.readonly` with offline access. Signing in never asks for Gmail. Because the client is Internal,
  Google doesn't review the app for this scope.
- That client stays for Gmail when sign-in moves to identity-service: only its sign-in callback comes
  off. This replaces ADR 0004's "the client is deleted", and keeps the departure from identity-service's
  ADR 0002 for Gmail alone. If identity-service ever offers Gmail access itself, members reconnect
  through it once, and this client goes then.
- The refresh token is stored encrypted, with a key from config (`TOKEN_ENCRYPTION_KEY`, a secret, PCR
  0001), in a table of its own with the mailbox's Gmail `historyId`.
- The server syncs each connected mailbox every few minutes in the background, asking Gmail only for
  what changed since its `historyId`. Replicas take mailboxes with `FOR UPDATE SKIP LOCKED`, so none is
  synced twice at once. No queue: Postgres is enough at this size.
- A message becomes a touchpoint only if its From, To or Cc has a **contact's email**. Anything else is
  dropped in memory and never stored. A matching message is stored as: date, direction (sent or
  received), subject, Gmail's snippet (its first line or two), which contact, and which member's
  mailbox. The body itself is never stored.
- Later, and only once the team agrees to it: a short summary and key notes of each matching email,
  written by an AI model (Claude) from the body. The body goes to the model's API to be summarized and
  isn't kept; only the summary is stored. This sends companies' emails to an outside processor, so it
  needs its own go-ahead and an API key (a secret).
- A matched message lands on every **open** deal of the contact's company; with none open, on the
  company's latest deal. Its `external_id` is the RFC `Message-ID`, so the same email seen in two members'
  mailboxes is one touchpoint. That makes `UNIQUE (source, external_id)` per deal instead: a new
  migration.
- Replies are caught the same way: a contact's reply is a received email in a connected member's
  mailbox. Only mail with no contact on it, or that reaches only members who haven't connected, is
  missed.

### Fathom: the team's workspace
- The team uses one Fathom workspace, each member in it with their kthais.com email. One webhook,
  added by one member and triggered for their own and **shared team recordings**, gets every meeting
  shared with the team. Fathom posts a meeting once its notes are ready to `POST
  /api/integrations/fathom`. The route is outside sign-in and checks Fathom's signature (Standard
  Webhooks: HMAC-SHA256 of id, timestamp and body, within 5 minutes) with the webhook's secret,
  `FATHOM_WEBHOOK_SECRET`. An unsigned, wrongly signed or stale call gets 401.
- Invitees' emails are matched to contacts the same way. A matching meeting becomes a `meeting`
  touchpoint with its title, Fathom's summary and action items as bullet points, and a link to the
  recording. `external_id` is Fathom's meeting id. A meeting with no contact is dropped.

### Order
Fathom first: it needs no Google scope and no background sync, and it tests the matching and timeline
display on real data. Gmail second.

### Follow-up nudges know whose turn it is
With emails, the nudge on an open deal knows who wrote last, so it says who owes a reply. An open deal
gets at most one nudge, the first that applies:
1. **An overdue next step**, as today.
2. **Their email is the latest touchpoint**, with no reply for 2 days: *"Lina replied 2 days ago: your
   turn"*.
3. **Our email is the latest touchpoint**, with no reply for 5 days: *"No reply from Lina for 5 days:
   follow up?"*. Until then there's no nudge: the 4-day inactivity nudge doesn't apply while we're waiting
   on their reply.
4. **Otherwise** (the latest touchpoint is a note or a meeting, or there's none), the inactivity nudge
   after 4 days, as today. A note or a meeting is a touchpoint from both sides: nobody owes a reply
   after it.

The 2, 4 and 5 days are a starting point, to tune once the team has used it.

### Trying it before it's live
There's no staging: this is built and tried locally, then goes live. Locally, contacts and mail are the
developers' own (personal addresses, and test emails between them) and meetings are test meetings, so a
laptop never holds companies' real email (PCR 0007).

## Consequences
- The timeline and nudges follow real conversations without anyone typing notes, once members connect.
- The CRM holds who each contact emailed with and when, and meeting summaries: real personal data about
  people outside KTHAIS, so only where sign-in is real (PCR 0007), and kept for as long as the deal is.
- A member who leaves the team, or disconnects, stops syncing; the touchpoints already synced stay, since
  they're the team's record of the deal.
- Email from someone at a company who isn't a contact yet is missed. Suggesting them as a contact, by
  their domain, is possible later.
- Each connected mailbox costs a few Gmail API calls every few minutes, well within Google's free quota.

## Still open
- Whether to add AI summaries and key notes after the snippet (above): the team's call.
