/**
 * Keyword check executor (ISC-38, ISC-39).
 *
 * Fetches the target URL and records:
 *   - `up`                                   the response body contains the configured keyword (ISC-38)
 *   - `down` / failure_reason `keyword_missing`  a response was received but the keyword is absent (ISC-38)
 *   - `down` / failure_reason `fetch_error`      the request itself failed at the network layer (ISC-39)
 *
 * Deliberately coarser failure classification than the HTTP executor: any
 * network-layer failure (DNS, timeout, refused, TLS) collapses to the single
 * `fetch_error` reason, per the FailureReason enum's own documented contract
 * for this check type — the point of a keyword monitor is "is the expected
 * content there," not a detailed network diagnosis. Redirects are followed
 * via fetch's default automatic behavior (unlike the HTTP executor, which
 * manually counts hops for ISC-34) since keyword checks have no analogous
 * hop-limit criterion.
 */

import type { CheckResult } from './types';
import { USER_AGENT, BYPASS_HEADER_NAME } from './http';

/** Default request budget in milliseconds. */
export const DEFAULT_KEYWORD_TIMEOUT_MS = 10_000;

function bypassToken(): string | undefined {
  return process.env.MONITOR_BYPASS_KEY;
}

function elapsedMs(startMark: number): number {
  return Math.max(0, Math.round(performance.now() - startMark));
}

export interface KeywordCheckOptions {
  /** Overall request budget in ms. Defaults to {@link DEFAULT_KEYWORD_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/**
 * Run a single keyword check. Never throws for an expected failure mode —
 * every network failure is returned as a `down` CheckResult with
 * `failure_reason: 'fetch_error'`. Only a caller contract violation (an
 * invalid `timeoutMs`) propagates.
 */
export async function runKeywordCheck(
  url: string,
  keyword: string,
  opts: KeywordCheckOptions = {},
): Promise<CheckResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_KEYWORD_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError(`timeoutMs must be a positive finite number, got ${String(timeoutMs)}`);
  }

  const checkedAt = new Date();
  const startMark = performance.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const token = bypassToken();
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: token
        ? { 'user-agent': USER_AGENT, [BYPASS_HEADER_NAME]: token }
        : { 'user-agent': USER_AGENT },
    });
    const body = await response.text();

    if (body.includes(keyword)) {
      return {
        status: 'up',
        statusCode: response.status,
        responseTimeMs: elapsedMs(startMark),
        checkedAt,
      };
    }
    return {
      status: 'down',
      statusCode: response.status,
      responseTimeMs: elapsedMs(startMark),
      failureReason: 'keyword_missing',
      checkedAt,
    };
  } catch {
    // Any network-layer failure — DNS, timeout, refused, TLS — collapses to
    // the single `fetch_error` reason (ISC-39); see file header for why this
    // is deliberately coarser than the HTTP executor's classification.
    return {
      status: 'down',
      responseTimeMs: elapsedMs(startMark),
      failureReason: 'fetch_error',
      checkedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}
