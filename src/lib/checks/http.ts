/**
 * HTTP check executor (ISC-30..35).
 *
 * Performs a GET against the target URL and returns a `CheckResult`:
 *   - 2xx/3xx final response  -> up (ISC-31)
 *   - >=400 final response     -> down, failure_reason `http` (ISC-32)
 *   - connection/network error -> down, classified failure_reason (ISC-32)
 *   - exceeds timeout          -> down, failure_reason `timeout` (ISC-33)
 *   - > MAX_REDIRECTS hops      -> down, failure_reason `http` (ISC-34)
 *   - identifying User-Agent sent on every request (ISC-35)
 *
 * Pure w.r.t. the database: it takes a URL, returns a result, touches no ORM.
 * Redirects are followed manually (fetch's `redirect: 'manual'`) so the hop
 * limit is exactly enforced rather than left to the platform default (~20).
 */

import type { CheckResult, FailureReason } from './types';
import { classifyFetchError } from './classify';

/** ISC-35: a distinct UA so target-site operators can identify/allowlist us. */
export const USER_AGENT = 'UptimeMonitorBot/1.0 (+https://uptime-monitor.example)';

/** ISC-33: default request budget in milliseconds (10 seconds). */
export const DEFAULT_TIMEOUT_MS = 10_000;

/** ISC-34: maximum number of redirect hops to follow before giving up. */
export const MAX_REDIRECTS = 5;

/** A response is a redirect we should follow iff it is 3xx with a Location. */
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

export interface HttpCheckOptions {
  /** Overall request budget in ms. Defaults to {@link DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/** Whole-millisecond monotonic duration since a `performance.now()` mark. */
function elapsedMs(startMark: number): number {
  return Math.max(0, Math.round(performance.now() - startMark));
}

/**
 * Resolve a `Location` header against the current request URL, honouring
 * relative redirects. Returns `undefined` if the header is missing or the
 * resolved value is not parseable as a URL.
 */
function resolveLocation(current: string, location: string | null): string | undefined {
  if (location === null || location.trim() === '') return undefined;
  try {
    return new URL(location, current).toString();
  } catch {
    return undefined;
  }
}

/**
 * Run a single HTTP check. Never throws for an expected failure mode
 * (timeout, DNS, refused, HTTP error, redirect overflow) — every one of
 * those is returned as a `down` CheckResult. It only propagates truly
 * programmer-level errors (e.g. an invalid `timeoutMs`), which are the
 * caller's contract violation, not a monitored-target condition.
 */
export async function runHttpCheck(
  url: string,
  opts: HttpCheckOptions = {},
): Promise<CheckResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError(`timeoutMs must be a positive finite number, got ${String(timeoutMs)}`);
  }

  const checkedAt = new Date();
  const startMark = performance.now();

  // One AbortController spans the whole check (all redirect hops share the
  // single overall timeout budget, per ISC-33 semantics of a request budget).
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    let currentUrl = url;

    // Manual redirect loop, bounded to MAX_REDIRECTS hops (ISC-34).
    // Iterate MAX_REDIRECTS + 1 times: the first request plus up to
    // MAX_REDIRECTS follow-ups; a further redirect is a `down`/http overflow.
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const response = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual', // we count and follow hops ourselves
        signal: controller.signal,
        headers: { 'user-agent': USER_AGENT },
      });

      const status = response.status;

      // Drain/close the body so the socket can be reused or freed. We never
      // read the body for a plain HTTP check; cancel() releases it promptly.
      // Errors here are irrelevant to the check outcome, so they are ignored
      // deliberately (comment satisfies the "no silent catch" rule).
      void response.body?.cancel().catch(() => {
        /* body already consumed or closed; nothing actionable */
      });

      if (REDIRECT_STATUSES.has(status)) {
        const next = resolveLocation(currentUrl, response.headers.get('location'));
        if (next === undefined) {
          // A 3xx with no usable Location is a broken redirect: treat the
          // 3xx itself as the final response. Per ISC-31, 3xx counts as up.
          return upResult(status, startMark, checkedAt);
        }
        if (hop === MAX_REDIRECTS) {
          // We have already followed MAX_REDIRECTS hops and the server wants
          // another. Give up: too many redirects (ISC-34) -> down / http.
          return downResult('http', status, startMark, checkedAt);
        }
        currentUrl = next;
        continue; // follow the redirect
      }

      // Terminal (non-redirect) response: classify by status code.
      // 2xx and any non-redirect 3xx (e.g. 304) -> up (ISC-31).
      // >=400 -> down with failure_reason `http` (ISC-32).
      if (status >= 400) {
        return downResult('http', status, startMark, checkedAt);
      }
      return upResult(status, startMark, checkedAt);
    }

    // Unreachable in practice: the loop always returns for every hop count.
    // Kept as a defensive, explicit terminal state rather than an implicit
    // `undefined` fall-through (completeness: every path returns a result).
    return downResult('http', undefined, startMark, checkedAt);
  } catch (err) {
    // The fetch threw. If our own timeout fired, that dominates the
    // classification (an aborted request surfaces as an AbortError, but we
    // know the *reason* was the deadline, not a caller abort).
    const failureReason: FailureReason = timedOut ? 'timeout' : classifyFetchError(err);
    return downResult(failureReason, undefined, startMark, checkedAt);
  } finally {
    // Always clear the timer so it cannot keep the event loop alive or fire
    // after we have already returned. Runs on every exit path.
    clearTimeout(timer);
  }
}

/** Build an `up` result with timing captured now. */
function upResult(statusCode: number, startMark: number, checkedAt: Date): CheckResult {
  return {
    status: 'up',
    statusCode,
    responseTimeMs: elapsedMs(startMark),
    checkedAt,
  };
}

/** Build a `down` result with the given reason, timing captured now. */
function downResult(
  failureReason: FailureReason,
  statusCode: number | undefined,
  startMark: number,
  checkedAt: Date,
): CheckResult {
  const result: CheckResult = {
    status: 'down',
    responseTimeMs: elapsedMs(startMark),
    failureReason,
    checkedAt,
  };
  // Only attach statusCode when we actually observed a response, so the
  // field stays absent (not 0/undefined-in-JSON) for pre-response failures.
  if (statusCode !== undefined) {
    result.statusCode = statusCode;
  }
  return result;
}
