-- Members' connected Fathom accounts (docs/adr/0008). Each has its own webhook at Fathom, posting to
-- /api/integrations/fathom/<hook>, since Fathom's payloads don't say whose webhook sent them. The refresh
-- token and the webhook's signing secret are sealed with TOKEN_ENCRYPTION_KEY. Removing a member removes
-- it.

-- +goose Up
CREATE TABLE fathom_connections (
    member_id      uuid PRIMARY KEY REFERENCES members (id) ON DELETE CASCADE,
    refresh_token  bytea NOT NULL,
    hook           text NOT NULL UNIQUE CHECK (hook <> ''),
    webhook_id     text NOT NULL,
    webhook_secret bytea NOT NULL,
    connected_at   timestamptz NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE fathom_connections;
