/**
 * SSL expiry check executor (ISC-40..43).
 *
 * Opens a raw TLS connection to the target host (port 443 by default — SSL
 * monitors have no separate port field, see `monitor-schema.ts`'s `sslFields`)
 * and inspects the peer certificate's `valid_to` date directly, rather than
 * relying on Node's own chain-trust verdict:
 *
 *   - connection succeeds, cert already expired            -> down / cert_expired (ISC-41)
 *   - connection succeeds, cert expires within warningDays  -> down / cert_expiring_soon (ISC-42)
 *   - connection succeeds, cert comfortably valid           -> up (ISC-43)
 *   - `certExpiresAt` is recorded on every reached-handshake outcome (ISC-40),
 *     regardless of up/down, since the expiry date itself is the signal this
 *     monitor type exists to report.
 *
 * `rejectUnauthorized: false` is deliberate: this monitor's whole job is
 * reporting *when* a cert expires, including certs that are already invalid
 * for other reasons (self-signed, untrusted CA) — rejecting the handshake
 * outright would hide the very date we need to read. A connection that never
 * reaches a handshake at all (DNS failure, refused, timeout) has no
 * certificate to report and is classified via the shared
 * `classifyFetchError`, same as the HTTP/keyword executors.
 */

import { connect as tlsConnect } from 'node:tls';
import { isIP } from 'node:net';
import type { CheckResult, FailureReason } from './types';
import { classifyFetchError } from './classify';

/** Default connection budget in milliseconds. */
export const DEFAULT_SSL_TIMEOUT_MS = 10_000;

/** SSL monitors always target the standard HTTPS port. */
export const SSL_PORT = 443;

/** ISC-42's default warning threshold, mirroring the schema column default. */
export const DEFAULT_WARNING_DAYS = 14;

function elapsedMs(startMark: number): number {
  return Math.max(0, Math.round(performance.now() - startMark));
}

export interface SslCheckOptions {
  /** Connection budget in ms. Defaults to {@link DEFAULT_SSL_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Port to connect on. Defaults to {@link SSL_PORT}; override only for tests. */
  port?: number;
  /** Days-before-expiry warning threshold (ISC-42). Defaults to {@link DEFAULT_WARNING_DAYS}. */
  warningDays?: number;
}

/**
 * Run a single SSL expiry check. Never throws for an expected failure mode
 * (DNS, refused, timeout) — every one of those is returned as a `down`
 * CheckResult. Only a caller contract violation (an invalid `timeoutMs`)
 * propagates.
 */
export async function runSslCheck(hostname: string, opts: SslCheckOptions = {}): Promise<CheckResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_SSL_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError(`timeoutMs must be a positive finite number, got ${String(timeoutMs)}`);
  }
  const port = opts.port ?? SSL_PORT;
  const warningDays = opts.warningDays ?? DEFAULT_WARNING_DAYS;

  const checkedAt = new Date();
  const startMark = performance.now();

  return new Promise((resolve) => {
    let settled = false;
    const socket = tlsConnect({
      host: hostname,
      port,
      // SNI's servername must be a DNS hostname, never an IP literal (RFC
      // 6066) — node throws synchronously if given one. Monitors are commonly
      // pointed at a bare IP, so this is a real case, not a hypothetical.
      servername: isIP(hostname) ? undefined : hostname,
      timeout: timeoutMs,
      rejectUnauthorized: false, // see file header — we read the cert regardless of chain trust
    });

    const finish = (result: CheckResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    const downNoCert = (reason: FailureReason) =>
      finish({ status: 'down', responseTimeMs: elapsedMs(startMark), failureReason: reason, checkedAt });

    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate();
      if (!cert || !cert.valid_to) {
        // A handshake happened but yielded no readable certificate — treat as
        // a TLS-layer failure rather than silently reporting nothing.
        downNoCert('tls');
        return;
      }

      const expiresAt = new Date(cert.valid_to);
      const msUntilExpiry = expiresAt.getTime() - Date.now();

      if (msUntilExpiry <= 0) {
        finish({
          status: 'down',
          responseTimeMs: elapsedMs(startMark),
          failureReason: 'cert_expired',
          certExpiresAt: expiresAt,
          checkedAt,
        });
        return;
      }

      const warningMs = warningDays * 24 * 60 * 60 * 1000;
      if (msUntilExpiry <= warningMs) {
        finish({
          status: 'down',
          responseTimeMs: elapsedMs(startMark),
          failureReason: 'cert_expiring_soon',
          certExpiresAt: expiresAt,
          checkedAt,
        });
        return;
      }

      finish({
        status: 'up',
        responseTimeMs: elapsedMs(startMark),
        certExpiresAt: expiresAt,
        checkedAt,
      });
    });

    socket.once('timeout', () => downNoCert('timeout'));
    socket.once('error', (err: NodeJS.ErrnoException) => downNoCert(classifyFetchError(err)));
  });
}
