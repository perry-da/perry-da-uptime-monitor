/**
 * "Ping" check executor (ISC-36).
 *
 * True ICMP echo requires raw sockets, which Vercel's serverless Node.js
 * runtime does not grant (no root, no raw-socket capability, no guaranteed
 * `ping` binary reachable via child_process either). Per the ISA Decision
 * (2026-09-01), this is implemented as a TCP-based reachability probe
 * instead — the same technique most cloud-hosted (non-agent-based)
 * uptime-monitoring products use under the hood for exactly this constraint.
 *
 * The semantics deliberately differ from tcp.ts: a ping monitor asks "is the
 * host alive at all," not "is this specific port open." So ECONNREFUSED —
 * the OS/network stack actively answering, just on a closed port — counts as
 * `up` here. tcp.ts treats the identical error as `down` for the opposite
 * reason: there, the specific port IS the thing being checked.
 */

import { Socket } from 'node:net';
import type { CheckResult, FailureReason } from './types';

export const DEFAULT_PING_TIMEOUT_MS = 5_000; // ISC-36
const PROBE_PORTS = [443, 80] as const; // try the common port first, fall back once

function elapsedMs(startMark: number): number {
  return Math.max(0, Math.round(performance.now() - startMark));
}

type ProbeOutcome = { ok: true } | { ok: false; reason: FailureReason };

function attemptConnect(hostname: string, port: number, timeoutMs: number): Promise<ProbeOutcome> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;

    const finish = (result: ProbeOutcome) => {
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
        // ISC-36: refusal proves the host answered — reachable, just closed here.
        finish({ ok: true });
      } else if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
        finish({ ok: false, reason: 'dns' });
      } else {
        finish({ ok: false, reason: 'unreachable' });
      }
    });

    socket.connect(port, hostname);
  });
}

export interface PingCheckOptions {
  timeoutMs?: number;
  /**
   * Override the probe port sequence. Defaults to [443, 80] in production.
   * Exposed so tests can point at an ephemeral local port instead of
   * requiring root to bind 443/80 — production callers should never set this.
   */
  ports?: readonly number[];
}

/**
 * Tries each probe port in turn (443 then 80 by default), succeeding as soon
 * as one proves reachability. Only reports `down` if every port attempt
 * fails with a genuine unreachability signal (not ECONNREFUSED, which
 * already resolves as `up` inside attemptConnect).
 */
export async function runPingCheck(hostname: string, opts: PingCheckOptions = {}): Promise<CheckResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_PING_TIMEOUT_MS;
  const ports = opts.ports ?? PROBE_PORTS;
  const checkedAt = new Date();
  const startMark = performance.now();

  let lastFailure: FailureReason = 'unreachable';

  for (const port of ports) {
    const result = await attemptConnect(hostname, port, timeoutMs);
    if (result.ok) {
      return { status: 'up', responseTimeMs: elapsedMs(startMark), checkedAt };
    }
    lastFailure = result.reason;
    // A DNS failure will fail identically on the fallback port — no point retrying.
    if (result.reason === 'dns') break;
  }

  return {
    status: 'down',
    responseTimeMs: elapsedMs(startMark),
    failureReason: lastFailure,
    checkedAt,
  };
}
