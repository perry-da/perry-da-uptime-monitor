/**
 * DNS check executor.
 *
 * Resolves six record types (A, AAAA, MX, TXT, NS, CNAME) for the target
 * hostname and returns a structured snapshot of whatever resolved. Unlike
 * the other executors, this one does not decide `up`/`down` from a single
 * result — a domain legitimately having no MX or no CNAME record is not a
 * failure. `up` means the domain resolves at all (A or AAAA succeeded);
 * `down` only when NEITHER resolves (the domain itself is unreachable by
 * DNS, e.g. NXDOMAIN or the nameservers themselves are unreachable).
 *
 * Pure w.r.t. the database, same discipline as every other executor in this
 * directory: takes a hostname, returns a result, touches no ORM. Change
 * detection and history persistence live in `lib/dns-tracking.ts`, which
 * calls this module and compares its output against prior snapshots.
 */

import { resolve4, resolve6, resolveMx, resolveTxt, resolveNs, resolveCname } from 'node:dns/promises';
import type { FailureReason } from './types';
import { classifyFetchError } from './classify';

/** Default per-record-type resolution budget in milliseconds. */
export const DEFAULT_DNS_TIMEOUT_MS = 10_000;

export const DNS_RECORD_TYPES = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME'] as const;
export type DnsRecordType = (typeof DNS_RECORD_TYPES)[number];

/** Resolved values for one record type, sorted for stable comparison (see file header). */
export type DnsRecordValues = Record<DnsRecordType, string[]>;

export interface DnsCheckResult {
  status: 'up' | 'down';
  /** Present only when status is 'down' — the domain didn't resolve at all. */
  failureReason?: FailureReason;
  /** Whatever resolved for each record type; an empty array means that type simply has no records (not a failure). */
  records: DnsRecordValues;
  responseTimeMs: number;
  checkedAt: Date;
}

export interface DnsCheckOptions {
  timeoutMs?: number;
}

function elapsedMs(startMark: number): number {
  return Math.max(0, Math.round(performance.now() - startMark));
}

/** Race a resolver call against a manual timeout, since node:dns/promises has no built-in per-call timeout option. */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error('dns lookup timed out'), { code: 'ETIMEDOUT' })), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/** Resolve one record type, returning a sorted array of string values or [] if the type has no records / lookup failed. */
async function resolveOne(type: DnsRecordType, hostname: string, timeoutMs: number): Promise<string[]> {
  try {
    switch (type) {
      case 'A':
        return (await withTimeout(resolve4(hostname), timeoutMs)).sort();
      case 'AAAA':
        return (await withTimeout(resolve6(hostname), timeoutMs)).sort();
      case 'MX': {
        const records = await withTimeout(resolveMx(hostname), timeoutMs);
        return records.map((r) => `${r.priority} ${r.exchange}`).sort();
      }
      case 'TXT': {
        const records = await withTimeout(resolveTxt(hostname), timeoutMs);
        return records.map((chunks) => chunks.join('')).sort();
      }
      case 'NS':
        return (await withTimeout(resolveNs(hostname), timeoutMs)).sort();
      case 'CNAME':
        return (await withTimeout(resolveCname(hostname), timeoutMs)).sort();
    }
  } catch {
    // ENODATA/ENOTFOUND for a single record type just means "no records of
    // this type" (or the type-specific lookup failed) — not a domain-wide
    // failure. The domain-wide up/down decision rests solely on A/AAAA below.
    return [];
  }
}

/**
 * Run a single DNS check. Never throws for an expected failure mode — a
 * fully unresolvable domain is returned as a `down` DnsCheckResult with every
 * record type empty. Only a caller contract violation (an invalid
 * `timeoutMs`) propagates.
 */
export async function runDnsCheck(hostname: string, opts: DnsCheckOptions = {}): Promise<DnsCheckResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_DNS_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError(`timeoutMs must be a positive finite number, got ${String(timeoutMs)}`);
  }

  const checkedAt = new Date();
  const startMark = performance.now();

  const [a, aaaa, mx, txt, ns, cname] = await Promise.all([
    resolveOne('A', hostname, timeoutMs),
    resolveOne('AAAA', hostname, timeoutMs),
    resolveOne('MX', hostname, timeoutMs),
    resolveOne('TXT', hostname, timeoutMs),
    resolveOne('NS', hostname, timeoutMs),
    resolveOne('CNAME', hostname, timeoutMs),
  ]);

  const records: DnsRecordValues = { A: a, AAAA: aaaa, MX: mx, TXT: txt, NS: ns, CNAME: cname };
  const responseTimeMs = elapsedMs(startMark);

  if (a.length === 0 && aaaa.length === 0) {
    // Domain-wide failure: reclassify the A-record attempt's actual error
    // (DNS/timeout/etc.) to report a meaningful reason, rather than a bare
    // "nothing resolved". Re-running is cheap (no state, pure resolver call)
    // and this only happens on the already-slow failure path.
    let failureReason: FailureReason = 'dns';
    try {
      await withTimeout(resolve4(hostname), timeoutMs);
    } catch (err) {
      failureReason = classifyFetchError(err);
    }
    return { status: 'down', failureReason, records, responseTimeMs, checkedAt };
  }

  return { status: 'up', records, responseTimeMs, checkedAt };
}
