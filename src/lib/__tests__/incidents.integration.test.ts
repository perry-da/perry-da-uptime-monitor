import { describe, it, expect, beforeAll } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as schema from "../../db/schema";
import { evaluateIncidentTransition } from "../incidents";
import { FakeEmailSender } from "../alerts/email-sender";

// Real embedded-Postgres integration test (ISC-51, 51.1, 52..62). Advisor-driven design:
// debounce/recovery state is reconstructed from persisted `checks` rows (not in-memory),
// span is computed from recorded `checked_at` timestamps (not wall-clock-at-test-run), and
// the 90s boundary gets an explicit pass/fail pair rather than only a "works" case.

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

async function seedMonitorWithAccount(overrides: Partial<typeof schema.monitors.$inferInsert> = {}) {
  const [account] = await db
    .insert(schema.accounts)
    .values({ email: `incidents-${crypto.randomUUID()}@example.com`, passwordHash: "x" })
    .returning();
  const [monitor] = await db
    .insert(schema.monitors)
    .values({
      accountId: account!.id,
      type: "http",
      url: "https://example.com",
      name: "incident-test monitor",
      intervalSeconds: 60,
      ...overrides,
    })
    .returning();
  return { account: account!, monitor: monitor! };
}

async function insertCheck(monitorId: string, accountId: string, status: "up" | "down", checkedAt: Date, failureReason?: string) {
  await db.insert(schema.checks).values({ monitorId, accountId, status, checkedAt, failureReason: failureReason as never });
}

describe("debounce boundary (ISC-51, ISC-51.1) — the advisor's specific correctness risk", () => {
  it("does NOT open an incident when 2 consecutive downs span exactly 60s (< 90s threshold)", async () => {
    const { account, monitor } = await seedMonitorWithAccount({ intervalSeconds: 60 });
    const t0 = new Date(Date.now() - 120_000);
    await insertCheck(monitor.id, account.id, "down", t0);
    await insertCheck(monitor.id, account.id, "down", new Date(t0.getTime() + 60_000)); // span = 60s

    const result = await evaluateIncidentTransition(db, monitor.id, account.id);
    expect(result.action).toBe("none");

    const openIncident = await db.query.incidents.findFirst({ where: eq(schema.incidents.monitorId, monitor.id) });
    expect(openIncident).toBeUndefined();
  });

  it("DOES open an incident on the 3rd consecutive down once span reaches 120s (>= 90s threshold)", async () => {
    const { account, monitor } = await seedMonitorWithAccount({ intervalSeconds: 60 });
    const t0 = new Date(Date.now() - 120_000);
    await insertCheck(monitor.id, account.id, "down", t0);
    await insertCheck(monitor.id, account.id, "down", new Date(t0.getTime() + 60_000));
    await insertCheck(monitor.id, account.id, "down", new Date(t0.getTime() + 120_000), "conn_refused");

    const result = await evaluateIncidentTransition(db, monitor.id, account.id);
    expect(result.action).toBe("opened");

    const openIncident = await db.query.incidents.findFirst({ where: eq(schema.incidents.monitorId, monitor.id) });
    expect(openIncident?.status).toBe("open");
  });

  it("opens on the 2nd consecutive down for a long-interval monitor (600s already exceeds 90s span)", async () => {
    const { account, monitor } = await seedMonitorWithAccount({ intervalSeconds: 600 });
    const t0 = new Date(Date.now() - 600_000);
    await insertCheck(monitor.id, account.id, "down", t0);
    await insertCheck(monitor.id, account.id, "down", new Date(t0.getTime() + 600_000));

    const result = await evaluateIncidentTransition(db, monitor.id, account.id);
    expect(result.action).toBe("opened"); // ISC-51.1: base 2-count rule still satisfied here
  });

  it("a single down check never opens an incident regardless of span", async () => {
    const { account, monitor } = await seedMonitorWithAccount({ intervalSeconds: 60 });
    await insertCheck(monitor.id, account.id, "down", new Date());
    const result = await evaluateIncidentTransition(db, monitor.id, account.id);
    expect(result.action).toBe("none");
  });
});

describe("recovery (ISC-52, ISC-56)", () => {
  it("closes an open incident on the first up check and computes duration_seconds", async () => {
    const { account, monitor } = await seedMonitorWithAccount({ intervalSeconds: 60 });
    const [incident] = await db
      .insert(schema.incidents)
      .values({ monitorId: monitor.id, accountId: account.id, status: "open", startedAt: new Date(Date.now() - 300_000) })
      .returning();
    await insertCheck(monitor.id, account.id, "up", new Date());

    const result = await evaluateIncidentTransition(db, monitor.id, account.id);
    expect(result.action).toBe("recovered");

    const row = await db.query.incidents.findFirst({ where: eq(schema.incidents.id, incident!.id) });
    expect(row!.status).toBe("closed");
    expect(row!.durationSeconds).toBeGreaterThanOrEqual(290);
  });

  it("an up check with no open incident is a no-op, not a spurious recovery", async () => {
    const { account, monitor } = await seedMonitorWithAccount();
    await insertCheck(monitor.id, account.id, "up", new Date());
    const result = await evaluateIncidentTransition(db, monitor.id, account.id);
    expect(result.action).toBe("still_closed");
  });
});

describe("alerting (ISC-53, ISC-54, ISC-55, ISC-58, ISC-62)", () => {
  it("sends exactly one open-alert email to the owning account, not on every subsequent down check", async () => {
    const { account, monitor } = await seedMonitorWithAccount({ intervalSeconds: 60 });
    const sender = new FakeEmailSender();
    const t0 = new Date(Date.now() - 300_000);
    await insertCheck(monitor.id, account.id, "down", t0);
    await insertCheck(monitor.id, account.id, "down", new Date(t0.getTime() + 60_000));
    await insertCheck(monitor.id, account.id, "down", new Date(t0.getTime() + 120_000)); // opens here

    await evaluateIncidentTransition(db, monitor.id, account.id, sender);
    expect(sender.sent.length).toBe(1); // ISC-53
    expect(sender.sent[0]!.to).toBe(account.email); // ISC-62

    // Simulate more failed checks while the incident stays open — ISC-55: no duplicate send.
    await insertCheck(monitor.id, account.id, "down", new Date(t0.getTime() + 180_000));
    await evaluateIncidentTransition(db, monitor.id, account.id, sender);
    expect(sender.sent.length).toBe(1); // still 1, not 2
  });

  it("sends exactly one recovery email on the up transition", async () => {
    const { account, monitor } = await seedMonitorWithAccount({ intervalSeconds: 60 });
    const sender = new FakeEmailSender();
    await db.insert(schema.incidents).values({ monitorId: monitor.id, accountId: account.id, status: "open", startedAt: new Date(Date.now() - 60_000) });
    await insertCheck(monitor.id, account.id, "up", new Date());

    await evaluateIncidentTransition(db, monitor.id, account.id, sender);
    expect(sender.sent.length).toBe(1); // ISC-54
    expect(sender.sent[0]!.to).toBe(account.email);
  });
});

describe("webhook independence (ISC-60, ISC-61)", () => {
  it("a monitor with no webhook_url configured does not attempt a webhook call and email still sends", async () => {
    const { account, monitor } = await seedMonitorWithAccount({ intervalSeconds: 60, webhookUrl: null });
    const sender = new FakeEmailSender();
    const t0 = new Date(Date.now() - 120_000);
    await insertCheck(monitor.id, account.id, "down", t0);
    await insertCheck(monitor.id, account.id, "down", new Date(t0.getTime() + 120_000));

    const result = await evaluateIncidentTransition(db, monitor.id, account.id, sender);
    expect(result.action).toBe("opened");
    expect(sender.sent.length).toBe(1); // email channel unaffected by absent webhook
  });

  it("a webhook pointed at an unreachable host does not throw or block the email send (ISC-61)", async () => {
    const { account, monitor } = await seedMonitorWithAccount({
      intervalSeconds: 60,
      webhookUrl: "http://127.0.0.1:1", // closed/reserved port — guaranteed connection failure
    });
    const sender = new FakeEmailSender();
    const t0 = new Date(Date.now() - 120_000);
    await insertCheck(monitor.id, account.id, "down", t0);
    await insertCheck(monitor.id, account.id, "down", new Date(t0.getTime() + 120_000));

    const result = await evaluateIncidentTransition(db, monitor.id, account.id, sender);
    expect(result.action).toBe("opened"); // did not throw
    expect(sender.sent.length).toBe(1); // email still sent despite webhook failure
  });
});

describe("duplicate-open race guard (ISC-50-style, partial unique index)", () => {
  it("a second evaluation call while an incident is already open does not create a second incidents row", async () => {
    const { account, monitor } = await seedMonitorWithAccount({ intervalSeconds: 60 });
    const t0 = new Date(Date.now() - 120_000);
    await insertCheck(monitor.id, account.id, "down", t0);
    await insertCheck(monitor.id, account.id, "down", new Date(t0.getTime() + 120_000));

    const first = await evaluateIncidentTransition(db, monitor.id, account.id);
    const second = await evaluateIncidentTransition(db, monitor.id, account.id);
    expect(first.action).toBe("opened");
    expect(second.action).toBe("still_open");

    const allIncidents = await db.select().from(schema.incidents).where(eq(schema.incidents.monitorId, monitor.id));
    expect(allIncidents.length).toBe(1);
  });
});
