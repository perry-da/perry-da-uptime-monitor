/**
 * Pure classification of fetch / undici / Node network errors into the
 * `FailureReason` enum. No I/O, no side effects — trivially unit-testable
 * with synthetic error objects (see checks.test.ts).
 *
 * Node's global `fetch` (undici) does not throw typed error classes; it
 * throws a generic `TypeError` ("fetch failed") whose real cause is nested
 * under `.cause` as a `Error` carrying a libuv/OpenSSL `.code`. Timeouts
 * surface as a `DOMException`/`Error` with `.name === 'AbortError'`. We
 * therefore inspect `name`, then walk the `.cause` chain looking at `code`.
 */

import type { FailureReason } from './types';

/**
 * String error codes we recognise. Grouped by the FailureReason they map to.
 * Kept as a flat lookup so classification is a single pass, not a switch
 * ladder that is easy to leave a hole in.
 */
const DNS_CODES: ReadonlySet<string> = new Set([
  'ENOTFOUND', // host does not resolve
  'EAI_AGAIN', // temporary DNS resolution failure
  'EAI_FAIL',
]);

const CONN_REFUSED_CODES: ReadonlySet<string> = new Set([
  'ECONNREFUSED', // port closed / nothing listening
]);

/**
 * OpenSSL / Node TLS failure codes. Covers expired certs, self-signed certs,
 * hostname mismatch, and untrusted chains encountered *during* a request.
 * (Deliberate SSL-expiry monitoring — cert_expired / cert_expiring_soon — is
 * handled by the dedicated SSL executor against `not_after`, not here; this
 * branch is for a TLS handshake that fails mid HTTP/keyword request.)
 */
const TLS_CODES: ReadonlySet<string> = new Set([
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_UNTRUSTED',
  'ERR_SSL_WRONG_VERSION_NUMBER',
  'ERR_TLS_HANDSHAKE_TIMEOUT',
]);

/**
 * Connection-layer codes that are neither DNS nor an active refusal — reset,
 * timeout at the socket layer, unreachable network, aborted connection.
 * These are genuine reachability failures, mapped to `fetch_error` so they
 * are distinct from an HTTP-status failure (`http`).
 */
const CONNECTION_CODES: ReadonlySet<string> = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'ECONNABORTED',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_CLOSED',
]);

/** Undici body/response-size codes that mean the fetch itself failed. */
const FETCH_LAYER_CODES: ReadonlySet<string> = new Set([
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_RESPONSE_STATUS_CODE',
  'UND_ERR_ABORTED',
]);

/** Read the `name` of an error-like value without trusting its shape. */
function errorName(value: unknown): string | undefined {
  if (value instanceof Error) return value.name;
  if (typeof value === 'object' && value !== null && 'name' in value) {
    const name = (value as { name?: unknown }).name;
    return typeof name === 'string' ? name : undefined;
  }
  return undefined;
}

/** Read a string `code` off an error-like value, if present. */
function errorCode(value: unknown): string | undefined {
  if (typeof value === 'object' && value !== null && 'code' in value) {
    const code = (value as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/**
 * Collect the error and its `.cause` chain into an array, newest-first.
 * Bounded to 10 links so a self-referential `cause` cannot loop forever.
 */
function causeChain(err: unknown): unknown[] {
  const chain: unknown[] = [];
  let current: unknown = err;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 10 && current != null; depth++) {
    if (seen.has(current)) break; // guard against cyclic cause references
    seen.add(current);
    chain.push(current);
    if (typeof current === 'object' && current !== null && 'cause' in current) {
      current = (current as { cause?: unknown }).cause;
    } else {
      break;
    }
  }
  return chain;
}

/**
 * Map a thrown fetch/network error to a `FailureReason`.
 *
 * Resolution order (first match wins), chosen so the most specific,
 * most actionable cause is reported:
 *   1. AbortError anywhere in the chain -> `timeout`
 *   2. DNS codes                        -> `dns`
 *   3. Connection refused               -> `conn_refused`
 *   4. TLS/cert handshake codes         -> `tls`
 *   5. Other connection/fetch codes     -> `fetch_error`
 *   6. Anything else recognisably an
 *      Error but unmapped               -> `fetch_error`
 *
 * Note: a >=400 HTTP *response* is NOT an error here — the HTTP executor
 * classifies that as `http` directly from the status code, because a 500 is
 * a successful fetch of a failing server, not a fetch failure.
 */
export function classifyFetchError(err: unknown): FailureReason {
  const chain = causeChain(err);

  // 1. Timeout: our AbortController aborts with an AbortError.
  for (const link of chain) {
    if (errorName(link) === 'AbortError' || errorName(link) === 'TimeoutError') {
      return 'timeout';
    }
  }

  // 2-5. Walk the chain and classify by the first recognised system code.
  for (const link of chain) {
    const code = errorCode(link);
    if (code === undefined) continue;
    if (DNS_CODES.has(code)) return 'dns';
    if (CONN_REFUSED_CODES.has(code)) return 'conn_refused';
    if (TLS_CODES.has(code)) return 'tls';
    if (CONNECTION_CODES.has(code)) return 'fetch_error';
    if (FETCH_LAYER_CODES.has(code)) return 'fetch_error';
  }

  // 6. Recognisable TLS errors sometimes only carry a message, not a code
  //    (e.g. reason strings from OpenSSL). Cheap secondary signal.
  for (const link of chain) {
    const message = link instanceof Error ? link.message.toLowerCase() : '';
    if (message.includes('certificate') || message.includes('tls handshake')) {
      return 'tls';
    }
  }

  // Fallback: a fetch that failed for a reason we do not specifically model.
  // `fetch_error` (network-layer failure) is the honest default — we reached
  // the fetch machinery and it threw, which is not an HTTP-status failure.
  return 'fetch_error';
}
