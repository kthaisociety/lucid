# 0009. Notifications through a Mattermost bot

Status: Proposed: waiting on Platform (the bot and its token) and the team (timing, channel posts)

## Context
Follow-up nudges (ADR 0006) and My page's "Waiting on you" show what needs doing, but only to someone who
opens Lucid. The team lives in Mattermost (`https://chat.aisociety.se`), where every member has an account
made from their kthais.com address by onboarding-service. Two Mattermost bots exist in KTHAIS repos, and
neither fits:
- onboarding-service's bot creates and deactivates accounts: its token is admin-level, too much for posting
  messages.
- `mattermost-ai-agent` is a chat agent people @mention, not something that posts on its own schedule.

Email would need a sending account or an SMTP relay, and is easier to ignore. An in-app bell only reaches
people who already open Lucid.

## Decision
- **Lucid gets its own Mattermost bot**, a plain bot account, not an admin. Its token is a secret,
  `MATTERMOST_BOT_TOKEN`, kept like onboarding-service's (OpenBao, `lucid/<environment>`). `MATTERMOST_URL`
  is a setting. Without both, notifications are off.
- **The bot only posts.** It reads no messages, and Lucid never acts on anything written in Mattermost.
- **A morning digest by direct message**, on weekdays, to each member with open deals waiting on them:
  what My page lists under "Waiting on you", in the same order (overdue, your turn, no reply, inactive),
  with a link to each deal. A member with nothing waiting gets nothing. Messages name companies and
  contacts, never quote emails.
- **Members match by their kthais.com email** to their Mattermost user, and a member with no match is
  skipped and logged.
- **Each member can turn the digest off** on My page. It's on by default.
- **Replicas send once.** Each digest is claimed per member and day in Postgres before it's sent, so two
  replicas, or a restart, don't send it twice.
- **Staging** gets a test bot that only messages testers, or none (ADR 0007).

## Consequences
- Members see what's waiting on them without opening Lucid; the nudges become something they act on.
- Lucid holds one more secret, with no more power than posting as its bot.
- A member who leaves the team stops getting digests at once, since only members get them.
- Mattermost going down delays a digest; it isn't queued for the next day.

## Still open
- Who creates the bot and stores its token (Platform), and which permissions bots get there.
- Whether a plain bot can look users up by email, or Mattermost hides addresses from non-admins ("Show
  Email Address"). If it does, members enter their Mattermost username on My page instead.
- The team's call: the digest's time, and whether it also goes on days with only inactive deals.
- Posts in the business team's channel for events such as a deal signed, and whether Platform is fine
  with bots in team channels.
