import { and, desc, eq, gte, or } from "drizzle-orm";
import { db } from "@/db/client";
import { checks, incidents, monitors } from "@/db/schema";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export interface DayBucket {
  date: string; // YYYY-MM-DD
  status: "up" | "down" | "no_data";
}

export interface StatusPageData {
  // ISC-69: deliberately narrow — name/type/target only, never account email or internal IDs
  // beyond this monitor's own public identifiers.
  name: string;
  type: string;
  target: string;
  currentStatus: "up" | "down" | "unknown";
  uptimePercent90d: number | null;
  historyBar: DayBucket[];
  responseTimeSeries24h: { checkedAt: string; responseTimeMs: number }[];
  openIncidents: { startedAt: string }[];
  closedIncidents: { startedAt: string; endedAt: string; durationSeconds: number }[];
}

/**
 * ISC-63, ISC-64, ISC-69: only returns data for a published monitor, looked up by slug.
 * Returns null for unpublished/nonexistent slugs — the route layer turns that into a 404,
 * not a 403, so no existence is leaked either way (ISC-23 pattern).
 *
 * ISC-71: this module is read-only — every query here is a SELECT, no writes, so an
 * anonymous visitor hitting the status page can never mutate state.
 */
export async function getStatusPageData(slug: string): Promise<StatusPageData | null> {
  const monitor = await db.query.monitors.findFirst({
    where: and(eq(monitors.slug, slug), eq(monitors.published, true)),
  });
  if (!monitor) return null;

  const since90d = new Date(Date.now() - NINETY_DAYS_MS);
  const recentChecks = await db
    .select()
    .from(checks)
    .where(and(eq(checks.monitorId, monitor.id), gte(checks.checkedAt, since90d)))
    .orderBy(desc(checks.checkedAt));

  const currentStatus: StatusPageData["currentStatus"] = recentChecks[0]
    ? recentChecks[0].status
    : "unknown";

  const uptimePercent90d =
    recentChecks.length === 0
      ? null
      : Math.round((recentChecks.filter((c) => c.status === "up").length / recentChecks.length) * 1000) / 10;

  // ISC-66: day-by-day history bar for the last 90 days.
  const byDay = new Map<string, ("up" | "down")[]>();
  for (const c of recentChecks) {
    const day = c.checkedAt.toISOString().slice(0, 10);
    const arr = byDay.get(day) ?? [];
    arr.push(c.status);
    byDay.set(day, arr);
  }
  const historyBar: DayBucket[] = [];
  for (let i = 89; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const statuses = byDay.get(d);
    if (!statuses || statuses.length === 0) {
      historyBar.push({ date: d, status: "no_data" });
    } else {
      historyBar.push({ date: d, status: statuses.every((s) => s === "up") ? "up" : "down" });
    }
  }

  // ISC-67: response-time series, last 24h, HTTP/keyword types only.
  let responseTimeSeries24h: StatusPageData["responseTimeSeries24h"] = [];
  if (monitor.type === "http" || monitor.type === "keyword") {
    const since24h = new Date(Date.now() - TWENTY_FOUR_HOURS_MS);
    responseTimeSeries24h = recentChecks
      .filter((c) => c.checkedAt >= since24h && c.responseTimeMs != null)
      .slice()
      .reverse()
      .map((c) => ({ checkedAt: c.checkedAt.toISOString(), responseTimeMs: c.responseTimeMs! }));
  }

  // ISC-70: open incidents + closed incidents from the last 90 days.
  const incidentRows = await db
    .select()
    .from(incidents)
    .where(
      and(
        eq(incidents.monitorId, monitor.id),
        or(eq(incidents.status, "open"), gte(incidents.startedAt, since90d))
      )
    )
    .orderBy(desc(incidents.startedAt));

  const openIncidents = incidentRows
    .filter((i) => i.status === "open")
    .map((i) => ({ startedAt: i.startedAt.toISOString() }));
  const closedIncidents = incidentRows
    .filter((i) => i.status === "closed" && i.endedAt && i.durationSeconds != null)
    .map((i) => ({
      startedAt: i.startedAt.toISOString(),
      endedAt: i.endedAt!.toISOString(),
      durationSeconds: i.durationSeconds!,
    }));

  return {
    name: monitor.name,
    type: monitor.type,
    target: monitor.url ?? monitor.hostname ?? "",
    currentStatus,
    uptimePercent90d,
    historyBar,
    responseTimeSeries24h,
    openIncidents,
    closedIncidents,
  };
}
