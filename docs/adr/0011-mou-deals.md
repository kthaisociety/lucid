# 0011. An MoU is a deal type

Status: Accepted

## Context
When Research/Dev reach an understanding with a company, KTHAIS signs a memorandum of understanding
(MoU) to make it official. The business team should be part of that process, so these MoUs belong in
Lucid next to the business team's own deals. The team also wants to see MoUs on their own, and its own
deals without them.

## Decision
- **MoU** is a fourth deal type, next to Event, Partnership and Job Post. It goes through the same
  pipeline (Lead → Discussing → Agreement → Signed → Finished, or Canceled) and has the same fields.
- The board's filters have an **MoU** button, like the other types, and a **Business only** button
  that shows every deal except MoUs.
- Reports counts MoU fees under their own type in "confirmed by type".

## Consequences
- An MoU has fields that may not fit it (event type, audience, fee, invoice). They stay empty until
  MoUs need fields of their own.
- "Business only" means "not an MoU". A new deal type counts as business unless that filter is changed.
