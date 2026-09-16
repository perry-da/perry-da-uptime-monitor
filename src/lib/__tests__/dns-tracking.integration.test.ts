import { describe, it, expect, beforeAll } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as schema from "../../db/schema";
import { runDnsCheckAndRecordHistory, getDnsTimeline, serialize } from "../dns-tracking";
import { DNS_RECORD_TYPES } from "../checks/dns";

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

async function seedDnsMonitor() {
  const [account] = await db
    .insert(schema.accounts)
    .values({ email: `dns-${crypto.randomUUID()}@example.com`, passwordHash: "x" })
    .returning();
  const [monitor] = await db
    .insert(schema.monitors)
    .values({
      accountId: account!.id,
      type: "dns",
      hostname: "example.com",
      name: "dns test",
      intervalSeconds: 60,
    })
    .returning();
  return monitor!;
}

describe("serialize (comparison-key stability)", () => {
  it("produces the same key regardless of input order", () => {
    expect(serialize(["b", "a", "c"])).toBe(serialize(["c", "b", "a"]));
  });

  it("produces a different key for genuinely different values", () => {
    expect(serialize(["a", "b"])).not.toBe(serialize(["a", "b", "c"]));
  });
});

describe("runDnsCheckAndRecordHistory (real DNS + real pglite persistence)", () => {
  it("records a fresh snapshot and a change row (old=null) on the very first check", async () => {
    const monitor = await seedDnsMonitor();
    const result = await runDnsCheckAndRecordHistory(db, monitor.id, "example.com");
    expect(result.status).toBe("up");

    const snapshots = await db
      .select()
      .from(schema.dnsSnapshots)
      .where(eq(schema.dnsSnapshots.monitorId, monitor.id));
    // one snapshot row per record type tracked
    expect(snapshots.length).toBe(DNS_RECORD_TYPES.length);

    const changes = await db
      .select()
      .from(schema.dnsChanges)
      .where(eq(schema.dnsChanges.monitorId, monitor.id));
    expect(changes.length).toBe(DNS_RECORD_TYPES.length);
    for (const change of changes) {
      expect(change.oldValues).toBeNull(); // first-ever snapshot for this record type
    }
  });

  it("does not record a new change on a second check with identical real-world results", async () => {
    const monitor = await seedDnsMonitor();
    await runDnsCheckAndRecordHistory(db, monitor.id, "example.com");
    const afterFirst = await db
      .select()
      .from(schema.dnsChanges)
      .where(eq(schema.dnsChanges.monitorId, monitor.id));

    await runDnsCheckAndRecordHistory(db, monitor.id, "example.com");
    const afterSecond = await db
      .select()
      .from(schema.dnsChanges)
      .where(eq(schema.dnsChanges.monitorId, monitor.id));

    // example.com's records are stable — a real second lookup should not add
    // new change rows (a flaky/rotating DNS answer would be a genuine, if
    // rare, source of test flake; documented here rather than silently
    // tolerated).
    expect(afterSecond.length).toBe(afterFirst.length);

    // but a fresh snapshot row IS written every check, regardless of change
    const snapshots = await db
      .select()
      .from(schema.dnsSnapshots)
      .where(eq(schema.dnsSnapshots.monitorId, monitor.id));
    expect(snapshots.length).toBe(DNS_RECORD_TYPES.length * 2);
  });

  it("records down (not a thrown error) for an unresolvable hostname, still writing snapshots", async () => {
    const monitor = await seedDnsMonitor();
    const result = await runDnsCheckAndRecordHistory(db, monitor.id, "this-host-does-not-exist.invalid");
    expect(result.status).toBe("down");
    expect(result.failureReason).toBeDefined();

    const snapshots = await db
      .select()
      .from(schema.dnsSnapshots)
      .where(eq(schema.dnsSnapshots.monitorId, monitor.id));
    expect(snapshots.length).toBe(DNS_RECORD_TYPES.length);
  });
});

describe("getDnsTimeline", () => {
  it("returns this monitor's changes only, most-recent-first", async () => {
    const monitor = await seedDnsMonitor();
    const other = await seedDnsMonitor();
    await runDnsCheckAndRecordHistory(db, monitor.id, "example.com");
    await runDnsCheckAndRecordHistory(db, other.id, "example.com");

    const timeline = await getDnsTimeline(db, monitor.id);
    expect(timeline.length).toBe(DNS_RECORD_TYPES.length);
    expect(timeline.every((c) => c.monitorId === monitor.id)).toBe(true);
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i - 1]!.detectedAt.getTime()).toBeGreaterThanOrEqual(timeline[i]!.detectedAt.getTime());
    }
  });
});
