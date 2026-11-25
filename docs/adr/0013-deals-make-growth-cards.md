# 0013. Business deals make cards on the growth board

Status: Accepted

## Context
The growth team posts about the business team's events, job posts and some partnerships (ADR 0012). Until
now the business team told them by email, which got lost. The growth team's plan: a checkbox on the deal,
"Involves Growth", and a card in their Backlog when a ticked deal reaches Agreement, carrying the deal's id
so analytics can join the two boards. Events and job posts always need a post, partnerships only some, and
MoUs never.

## Decision
- **Deals have `involves_growth`.** A new event or job post starts ticked, a partnership unticked, and an
  MoU can't be ticked (a CHECK; a deal made an MoU is unticked). Anyone can tick or untick it in the deal's
  panel. Which partnerships need a post is left to whoever ticks it, rather than a list of partnership types.
- **The card is made in the same transaction as the deal's change** that makes it qualify: it reaches
  Agreement, Signed or Finished while ticked (a deal can skip Agreement), or it's ticked at one of them.
  The card goes in the Backlog, unassigned, in the deal's semester, titled after the company and the event
  type (or deal type), with the matching task type.
- **One card per deal.** `growth_tasks.source_deal_id` is unique. A deal moving on (Agreement → Signed)
  doesn't make another, nor one the growth team deleted. Deleting the deal keeps the card, unlinked.
- **Agreement, as the plan's trigger section says.** Its goal mentions Signed; changing to Signed is one
  line (`involvesGrowthNow`) if the business team decides so.
- **Each side links to the other:** the deal's panel shows the card's status on the growth board, and the
  card opens the deal.

## Consequences
- Nothing goes by email between the teams for these posts, and the growth team sees them in its Backlog.
- Existing events and job posts still in Lead or Discussing were ticked by the migration; deals already past
  Agreement made no cards, since the teams handled them by email.
- A card made while the deal still says "TBA" for its event type is titled "Event"; the growth team renames
  it if needed. Nothing changes the card when the deal changes later.
