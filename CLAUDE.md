# CLAUDE.md

Lucid: the KTHAIS business team's CRM: the deal log as a board and a list. Sign-in is OIDC (Google
until identity-service is live, ADR 0004), or the dev user for local work (PCR 0007). One repo, one image: a Go server (Gin, GORM, Postgres) serves
the API under `/api` and an embedded Vite + React frontend everywhere else.

## Commands

- Local Postgres: `docker compose up -d`
- Config: `cp .env.example .env`
- Made-up data for local dev: `go run ./cmd/seed` (once, on an empty database; makes the dev user an admin);
  on staging `./lucid-seed` in the image. Staging holds made-up data only (ADR 0007)
- A new environment's first admin: `./lucid appoint-admin EMAIL` in the image (in `/app`), once (ADR 0005)
- Backend: `go run ./cmd/server` (on `127.0.0.1:8002`)
- Frontend dev: `cd frontend && npm install && npm run dev` (Vite on 5174, proxies `/api` to 8002)
- All checks: `make test` (needs `docker compose up -d`, and `npm install` in `frontend/` once)
- Image: `docker build -t lucid .`

## Layout

- `cmd/server`: wiring and startup; `cmd/seed`: made-up deals for local dev
- `internal/config`: env, validated at boot
- `internal/auth`: who is signed in: OIDC sign-in and sessions (ADR 0004), or the dev user (PCR 0007);
  `auth/authtest` is a fake OIDC provider for tests
- `internal/deals`: the deal log: GORM models, validation and queries; `Record` puts synced emails and meetings on deals
- `internal/fathom`: members' connected Fathom accounts, their webhooks, signature and payload (ADR 0008);
  `fathom/fathomtest` is a fake Fathom for tests
- `internal/gmail`: members' connected Gmail mailboxes (ADR 0006); `internal/secretbox` seals their tokens
- `internal/handlers`: `/api` routes, and the frontend for every other path
- `internal/database`: Postgres connection and migrations (`migrations/*.sql`, applied at startup)
- `frontend/`: the frontend (Vite, React, TypeScript, Tailwind); `frontend/embed.go` embeds `frontend/dist`

## Rules

- Read `CONTEXT.md` for vocabulary, `docs/adr/` for decisions and `docs/pcr/` for conventions before
  changing a part they cover. Record a new decision as a new ADR or PCR, never by editing an accepted one.
- Handlers get the user from `auth.Current` (ADR 0004, PCR 0007). Seed and test data are made up
  (`@example.com`); real personal data only where sign-in is real.
- No `VITE_*` or other build-time config: the frontend calls `/api` on its own origin (PCR 0001).
- Use npm in `frontend/`; don't add another lockfile.
- Schema changes are new SQL files in `internal/database/migrations/`, never `AutoMigrate` (PCR 0006).
- PR titles and commits are Conventional Commits (`feat:`, `fix:`, `docs:`, …): they drive releases.
