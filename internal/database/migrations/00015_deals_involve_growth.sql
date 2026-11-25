-- Business deals that involve the growth team make a card on its board (docs/adr/0013). A deal says whether
-- it involves growth: events and job posts do unless someone unticks it, partnerships only when ticked,
-- MoUs never. A card made from a deal points back at it, one card per deal, so the two boards join.

-- +goose Up
ALTER TABLE deals ADD COLUMN involves_growth boolean NOT NULL DEFAULT false;
ALTER TABLE deals ADD CONSTRAINT deals_mou_without_growth CHECK (NOT (deal_type = 'MoU' AND involves_growth));
-- Events and job posts still on their way to Agreement involve growth; deals past it already were handled
-- by email, so they make no cards now.
UPDATE deals SET involves_growth = true WHERE deal_type IN ('Event', 'Job Post') AND status IN ('lead', 'discussing');

ALTER TABLE growth_tasks ADD COLUMN source_deal_id uuid UNIQUE REFERENCES deals (id) ON DELETE SET NULL;

-- +goose Down
ALTER TABLE growth_tasks DROP COLUMN source_deal_id;
ALTER TABLE deals DROP CONSTRAINT deals_mou_without_growth;
ALTER TABLE deals DROP COLUMN involves_growth;
