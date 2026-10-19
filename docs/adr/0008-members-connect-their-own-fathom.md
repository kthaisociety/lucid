# 0008. Members connect their own Fathom

Status: Accepted

## Context
ADR 0006 brings Fathom meetings in through one webhook, added by one member of the team's Fathom workspace
and triggered for shared team recordings. Fathom has no organisation-level keys or webhooks: every webhook
belongs to the user who made it, and stops when that user is deactivated. So the team's meetings would
depend on one person's account, and only meetings someone remembered to share with the team would come
in. Platform's goal is not to depend on personal accounts and tokens.

Fathom offers OAuth for apps that its users connect their own accounts to (developers.fathom.ai/oauth):
standard OAuth 2.0 with one scope, `public_api`. Its SDKs are TypeScript and Python only, but the SDK
only wraps HTTP calls the docs describe, the same kind the Go server already makes for Gmail.

## Decision
- **Connect Fathom, per member**, as with Gmail (ADR 0006): a member clicks Connect Fathom on My page,
  approves Lucid on Fathom's consent screen, and comes back connected. Disconnect stops it. Members who
  don't record meetings needn't connect: there's no bar asking everyone, unlike Gmail.
- **Fathom's OAuth app** is registered on Fathom by Platform, not by a member, with each environment's
  `/auth/fathom/callback` as a redirect URL. Fathom allows several redirect URLs only for development, so
  staging and live may need separate apps. Its client ID and secret are config (`FATHOM_CLIENT_ID`,
  `FATHOM_CLIENT_SECRET`, secrets: PCR 0001). Connect Fathom needs real sign-in and
  `TOKEN_ENCRYPTION_KEY`, like Connect Gmail.
- **The flow** is the authorization code flow, with `state` in the same signed, short-lived cookie as
  sign-in's (ADR 0004), along with the member who started it: if the browser has signed in as someone
  else by the time Fathom sends it back, nothing is exchanged or connected. The authorize URL isn't in Fathom's docs; it's the one their SDK uses,
  `https://fathom.video/external/v1/oauth2/authorize`. The token URL is the docs',
  `https://api.fathom.ai/external/v1/oauth2/token`.
- **One webhook per member.** On connect, Lucid creates a webhook through Fathom's API with the member's
  token, triggered for their own recordings (`my_recordings` and `my_shared_with_team_recordings`), with
  the summary and action items. Fathom's payloads don't say whose webhook they came from, so each
  connection gets its own URL, `/api/integrations/fathom/<hook>`, where `<hook>` is random. The webhook's
  signing secret is stored sealed, and each delivery is checked against its connection's secret as
  before: Standard Webhooks, within 5 minutes, 401 otherwise. Matching to contacts and deals is
  unchanged (ADR 0006).
- **Tokens.** The refresh token is stored sealed with `TOKEN_ENCRYPTION_KEY`. Fathom's refresh tokens
  can be used once and rotate on each refresh. Lucid only needs one to delete the webhook on disconnect,
  after it has already forgotten the token, so it never has to store a rotated one.
- **Disconnect** forgets the connection first, then refreshes the token once and deletes the webhook at
  Fathom. If Fathom can't be reached, the connection is gone from Lucid anyway, and deliveries to its URL
  get 404. Connecting again replaces the connection and deletes the old webhook the same way.
- **Connects take turns per member**, locking the member's row, so two at once can't both miss the
  other's connection and leave a webhook behind.
- **Removing a member** deletes their connection with them, as with Gmail; their webhook at Fathom is
  left behind, and its deliveries get 404.
- **The team's webhook goes.** `POST /api/integrations/fathom` and `FATHOM_WEBHOOK_SECRET` are removed:
  there's one way in.
- This replaces ADR 0006's "Fathom: the team's workspace". The rest of ADR 0006 stands.

## Consequences
- Nobody's departure stops the others' meetings. Each member's own meetings come in whether or not they
  shared them with the team. A meeting recorded by someone who hasn't connected is missed, unless a
  connected member recorded it too.
- A meeting recorded by two connected members is one touchpoint: the recording id is the key, as before.
- Lucid holds a refresh token for each connected member's Fathom, sealed, usable once.
- Working on Fathom locally needs an https URL Fathom can redirect to and post webhooks to, such as an
  ngrok domain, registered with the OAuth app as a development redirect URL. Real sign-in must be on
  then: never `DEV_USER_EMAIL`, which would let anyone reaching the tunnel in as an admin.

## Still open
- Fathom's FAQ says OAuth apps can't get summaries from `/meetings`, and must use `/recordings`. Whether
  their webhooks carry the summary and action items isn't documented. If the first real delivery comes
  without them, Lucid fetches the summary from `/recordings/{id}/summary` with the member's token, which
  then means storing each rotated refresh token.
- The SDK sends tokens to `fathom.video/external/v1/oauth2/token`, the docs to `api.fathom.ai`; both are
  settable, and the first real connect confirms which works.
- Whether Fathom's review is needed before members other than the app's owner can connect.
