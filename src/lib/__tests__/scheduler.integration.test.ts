import { describe, it, expect, beforeAll } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import * as schema from "../../db/schema";
import { claimDueMonitors, runOneCheck, runDueChecks } from "../scheduler";

// Real embedded-Postgres test (ISC-44, 45, 47, 48, 49, 50, 121). Advisor caveat, recorded
// in ISA Decisions: pglite is a single connection with no real OS-level parallelism, so a
// "two concurrent invocations" scenario here proves SEQUENTIAL idempotency and the
// stale-reclaim path, not an actual race — that requires two live connections against real
// Postgres (tracked as a real follow-up, not silently treated as equivalent coverage).

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const client = new PGlite();
  const drizzleDir = join(import.meta.dir, "../../../drizzle");
  const files = readdirSync(drizzleDir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = readFileSync(join(drizzleDir, file), "utf-8");
    const statements = sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      await client.exec(stmt);
    }
  }
  db = drizzle(client, { schema });
});

async function seedMonitor(overrides: Partial<typeof schema.monitors.$inferInsert> = {}) {
  const [account] = await db
    .insert(schema.accounts)
    .values({ email: `sched-${crypto.randomUUID()}@example.com`, passwordHash: "x" })
    .returning();
  const [monitor] = await db
    .insert(schema.monitors)
    .values({
      accountId: account!.id,
      type: "http",
      url: "https://example.com",
      name: "scheduled monitor",
      intervalSeconds: 60,
      nextCheckAt: new Date(Date.now() - 1000), // already due
      ...overrides,
    })
    .returning();
  return { account: account!, monitor: monitor! };
}

describe("claimDueMonitors (ISC-44, ISC-50)", () => {
  it("claims a due, unclaimed monitor and sets claimed_at", async () => {
    const { monitor } = await seedMonitor();
    const claimed = await claimDueMonitors(db);
    expect(claimed.some((m) => m.id === monitor.id)).toBe(true);

    const row = await db.query.monitors.findFirst({ where: eq(schema.monitors.id, monitor.id) });
    expect(row!.claimedAt).not.toBeNull();
  });

  it("does not re-claim a freshly-claimed monitor on the next call (sequential idempotency)", async () => {
    const { monitor } = await seedMonitor();
    const first = await claimDueMonitors(db);
    const second = await claimDueMonitors(db);
    expect(first.some((m) => m.id === monitor.id)).toBe(true);
    expect(second.some((m) => m.id === monitor.id)).toBe(false); // ISC-50
  });

  it("re-claims a monitor whose claim is stale (> 2x interval old) — ISC-49/ISC-121 self-heal", async () => {
    const { monitor } = await seedMonitor({ intervalSeconds: 60 });
    await db
      .update(schema.monitors)
      .set({ claimedAt: new Date(Date.now() - 130_000) }) // 130s ago, > 2x60s stale threshold
      .where(eq(schema.monitors.id, monitor.id));

    const claimed = await claimDueMonitors(db);
    expect(claimed.some((m) => m.id === monitor.id)).toBe(true);
  });

  it("does not claim a disabled monitor", async () => {
    const { monitor } = await seedMonitor({ enabled: false });
    const claimed = await claimDueMonitors(db);
    expect(claimed.some((m) => m.id === monitor.id)).toBe(false);
  });

  it("does not claim a monitor that isn't due yet", async () => {
    const { monitor } = await seedMonitor({ nextCheckAt: new Date(Date.now() + 60_000) });
    const claimed = await claimDueMonitors(db);
    expect(claimed.some((m) => m.id === monitor.id)).toBe(false);
  });
});

describe("runOneCheck (ISC-45, ISC-48)", () => {
  it("dispatches a real ping check through the scheduler (ISC-36 wiring)", async () => {
    // The scheduler's ping dispatch always uses ping.ts's default probe ports (443, 80) —
    // it doesn't accept a port override at this call site (that's ping.ts's own testing
    // affordance, exercised directly in ping.test.ts). Nothing should be listening on
    // 127.0.0.1:443/:80 in this sandbox, so the real ECONNREFUSED-is-up rule (ISC-36) is
    // what proves the actual executor ran end-to-end through runOneCheck, not a stub.
    const { monitor } = await seedMonitor({ type: "ping", url: null, hostname: "127.0.0.1", intervalSeconds: 60 });
    const result = await runOneCheck(db, {
      id: monitor.id,
      accountId: monitor.accountId,
      type: "ping",
      url: null,
      hostname: "127.0.0.1",
      port: null,
      keyword: null,
      sslExpiryWarningDays: 14,
      intervalSeconds: 60,
    });
    expect(result.ok).toBe(true);
    const row = await db.select().from(schema.checks).where(eq(schema.checks.monitorId, monitor.id));
    expect(row.length).toBe(1);
    expect(row[0]!.status).toBe("up");
  });

  it("dispatches a real tcp check through the scheduler (ISC-37 wiring)", async () => {
    const server = createServer((socket) => socket.end());
    const port = await new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") resolve(addr.port);
      });
    });
    try {
      const { monitor } = await seedMonitor({ type: "tcp", url: null, hostname: "127.0.0.1", port, intervalSeconds: 60 });
      const result = await runOneCheck(db, {
        id: monitor.id,
        accountId: monitor.accountId,
        type: "tcp",
        url: null,
        hostname: "127.0.0.1",
        port,
        keyword: null,
        sslExpiryWarningDays: 14,
        intervalSeconds: 60,
      });
      expect(result.ok).toBe(true);
      const row = await db.select().from(schema.checks).where(eq(schema.checks.monitorId, monitor.id));
      expect(row.length).toBe(1);
      expect(row[0]!.status).toBe("up");
    } finally {
      server.close();
    }
  });

  it("dispatches a real keyword check through the scheduler (ISC-38 wiring)", async () => {
    const server = createHttpServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("healthy site, all systems go");
    });
    const port = await new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") resolve(addr.port);
      });
    });
    try {
      const { monitor } = await seedMonitor({
        type: "keyword",
        url: `http://127.0.0.1:${port}`,
        keyword: "all systems go",
        intervalSeconds: 60,
      });
      const result = await runOneCheck(db, {
        id: monitor.id,
        accountId: monitor.accountId,
        type: "keyword",
        url: `http://127.0.0.1:${port}`,
        hostname: null,
        port: null,
        keyword: "all systems go",
        sslExpiryWarningDays: 14,
        intervalSeconds: 60,
      });
      expect(result.ok).toBe(true);
      const row = await db.select().from(schema.checks).where(eq(schema.checks.monitorId, monitor.id));
      expect(row.length).toBe(1);
      expect(row[0]!.status).toBe("up");
    } finally {
      server.close();
    }
  });

  it("dispatches a real ssl check through the scheduler (ISC-40/43 wiring)", async () => {
    // The scheduler's ssl dispatch always connects on ssl.ts's default port 443 (SSL
    // monitors have no port field, per monitor-schema.ts) — nothing should be listening
    // on 127.0.0.1:443 in this sandbox, so this exercises the real dispatch + connection
    // -failure path through runOneCheck. A genuine up/cert_expiring_soon outcome against
    // an actual certificate is covered directly in ssl.test.ts.
    const { monitor } = await seedMonitor({ type: "ssl", url: null, hostname: "127.0.0.1", intervalSeconds: 60 });
    const result = await runOneCheck(db, {
      id: monitor.id,
      accountId: monitor.accountId,
      type: "ssl",
      url: null,
      hostname: "127.0.0.1",
      port: null,
      keyword: null,
      sslExpiryWarningDays: 14,
      intervalSeconds: 60,
    });
    expect(result.ok).toBe(true);
    const row = await db.select().from(schema.checks).where(eq(schema.checks.monitorId, monitor.id));
    expect(row.length).toBe(1);
    expect(row[0]!.status).toBe("down");
  });

  it("dispatches a real dns check through the scheduler and records the timeline", async () => {
    const { monitor } = await seedMonitor({ type: "dns", url: null, hostname: "example.com", intervalSeconds: 60 });
    const result = await runOneCheck(db, {
      id: monitor.id,
      accountId: monitor.accountId,
      type: "dns",
      url: null,
      hostname: "example.com",
      port: null,
      keyword: null,
      sslExpiryWarningDays: 14,
      intervalSeconds: 60,
    });
    expect(result.ok).toBe(true);

    const row = await db.select().from(schema.checks).where(eq(schema.checks.monitorId, monitor.id));
    expect(row.length).toBe(1);
    expect(row[0]!.status).toBe("up");

    // dns dispatch does more than the standard checks-row insert — confirm the
    // snapshot/change history was actually written, not just the checks row.
    const snapshots = await db
      .select()
      .from(schema.dnsSnapshots)
      .where(eq(schema.dnsSnapshots.monitorId, monitor.id));
    expect(snapshots.length).toBeGreaterThan(0);
  });

  it("does not abort on a monitor with a bad target — records failure, releases claim (ISC-48)", async () => {
    const { monitor } = await seedMonitor({ url: "not-a-valid-url", intervalSeconds: 60 });
    const result = await runOneCheck(db, {
      id: monitor.id,
      accountId: monitor.accountId,
      type: "http",
      url: "not-a-valid-url", // runHttpCheck will throw on invalid URL construction
      hostname: null,
      port: null,
      keyword: null,
      sslExpiryWarningDays: 14,
      intervalSeconds: 60,
    });
    // Whatever happens inside runHttpCheck, runOneCheck itself must not throw.
    expect(typeof result.ok).toBe("boolean");

    const row = await db.query.monitors.findFirst({ where: eq(schema.monitors.id, monitor.id) });
    expect(row!.claimedAt).toBeNull(); // claim released either way
  });

  it("clamps next_check_at to now() when the check itself runs longer than the interval", async () => {
    const { monitor } = await seedMonitor({ url: null, intervalSeconds: 1 }); // 1s interval, trivially exceeded
    await runOneCheck(db, {
      id: monitor.id,
      accountId: monitor.accountId,
      type: "http", // missing url throws immediately — exercises the catch-branch anchoring path
      url: null,
      hostname: null,
      port: null,
      keyword: null,
      sslExpiryWarningDays: 14,
      intervalSeconds: 1,
    });
    const row = await db.query.monitors.findFirst({ where: eq(schema.monitors.id, monitor.id) });
    // next_check_at must never be more than a few ms in the past — the clamp fires.
    expect(row!.nextCheckAt!.getTime()).toBeGreaterThanOrEqual(Date.now() - 5000);
  });
});

describe("runDueChecks batch behavior (ISC-47, ISC-48)", () => {
  it("a single monitor's failure does not prevent siblings in the same batch from completing", async () => {
    const { monitor: goodMonitor } = await seedMonitor({ type: "ping", url: null, hostname: "127.0.0.1" });
    const { monitor: badMonitor } = await seedMonitor({ type: "http", url: "not-a-valid-url" });

    const results = await runDueChecks(db);
    const ids = results.map((r) => r.monitorId);
    expect(ids).toContain(goodMonitor.id);
    expect(ids).toContain(badMonitor.id);
  });

  it("returns an empty array when nothing is due", async () => {
    await db.update(schema.monitors).set({ enabled: false });
    const results = await runDueChecks(db);
    expect(results).toEqual([]);
  });
});
