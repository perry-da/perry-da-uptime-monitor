import { and, desc, eq } from "drizzle-orm";
import { accounts, checks, incidents, monitors } from "@/db/schema";
import type { EmailSender } from "@/lib/alerts/email-sender";
import { sendWebhook } from "@/lib/alerts/webhook-sender";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const DEBOUNCE_MIN_STREAK = 2; // ISC-51
const DEBOUNCE_MIN_SPAN_MS = 90_000; // ISC-51.1
const HISTORY_LOOKBACK = 10; // enough to find the current down-streak without unbounded scans

export interface IncidentEvalResult {
  action: "none" | "opened" | "still_open" | "recovered" | "still_closed";
  incidentId?: string;
}

/**
 * ISC-51, ISC-51.1, ISC-52: reconstructs debounce/recovery state from persisted `checks`
 * history — NOT in-memory — per the Advisor's correction: the scheduler is inherently
 * multi-invocation, so any per-process counter would be silently wrong. Span is computed
 * from recorded `checked_at` timestamps, not wall-clock-at-execution.
 *
 * `emailSender` is threaded explicitly (not a global/singleton) so tests can pass a
 * `FakeEmailSender` and production code passes a real adapter — same explicit-dependency
 * style as the rest of this codebase.
 */
export async function evaluateIncidentTransition(
  db: Db,
  monitorId: string,
  accountId: string,
  emailSender?: EmailSender
): Promise<IncidentEvalResult> {
  const recent = await db
    .select()
    .from(checks)
    .where(eq(checks.monitorId, monitorId))
    .orderBy(desc(checks.checkedAt))
    .limit(HISTORY_LOOKBACK);

  if (recent.length === 0) return { action: "none" };

  const latest = recent[0];
  const openIncident = await db.query.incidents.findFirst({
    where: and(eq(incidents.monitorId, monitorId), eq(incidents.status, "open")),
  });

  if (latest.status === "up") {
    if (!openIncident) return { action: "still_closed" }; // ISC-52 guard: nothing to recover from
    return recoverIncident(db, openIncident, latest.checkedAt, emailSender);
  }

  // latest is 'down' — walk the consecutive-down streak from the most recent check backward.
  const streak: (typeof recent)[number][] = [];
  for (const row of recent) {
    if (row.status !== "down") break;
    streak.push(row);
  }

  if (openIncident) return { action: "still_open", incidentId: openIncident.id };

  if (streak.length < DEBOUNCE_MIN_STREAK) return { action: "none" };

  const earliestInStreak = streak[streak.length - 1];
  const spanMs = latest.checkedAt.getTime() - earliestInStreak.checkedAt.getTime();
  if (spanMs < DEBOUNCE_MIN_SPAN_MS) return { action: "none" }; // ISC-51.1 boundary

  return openIncidentRow(db, monitorId, accountId, latest.failureReason ?? undefined, emailSender);
}

async function openIncidentRow(
  db: Db,
  monitorId: string,
  accountId: string,
  failureReason: string | undefined,
  emailSender?: EmailSender
) {
  let inserted;
  try {
    [inserted] = await db
      .insert(incidents)
      .values({ monitorId, accountId, status: "open", startedAt: new Date() })
      .returning();
  } catch {
    // ISC-50-style race: the partial unique index (incidents_one_open_per_monitor) rejected
    // a concurrent second open — another evaluation already opened it. Not an error.
    const existing = await db.query.incidents.findFirst({
      where: and(eq(incidents.monitorId, monitorId), eq(incidents.status, "open")),
    });
    return { action: "still_open" as const, incidentId: existing?.id };
  }

  await notifyOpen(db, inserted, failureReason, emailSender);
  return { action: "opened" as const, incidentId: inserted.id };
}

async function recoverIncident(
  db: Db,
  openIncident: typeof incidents.$inferSelect,
  recoveredAt: Date,
  emailSender?: EmailSender
) {
  const durationSeconds = Math.round((recoveredAt.getTime() - openIncident.startedAt.getTime()) / 1000);
  const [closed] = await db
    .update(incidents)
    .set({ status: "closed", endedAt: recoveredAt, durationSeconds })
    .where(eq(incidents.id, openIncident.id))
    .returning();

  await notifyRecovery(db, closed, emailSender);
  return { action: "recovered" as const, incidentId: closed.id };
}

async function loadAlertContext(db: Db, monitorId: string, accountId: string) {
  const [monitor, account] = await Promise.all([
    db.query.monitors.findFirst({ where: eq(monitors.id, monitorId) }),
    db.query.accounts.findFirst({ where: eq(accounts.id, accountId) }),
  ]);
  return { monitor, account };
}

/** ISC-53, ISC-55, ISC-60, ISC-62: fires exactly once per open transition, gated by openNotifiedAt. */
async function notifyOpen(
  db: Db,
  incident: typeof incidents.$inferSelect,
  failureReason: string | undefined,
  sender?: EmailSender
) {
  if (incident.openNotifiedAt) return; // idempotency gate — advisor correction
  const { monitor, account } = await loadAlertContext(db, incident.monitorId, incident.accountId);
  if (!monitor || !account) return;

  if (sender) {
    await sender.send({
      to: account.email, // ISC-62: always the owning account's registered email, never client-supplied
      subject: `${monitor.name} is DOWN`,
      body: `${monitor.name} (${monitor.url ?? monitor.hostname}) went down${failureReason ? `: ${failureReason}` : ""}.`,
    });
  }
  if (monitor.webhookUrl) {
    await sendWebhook(monitor.webhookUrl, {
      event: "incident.open",
      monitorId: monitor.id,
      monitorName: monitor.name,
      status: "down",
      failureReason,
      timestamp: new Date().toISOString(),
    }); // ISC-61: failure here must not throw — sendWebhook never throws, only returns {ok:false}
  }

  await db.update(incidents).set({ openNotifiedAt: new Date() }).where(eq(incidents.id, incident.id));
}

/** ISC-54, ISC-60: fires exactly once per recovery, gated by closeNotifiedAt. */
async function notifyRecovery(db: Db, incident: typeof incidents.$inferSelect, sender?: EmailSender) {
  if (incident.closeNotifiedAt) return;
  const { monitor, account } = await loadAlertContext(db, incident.monitorId, incident.accountId);
  if (!monitor || !account) return;

  if (sender) {
    await sender.send({
      to: account.email,
      subject: `${monitor.name} is back UP`,
      body: `${monitor.name} recovered after ${incident.durationSeconds}s of downtime.`,
    });
  }
  if (monitor.webhookUrl) {
    await sendWebhook(monitor.webhookUrl, {
      event: "incident.recovery",
      monitorId: monitor.id,
      monitorName: monitor.name,
      status: "up",
      durationSeconds: incident.durationSeconds ?? undefined,
      timestamp: new Date().toISOString(),
    });
  }

  await db.update(incidents).set({ closeNotifiedAt: new Date() }).where(eq(incidents.id, incident.id));
}
