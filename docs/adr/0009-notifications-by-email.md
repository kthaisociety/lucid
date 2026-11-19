# 0009. Notifications by email, through Amazon SES

Status: Proposed: waiting on the sending address and SES's setup (domain, sandbox, who owns the account)

## Context
Follow-up nudges (ADR 0006) and My page's "Waiting on you" show what needs doing, but only to someone who
opens Lucid.

This ADR first proposed a Mattermost bot (`https://chat.aisociety.se`), since the team lives there. That
waits on Platform: a bot account and its token, and whether a plain bot may look users up by email. Email
was set aside then because it needed a sending account. KTHAIS now has Amazon SES, so email can go out
without waiting on anyone. Every member already has a kthais.com address, the one they sign in with
(ADR 0004).

Email is easier to ignore than a chat message. A short digest, sent only when something waits, keeps it
worth reading. An in-app bell would only reach people who already open Lucid.

## Decision
- **A morning digest by email**, on weekdays, to each member with open deals waiting on them: what My
  page lists under "Waiting on you", in the same order (overdue, your turn, no reply, inactive), with a
  link to each deal. A member with nothing waiting gets nothing. Messages name companies and contacts,
  never quote emails.
- **It goes to the member's email in Lucid**, their kthais.com address. No matching to another account.
- **Through SES's SMTP interface**, with Go's `net/smtp`: no AWS SDK. The settings are `SMTP_HOST`,
  `SMTP_USERNAME` and `MAIL_FROM`; `SMTP_PASSWORD` is a secret, kept like the others (OpenBao,
  `lucid/<environment>`). Without all of them, notifications are off.
- **Each member can turn the digest off** on My page. It's on by default.
- **Replicas send once.** Each digest is claimed per member and day in Postgres before it's sent, so two
  replicas, or a restart, don't send it twice.
- **Staging** sends only to testers' addresses, or nothing (ADR 0007): its deals are made up.

## Consequences
- Members see what's waiting on them without opening Lucid; the nudges become something they act on.
- Lucid holds one more secret, which can send mail as `MAIL_FROM` and nothing else.
- A member who leaves the team stops getting digests at once, since only members get them.
- SES failing delays a digest; it isn't queued for the next day.
- The settings name SMTP, not SES: another relay would work without code changes.
- A Mattermost bot can still come later as a second channel, in a new ADR.

## Still open
- The sending address (e.g. `lucid@kthais.com`). Its domain must be verified in SES, with DKIM, or the
  mail lands in spam.
- Whether the SES account is out of the sandbox; in it, SES only sends to verified addresses.
- Whose SES account it is. If it's shared across KTHAIS, Platform should know Lucid sends through it.
- SES's SMTP credentials are not the IAM access key: they're made for SMTP in the SES console (or
  derived from an IAM key).
- The team's call: the digest's time, and whether it also goes on days with only inactive deals.
