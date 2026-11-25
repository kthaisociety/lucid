-- The growth board's status changes (docs/adr/0015), which the weekly summary is built from: a task made
-- (from NULL) or moved, and when. And the weekly emails sent, now two kinds: the reminder and the summary.

-- +goose Up
CREATE TABLE growth_task_events (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id     uuid NOT NULL REFERENCES growth_tasks (id) ON DELETE CASCADE,
    from_status text, -- NULL: the task was made
    to_status   text NOT NULL,
    at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX growth_task_events_at_idx ON growth_task_events (at);

-- Tasks already on the board count as made when they last changed status.
INSERT INTO growth_task_events (task_id, to_status, at) SELECT id, status, status_changed_at FROM growth_tasks;

ALTER TABLE growth_reminders ADD COLUMN kind text NOT NULL DEFAULT 'reminder' CHECK (kind IN ('reminder', 'summary'));
ALTER TABLE growth_reminders DROP CONSTRAINT growth_reminders_pkey;
ALTER TABLE growth_reminders ADD PRIMARY KEY (week, member_id, kind);

-- +goose Down
DELETE FROM growth_reminders WHERE kind = 'summary';
ALTER TABLE growth_reminders DROP CONSTRAINT growth_reminders_pkey;
ALTER TABLE growth_reminders ADD PRIMARY KEY (week, member_id);
ALTER TABLE growth_reminders DROP COLUMN kind;
DROP TABLE growth_task_events;
