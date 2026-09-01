---
task: "Build multi-tenant SaaS uptime monitor like UptimeRobot"
project: uptime-monitor
effort: deep
effort_source: classifier
phase: learn
progress: 61/140
mode: interactive
started: 2026-08-12T00:00:00Z
updated: 2026-08-12T00:00:00Z
---

## Problem

There is no running product yet — this is a greenfield build. The underlying problem the product solves: anyone running a website, API, or server has no cheap, fast way to know the instant it goes down, and no easy way to show customers/stakeholders a live status page proving reliability. UptimeRobot solved this at scale (50+ check types, millions of monitors) but the wedge for a new entrant is a fast, clean, developer-friendly monitor + status page product with a generous free tier and simple setup (add a URL, get alerted in under 5 minutes). Today, that "under 5 minutes to first alert" experience does not exist anywhere in this codebase — there is no auth, no monitor model, no scheduler, no alert pipeline, no status page.

## Vision

A new user signs up, pastes in a URL, picks "HTTP" as the check type, and within 90 seconds sees their first green "up" check land in the dashboard. They close the tab. Twenty minutes later their site goes down for a deploy mistake — they get an email within one check interval saying "yourdomain.com is DOWN (connection refused)" before their own customers notice. They fix it, get an "back UP after 4m12s" recovery email, and then paste their public status-page URL into their company Slack. The moment that produces euphoric surprise: they didn't configure anything except a URL, and the system already knew what "down" meant, told them fast, and gave them something shareable.

## Out of Scope

- **Billing/payments.** No Stripe integration, no paid tiers, no usage metering in this build. All monitors are free-tier for now; the schema should not actively block adding billing later, but no billing code ships.
- **Team RBAC / multi-seat roles.** One account = one owner. No invited teammates, no role permissions (admin/viewer/editor). Every account is single-user for this build.
- **SMS / voice-call alerting.** Alerting in this build is email + webhook only. No Twilio, no phone calls, no push notifications.
- **Multi-region checks.** Checks run from a single execution region. No "check from 8 global locations" feature — that is a defined future capability, not built now.
- **Custom domains for status pages.** Status pages are served at `/status/{slug}` on the product's own domain. No CNAME/custom-domain support in this build.
- **Mobile native apps.** Web only.
- **Maintenance windows / scheduled downtime suppression.** Not built — every down check triggers an alert, even planned ones, for v1.

## Principles

- **Time-to-first-alert is the product.** Every architectural choice is judged against: does this make "add a monitor → get a real alert" faster or slower.
- **A false "down" alert is worse than a missed one, up to a point.** Checks must tolerate one transient failure before declaring an incident (require 2 consecutive failures) to avoid alert fatigue from network blips — this is a hard-to-vary explanation of "monitoring," not an implementation detail.
- **Tenant isolation is non-negotiable.** No account may ever read, alert on, or display another account's monitor data, under any code path — including public status pages, which reveal only what the owning account explicitly published.
- **The dashboard must load fast enough to feel free.** A user checking status should never wait on a spinner longer than a network request takes.
- **Every unresolved incident is visible somewhere a human will actually see it** — dashboard banner, status page, and alert channel all agree on current state at all times.

## Constraints

- TypeScript throughout. Runtime is `bun` for local dev/build scripts (per operational rules); the deployed app itself runs on Vercel's Node.js runtime for Next.js compatibility.
- Framework: Next.js (App Router) for both the web UI and the API routes — single deployable unit, no separate backend service.
- Database: Postgres (Vercel Postgres / Neon-compatible), accessed via Drizzle ORM. No raw SQL string concatenation anywhere user input reaches a query.
- Scheduled checks run via Vercel Cron hitting an internal `/api/cron/run-checks` route on a fixed interval (Vercel Cron's minimum granularity is 1 minute; monitor check intervals are quantized to multiples of that).
- Auth: email + password with hashed credentials (bcrypt/argon2) plus session cookies — no third-party OAuth requirement, but must not preclude adding it later.
- Alert delivery in this build: email only, sent via the existing Composio Outlook integration OR a transactional email provider (Resend) if Outlook is unsuitable for arbitrary end-user recipients — decided in `## Decisions`.
- All monitor check requests originate from the deployed app's own serverless functions — no external check-runner service in v1.
- Deploy target is Vercel; a VPS fallback (Docker + node) must be documented but is not the primary path unless Vercel Cron proves insufficient.

## Goal

Ship a deployed, publicly reachable multi-tenant web app where a new user can sign up, add an HTTP/ping/TCP/keyword/SSL-expiry monitor, have it checked on an interval by a Vercel Cron-driven engine, see live status + response-time history in a dashboard, receive an email alert on down/up transitions (after 2 consecutive failed checks), and expose a public read-only status page for any monitor — with strict per-tenant data isolation and no monitor ever silently failing to be checked.

## Criteria

### Auth & Accounts
- [x] ISC-1: `POST /api/auth/signup` with valid email+password creates an account row and returns 201.
- [DEFERRED-VERIFY] ISC-2: `POST /api/auth/signup` with an already-registered email returns 409, no duplicate account created.
- [DEFERRED-VERIFY] ISC-3: `POST /api/auth/signup` with a password under 8 characters returns 400 with a validation error.
- [DEFERRED-VERIFY] ISC-4: `POST /api/auth/login` with correct credentials returns a session cookie and 200.
- [DEFERRED-VERIFY] ISC-5: `POST /api/auth/login` with wrong password returns 401 and sets no session cookie.
- [DEFERRED-VERIFY] ISC-6: `POST /api/auth/logout` clears the session cookie and subsequent authenticated requests return 401.
- [x] ISC-7: Passwords are stored hashed (probe: `SELECT password` on the accounts table never contains the plaintext value used at signup).
- [DEFERRED-VERIFY] ISC-8: Session cookie is `httpOnly` and `Secure` in production (probe: response header inspection).
- [x] ISC-9: An unauthenticated request to `GET /api/monitors` returns 401.
- [DEFERRED-VERIFY] ISC-10: `POST /api/auth/reset-password/request` with a registered email queues a reset email and returns 200 regardless of whether email exists (no user enumeration).
- [DEFERRED-VERIFY] ISC-11: `POST /api/auth/reset-password/confirm` with a valid, unexpired token updates the password hash.
- [DEFERRED-VERIFY] ISC-12: `POST /api/auth/reset-password/confirm` with an expired or already-used token returns 400.
- [DEFERRED-VERIFY] ISC-13: Session expires after 30 days of inactivity (probe: session row has an `expires_at` and expired sessions are rejected by middleware).
- [x] ISC-14: Anti: `GET /api/monitors` for account A ever returns a monitor row owned by account B (probe: `bun test tenant/isolation.test.ts` seeds two accounts and asserts zero cross-visibility).

### Monitor CRUD
- [x] ISC-15: `POST /api/monitors` with `type: http`, a valid `url`, and `interval_seconds` creates a monitor row scoped to the authenticated account.
- [DEFERRED-VERIFY] ISC-16: `POST /api/monitors` with `type: ping` and a valid hostname creates a ping monitor.
- [DEFERRED-VERIFY] ISC-17: `POST /api/monitors` with `type: tcp`, a hostname, and a `port` creates a TCP-port monitor.
- [DEFERRED-VERIFY] ISC-18: `POST /api/monitors` with `type: keyword`, a `url`, and a `keyword` string creates a keyword-match monitor.
- [DEFERRED-VERIFY] ISC-19: `POST /api/monitors` with `type: ssl` and a hostname creates an SSL-expiry monitor.
- [DEFERRED-VERIFY] ISC-20: `POST /api/monitors` with an unsupported `type` value returns 400.
- [DEFERRED-VERIFY] ISC-21: `POST /api/monitors` with a malformed `url` (fails URL parse) returns 400 without creating a row.
- [x] ISC-22: `GET /api/monitors` returns only monitors owned by the authenticated account, newest first.
- [x] ISC-23: `GET /api/monitors/:id` for a monitor owned by another account returns 404 (not 403 — no existence leak).
- [DEFERRED-VERIFY] ISC-24: `PATCH /api/monitors/:id` updates `interval_seconds` and the scheduler picks up the new interval on the next run.
- [x] ISC-25: `DELETE /api/monitors/:id` removes the monitor and all its check-history rows (cascade).
- [DEFERRED-VERIFY] ISC-26: `interval_seconds` below the minimum allowed (60s) is rejected with 400.
- [DEFERRED-VERIFY] ISC-27: A free-tier account is capped at N monitors (cap value fixed in `## Decisions`); the (N+1)th create attempt returns 402-equivalent business error, not a 500.
- [DEFERRED-VERIFY] ISC-28: Each monitor has a `name` field, defaulting to the URL/hostname if not supplied at creation.
- [DEFERRED-VERIFY] ISC-29: `PATCH /api/monitors/:id` can pause a monitor (`enabled: false`) and paused monitors are skipped by the scheduler.

### Check Engine — HTTP
- [x] ISC-30: An HTTP monitor check performs a GET to the configured URL and records `status_code`, `response_time_ms`, and `checked_at`.
- [x] ISC-31: An HTTP check with response status in 200-399 is recorded as `up`.
- [x] ISC-32: An HTTP check with response status ≥400 or a connection error is recorded as `down` with a `failure_reason`.
- [x] ISC-33: An HTTP check that exceeds a 10-second timeout is recorded as `down` with `failure_reason: timeout`.
- [x] ISC-34: HTTP checks follow redirects up to 5 hops before giving up.
- [x] ISC-35: HTTP checks send a distinct `User-Agent` identifying the monitoring service (so target-site operators can identify and allowlist the checker).

### Check Engine — Ping / TCP / Keyword / SSL
- [x] ISC-36: A ping monitor check records `up` when the host responds and `down` with `failure_reason: unreachable` when it does not, within a 5-second timeout.
- [x] ISC-37: A TCP monitor check records `up` when the configured port accepts a connection and `down` otherwise.
- [ ] ISC-38: A keyword monitor check fetches the URL and records `up` only if the configured keyword string is present in the response body; `down` with `failure_reason: keyword_missing` otherwise.
- [ ] ISC-39: A keyword monitor check that fails to fetch the URL at all (network error) is recorded `down` with `failure_reason: fetch_error`, distinct from `keyword_missing`.
- [ ] ISC-40: An SSL monitor check records the certificate's `not_after` expiry date on every check.
- [ ] ISC-41: An SSL monitor is recorded `down` with `failure_reason: cert_expired` when the certificate is already expired.
- [ ] ISC-42: An SSL monitor is recorded `down` with `failure_reason: cert_expiring_soon` when expiry is within a configurable threshold (default 14 days) even though the cert is still technically valid — this is a warning-as-down state distinct from ISC-41.
- [ ] ISC-43: An SSL monitor check against a host with a valid, non-expiring certificate is recorded `up`.

### Scheduler
- [x] ISC-44: `GET /api/cron/run-checks` (invoked by Vercel Cron) selects all enabled monitors whose `next_check_at` is due and dispatches a check for each.
- [ ] ISC-45: After a check completes, `next_check_at` is advanced by exactly `interval_seconds` from the check's start time, not from cron invocation time (prevents interval drift).
- [DEFERRED-VERIFY] ISC-46: `GET /api/cron/run-checks` is protected by a shared secret header so it cannot be triggered by arbitrary external callers.
- [x] ISC-47: `GET /api/cron/run-checks` processes monitors concurrently (bounded batch) rather than sequentially, so N monitors checked in ~one check's latency, not N×latency.
- [x] ISC-48: A single monitor's check failure (thrown exception, malformed target) does not abort the batch — other monitors in the same cron run still get checked (probe: inject a monitor with an unparseable URL into a batch and confirm siblings still complete).
- [x] ISC-49: A monitor whose `next_check_at` is more than 2× its interval in the past (missed runs, e.g. cron was down) is still checked exactly once on the next run, not backfilled N times.
- [DEFERRED-VERIFY] ISC-50: Anti: two overlapping cron invocations both process the same due monitor concurrently, producing duplicate check rows for the same timestamp (probe: row-level lock or advisory lock verified via concurrent-invocation test).

### Incident Detection & Alerting
- [x] ISC-51: A monitor transitions to `incident: open` only after 2 consecutive `down` checks, not on the first (debounce).
- [x] ISC-51.1: The debounce threshold scales with check interval rather than using a fixed sample count — specifically, an incident opens only after `down` checks span at least 90 seconds of wall-clock time (not just 2 samples), so a 60s-interval monitor and a 600s-interval monitor have comparable false-positive exposure per unit time (probe: `bun test incidents/debounce-time-window.test.ts` asserts a monitor with 60s interval requires 2 checks spanning ≥90s before opening an incident, and a monitor with 600s interval still opens after its 2nd consecutive down check since 2×600s already exceeds the window).
- [x] ISC-52: A monitor transitions back to `incident: none` (recovery) after exactly 1 `up` check following an open incident.
- [x] ISC-53: On incident open, an email is sent to the account owner containing monitor name, target, and failure reason.
- [x] ISC-54: On incident recovery, an email is sent to the account owner containing monitor name, target, and total downtime duration.
- [x] ISC-55: No duplicate "down" email is sent for checks 3, 4, 5... while an incident remains open (one alert per incident-open transition, not per failed check).
- [x] ISC-56: An `incidents` table row is created on open with `started_at`, and closed with `ended_at` + computed `duration_seconds` on recovery.
- [x] ISC-57: `GET /api/monitors/:id/incidents` returns the incident history for that monitor, scoped to the owning account.
- [ ] ISC-58: Alert emails are sent via the configured transactional provider with a delivery-failure retry (at least 1 retry on 5xx from the provider).
- [x] ISC-59: A monitor with `enabled: false` never generates an incident or alert, even if it had an open incident when paused.
- [x] ISC-60: `PATCH /api/monitors/:id` supports a `webhook_url` field; on incident open/recovery, a POST is sent to the webhook with a JSON payload if configured.
- [x] ISC-61: Webhook delivery failure (non-2xx or timeout) does not block or fail the email alert path — the two channels are independent.
- [x] ISC-62: Anti: an alert email is ever sent to an email address other than the owning account's registered email (probe: alert-dispatch test asserts recipient == account.email for every fixture).

### Status Pages
- [x] ISC-63: `GET /status/:slug` renders a public page (no auth required) showing the monitor's current status (`up`/`down`) and name, when the owner has published it.
- [x] ISC-64: A monitor not marked `published: true` is not reachable via any `/status/:slug` URL — request returns 404.
- [ ] ISC-65: The status page shows a rolling 90-day uptime percentage computed from check history.
- [ ] ISC-66: The status page shows a visual history bar (e.g. day-by-day up/down/degraded blocks) for the last 90 days.
- [ ] ISC-67: The status page shows a response-time trend chart for the last 24 hours (HTTP/keyword monitor types only — ping/TCP/SSL show status only, no response-time series).
- [x] ISC-68: `PATCH /api/monitors/:id` can set/change the public `slug` for a monitor; slug collisions across accounts return 409.
- [x] ISC-69: The status page never exposes the owning account's email, internal monitor ID, or any other monitor belonging to the same account unless that monitor is also independently published.
- [ ] ISC-70: The status page lists current open incidents with start time and elapsed duration, and closed incidents from the last 90 days with resolved duration.
- [ ] ISC-71: Anti: a `/status/:slug` request ever triggers a database write (public pages are strictly read-only, no side effects from anonymous traffic).

### Dashboard UI
- [x] ISC-72: `/dashboard` (authenticated) lists all monitors for the logged-in account with current status badge (up/down/paused).
- [x] ISC-73: Each monitor row shows the most recent response time and last-checked timestamp.
- [ ] ISC-74: Clicking a monitor navigates to `/dashboard/monitors/:id` showing a detail view with a response-time chart.
- [ ] ISC-75: The monitor detail view shows the last 50 check results in a table (timestamp, status, response time, failure reason if any).
- [ ] ISC-76: An "Add Monitor" form on the dashboard supports all 5 monitor types with type-specific fields shown/hidden dynamically.
- [ ] ISC-77: Form validation on the client mirrors server validation (invalid URL, interval below minimum) and shows inline errors before submit.
- [ ] ISC-78: The dashboard shows a top-level banner when any monitor has an open incident, with a link to it.
- [ ] ISC-79: An "Edit Monitor" form pre-populates existing values and supports pause/resume and delete (with a confirmation step before delete).
- [x] ISC-80: The dashboard exposes a "Copy public status page link" action per monitor once published.
- [x] ISC-81: `/dashboard` route redirects to `/login` when the session is missing or expired, rather than rendering an empty/broken page.
- [x] ISC-82: The signup and login pages are reachable from an unauthenticated landing page at `/`.
- [ ] ISC-83: The dashboard loads its initial monitor list in under 1.5s server-render time on a cold request against a seeded account with 10 monitors (probe: response timing header or server log).

### REST API Surface
- [ ] ISC-84: All authenticated API routes require the session cookie or a valid API token (Bearer) — at least one auth path works for programmatic access.
- [ ] ISC-85: `POST /api/tokens` (authenticated) issues a long-lived API token scoped to the account, returned once at creation.
- [ ] ISC-86: `GET /api/monitors/:id/checks` returns paginated check history with `limit`/`before` query params.
- [ ] ISC-87: API responses use a consistent JSON envelope (`{ data, error }`) across all routes.
- [ ] ISC-88: A malformed JSON request body returns 400 with a parseable error body, not a 500.
- [ ] ISC-89: API routes rate-limit per account/IP (e.g. 100 req/min) and return 429 with a `Retry-After` header when exceeded.
- [ ] ISC-90: `DELETE /api/tokens/:id` revokes a token and subsequent requests using it return 401.
- [ ] ISC-91: OpenAPI or equivalent route documentation exists at `/api/docs` or a static doc file listing every route, method, and expected body shape.

### Data Model & Integrity
- [x] ISC-92: Every table that stores per-account data has a non-nullable `account_id` foreign key with `ON DELETE CASCADE` from the accounts table.
- [x] ISC-93: Deleting an account cascades to delete all its monitors, checks, incidents, and tokens (probe: `SELECT count(*)` on each child table is 0 after account delete).
- [x] ISC-94: The `monitors.type` column is constrained (enum or check constraint) to the 5 supported values only.
- [ ] ISC-95: Check-history rows are append-only in normal operation — no UPDATE statements target the `checks` table outside of migrations.
- [x] ISC-96: A database migration system (Drizzle Kit or equivalent) exists with a committed migration history, not ad-hoc schema edits.
- [DEFERRED-VERIFY] ISC-97: The `checks` table has an index on `(monitor_id, checked_at)` supporting the dashboard's recent-history query without a full table scan (probe: `EXPLAIN` shows index usage).
- [x] ISC-98: Unique constraint on `monitors.slug` prevents two monitors (even across accounts) from claiming the same public status-page slug.
- [x] ISC-99: Unique constraint on `accounts.email` prevents duplicate signups at the database layer, not just application-layer checks.

### Security
- [x] ISC-100: Every authenticated API route independently verifies `account_id` ownership on the resource being accessed — no route trusts a client-supplied `account_id` in the request body.
- [DEFERRED-VERIFY] ISC-101: All user-supplied strings rendered in HTML (monitor names, failure reasons) are escaped, preventing stored XSS (probe: create a monitor named `<script>alert(1)</script>` and confirm it renders as text, not executes).
- [DEFERRED-VERIFY] ISC-102: State-changing API routes (POST/PATCH/DELETE) reject requests without a valid CSRF token or same-site cookie protection, when invoked from a browser session context.
- [x] ISC-103: Secrets (DB connection string, cron shared secret, email provider API key) are read from environment variables, never hardcoded in source.
- [x] ISC-104: SQL queries are built exclusively through the ORM's parameterized query builder — a grep for raw template-literal SQL concatenation with request-derived values returns zero matches.
- [DEFERRED-VERIFY] ISC-105: The cron endpoint (ISC-46) rejects requests missing or presenting the wrong shared-secret header with 401, verified by a live probe against the deployed URL.
- [DEFERRED-VERIFY] ISC-106: Password reset tokens are single-use and invalidated immediately after successful use (probe: replaying a used token returns 400).
- [DEFERRED-VERIFY] ISC-107: Anti: an error response body ever includes a stack trace or raw exception message in production (probe: force a 500 and inspect the response body).

### Performance
- [ ] ISC-108: A single monitor's HTTP check completes (request + write to DB) in under 12 seconds worst case (10s target timeout + margin), verified against a deliberately slow test endpoint.
- [ ] ISC-109: The cron batch endpoint processes 50 due monitors in under 15 seconds total (bounded concurrency, not serial).
- [ ] ISC-110: `GET /api/monitors` for an account with 50 monitors returns in under 500ms server time.
- [ ] ISC-111: The status page (`/status/:slug`) with 90 days of history renders in under 1s server time, using pre-aggregated daily rollups rather than scanning raw check rows per request.

### Build & Deploy
- [x] ISC-112: `bun run build` (Next.js production build) completes with zero TypeScript errors.
- [x] ISC-113: `bun run typecheck` passes with zero errors across the whole project.
- [x] ISC-114: The app deploys successfully to Vercel and the deployed root URL returns 200.
- [ ] ISC-115: `vercel.json` (or `next.config`) declares the cron schedule for `/api/cron/run-checks` at the chosen interval.
- [x] ISC-116: Environment variables required for production (`DATABASE_URL`, cron secret, email provider key) are documented in a committed `.env.example` with no real secret values.
- [DEFERRED-VERIFY] ISC-117: A fresh clone of the repo plus `.env` following the README can run `bun install && bun run dev` and reach a working local dashboard against a local/dev database.
- [x] ISC-118: `git log` shows the project was checkpointed incrementally during the build (not one giant final commit) — verified via `CheckpointPerISC.hook.ts` commit history.

### Operational
- [x] ISC-119: `GET /api/health` returns 200 with a JSON body confirming DB connectivity, for external synthetic monitoring of the product itself.
- [ ] ISC-120: A failed cron run (the check engine itself erroring) is logged somewhere inspectable (console/log aggregator), not silently swallowed.
- [x] ISC-121: The scheduler self-heals from a cold start — after a deploy or cron gap, the next cron tick picks up all overdue monitors without manual intervention (covered jointly with ISC-49).

### Anti-Criteria (Out-of-Scope Enforcement)
- [ ] ISC-122: Anti: any Stripe/payment SDK or billing table exists in the codebase (probe: `grep -ri stripe` and schema inspection return no matches).
- [ ] ISC-123: Anti: any team-invite, role, or permission table/endpoint exists (probe: schema + route inspection).
- [ ] ISC-124: Anti: any SMS/Twilio/voice-call dependency is present in `package.json`.
- [ ] ISC-125: Anti: the checker dispatches a check request from more than one execution region/provider (single-region only, per Out of Scope).
- [ ] ISC-126: Anti: status pages accept or resolve a custom-domain / CNAME configuration.
- [ ] ISC-127: Anti: maintenance-window suppression logic exists that silences an alert for a scheduled/expected outage.

### Antecedent (Experiential Goal)
- [ ] ISC-128: Antecedent: the "Add Monitor" form defaults `interval_seconds` to the shortest supported interval (60s) so a new user's first check fires within a minute of signup, not the default long interval — this precondition is what makes the "alert before the user even leaves the tab" experience in the Vision section possible.

### End-to-End Smoke
- [ ] ISC-129: A full signup → add HTTP monitor → wait for one cron tick → see an `up` check in the dashboard flow completes without manual DB intervention, run against the deployed staging/production URL.
- [ ] ISC-130: A monitor pointed at a deliberately-down target (closed port / dead domain) produces 2 consecutive `down` checks and a delivered alert email within 2× the configured interval.
- [ ] ISC-131: A monitor that recovers after an incident produces a recovery email and closes the `incidents` row with a non-null `duration_seconds`.
- [ ] ISC-132: A published monitor's `/status/:slug` page is reachable from an incognito/unauthenticated request and shows correct live status matching the dashboard.
- [ ] ISC-133: Deleting the test account via the API leaves zero rows in `monitors`, `checks`, `incidents`, `tokens` for that account (cross-check with ISC-93 at the account-lifecycle level, not just schema level).
- [ ] ISC-134: Anti: the end-to-end smoke run leaves any test data visible on a status page slug that collides with a real future customer's chosen slug (test fixtures use a clearly namespaced slug prefix, e.g. `_smoketest-*`).

### Public Marketing Pages (NEW — 2026-09-01, added mid-project per Anup's request for an Odoo-inspired redesign)
- [x] ISC-135: `/` (landing) returns 200 and renders the hero headline text.
- [x] ISC-136: `/features` returns 200.
- [x] ISC-137: `/pricing` returns 200.
- [x] ISC-138: `/signup` and `/login` remain reachable (200) and functionally unchanged after the visual redesign.
- [ ] ISC-139: Antecedent: the visual design is confirmed, by a human looking at it in a real browser, to actually read as "Odoo-inspired" — not just structurally present. **Not verified this session — no browser/screenshot tool (Interceptor) was available in this environment.** Only HTTP-level checks (200 status, text content present) were possible.
- [ ] ISC-140: Pricing page's tiers accurately reflect the product's real state — Free tier is fully functional (matches ISC-27's 50-monitor cap), Pro tier is honestly marked "coming soon" with no functioning checkout, so the page never implies a purchase is possible when none exists. Structurally true by code inspection; not independently re-verified against a rendered page.

## Test Strategy

```yaml
- isc: ISC-14
  type: security-probe
  check: cross-tenant monitor visibility
  threshold: zero cross-tenant rows returned across all fixtures
  tool: bun test tenant/isolation.test.ts

- isc: ISC-45
  type: unit
  check: next_check_at anchored to check start time, not cron invocation time
  threshold: computed next_check_at within 1s tolerance of expected
  tool: bun test scheduler/interval-anchor.test.ts

- isc: ISC-50
  type: concurrency-probe
  check: overlapping cron invocations do not double-check the same monitor
  threshold: exactly 1 check row per monitor per due window under concurrent invocation
  tool: bun test scheduler/concurrent-lock.test.ts

- isc: ISC-51
  type: unit
  check: incident opens only after 2 consecutive down checks
  threshold: 1 down check produces no incident row; 2nd produces exactly 1
  tool: bun test incidents/debounce.test.ts

- isc: ISC-62
  type: security-probe
  check: alert recipient always equals account owner email
  threshold: 100% of fixtures
  tool: bun test alerts/recipient-scope.test.ts

- isc: ISC-71
  type: probe
  check: anonymous GET to /status/:slug produces zero DB writes
  threshold: write-count delta == 0
  tool: bun test status-page/read-only.test.ts

- isc: ISC-83
  type: performance
  check: dashboard cold-render time, 10-monitor seeded account
  threshold: < 1500ms
  tool: server timing header + bun test perf/dashboard-load.test.ts

- isc: ISC-101
  type: security-probe
  check: stored XSS via monitor name
  threshold: script tag renders as escaped text, does not execute
  tool: Interceptor screenshot + DOM inspection

- isc: ISC-105
  type: security-probe
  check: cron endpoint rejects missing/invalid shared secret
  threshold: 401 on live deployed URL
  tool: curl -i against production cron endpoint

- isc: ISC-114
  type: deploy-probe
  check: deployed root URL responds
  threshold: 200 status
  tool: curl -I <vercel-url>

- isc: ISC-129
  type: e2e
  check: full signup-to-first-check flow against live deployment
  threshold: up check visible in dashboard within 1 interval
  tool: Interceptor scripted flow + curl against /api/monitors/:id/checks

- isc: ISC-130
  type: e2e
  check: down monitor triggers alert within 2x interval
  threshold: alert email received, incident row open
  tool: Interceptor + email inbox check (or provider delivery log)
```

## Features

```yaml
- name: ProjectScaffold
  description: Next.js App Router project, TypeScript config, Drizzle ORM + Postgres connection, bun scripts, .env.example, base layout, Vercel project link.
  satisfies: [ISC-96, ISC-103, ISC-112, ISC-113, ISC-116, ISC-117]
  depends_on: []
  parallelizable: false

- name: AuthAndAccounts
  description: Signup/login/logout/password-reset routes, session cookie middleware, password hashing, account schema.
  satisfies: [ISC-1, ISC-2, ISC-3, ISC-4, ISC-5, ISC-6, ISC-7, ISC-8, ISC-9, ISC-10, ISC-11, ISC-12, ISC-13, ISC-14, ISC-99]
  depends_on: [ProjectScaffold]
  parallelizable: false

- name: MonitorDataModel
  description: monitors/checks/incidents/tokens schema, migrations, indices, cascade constraints, type enum.
  satisfies: [ISC-92, ISC-93, ISC-94, ISC-95, ISC-97, ISC-98]
  depends_on: [ProjectScaffold]
  parallelizable: true

- name: MonitorCrudApi
  description: Create/list/get/update/delete monitor routes with per-type validation and tenant-scoped ownership checks.
  satisfies: [ISC-15, ISC-16, ISC-17, ISC-18, ISC-19, ISC-20, ISC-21, ISC-22, ISC-23, ISC-24, ISC-25, ISC-26, ISC-27, ISC-28, ISC-29, ISC-100]
  depends_on: [AuthAndAccounts, MonitorDataModel]
  parallelizable: false

- name: CheckEngine
  description: Per-type check executors (HTTP, ping, TCP, keyword, SSL-expiry) with timeout handling and result recording.
  satisfies: [ISC-30, ISC-31, ISC-32, ISC-33, ISC-34, ISC-35, ISC-36, ISC-37, ISC-38, ISC-39, ISC-40, ISC-41, ISC-42, ISC-43, ISC-108]
  depends_on: [MonitorDataModel]
  parallelizable: true  # split by check type — each executor is independent

- name: Scheduler
  description: Vercel Cron endpoint that selects due monitors, dispatches CheckEngine calls concurrently, advances next_check_at, guards against double-processing.
  satisfies: [ISC-44, ISC-45, ISC-46, ISC-47, ISC-48, ISC-49, ISC-50, ISC-109, ISC-115, ISC-120, ISC-121]
  depends_on: [CheckEngine, MonitorCrudApi]
  parallelizable: false

- name: IncidentsAndAlerting
  description: Debounced incident open/close transitions, email dispatch, webhook dispatch, incident history API.
  satisfies: [ISC-51, ISC-52, ISC-53, ISC-54, ISC-55, ISC-56, ISC-57, ISC-58, ISC-59, ISC-60, ISC-61, ISC-62]
  depends_on: [Scheduler]
  parallelizable: false

- name: StatusPages
  description: Public read-only /status/:slug route, uptime rollups, history bar, response-time chart, publish/slug management.
  satisfies: [ISC-63, ISC-64, ISC-65, ISC-66, ISC-67, ISC-68, ISC-69, ISC-70, ISC-71, ISC-111]
  depends_on: [MonitorCrudApi, IncidentsAndAlerting]
  parallelizable: true

- name: DashboardUI
  description: Authenticated monitor list, detail view, add/edit forms, incident banner, status-page link sharing.
  satisfies: [ISC-72, ISC-73, ISC-74, ISC-75, ISC-76, ISC-77, ISC-78, ISC-79, ISC-80, ISC-81, ISC-82, ISC-83, ISC-101]
  depends_on: [MonitorCrudApi, IncidentsAndAlerting]
  parallelizable: true

- name: PublicApiAndTokens
  description: API token issuance/revocation, paginated check-history endpoint, JSON envelope convention, rate limiting, docs.
  satisfies: [ISC-84, ISC-85, ISC-86, ISC-87, ISC-88, ISC-89, ISC-90, ISC-91, ISC-110]
  depends_on: [MonitorCrudApi]
  parallelizable: true

- name: SecurityHardening
  description: CSRF protection, output escaping audit, raw-SQL grep gate, error-body scrubbing, cron secret enforcement.
  satisfies: [ISC-102, ISC-104, ISC-105, ISC-106, ISC-107]
  depends_on: [AuthAndAccounts, Scheduler]
  parallelizable: true

- name: OutOfScopeEnforcement
  description: Anti-criteria audit — confirm billing/RBAC/SMS/multi-region/custom-domain/maintenance-window features are genuinely absent.
  satisfies: [ISC-122, ISC-123, ISC-124, ISC-125, ISC-126, ISC-127]
  depends_on: [DashboardUI, StatusPages, IncidentsAndAlerting]
  parallelizable: true

- name: DeployAndSmokeTest
  description: Vercel deploy, health endpoint, end-to-end smoke flow against the live deployment.
  satisfies: [ISC-114, ISC-118, ISC-119, ISC-128, ISC-129, ISC-130, ISC-131, ISC-132, ISC-133, ISC-134]
  depends_on: [SecurityHardening, PublicApiAndTokens, OutOfScopeEnforcement]
  parallelizable: false
```

## Decisions

- 2026-09-01: Vercel↔GitHub git integration stopped auto-deploying after the ping/TCP push — both a Deploy Hook re-trigger and a genuine new single-commit push produced zero new builds over several minutes of polling (distinct from the earlier commit-flood issue, where builds queued but landed on the wrong commit — this time nothing queued at all). Root cause not diagnosable via the GitHub/Vercel APIs available in this environment (no access to the GitHub App installation status or Vercel's webhook delivery log). Anup manually redeployed from the Vercel dashboard, but that redeploy rebuilt the same stale commit (`8fa6955f`) rather than pulling true `main` HEAD — likely a "Redeploy" action on an existing deployment entry (which rebuilds that deployment's pinned source) rather than a fresh deployment from the branch. Net effect: the ping/TCP scheduler dispatch code (committed at `7dcdf102` and later) was still not live as of this entry. Live-reproduced the symptom with a throwaway signup+monitor: manually invoking `/api/cron/run-checks` returned `{"checked":1,"ok":1}` but wrote zero rows to `checks` — the signature of the old pre-dispatch `scheduler.ts` (its `default: skip` case returns `ok:true` without a DB write).
- 2026-09-01: Separately, Anup reported a "website" (HTTP) monitor showing `Down` for `capital-cyber.com` despite the site being reachable. Reproduced live: the monitor's actual recorded check was `statusCode: 403`, not a network failure — capital-cyber.com runs behind Cloudflare, which is blocking the checker's request (most likely Cloudflare Bot Fight Mode reacting to the declared `UptimeMonitorBot/1.0` User-Agent and/or Vercel's datacenter egress IP range; confirmed it's not the UA alone since an identical curl from this sandbox's own IP got a clean 200). This is the checker working correctly, not a bug — recommended a Cloudflare WAF custom rule (User Agent contains "UptimeMonitorBot" → Skip Bot Fight Mode) as the fix, not a code change. Vercel Hobby has no static outbound IP (that requires the paid Secure Compute add-on), so IP-based allowlisting isn't viable here.
- 2026-09-01: Anup also flagged that a monitor set to `intervalSeconds: 60` wasn't actually being checked every 60s. Root cause: `intervalSeconds` only controls when a monitor becomes "due" in the DB — actual execution depends entirely on something calling `/api/cron/run-checks`, and `vercel.json`'s cron is `"0 0 * * *"` (once/day), a hard Vercel Hobby-plan cap (sub-daily cron requires Pro). Fix shipped this session: a GitHub Actions workflow (`.github/workflows/run-checks-cron.yml`, `schedule: */5 * * * *` plus `workflow_dispatch`) pings the same cron endpoint every 5 minutes — GitHub Actions' practical minimum granularity — as a free stand-in for Pro's per-minute cron. `CRON_SECRET` was added as a GitHub Actions repository secret (fetched the repo's Actions public key via `GITHUB_GET_A_REPOSITORY_PUBLIC_KEY`, encrypted locally with `libsodium-wrappers`' `crypto_box_seal` per GitHub's required sealed-box format, then `GITHUB_CREATE_OR_UPDATE_A_REPOSITORY_SECRET`). Chosen over waiting on the broken Vercel deploy pipeline above: this workflow needed no Vercel deployment at all — GitHub Actions picks up any workflow file on the default branch directly, sidestepping that unresolved issue entirely. Pushed as a single commit (`bef81fd0`) specifically to avoid repeating the commit-flood mistake. Manually triggered via `workflow_dispatch` and verified the run reached `conclusion: success` before considering this done — not just "file exists," actual execution confirmed.

- 2026-09-01: Ping and TCP check executors built (ISC-36, ISC-37). Forge (auto-included per the E3 coding-task binding) correctly DECLINED to write this code — `codex` CLI genuinely absent, and Forge's own doctrine forbids silently substituting Claude-family reasoning under its name (a stricter, more correct stance than the earlier CheckEngine session, where Forge disclosed the substitution but wrote the code anyway). Given the task was well-specified (Forge said so itself) and time-boxed, wrote `ping.ts`/`tcp.ts` directly rather than dispatching a third agent for mechanical, unambiguous work. `ClaimedMonitor` (scheduler.ts) gained `hostname`/`port` fields to support dispatch; existing scheduler tests that used "ping" as a stand-in for "still-unimplemented, safe pass-through type" were updated to use "keyword" instead (still genuinely unbuilt) since ping is no longer a no-op, plus two new tests exercising the real ping/tcp dispatch end-to-end through `runOneCheck`. 71/71 tests passing (10 new: 9 direct executor tests + updates to existing scheduler tests), typecheck and build both clean.

- 2026-09-01: Found a real bug while building ping/TCP checks: the login and signup success screens still showed "The monitor dashboard is still being built — check back soon" from before DashboardUI existed — never updated after the dashboard shipped. Fixed by removing the intermediate "done" screen entirely; both pages now `router.push("/dashboard")` directly on success, since there's a real destination to send people to now. Pushed as 2 individual file commits (not a full-repo re-sync) specifically to avoid repeating the commit-flood mistake noted below.
- 2026-09-01: Ping check implementation constraint — true ICMP echo requires raw sockets, which Vercel's serverless Node.js runtime does not permit (no root, no raw socket access, and no guaranteed `ping` binary to shell out to even if child_process were viable in that sandbox). Implemented "ping" as a TCP-based reachability probe instead: attempt a TCP connection to the target hostname on port 443 (falling back to 80 on failure) with a 5s timeout — a completed connection OR an ECONNREFUSED (the OS/network stack answered, just that port is closed) both count as `up`, since either proves the host is reachable; ETIMEDOUT/EHOSTUNREACH/ENETUNREACH/DNS failure count as `down` with `failure_reason: unreachable`. This is the same technique most cloud-based (not on-prem-agent) uptime-monitoring products use under the hood for "ping" checks, for the same underlying constraint — genuine ICMP requires infrastructure control these platforms don't have. Documented explicitly rather than silently building something that only resembles ping in name.
- 2026-09-01: Anup connected GitHub to the Vercel project (Settings → Git → Connect Repository) to work around the exhausted API-deployment quota. Found a real, non-obvious consequence of this session's push pattern: every GitHub sync this session pushed each file as its OWN commit (via `GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS` in a loop), producing 100+ individual commits per sync run instead of one atomic commit. When the repo connected, Vercel's git integration queued a build for essentially every one of those commits; most got CANCELED/ERRORed as newer pushes superseded them mid-build, but the deployment that actually won the production alias (`dpl_8aW3SbngPB8vUGz7i7PysbFsZEm8`) landed on an INTERMEDIATE commit (`5dcd2f28...`) from partway through a sync run — confirmed via `GITHUB_GET_REPOSITORY_CONTENT` at that exact ref returning 404 for `src/app/status/[slug]/page.tsx`, which didn't exist yet at that point in the push sequence. Net effect: the live site had the redesign and dashboard but not StatusPages, even though GitHub's true HEAD had everything. Pushed one more settling commit to trigger a fresh build from true HEAD; the git webhook did not visibly fire within several minutes of polling (possibly rate-limited/backed off after the earlier flood). **Resolved:** Anup found and triggered the project's Vercel Deploy Hook directly (`POST .../v1/integrations/deploy/prj_.../keb6gLfxaG`), which built the true latest commit (`19b6b05`) cleanly — bypassing both the exhausted API-deployment quota AND the apparently-stalled GitHub webhook. Full live smoke test afterward: signup → 201, monitor create, dashboard detail page confirmed showing the "Public status page" section (proving the true latest code is what's serving), publish via PATCH → 200, `/status/:slug` → 200, cleanup delete → 200. StatusPages is genuinely live and verified now, not just built. **Learning for future sessions: never push multi-file changes to a git-linked deploy target as N separate single-file commits — batch into one commit (a real git commit, or a single multi-file GitHub Contents API call if one exists) specifically because git-triggered CI/CD systems build per-commit and can lose a race to their own backlog.**
- 2026-09-01: StatusPages Feature built (public `/status/:slug` route, 90-day uptime %, day-by-day history bar, 24h response-time chart for HTTP/keyword monitors, incident history, deliberately narrow data shape excluding account email/internal IDs per ISC-69) plus the DashboardUI wiring this unblocks (publish toggle, slug editor, "Copy public link" button — closing ISC-80, deferred in the prior DashboardUI session specifically because this Feature didn't exist yet). Typecheck, build (`/status/[slug]` registers as a dynamic route), and test suite (60/60, 4 new pglite-backed tests for the slug-lookup and uptime-aggregation query patterns) all green locally. Per Anup's explicit instruction this session ("start building the next item, we will deploy later"), **not deployed** — code is committed and will be pushed to GitHub, but the live-probe verification Rule 1 requires (real HTTP against a running deployment) can't happen until both the Vercel quota resets and Anup gives the go-ahead to deploy. All StatusPages/ISC-80 ISCs stay `[ ]`, not claimed, pending that.
- 2026-09-01: StatusPages built without ISC-111's literal "pre-aggregated daily rollups" — computing 90-day uptime %/history bar via a direct aggregate query over the `checks` table (indexed on `monitor_id, checked_at`) instead. Reasoning: ISC-111 assumed high check volume (the original 60s-interval design), but the actual deployed cron is daily-only (Hobby plan limit, see Scheduler Decisions) — at most ~90 rows/monitor over 90 days, trivially fast to aggregate live. Building a separate rollup table now would be premature optimization for data volume that doesn't exist yet. ISC-111 left `[ ]`, not claimed — revisit if/when check frequency actually increases (leaving Hobby plan).
- 2026-08-12 03:00: IncidentsAndAlerting design: `EmailSender` interface with a `FakeEmailSender` test double and a thin `ResendEmailSender` adapter — chosen over hand-rolling a mock or skipping email-logic verification entirely, per the Advisor's explicit ruling that a fake sender is legitimate for trigger/payload verification but must not be conflated with real-deliverability verification (see Verification section for the exact scope line). `emailSender` is threaded as an explicit optional parameter through `evaluateIncidentTransition` → `runOneCheck` → `runDueChecks` → the cron route, matching the codebase's existing explicit-dependency style rather than a global/singleton (rejected a `globalThis` pattern mid-BUILD once written, in favor of parameter threading).
- 2026-08-12 03:00: Debounce/recovery state is reconstructed from persisted `checks` history on every evaluation call, not tracked in-memory — the Advisor's single highest-value correction this session, since the CAS-locked scheduler is inherently multi-invocation (any per-process counter would silently reset or diverge across cron ticks). Span for ISC-51.1 is computed from the recorded `checked_at` timestamps of the check rows themselves, not `Date.now()` at evaluation time, so retry/queue delay in the scheduler can't skew the debounce window.
- 2026-08-12 03:00: Added a partial unique index `incidents_one_open_per_monitor ON incidents (monitor_id) WHERE status='open'` (advisor correction) as a DB-layer backstop against two near-simultaneous evaluations opening duplicate incidents — `openIncidentRow` catches the constraint violation and treats it as "someone else already opened it," not an error.
- 2026-08-12 02:20: The Advisor's concurrency correction (see Changelog) is why ISC-50 was NOT promoted to `[x]` despite all 13 new scheduler tests passing — a green pglite suite proving sequential idempotency is not the same evidence as proving the anti-criterion (no double-claim under real concurrent invocation). Recorded explicitly in Verification rather than let a passing test suite imply more than it proves.
- 2026-08-12 02:00: Scheduler lock mechanism: `claimed_at` timestamp compare-and-swap via a single `UPDATE monitors SET claimed_at = now() WHERE id = ? AND next_check_at <= now() AND (claimed_at IS NULL OR claimed_at < now() - stale_threshold) RETURNING *`, NOT `SELECT ... FOR UPDATE`. Chosen via FirstPrinciples Challenge: Vercel serverless functions hold short-lived connections per invocation and can be killed mid-request; `FOR UPDATE` would require holding a transaction open across the check's own network I/O (up to 10s), and a killed function leaves that lock held until Postgres notices the dead connection — unbounded by application code. The CAS is a single auto-committing statement with no held transaction, and its staleness window (2× the monitor's interval, reusing ISC-49's own threshold) simultaneously satisfies ISC-49 (missed-run backfill-once) and ISC-50 (no double-claim) as the same mechanism rather than two.
- 2026-08-12 00:20: ApertureOscillation synthesis — tonight's build slice (ProjectScaffold/Auth/MonitorCrud/HTTP CheckEngine) must write `checks` rows against the FULL future schema (status, failure_reason, response_time_ms, checked_at columns) even though incident/scheduler logic isn't built this session, so next session's Scheduler and IncidentsAndAlerting features slot on as logic-only additions rather than requiring a schema migration. Narrow scope in features shipped, full scope in schema shape.
- 2026-08-12 00:00: Scope locked to multi-tenant SaaS (not personal tool, not OSS self-hosted) per direct user choice via AskUserQuestion — this is the single highest-leverage decision in the ISA since it changes every downstream architectural choice (auth, tenancy, status pages).
- 2026-08-12 00:00: Check types locked to HTTP, ping, TCP port, keyword-match, SSL-expiry per direct user choice — broader than the "HTTP only" recommended default.
- 2026-08-12 00:00: Deploy target Vercel (chosen over VPS) — user selected "deploy it somewhere (Vercel, a VPS, etc.)" without a strict preference; Vercel chosen because Vercel MCP tooling is already connected in this environment (`mcp__claude_ai_Vercel__*`), and Vercel Cron gives a zero-infra scheduler for the check engine, avoiding a separate worker process for v1.
- 2026-08-12 00:00: Billing, team RBAC, SMS alerting, multi-region checks, custom status-page domains, and maintenance windows are explicitly Out of Scope — not because they're low-value, but because building all of them alongside auth+monitors+scheduler+alerting+status-pages in one build would blow the E4 time budget and produce a shallow, unshippable version of everything instead of a working core.
- 2026-08-12 00:00: Free-tier monitor cap (ISC-27) set to 50 monitors/account — arbitrary placeholder chosen to exercise the cap-enforcement code path; not a considered business decision, flagged for revisit once real usage data exists.
- 2026-08-12 00:25: Advisor call (commitment boundary, pre-BUILD) confirmed the vertical-slice scope but corrected two points: (1) use real Postgres via Drizzle `pg-core` from the start, NOT SQLite-then-migrate — dialect swap would rewrite the schema layer that is this session's one durable artifact; sandbox has no local Postgres/Docker, so DB-dependent ISCs (writes, live queries) are marked `[DEFERRED-VERIFY]` pending a `DATABASE_URL` (Neon/Supabase free tier) the user supplies in a follow-up session — code is written and typechecked against the real pg schema regardless. (2) Defer live Vercel deploy to a follow-up session; verify locally via typecheck + unit tests on pure logic (e.g. HTTP-check classification) instead. (3) Use an existing auth library (Better-Auth) instead of hand-rolled session/crypto — session-eating rabbit hole with security downside per advisor. (4) Tenant isolation via a single scoped-query helper, not ad-hoc `where org_id =` per call site. (5) `checks` row shape finalized: monitor_id, account_id (denormalized for scoped reads), checked_at, status (up/down enum), status_code, response_time_ms, failure_reason enum (timeout/dns/tls/http/conn_refused/keyword_missing/cert_expired/cert_expiring_soon), matching ISC-30..43.
- 2026-08-12 00:30: Deviated from advisor's specific recommendation to use Better-Auth. Reason: Better-Auth's Drizzle adapter expects its own `user`/`session`/`account`/`verification` table shape, which conflicts with the already-finalized `accounts`/`sessions`/`passwordResetTokens` schema (whose exact column shape — `password_hash`, `sessions.expires_at` — was written to satisfy specific ISCs, ISC-7/ISC-8/ISC-13). Forcing Better-Auth onto a custom schema mid-session risks the exact rabbit hole the advisor warned about, just relocated to adapter-config debugging instead of session-crypto debugging. Compromise: bcrypt (vetted library, not custom crypto) for password hashing + `crypto.randomBytes` for session tokens + httpOnly/Secure signed cookie — assembling well-known primitives correctly against the schema already designed, not inventing new cryptography. This is a real trade-off, not a free pass; flagged here per "show your math" so a future session can swap in Better-Auth/Lucia if this thin layer proves under-featured (e.g. no OAuth path).
- 2026-08-12 00:00: Alert email provider decision deferred to BUILD phase — Composio Outlook (already connected, but bound by this repo's Anup-only allowlist for the *DA's own* outbound mail — NOT appropriate for arbitrary end-user recipients of a multi-tenant product) vs. Resend (a real transactional-email provider, better fit for a product that emails its own signed-up users). Leaning Resend; final call and API-key acquisition happens in BUILD since it requires a new account/credential, not a design choice.
- 2026-08-12 00:15: refined: ISC-51 split into ISC-51 (2-consecutive-failure debounce) + ISC-51.1 (time-window floor of 90s) after SystemsThinking causal-loop analysis surfaced a structural risk — a fixed sample-count debounce combined with the fast 60s default interval (ISC-128, chosen specifically to sell "alert in under 5 minutes") maximizes false-positive exposure at exactly the interval the product defaults new users into, which works against the "false down is worse than missed, up to a point" Principle.
- 2026-08-12 01:30: Session closes at `phase: learn`, deliberately not `phase: complete` — the Algorithm doctrine's "set phase: complete" instruction fits a task ISA with a binary done condition; this is a project ISA with 135 ISCs across many Features, most not yet built. Setting `complete` would misrepresent the project's actual state. Next session resumes at `plan` for the next `## Features` entry in dependency order (Scheduler is next — it depends only on CheckEngine + MonitorCrudApi, both shipped this session).
- 2026-09-01: DashboardUI built (11 of 12 ISCs targeted: ISC-72..79, 81, 83; ISC-80 status-page-link deferred since StatusPages doesn't exist yet) — session-gated `/dashboard` (Server Component, redirects to `/login` when unauthenticated) listing monitors with status badge/response-time/last-checked, an Add Monitor modal with all 5 types and client-side validation mirroring the server schema, a monitor detail page with a check-history table and a lightweight SVG response-time sparkline (no charting library — kept the dependency footprint at zero), edit/pause-resume/delete with a confirm step, and a top-level incident banner. Typecheck, build, and full test suite (56/56) all green locally. **Could not deploy this session — hit Vercel's free-tier `api-deployments-free-per-day` cap (100/day) on the Perry-DA account, exhausted from today's many deploy iterations while debugging the earlier Neon/base64/framework issues.** Resets ~2026-09-02T19:05Z. Code is fully committed and pushed to `github.com/perry-da/perry-da-uptime-monitor` (56 files); redeploying once the quota resets is the same one-line `VERCEL_CREATE_NEW_DEPLOYMENT` call already scripted. Not a code or access problem — purely a platform quota.
- 2026-09-01: Redesigned all public pages (landing, features, pricing — plus restyled signup/login for consistency) in an Odoo.com-inspired visual language, per Anup's direct request. Researched Odoo's actual current homepage structure via WebFetch (hero + value prop, app/feature grid, narrative feature sections, social-proof block, final CTA, multi-column footer) rather than working from memory, then adapted that structure — not their copy — to this product. Locked scope via 2 clarifying questions: pages = landing + features + pricing (not the full Odoo site), palette = match Odoo's actual white-space/yellow-accent look closely (not a different accent color) — both per Anup's explicit choice. Added Tailwind CSS v4 (the project had zero styling solution before this). Pricing page deliberately does NOT imply a working checkout — Free tier is the real, fully-functional product; Pro tier is marked "coming soon" with no payment flow, consistent with the ISA's standing Out-of-Scope decision on billing. **Known gap:** no visual/screenshot verification was possible — Interceptor (the mandated browser-verification tool) has no Chrome extension bridge in this environment, so only HTTP-level checks (200 status, expected text present) were run. The actual visual result has not been confirmed by a human or a screenshot tool; flagged as ISC-139, left `[ ]` rather than claimed.
- 2026-09-01: Signup/login pages (ISC-82) actually deployed live — they were built and committed in an earlier entry but never pushed to the running deployment, so `/signup` and `/login` still 404'd until this. Also hit and resolved a real access hiccup along the way: reconnecting Vercel via Composio (per Anup's request to align accounts) briefly replaced the working connection with one authenticated as Capital Cyber instead of the Perry-DA team the app actually lives on (403 on the live project), blocking any redeploy until Anup reconnected again under the correct account. Verified live afterward: `/signup` → 200, `/login` → 200, `/` → 200, `/api/health` → 200 connected.
- 2026-09-01: Canonical GitHub source moved to `github.com/perry-da/perry-da-uptime-monitor` (Anup's ask: both Vercel and GitHub should be on the perry-da account, not mixed). Synced full current state there (37 files: schema, auth, monitor CRUD, check engine, scheduler, incidents, signup/login pages, migrations). `capitalcybercompliance/perry-da-uptime-monitor` is now stale/unused — left in place per the standing "never delete a repo" rule, not actively maintained going forward. Note: the live Vercel deployment was never git-linked (direct file-upload deploys throughout, due to the earlier `create_git_project` 403), so this move doesn't affect what's actually running — it only fixes which repo is the canonical dev reference.
- 2026-08-12 06:00: Real database wired end-to-end and verified. Anup connected Neon to the Vercel project via Vercel's marketplace integration; it added its own `DB_`-prefixed env vars (`DB_POSTGRES_URL`, `DB_DATABASE_URL`, etc.) rather than touching the existing `DATABASE_URL` placeholder. Updated `src/db/client.ts` and `drizzle.config.ts` to fall back from `DATABASE_URL` → `DB_POSTGRES_URL`/`DB_DATABASE_URL` (pooled for the app, unpooled preferred for migrations) — but the placeholder `DATABASE_URL` still took precedence in the fallback chain and silently shadowed the real Neon var (`ENOTFOUND placeholder.example.com`), only surfaced by adding a temporary secret-gated error-detail path to `/api/health`. Fixed by deleting the placeholder `DATABASE_URL` env var from the Vercel project outright. Applied the 3 committed migrations to the live Neon database via a temporary secret-gated `/api/admin/run-migrations` route (the only way to reach the decrypted connection string, since Vercel's Management API never exposes it, only the running app can see it) — then deleted that route and reverted `/api/health`'s debug path once done. **Full production smoke test passed for real, against the live Neon database:** signup → 201, create HTTP monitor → 201, list monitors → 200 with the created row, delete monitor → 200 (cleaned up the test data afterward). Landing page 200, health 200 `{status:"ok", db:"connected"}`, temporary admin route now genuinely 404 (confirmed removed, not just untested). This directly satisfies ISC-114's actual wording ("deployed root URL returns 200") — promoting it, and closing the loop the SSO-wall entry above left open.
- 2026-08-12 05:15: Deployment reached `readyState: READY` — the app is genuinely built and running on Vercel (`dpl_4h4dCFbU1pPKkpXxbt4gSNdi4uWY`, alias `perry-da-uptime-monitor-perry-da1.vercel.app`). Two more real bugs found and fixed en route: (1) `vercel.json` needed an explicit `"framework": "nextjs"` — without it, Vercel's direct-file-deploy path ran the custom `buildCommand` but then looked for a static-site `public/` output directory instead of invoking the Next.js serverless-function builder, failing with `STATIC_BUILD_NO_OUT_DIR`. (2) confirmed the cron DID register correctly post-fix — `VERCEL_GET_PROJECT` shows `crons.definitions: [{path: "/api/cron/run-checks", schedule: "0 0 * * *"}]`. **Remaining blocker: Vercel Authentication (SSO wall) is on by default for this fresh account and gates every URL with a 302 to `vercel.com/sso-api`.** Attempted to disable via `VERCEL_UPDATE_PROJECT` with `ssoProtection: null` twice — calls report success with no error, but the live URL still redirects to the SSO wall afterward. This is a real, unresolved gap: either Composio's tool doesn't actually reach the specific endpoint that controls this (Vercel's newer "Vercel Authentication" toggle may live outside the general project-PATCH surface), or there's a propagation delay longer than tested. **Needs Anup:** Vercel dashboard → `perry-da-uptime-monitor` project → Settings → Deployment Protection → turn "Vercel Authentication" off (or scope it to preview-only) — a one-click fix once you have the URL in front of you, which I could not complete via the API surface available to me.
- 2026-08-12 04:45: Real Composio `VERCEL_CREATE_NEW_DEPLOYMENT` bug found and worked around: its `files[].data` field description says "Base64 or text data" but the tool does NOT auto-detect/decode base64 — it deploys whatever string is given as the literal file bytes. Base64-encoding every file (the natural choice for a binary-safe transport) produced `ENOENT`/`Unexpected token` errors deep in the build (e.g. `package.json` failing to parse because its content was literally the base64 string `ewogICJuYW...`). Two other false leads chased first: suspected the Hobby-plan cron-frequency limit (`* * * * *` → daily `0 0 * * *`, no change) and suspected `vercel.json`'s `crons` key entirely (removed it, no change) — both real, worth-knowing Vercel constraints but neither was this bug. Fix: send plain UTF-8 text for `data`, not base64, for every text file.
- 2026-08-12 04:30: Deploy blocker resolved — Anup connected a new, separate Vercel account via Composio (team "Perry-DA", `team_n69makAuvStogBEHGIi3LEAf`, distinct from the permission-restricted Capital Cyber Compliance team). Verified live via `VERCEL_LIST_TEAMS` before using it. Deployed via Composio's `VERCEL_CREATE_NEW_DEPLOYMENT` (direct file upload, base64-encoded, 35 files) rather than the git-linked path, since this fresh account has no GitHub App installed yet. Required `skipAutoDetectionConfirmation: "1"` — Vercel's deployment API rejects new-project deployments without explicit framework confirmation or projectSettings. Set `DATABASE_URL` (placeholder, matching the local-build-only pattern from earlier sessions) and a freshly generated `CRON_SECRET` as encrypted env vars on the project before the real deploy, so the build doesn't fail at "collecting page data" the way local `bun run build` did without a DATABASE_URL present. Project: `prj_GavxYsFpIU0SQJgc7dyrxJ9uTDVQ`, team slug `perry-da1`.
- 2026-08-12 04:00: Deploy attempt — code pushed to GitHub (`github.com/capitalcybercompliance/perry-da-uptime-monitor`, and a duplicate at `github.com/perry-da/perry-da-uptime-monitor` from an earlier attempt before the permission issue was diagnosed) but the actual Vercel project creation/first deploy is BLOCKED: both `create_git_project` and `deploy_to_vercel` return `403 forbidden — You don't have permission to create a project` against the only available team (`Capital Cyber Compliance Project`, hobby plan), pointing to Vercel's team-members-and-roles docs. This is a genuine RBAC restriction on the connected Vercel identity, not a code or GitHub issue — confirmed by testing both tool paths and by the fact that GitHub pushes to both repos succeeded cleanly. Not deployed. Needs Anup to either grant the connected identity project-create permission in Vercel team settings, or create the empty `perry-da-uptime-monitor` project shell himself (Vercel dashboard → Add New Project → import `capitalcybercompliance/perry-da-uptime-monitor`), after which redeploying is a single tool call.
- 2026-08-12 03:15: IncidentsAndAlerting feature shipped this session (10 of 12 ISCs promoted to `[x]`, ISC-58 genuinely not built, ISC-50 stays with Scheduler's prior deferral). Session closes at `phase: learn` again. Next session resumes at `plan` for `StatusPages` or `DashboardUI` (both now unblocked — `StatusPages` depends on `MonitorCrudApi` + `IncidentsAndAlerting`, both shipped; `DashboardUI` has the same dependency set) — whichever the user names, or `StatusPages` by default since it's smaller and closes the Vision's "shareable status page" moment.
- 2026-08-12 02:30: Scheduler feature shipped this session (5 of its 8 ISCs promoted to `[x]`, 3 stay `[DEFERRED-VERIFY]` for live-HTTP/real-concurrency reasons, all documented in Verification). Session closes at `phase: learn` again, same reasoning as above. Next session resumes at `plan` for `IncidentsAndAlerting`, the next `## Features` entry whose only dependency (Scheduler) is now satisfied.
- 2026-08-12 00:00: This is a multi-day project by nature — E4's 30-minute budget covers ProjectScaffold + AuthAndAccounts + MonitorDataModel + MonitorCrudApi + a first CheckEngine executor (HTTP) as the working vertical slice this session; remaining Features stay `[ ]` in Criteria and get picked up in follow-up Algorithm runs against this same project ISA (per doctrine: "Project ISAs grow continuously across many tasks"). This session's own EXECUTE/VERIFY will show exactly which ISCs are shipped-and-verified vs. still-pending.

- 2026-08-12 01:00: Forge (auto-included per E4 coding-task binding) reported the `codex` CLI is not installed in this environment, so the HTTP check-engine module was produced by Forge's own Opus/Claude-family reasoning rather than being routed through GPT-5.4 — the cross-vendor blind-spot reduction Forge normally provides did not occur for this piece. Flagged rather than silently treated as a full Forge delegation. Code quality verified independently regardless (28 passing tests, clean typecheck), so shipped as-is; noted as a gap in delegation quality, not blocking.

- 2026-08-12 01:15: Cato cross-vendor audit (mandatory E4 gate, Rule 2a) dispatched via `Agent(subagent_type="Cato")` — same `codex` CLI unavailability Forge hit applies here too (confirmed via `type codex` → not found); Cato performed the audit directly rather than a silent skip, same pattern as Forge.
- 2026-08-12 01:20: Cato verdict: **concerns** (medium criticality), no fraudulent `[x]` claims but real evidence gaps. Findings and disposition: (1) **Fixed now** — ISC-93's cascade test only inserted/checked 2 of the 4 named child tables (monitors, checks; missing incidents, tokens, and sessions); test rewritten to cover all of them, re-verified 35/35 passing. (2) **Accepted, not a bug** — `PATCH /api/monitors/:id` slug-collision check is intentionally unscoped by account (global uniqueness is the point — `/status/:slug` must resolve to exactly one monitor across all tenants) and a 409 "slug_taken" response reveals only that the string is claimed, not by whom — the same low-severity pattern as GitHub username availability checks; not equivalent to ISC-23's "existence leak" (which is about revealing a specific resource, not a claimed string). (3) **Downgraded** — ISC-34 (5-hop redirect cap) evidence caveat added to Verification: the passing test proves the loop logic against same-origin `node:http`, not against production undici/Vercel runtime redirect/Location-header behavior, which is a materially different code path; flagged as a real follow-up rather than re-marked `[ ]`, since the logic itself (not just the test target) is sound by inspection. (4) **Noted** — ISC-7's integration-test evidence computes its own bcrypt hash rather than exercising `auth.ts`'s `createAccount` path (that function depends on the production `db` singleton, which isn't swappable for the pglite test db without a dependency-injection refactor out of scope for this session); the underlying claim (password never stored plaintext) still holds by code inspection of `hashPassword`/`createAccount`, but the test's specific evidence is narrower than the ISA's wording implied — flagged, not silently accepted, per Cato's phrase "prose-quality masking evidence gaps," a real and worth-remembering failure mode for future sessions.

## Changelog

- 2026-08-12 conjectured: incident debounce/recovery could reasonably track state per-check-evaluation in a straightforward way without special persistence concerns, similar to the Scheduler's stateless-dispatch model. / refuted by: the Advisor's pre-BUILD call — the scheduler is fundamentally multi-invocation (each cron tick is a fresh process/request), so unlike the check-engine's pure functions, incident state genuinely needs a durable read of history on every evaluation; an in-memory streak counter would silently be wrong the moment two cron ticks ran as separate invocations, which is the normal case, not an edge case. / learned: "stateless dispatch" (Scheduler) and "stateful debounce" (Incidents) are different problems that happen to sit next to each other in the pipeline — the Scheduler's claimed_at CAS pattern doesn't transfer to incident debounce, because debounce needs a *history*, not just a *lock*. / criterion now: `evaluateIncidentTransition` queries the last 10 `checks` rows on every call and derives the consecutive-down streak and span from their recorded `checked_at` values — no in-memory or per-request state at all.

- 2026-08-12 conjectured: pglite is an adequate stand-in for real Postgres to verify the Scheduler's row-locking mechanism (ISC-50), the same way it worked for the first session's tenant-isolation ISCs. / refuted by: the Advisor's pre-BUILD call — pglite is a single embedded connection with no OS-level parallelism and no ability to hold two overlapping transactions against the same instance; a "two concurrent invocations" test against it runs strictly sequentially and proves idempotency-under-repetition, not a race. / learned: embedded-Postgres closes the "no live DB" gap for query/schema/constraint correctness (proven last session), but NOT for concurrency correctness — those are different verification problems and the second one genuinely requires either real Postgres with two live connections or a differently-designed test (e.g. asserting the SQL shape uses `FOR UPDATE SKIP LOCKED` and trusting Postgres's own documented semantics rather than empirically racing it). / criterion now: ISC-50 stays `[DEFERRED-VERIFY]` even after 13/13 scheduler tests pass — the passing suite proves ISC-44/47/48/49/121, not ISC-50's specific anti-criterion; follow-up needs a real two-connection race test, tracked in Verification.

- 2026-08-12 conjectured: applying only `drizzle/0000_*.sql` in an integration test's `beforeAll` is a stable, adequate migration-application pattern. / refuted by: the moment this session's Scheduler feature added a second migration file (`0001_sad_gressill.sql` for the `claimed_at` column), the first session's tenant-isolation test — hardcoded to the single `0000` filename — started failing with `column "claimed_at" of relation "monitors" does not exist`, because the test's schema drifted from the actual generated migrations the moment a second migration existed. / learned: any test harness that "applies the migration" needs to apply ALL migrations in order via a directory scan, not a filename baked in at the time the test was written — this is the same class of bug as hardcoding a config path, just one level removed (a test fixture silently trusting the migration history to never grow). / criterion now: both integration-test files now scan `drizzle/*.sql` in sorted order rather than referencing a specific filename; this pattern is now the template for any future integration test in this project.

- 2026-08-12 conjectured: this sandbox's lack of local Postgres/Docker meant tenant-isolation and schema-constraint ISCs could only be marked `[DEFERRED-VERIFY]`, deferred to a future session with real infrastructure. / refuted by: the second Advisor call (VERIFY phase, Rule 2) pushed back specifically on this — pointed out that query-correctness verification does not require a *deployed* database, only *a* database, and named `testcontainers`/`pglite`/docker as options; `@electric-sql/pglite` (WASM-compiled Postgres, no Docker/network dependency beyond the npm download) installed and ran cleanly in this sandbox. / learned: "no live DB" and "no way to verify DB-dependent logic" are not the same claim — an embedded real-Postgres engine closes most of that gap for free, and should be the default first move before reaching for DEFERRED-VERIFY on schema/query-correctness ISCs, reserving DEFERRED-VERIFY for genuinely deploy-dependent concerns (live HTTP round-trip, real DNS, actual email delivery). / criterion now: ISC-7, ISC-14, ISC-23, ISC-92, ISC-93, ISC-94, ISC-96, ISC-98, ISC-99, ISC-100 promoted from `[DEFERRED-VERIFY]` to `[x]` with real integration-test evidence; remaining auth/CRUD ISCs stay `[DEFERRED-VERIFY]` because they specifically require the Next.js HTTP layer (cookies, status codes), not just the database.

- 2026-08-12 conjectured: a fixed 2-consecutive-failed-check debounce (ISC-51) is sufficient to prevent alert-fatigue false positives across all monitors. / refuted by: SystemsThinking causal-loop analysis (`CausalLoop` workflow) showing debounce sample-count is decoupled from check interval, so the fastest, most-recommended interval (60s, ISC-128) produces the *thinnest* false-positive margin — as little as 60-120s between two transient blips and a false incident — exactly inverting the intended effect of defaulting new users to a fast interval. / learned: debounce must be expressed as a time-window floor, not a raw sample count, so short-interval and long-interval monitors carry comparable false-positive exposure per unit time. / criterion now: ISC-51 (2-consecutive-failure debounce) retained as the base rule, ISC-51.1 added — incident opens only once down checks span ≥90s wall-clock time, closing the gap the fast default interval would otherwise open.

## Verification

- ISC-36, ISC-37 (ping/TCP check executors): `bun test src/lib/checks/ping.test.ts src/lib/checks/tcp.test.ts` → 9 pass, 0 fail, real sockets (local `net.createServer` for up/refused cases, real DNS resolution against `this-host-does-not-exist.invalid` for the dns-failure case, real TEST-NET-1 (192.0.2.1) connection attempt for the timeout/unreachable case) — no network mocking. Explicitly proves the deliberate ping-vs-tcp asymmetry: identical ECONNREFUSED classified as `up` for ping (host answered, reachable) and `down`/`conn_refused` for tcp (the specific port is what's being checked). Scheduler dispatch wiring verified via 2 new tests in `scheduler.integration.test.ts` exercising `runOneCheck` end-to-end (claim → real check → checks row written) for both types, part of the full 71/71 passing suite. Not yet deployed/live-verified — code is committed, pending the next deploy-hook trigger. Verified 2026-09-01.
- ISC-63, ISC-64, ISC-68, ISC-69, ISC-72, ISC-73, ISC-80, ISC-81 (StatusPages + DashboardUI, live on the corrected deployment via the Vercel Deploy Hook): full live smoke test against `https://perry-da-uptime-monitor-perry-da1.vercel.app` after fixing the stale-commit deploy issue. Dashboard list shows the created monitor's real name, "Pending" status badge (accurate — no check run yet), and "Never" last-checked (ISC-72, ISC-73). `/dashboard` unauthenticated → 307 to `/login` (ISC-81). Monitor detail page confirmed rendering the "Public status page" section (proof the deployed code is genuinely current, not the earlier stale commit). Published a monitor via `PATCH .../slug+published` → 200, then `/status/:slug` → 200 with the monitor's real name in the body and "No data yet" (accurate, honest empty state) — not just a status code check (ISC-63). A second monitor attempting the same slug → 409 (ISC-68). Unpublished/nonexistent slugs → 404, confirmed both before and after the fix (ISC-64). No account email or other-monitor data appeared anywhere in the public status page HTML (ISC-69, by inspection of the actual response body). All test accounts/monitors created for these checks were deleted afterward via the real DELETE endpoint. Verified 2026-09-01.
- ISC-1, ISC-9, ISC-15, ISC-22, ISC-25, ISC-114, ISC-119 (live HTTP round-trip against the deployed production URL, real Neon database): `curl` against `https://perry-da-uptime-monitor-perry-da1.vercel.app` — signup → 201; unauthenticated `GET /api/monitors` → 401; `POST /api/monitors` (http type) → 201 with the created row; `GET /api/monitors` (authenticated) → 200 with exactly the created row; `DELETE /api/monitors/:id` → 200 `{deleted:true}`; root `/` → 200; `/api/health` → 200 `{status:"ok",db:"connected"}`. This is the `FOLLOWUP-uptime-monitor-live-db-probe` task completing — not a future action, done this session. Test data (the smoketest@example.com account's monitor) was deleted afterward via the same DELETE endpoint; the account row itself remains (no account-delete endpoint exists yet, low-value cleanup deferred). Verified 2026-08-31.

**Follow-up task for remaining `[DEFERRED-VERIFY]` entries below: `FOLLOWUP-uptime-monitor-live-db-probe` — provision a real `DATABASE_URL` (Neon/Supabase free tier) and run the HTTP-round-trip probes against `bun run dev` for the ISCs that specifically require the Next.js route layer (cookies, status codes over real HTTP). Note: several ISCs that were originally going to need this were instead verified this session via an embedded real-Postgres integration test (`@electric-sql/pglite` + the actual generated Drizzle migration) — see below.**

- ISC-7, ISC-14, ISC-23, ISC-92, ISC-93, ISC-94, ISC-96, ISC-98, ISC-99, ISC-100: `bun test src/db/__tests__/tenant-isolation.integration.test.ts` → **7 pass, 0 fail** (later corrected to 7 tests / 64 total assertions across the suite after the ISC-93 fix — see below), running against `@electric-sql/pglite` (WASM Postgres) with the actual `drizzle/0000_small_mauler.sql` migration applied — a real database, real unique/enum constraints, real cascade deletes, real `scopedToAccount()` query filtering, not mocks. Specifically confirms: password hash never equals plaintext (ISC-7 — **Cato audit caveat**: this test calls `bcrypt.hash` directly rather than exercising `auth.ts`'s `createAccount` function, since that function is bound to the production `db` singleton, not the pglite test instance, without a DI refactor out of this session's scope; the underlying claim holds by direct code inspection of `createAccount`/`hashPassword`, but the automated evidence is narrower than ideal — flagged honestly rather than glossed over); account A's scoped query returns zero rows for account B's monitor (ISC-14); account A's scoped delete-by-id against account B's monitor affects zero rows, proving the single-query IDOR pattern the advisor asked for (ISC-23, ISC-100); accounts.email unique constraint enforced at the DB layer (ISC-99); monitors.type enum rejects an invalid value at the DB layer (ISC-94); account delete cascades to zero remaining monitors/checks (ISC-93); schema/migration apply cleanly end-to-end (ISC-96, ISC-98). Verified 2026-08-12.

- ISC-44, ISC-47, ISC-48, ISC-49, ISC-121 (Scheduler core): `bun test src/lib/__tests__/scheduler.integration.test.ts` → **13 pass, 0 fail** against pglite with both migrations applied (fixing a real bug this exposed — see Decisions). Confirms: a due, unclaimed, enabled monitor is claimed (ISC-44); a disabled or not-yet-due monitor is never claimed; a batch with one bad-target monitor still completes its sibling (ISC-48); `runDueChecks` returns `[]` when nothing is due; `next_check_at` is clamped to `now()` when a check exceeds its own interval, closing the tight-loop risk the advisor flagged (ISC-45's clamp fix, folded into ISC-121's self-heal wording). Verified 2026-08-12.
- ISC-46 (cron shared-secret) and ISC-105 (its 401 probe): code inspection confirms the route rejects any request whose `Authorization` header doesn't exactly match `Bearer ${CRON_SECRET}`; the live-HTTP 401 probe itself needs `bun run dev` against a real deployment. `[DEFERRED-VERIFY]`, folded into `FOLLOWUP-uptime-monitor-live-db-probe`.
- ISC-51, ISC-51.1, ISC-52, ISC-55, ISC-56, ISC-57, ISC-59, ISC-60, ISC-61, ISC-62 (incident detection, recovery, dedup, history, isolation): `bun test src/lib/__tests__/incidents.integration.test.ts` → **11 pass, 0 fail, 22 expect() calls** against pglite. Specifically proves the advisor's named correctness risk directly: 2 consecutive downs spanning exactly 60s do NOT open an incident (ISC-51.1's boundary), while the 3rd down at 120s DOES; a 600s-interval monitor opens on its 2nd down since 600s already exceeds the 90s window; recovery closes the incident and computes `duration_seconds` from real timestamps; a webhook pointed at a guaranteed-closed port does not throw or block the email send (ISC-61, real network attempt, not mocked); a second evaluation call while an incident is open creates zero duplicate rows (the partial unique index backstop). Verified 2026-08-12.
- ISC-53, ISC-54 (alert trigger + payload correctness): same test file — `FakeEmailSender` proves the incident-open/recovery transitions call `send()` exactly once each with `to === account.email` and content naming the monitor/reason/duration. **Scope of this claim, per the Advisor's explicit instruction:** this verifies the app's TRIGGER and PAYLOAD logic, not real email deliverability. `ResendEmailSender` (the real adapter, `src/lib/alerts/email-sender.ts`) is NOT exercised by any test in this repo — no `RESEND_API_KEY` in this sandbox — and is explicitly commented in its own source as unverified. Marking ISC-53/54 `[x]` reflects the ISA wording ("an email is sent" = the app's send-call behavior), not a claim that real inboxes receive real mail.
- ISC-58 (delivery-failure retry): genuinely not built — `ResendEmailSender.send()` has no retry logic. Correctly left `[ ]`, not marked or glossed over.
- ISC-50 (no double-claim under real concurrency): **stays `[DEFERRED-VERIFY]`, NOT promoted to `[x]`, per the Advisor's explicit correction (see Decisions).** `claimDueMonitors` calling twice in sequence correctly claims-then-skips (proven, 13/13 scheduler tests including the sequential-idempotency case), and the stale-reclaim self-heal path is proven — but pglite is a single connection with no real transaction-level parallelism, so it cannot prove the actual anti-criterion (two *concurrent* invocations racing for the same row). The architectural protection (`FOR UPDATE SKIP LOCKED` inside the claim subquery) is sound by Postgres semantics, but "sound by semantics" and "proven under real concurrent load" are different claims, and this ISA doesn't collapse them. Follow-up: `FOLLOWUP-uptime-monitor-live-db-probe` should include a real-Postgres two-connection race test (testcontainers or a live Neon branch), not just a repeat of the pglite suite.

- ISC-30..35 (HTTP check engine): `bun test src/lib/checks/checks.test.ts` → **28 pass, 0 fail, 50 expect() calls** against a local `node:http` test server (200/500/redirect/timeout/closed-port/DNS-failure paths). This is real network I/O against localhost, not mocked. Verified 2026-08-12. **Cato audit caveat (ISC-34 specifically):** the redirect-cap test proves the loop logic correctly but only exercises same-origin `node:http` — production undici/Vercel redirect and opaque-Location-header behavior is a different code path, untested this session. Loop logic sound by inspection; production-runtime behavior is a real follow-up, tracked under `FOLLOWUP-uptime-monitor-live-db-probe`'s companion deploy-verification pass, not re-marked `[ ]` since the shipped logic itself isn't in question, only its production-runtime coverage.
- ISC-93 (cascade delete, all 4 named child tables): originally tested with only 2 of 4 tables (monitors, checks) — a real evidence gap Cato caught. Test rewritten same session to insert+verify all four (monitors, checks, incidents, apiTokens) plus sessions; re-run: **35 pass, 0 fail, 64 expect() calls**. Verified 2026-08-12 (corrected).
- ISC-112 (build zero TS errors) + ISC-113 (typecheck): `bun run typecheck` → zero output, exit 0. `bun run build` → `✓ Compiled successfully`, `✓ Generating static pages (11/11)`, all 8 API routes listed as dynamic routes. Verified 2026-08-12 (build required a placeholder `DATABASE_URL` env var to be *present* — `postgres()` client construction doesn't eagerly connect — but did NOT require a reachable database; this confirms build-time correctness is independent of runtime DB availability).
- ISC-103 (secrets from env): `src/db/client.ts` reads `process.env.DATABASE_URL`; no secret string literals in any committed file — confirmed by direct read of every file written this session.
- ISC-104 (no raw SQL concat): every query in `src/app/api/**` and `src/lib/**` goes through Drizzle's query builder (`db.query.*`, `db.select()`, `db.insert()`, `db.update()`) or the single `sql\`select 1\`` health-check literal (no interpolated values) — confirmed by direct read of every route file.
- ISC-116 (.env.example committed, no real secrets): `.env.example` exists at project root with placeholder values only (`postgres://user:password@host...`, empty secret fields).
- ISC-1..14 (auth), ISC-15..29 (monitor CRUD), ISC-92..102/105..107 (data model + security probes), ISC-117 (fresh-clone dev loop): code is written and typechecks clean against the full Postgres schema, but the live HTTP-request-against-a-running-server-with-a-real-database probes these ISCs specify could not run in this sandbox (no Postgres, no Docker). Marked `[DEFERRED-VERIFY]` per doctrine's probe-impossible escape clause, not `[x]` — this is a real gap, not a formality. `bun install` and `bun run build` (both required for ISC-117) DID succeed live; only the `bun run dev` + actual signup/login HTTP round-trip against a real DB is deferred.
- ISC-36..91, ISC-108..111, ISC-114-115, ISC-118-135: not yet built this session (Scheduler, IncidentsAndAlerting, StatusPages, DashboardUI, PublicApiAndTokens, remaining SecurityHardening, OutOfScopeEnforcement audit, live Deploy, end-to-end smoke). Left `[ ]`, unchanged from OBSERVE — honestly represents not-yet-built work, not a verification failure. Continues in a follow-up Algorithm run against this same project ISA per the Decisions entry on multi-day scope.
- ISC-118 (checkpointed incrementally): now met — `git log --oneline` shows 3 commits across the session (scaffold+auth+CRUD+HTTP-engine → pglite integration tests → Cato-fix), not one giant final commit. Marked `[x]`, promoted from the earlier `[ ]` once the third checkpoint landed. Verified 2026-08-12.
