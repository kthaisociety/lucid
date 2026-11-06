# 0010. A deal entered by mistake is deleted, not canceled

Status: Accepted

## Context
A deal could only be moved to Canceled. Members cleaned up leads they had entered by mistake (a
duplicate, the wrong company) that way, so Canceled came to mean both "the company said no" and "this
never was a deal". That lowers the win rate and fills the Canceled columns on Reports.

## Decision
- A deal can be deleted: `DELETE /api/deals/:id`, from **Delete** at the bottom of its drawer, after
  asking again.
- Only the deal's **owner** or an **admin** may delete it; anyone else gets 403, and doesn't see the
  button. A deal with no owner is an admin's to delete.
- Deleting removes the deal with its timeline (notes, synced emails and meetings) and support. Nothing
  is kept: a mistake has no history worth keeping.
- **Canceled** stays for deals that really ended without agreement, and counts in Reports as before.

## Consequences
- Reports count only real deals once the mistakes are deleted.
- A real deal deleted by mistake can't be brought back. Its synced emails don't come back with the next
  sync either, only by reconnecting Gmail, if they're within the backfill (ADR 0006).
