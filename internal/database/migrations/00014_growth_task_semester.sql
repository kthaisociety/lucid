-- A growth task belongs to a semester, as a deal does (docs/adr/0012): the header's semester picker shows
-- one at a time on both boards, and a task a deal makes will take the deal's. Tasks already there take the
-- semester they were made in.

-- +goose Up
ALTER TABLE growth_tasks ADD COLUMN semester text CHECK (semester ~ '^(HT|VT) [0-9]{4}$');
UPDATE growth_tasks
SET semester = CASE WHEN extract(month FROM created_at) >= 7 THEN 'HT ' ELSE 'VT ' END || extract(year FROM created_at)::int;
ALTER TABLE growth_tasks ALTER COLUMN semester SET NOT NULL;
CREATE INDEX growth_tasks_semester_idx ON growth_tasks (semester);

-- +goose Down
ALTER TABLE growth_tasks DROP COLUMN semester;
