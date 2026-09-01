/**
 * TCP port check executor (ISC-37).
 *
 * Attempts a TCP connection to a specific host:port and reports whether that
 * exact port accepted the connection. Unlike ping.ts, ECONNREFUSED here means
 * `down` — the whole point of a TCP monitor is "is THIS port open," and a
 * refused connection means it isn't, even though the host itself clearly
 * responded. That's the deliberate, opposite interpretation from ping.ts's
 * reachability check — see that file's header comment for the contrast.
 */

import { Socket } from 'node:net';
import type { CheckResult, FailureReason } from './types';

export const DEFAULT_TCP_TIMEOUT_MS = 5_000; // ISC-37 default budget, matches ping's 5s (ISC-36)

function elapsedMs(startMark: number): number {
  return Math.max(0, Math.round(performance.now() - startMark));
}

/** Attempts one TCP connection, resolving with either success or a classified failure. */
function attemptConnect(
  hostname: string,
  port: number,
  timeoutMs: number
): Promise<{ ok: true } | { ok: false; reason: FailureReason }> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;

    const finish = (result: { ok: true } | { ok: false; reason: FailureReason }) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);

    socket.once('connect', () => finish({ ok: true }));

    socket.once('timeout', () => finish({ ok: false, reason: 'timeout' }));

    socket.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ECONNREFUSED') {
        finish({ ok: false, reason: 'conn_refused' }); // ISC-37: refused port = down
      } else if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
        finish({ ok: false, reason: 'dns' });
      } else if (err.code === 'EHOSTUNREACH' || err.code === 'ENETUNREACH' || err.code === 'ETIMEDOUT') {
        finish({ ok: false, reason: 'unreachable' });
      } else {
        finish({ ok: false, reason: 'unreachable' });
      }
    });

    socket.connect(port, hostname);
  });
}

export interface TcpCheckOptions {
  timeoutMs?: number;
}

export async function runTcpCheck(
  hostname: string,
  port: number,
  opts: TcpCheckOptions = {}
): Promise<CheckResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TCP_TIMEOUT_MS;
  const checkedAt = new Date();
  const startMark = performance.now();

  const result = await attemptConnect(hostname, port, timeoutMs);

  if (result.ok) {
    return { status: 'up', responseTimeMs: elapsedMs(startMark), checkedAt };
  }
  return {
    status: 'down',
    responseTimeMs: elapsedMs(startMark),
    failureReason: result.reason,
    checkedAt,
  };
}
