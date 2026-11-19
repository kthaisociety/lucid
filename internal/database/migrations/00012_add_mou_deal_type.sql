-- MoU: a memorandum of understanding Research/Dev reach with a company, which the business team joins. It
-- moves through the same pipeline as any other deal.

-- +goose Up
ALTER TABLE deals DROP CONSTRAINT deals_deal_type_check;
ALTER TABLE deals ADD CONSTRAINT deals_deal_type_check CHECK (deal_type IN ('Event', 'Partnership', 'Job Post', 'MoU'));

-- +goose Down
ALTER TABLE deals DROP CONSTRAINT deals_deal_type_check;
ALTER TABLE deals ADD CONSTRAINT deals_deal_type_check CHECK (deal_type IN ('Event', 'Partnership', 'Job Post'));
