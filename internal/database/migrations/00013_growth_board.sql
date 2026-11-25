-- The growth team's board (docs/adr/0012): which team each member is on, the growth team's tasks, and the
-- weekly reminders already sent, so replicas send each one once.

-- +goose Up
ALTER TABLE members ADD COLUMN team text NOT NULL DEFAULT 'business' CHECK (team IN ('business', 'growth'));

CREATE TABLE growth_tasks (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title             text NOT NULL CHECK (title <> ''),
    task_type         text NOT NULL CHECK (task_type IN ('event_post', 'partnership_post', 'job_post', 'content', 'project')),
    assignee_id       uuid REFERENCES members (id),
    post_date         date,
    channels          jsonb NOT NULL DEFAULT '[]',
    status            text NOT NULL DEFAULT 'backlog' CHECK (status IN (
                          'backlog', 'draft', 'quality_check', 'scheduled', 'posted', 'canceled')),
    notes             text NOT NULL DEFAULT '',
    -- When the status last changed: a card whose status stays put for a week has no movement.
    status_changed_at timestamptz NOT NULL DEFAULT now(),
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX growth_tasks_assignee_idx ON growth_tasks (assignee_id);

CREATE TABLE growth_reminders (
    week      date NOT NULL, -- the Monday of the week it's for
    member_id uuid NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    sent_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (week, member_id)
);

-- +goose Down
DROP TABLE growth_reminders;
DROP TABLE growth_tasks;
ALTER TABLE members DROP COLUMN team;
