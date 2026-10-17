-- A team member's title on the business team ("Partnerships Lead"), shown beside their name. It's only a
-- description: what they may do is their role (docs/adr/0003). They set it themselves, or an admin does.

-- +goose Up
ALTER TABLE members ADD COLUMN title text NOT NULL DEFAULT '' CHECK (char_length(title) <= 100);

-- +goose Down
ALTER TABLE members DROP COLUMN title;
