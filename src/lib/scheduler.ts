import { and, eq, inArray, lte, or, isNull, lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { monitors, checks } from "@/db/schema";
import { runHttpCheck } from "@/lib/checks/http";
import { runPingCheck } from "@/lib/checks/ping";
import { runTcpCheck } from "@/lib/checks/tcp";
import type { CheckResult } from "@/lib/checks/types";
import { evaluateIncidentTransition } from "@/lib/incidents";
import type { EmailSender } from "@/lib/alerts/email-sender";

// Generic over any drizzle db bound to this schema — production `postgres-js` client
// or a pglite-backed test client. Keeps the scheduler DB-driver-agnostic (advisor point
// from BUILD: don't force a real-vs-test db split into the core logic).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const DEFAULT_BATCH_SIZE = 25; // ISC-47: bounded batch, concurrent not sequential
const STALE_MULTIPLIER = 2; // ISC-49: matches "more than 2x interval" backfill-once rule

export interface ClaimedMonitor {
  id: string;
  accountId: string;
  type: (typeof monitors.$inferSelect)["type"];
  url: string | null;
  hostname: string | null;
  port: number | null;
  intervalSeconds: number;
}

/**
 * ISC-44, ISC-47, ISC-50: atomically claims up to `batchSize` due monitors via the
 * claimed_at CAS (ISA Decisions — chosen over SELECT FOR UPDATE because Vercel functions
 * hold short-lived connections and can die mid-request, which would leave a held
 * transaction lock stuck; a single auto-committing UPDATE has no such failure mode).
 *
 * Uses `FOR UPDATE SKIP LOCKED` in the id-selection subquery (advisor correction — plain
 * `UPDATE ... LIMIT` doesn't exist in Postgres, and without SKIP LOCKED a second concurrent
 * invocation would block on locked rows instead of moving past them).
 */
export async function claimDueMonitors(db: Db, batchSize = DEFAULT_BATCH_SIZE): Promise<ClaimedMonitor[]> {
  const now = new Date();
  const staleBefore = sql`now() - (${monitors.intervalSeconds} * ${STALE_MULTIPLIER} * interval '1 second')`;

  const claimable = db
    .select({ id: monitors.id })
    .from(monitors)
    .where(
      and(
        eq(monitors.enabled, true),
        lte(monitors.nextCheckAt, now),
        or(isNull(monitors.claimedAt), lt(monitors.claimedAt, staleBefore))
      )
    )
    .orderBy(monitors.nextCheckAt)
    .limit(batchSize)
    .for("update", { skipLocked: true });

  const claimed = await db
    .update(monitors)
    .set({ claimedAt: now })
    .where(inArray(monitors.id, claimable))
    .returning({
      id: monitors.id,
      accountId: monitors.accountId,
      type: monitors.type,
      url: monitors.url,
      hostname: monitors.hostname,
      port: monitors.port,
      intervalSeconds: monitors.intervalSeconds,
    });

  return claimed;
}

export interface RunOneResult {
  monitorId: string;
  ok: boolean;
  error?: string;
}

/**
 * ISC-30..35 dispatch + ISC-45 (anchor next_check_at to check-start, not cron-tick time)
 * + advisor's clamp fix (next_check_at = max(now, anchor + interval) so a slow check can't
 * put the monitor immediately due again and create a tight re-check loop) + ISC-48
 * (one monitor's failure must not abort the batch — caught and returned, not thrown).
 */
export async function runOneCheck(db: Db, monitor: ClaimedMonitor, emailSender?: EmailSender): Promise<RunOneResult> {
  const checkStartedAt = new Date();
  try {
    let result: CheckResult;
    switch (monitor.type) {
      case "http":
        if (!monitor.url) throw new Error("http monitor missing url");
        result = await runHttpCheck(monitor.url);
        break;
      case "ping":
        if (!monitor.hostname) throw new Error("ping monitor missing hostname");
        result = await runPingCheck(monitor.hostname);
        break;
      case "tcp":
        if (!monitor.hostname || !monitor.port) throw new Error("tcp monitor missing hostname/port");
        result = await runTcpCheck(monitor.hostname, monitor.port);
        break;
      default:
        // keyword/ssl executors are still future Features (see ISA) — a monitor of
        // one of those types simply isn't checked yet, not a crash.
        return { monitorId: monitor.id, ok: true };
    }

    await db.insert(checks).values({
      monitorId: monitor.id,
      accountId: monitor.accountId,
      status: result.status,
      statusCode: result.statusCode,
      responseTimeMs: result.responseTimeMs,
      failureReason: result.failureReason,
      checkedAt: result.checkedAt,
    });

    // ISC-51/51.1/52..62: evaluate after the check row is committed and visible, reading
    // persisted history rather than any in-memory state (advisor correction — the
    // scheduler is inherently multi-invocation). ISC-59 is satisfied structurally: a
    // disabled monitor is never claimed by claimDueMonitors, so this line never runs for it.
    await evaluateIncidentTransition(db, monitor.id, monitor.accountId, emailSender);

    const anchored = new Date(checkStartedAt.getTime() + monitor.intervalSeconds * 1000);
    const nextCheckAt = anchored.getTime() < Date.now() ? new Date() : anchored; // advisor clamp

    await db
      .update(monitors)
      .set({ nextCheckAt, claimedAt: null })
      .where(eq(monitors.id, monitor.id));

    return { monitorId: monitor.id, ok: true };
  } catch (err) {
    // ISC-48: swallow per-monitor failures so the batch continues; still release the claim
    // and advance next_check_at so a permanently-broken monitor (e.g. malformed URL) doesn't
    // wedge itself as claimed forever.
    const anchored = new Date(checkStartedAt.getTime() + monitor.intervalSeconds * 1000);
    const nextCheckAt = anchored.getTime() < Date.now() ? new Date() : anchored;
    await db.update(monitors).set({ nextCheckAt, claimedAt: null }).where(eq(monitors.id, monitor.id));
    return { monitorId: monitor.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** ISC-44, ISC-47: entry point — claim a batch, then run all claimed checks concurrently. */
export async function runDueChecks(db: Db, batchSize = DEFAULT_BATCH_SIZE, emailSender?: EmailSender): Promise<RunOneResult[]> {
  const claimed = await claimDueMonitors(db, batchSize);
  if (claimed.length === 0) return [];
  return Promise.all(claimed.map((m) => runOneCheck(db, m, emailSender)));
}
