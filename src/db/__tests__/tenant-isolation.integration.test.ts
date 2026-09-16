import { describe, it, expect, beforeAll } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as schema from "../schema";
import { scopedToAccount, NotFoundInScopeError } from "../../lib/tenant";
import bcrypt from "bcryptjs";

// Real embedded-Postgres integration test (ISC-14, ISC-92..99, ISC-100) — not mocked.
// Runs the actual generated migration SQL against PGlite (WASM Postgres, no Docker/network
// required — see ISA.md Verification for why this exists: sandbox has no local Postgres,
// so this converts several DEFERRED-VERIFY items into real, tool-verified evidence.

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const client = new PGlite();
  // Apply every migration in order, not a hardcoded single file — this broke silently
  // (`column "claimed_at" does not exist`) the moment the Scheduler feature added a second
  // migration; a directory scan is the only version of this that stays correct as the
  // project grows past one migration file.
  const drizzleDir = join(import.meta.dir, "../../../drizzle");
  const files = readdirSync(drizzleDir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const migrationSql = readFileSync(join(drizzleDir, file), "utf-8");
    const statements = migrationSql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      await client.exec(stmt);
    }
  }
  db = drizzle(client, { schema });
});

describe("schema applies cleanly (ISC-96, ISC-98, ISC-99)", () => {
  it("accounts.email unique constraint is enforced at the DB layer", async () => {
    await db.insert(schema.accounts).values({ email: "dup@example.com", passwordHash: "x" });
    let threw = false;
    try {
      await db.insert(schema.accounts).values({ email: "dup@example.com", passwordHash: "y" });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true); // ISC-99
  });

  it("monitors.type enum rejects an unsupported value at the DB layer (ISC-94)", async () => {
    const [account] = await db.insert(schema.accounts).values({ email: "enum-test@example.com", passwordHash: "x" }).returning();
    let threw = false;
    try {
      // @ts-expect-error deliberately invalid type to prove the DB enum constraint, not just app validation
      await db.insert(schema.monitors).values({ accountId: account!.id, type: "carrier-pigeon", name: "bad" });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it("deleting an account cascades to ALL four named child tables — monitors, checks, incidents, tokens (ISC-93)", async () => {
    // Cato cross-vendor audit (2026-08-12) flagged that the original version of this test only
    // inserted monitors+checks while ISC-93's own wording names four tables — an overclaim. Fixed
    // to actually insert into and check all four.
    const [account] = await db.insert(schema.accounts).values({ email: "cascade-test@example.com", passwordHash: "x" }).returning();
    const [monitor] = await db.insert(schema.monitors).values({ accountId: account!.id, type: "http", url: "https://example.com", name: "m" }).returning();
    await db.insert(schema.checks).values({ monitorId: monitor!.id, accountId: account!.id, status: "up" });
    await db.insert(schema.incidents).values({ monitorId: monitor!.id, accountId: account!.id, status: "open" });
    await db.insert(schema.apiTokens).values({ accountId: account!.id, tokenHash: "x", label: "test token" });
    await db.insert(schema.sessions).values({ accountId: account!.id, expiresAt: new Date(Date.now() + 1000) });

    await db.delete(schema.accounts).where(eq(schema.accounts.id, account!.id));

    const remainingMonitors = await db.select().from(schema.monitors).where(eq(schema.monitors.accountId, account!.id));
    const remainingChecks = await db.select().from(schema.checks).where(eq(schema.checks.accountId, account!.id));
    const remainingIncidents = await db.select().from(schema.incidents).where(eq(schema.incidents.accountId, account!.id));
    const remainingTokens = await db.select().from(schema.apiTokens).where(eq(schema.apiTokens.accountId, account!.id));
    const remainingSessions = await db.select().from(schema.sessions).where(eq(schema.sessions.accountId, account!.id));
    expect(remainingMonitors.length).toBe(0);
    expect(remainingChecks.length).toBe(0);
    expect(remainingIncidents.length).toBe(0);
    expect(remainingTokens.length).toBe(0);
    expect(remainingSessions.length).toBe(0);
  });
});

describe("tenant isolation via scopedToAccount (ISC-14, ISC-23, ISC-100)", () => {
  it("account A can never read account B's monitor through the scoped-query helper", async () => {
    const [accountA] = await db.insert(schema.accounts).values({ email: "tenant-a@example.com", passwordHash: "x" }).returning();
    const [accountB] = await db.insert(schema.accounts).values({ email: "tenant-b@example.com", passwordHash: "x" }).returning();

    const [monitorB] = await db
      .insert(schema.monitors)
      .values({ accountId: accountB!.id, type: "http", url: "https://b-only.example.com", name: "B's monitor" })
      .returning();

    // Exactly the pattern route handlers use: scopedToAccount(monitors.accountId, callerAccountId, eq(monitors.id, targetId))
    const rows = await db
      .select()
      .from(schema.monitors)
      .where(scopedToAccount(schema.monitors.accountId, accountA!.id, eq(schema.monitors.id, monitorB!.id)));

    expect(rows.length).toBe(0); // ISC-14: zero cross-tenant rows returned
  });

  it("account B can read its own monitor through the same helper", async () => {
    const [accountC] = await db.insert(schema.accounts).values({ email: "tenant-c@example.com", passwordHash: "x" }).returning();
    const [monitorC] = await db
      .insert(schema.monitors)
      .values({ accountId: accountC!.id, type: "http", url: "https://c-only.example.com", name: "C's monitor" })
      .returning();

    const rows = await db
      .select()
      .from(schema.monitors)
      .where(scopedToAccount(schema.monitors.accountId, accountC!.id, eq(schema.monitors.id, monitorC!.id)));

    expect(rows.length).toBe(1);
    expect(rows[0]!.id).toBe(monitorC!.id);
  });

  it("account A's delete-by-id against account B's monitor affects zero rows (IDOR check, ISC-100)", async () => {
    const [accountD] = await db.insert(schema.accounts).values({ email: "tenant-d@example.com", passwordHash: "x" }).returning();
    const [accountE] = await db.insert(schema.accounts).values({ email: "tenant-e@example.com", passwordHash: "x" }).returning();
    const [monitorE] = await db
      .insert(schema.monitors)
      .values({ accountId: accountE!.id, type: "http", url: "https://e-only.example.com", name: "E's monitor" })
      .returning();

    // Same single-query delete pattern as DELETE /api/monitors/[id] — WHERE id = ? AND account_id = ?
    // in one query, not fetch-then-check (advisor's TOCTOU concern).
    await db
      .delete(schema.monitors)
      .where(scopedToAccount(schema.monitors.accountId, accountD!.id, eq(schema.monitors.id, monitorE!.id)));

    const stillExists = await db.select().from(schema.monitors).where(eq(schema.monitors.id, monitorE!.id));
    expect(stillExists.length).toBe(1); // E's monitor survives D's delete attempt
  });
});

describe("password hashing (ISC-7)", () => {
  it("stored password_hash never contains the plaintext password", async () => {
    const plaintext = "correct horse battery staple";
    const hash = await bcrypt.hash(plaintext, 12);
    const [account] = await db.insert(schema.accounts).values({ email: "hash-test@example.com", passwordHash: hash }).returning();

    const row = await db.query.accounts.findFirst({ where: eq(schema.accounts.id, account!.id) });
    expect(row!.passwordHash).not.toBe(plaintext);
    expect(row!.passwordHash.includes(plaintext)).toBe(false);
    expect(await bcrypt.compare(plaintext, row!.passwordHash)).toBe(true);
  });
});
