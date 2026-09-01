# uptime-monitor

A multi-tenant SaaS uptime monitor (UptimeRobot-like). See `ISA.md` for the full ideal-state
spec — 135 criteria across auth, monitor CRUD, a 5-type check engine, scheduling, incident
alerting, status pages, and security/tenant-isolation guarantees.

## What's built so far (this session's vertical slice)

- Full Postgres schema (Drizzle, `pg-core`) for accounts, sessions, password resets, API tokens,
  monitors, checks, incidents — designed against the *entire* 135-ISC spec up front so later
  sessions add logic, not migrations.
- Auth: signup / login / logout / password-reset request+confirm, bcrypt hashing, httpOnly+Secure
  session cookies.
- Monitor CRUD API, tenant-scoped through a single `scopedToAccount()` helper (`src/lib/tenant.ts`)
  — no ad-hoc `where accountId = ...` at call sites.
- HTTP check engine (`src/lib/checks/`) — request, classify, 28 passing unit tests against a local
  test server (no live network dependency).

**Not built yet** (next session, per `ISA.md` `## Features`): Scheduler (Vercel Cron wiring +
the due-monitor row lock), IncidentsAndAlerting, StatusPages, DashboardUI, PublicApiAndTokens,
SecurityHardening pass, live Vercel deploy.

## Local dev

```bash
cp .env.example .env
# Fill in DATABASE_URL with a real Postgres instance — Neon or Supabase free tier both work.
# SQLite is deliberately not supported; see ISA.md Decisions for why.

bun install
bun run db:push     # applies the Drizzle schema to your database
bun run dev          # http://localhost:3000
```

```bash
bun run typecheck    # tsc --noEmit
bun test              # unit tests (no DB required — check-engine tests use a local test server)
bun run build         # production build (requires DATABASE_URL to be *set*, not necessarily reachable)
```

## Deploy (not done yet)

Target is Vercel. `vercel.json`/cron config for `/api/cron/run-checks` is not written yet —
that ships with the Scheduler feature. See `ISA.md` Constraints for the deploy contract.

<!-- deploy-trigger 1788294155449 -->
