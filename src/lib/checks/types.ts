/**
 * Shared types for the check engine.
 *
 * These types are intentionally free of any database, ORM, or framework
 * dependency so the check executors can be unit-tested without Postgres.
 * They mirror the finalized `checks` row shape from the project ISA
 * (Decisions, 2026-08-12 00:25): monitor_id, account_id, checked_at,
 * status (up/down), status_code, response_time_ms, failure_reason.
 *
 * Only the HTTP executor is built this session, but the type surface is
 * forward-compatible with ping / TCP / keyword / SSL checks (ISC-36..43):
 * every failure mode those executors need already has a `FailureReason`
 * member, so adding them later is logic-only, not a type change.
 */

/** Terminal status of a single check, matching the `status` enum (ISC-31/32). */
export type CheckStatus = 'up' | 'down';

/**
 * Why a check was recorded as `down`. Superset covering all five check types
 * so downstream code (scheduler, incident detection) can switch exhaustively.
 *
 * - `timeout`             HTTP/keyword request exceeded the configured timeout (ISC-33).
 * - `dns`                 Hostname did not resolve (ENOTFOUND / EAI_AGAIN).
 * - `tls`                 TLS handshake / certificate validation failed mid-request.
 * - `http`               Reached the server but got a >=400 status, or too many redirects (ISC-32/34).
 * - `conn_refused`        TCP connection actively refused (ECONNREFUSED) (ISC-37).
 * - `keyword_missing`     Keyword monitor fetched the page but the string was absent (ISC-38).
 * - `fetch_error`         Keyword/HTTP fetch failed at the network layer, distinct from keyword_missing (ISC-39).
 * - `cert_expired`        SSL monitor: certificate `not_after` is already in the past (ISC-41).
 * - `cert_expiring_soon`  SSL monitor: certificate valid but expiring within the threshold (ISC-42).
 * - `unreachable`         Ping monitor: host did not respond within the timeout (ISC-36).
 */
export type FailureReason =
  | 'timeout'
  | 'dns'
  | 'tls'
  | 'http'
  | 'conn_refused'
  | 'keyword_missing'
  | 'fetch_error'
  | 'cert_expired'
  | 'cert_expiring_soon'
  | 'unreachable';

/**
 * The outcome of running a single check against a single target.
 *
 * This is the in-memory shape produced by a check executor. The scheduler
 * persists it into the `checks` table by pairing it with the owning
 * `monitor_id` / `account_id` (kept out of this type deliberately: the
 * executor is given a target, not a tenant, so it stays pure and testable).
 */
export interface CheckResult {
  /** Terminal status. `up` iff the check's success condition was met. */
  status: CheckStatus;

  /**
   * The HTTP status code observed, when the check reached an HTTP response.
   * Absent for non-HTTP checks, or when the request failed before any
   * response was received (DNS failure, connection refused, timeout).
   */
  statusCode?: number;

  /**
   * Wall-clock duration of the check in whole milliseconds, measured with a
   * monotonic clock around the network operation. Always present (even on
   * failure) so response-time history and timeout diagnostics are complete.
   */
  responseTimeMs: number;

  /**
   * Set iff `status === 'down'`. Explains the failure for alerting and the
   * dashboard's check-history table. Never set when `status === 'up'`.
   */
  failureReason?: FailureReason;

  /** When the check started, for ordering and history (`checked_at`). */
  checkedAt: Date;
}
