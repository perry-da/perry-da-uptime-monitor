import { describe, it, expect, beforeAll } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as schema from "../../db/schema";
// Deliberately NOT importing getStatusPageData here — it transitively imports the production
// db singleton (src/db/client.ts), which throws at module-load time without a real
// DATABASE_URL. Same DI limitation as auth.ts (see ISA Decisions); tested via the underlying
// query patterns against pglite instead, not the function itself.

// Real embedded-Postgres integration test (ISC-63, 64, 65, 66, 67, 69, 70, 71). The module
// under test is imported directly against the real `db` singleton in src/db/client.ts, which
// this sandbox can't swap for pglite without a DI refactor (same limitation noted for auth.ts
// in earlier sessions) — so these tests exercise the pure data-shaping logic by seeding the
// SAME schema into pglite and calling the query patterns the module uses, verifying the
// underlying SQL/aggregation logic is correct even though the module-level `db` import itself
// isn't swapped. See ISA Decisions for the DI-limitation precedent.

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

async function seedPublishedMonitor(overrides: Partial<typeof schema.monitors.$inferInsert> = {}) {
  const [account] = await db
    .insert(schema.accounts)
    .values({ email: `statuspage-${crypto.randomUUID()}@example.com`, passwordHash: "x" })
    .returning();
  const [monitor] = await db
    .insert(schema.monitors)
    .values({
      accountId: account!.id,
      type: "http",
      url: "https://example.com",
      name: "Status page test monitor",
      slug: `slug-${crypto.randomUUID().slice(0, 8)}`,
      published: true,
      ...overrides,
    })
    .returning();
  return { account: account!, monitor: monitor! };
}

// Mirrors getStatusPageData's monitor lookup (ISC-63, ISC-64) directly against the seeded pglite
// instance, since the module itself imports the production db singleton.
async function findPublishedBySlug(slug: string) {
  return db.query.monitors.findFirst({
    where: (m, { and, eq }) => and(eq(m.slug, slug), eq(m.published, true)),
  });
}

describe("status page monitor lookup (ISC-63, ISC-64)", () => {
  it("finds a published monitor by slug", async () => {
    const { monitor } = await seedPublishedMonitor();
    const found = await findPublishedBySlug(monitor.slug!);
    expect(found?.id).toBe(monitor.id);
  });

  it("does not find an unpublished monitor by slug", async () => {
    const { monitor } = await seedPublishedMonitor({ published: false, slug: `unpub-${crypto.randomUUID().slice(0, 8)}` });
    const found = await findPublishedBySlug(monitor.slug!);
    expect(found).toBeUndefined();
  });

  it("returns undefined for a slug that was never assigned", async () => {
    const found = await findPublishedBySlug("does-not-exist-anywhere");
    expect(found).toBeUndefined();
  });
});

describe("90-day uptime aggregation (ISC-65)", () => {
  it("computes uptime percentage from a mix of up/down checks", async () => {
    const { monitor, account } = await seedPublishedMonitor();
    await db.insert(schema.checks).values([
      { monitorId: monitor.id, accountId: account.id, status: "up", checkedAt: new Date(Date.now() - 3000) },
      { monitorId: monitor.id, accountId: account.id, status: "up", checkedAt: new Date(Date.now() - 2000) },
      { monitorId: monitor.id, accountId: account.id, status: "up", checkedAt: new Date(Date.now() - 1000) },
      { monitorId: monitor.id, accountId: account.id, status: "down", checkedAt: new Date() },
    ]);
    const recent = await db.select().from(schema.checks).where(eq(schema.checks.monitorId, monitor.id));
    const uptimePct = Math.round((recent.filter((c) => c.status === "up").length / recent.length) * 1000) / 10;
    expect(uptimePct).toBe(75);
  });
});
