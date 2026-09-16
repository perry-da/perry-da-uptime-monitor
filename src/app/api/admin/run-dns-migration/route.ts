import { NextRequest, NextResponse } from "next/server";
import postgres from "postgres";

// TEMPORARY route — same pattern as the earlier one-off migration route
// documented in ISA.md (2026-08-12): Vercel's Management API never exposes
// the decrypted connection string, only the running app can see it, so this
// is the only way to apply a new migration to the live Neon database without
// a persistent CLI/CI pipeline. Applies ONLY the 0003 migration (the DNS
// enum value + dns_snapshots/dns_changes tables) — earlier migrations are
// already live. Delete this route once run once, successfully, in production.
const STATEMENTS = [
  `CREATE TYPE "public"."dns_record_type" AS ENUM('A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME')`,
  `ALTER TYPE "public"."monitor_type" ADD VALUE 'dns'`,
  `CREATE TABLE "dns_changes" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "monitor_id" uuid NOT NULL,
    "record_type" "dns_record_type" NOT NULL,
    "old_values" text,
    "new_values" text NOT NULL,
    "detected_at" timestamp with time zone DEFAULT now() NOT NULL
  )`,
  `CREATE TABLE "dns_snapshots" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "monitor_id" uuid NOT NULL,
    "record_type" "dns_record_type" NOT NULL,
    "values" text NOT NULL,
    "checked_at" timestamp with time zone DEFAULT now() NOT NULL
  )`,
  `ALTER TABLE "dns_changes" ADD CONSTRAINT "dns_changes_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action`,
  `ALTER TABLE "dns_snapshots" ADD CONSTRAINT "dns_snapshots_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action`,
  `CREATE INDEX "dns_changes_monitor_detected_idx" ON "dns_changes" USING btree ("monitor_id","detected_at")`,
  `CREATE INDEX "dns_snapshots_monitor_record_checked_idx" ON "dns_snapshots" USING btree ("monitor_id","record_type","checked_at")`,
];

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get("authorization");
  if (!secret || provided !== `Bearer ${secret}`) {
    return NextResponse.json({ data: null, error: "unauthorized" }, { status: 401 });
  }

  const connectionString =
    process.env.DATABASE_URL || process.env.DB_POSTGRES_URL || process.env.DB_DATABASE_URL;
  if (!connectionString) {
    return NextResponse.json({ data: null, error: "no_connection_string" }, { status: 500 });
  }

  const client = postgres(connectionString);
  const applied: string[] = [];
  try {
    for (const stmt of STATEMENTS) {
      // ALTER TYPE ... ADD VALUE cannot run in the same transaction as a
      // statement that uses the new value — running each statement as its
      // own implicit (non-batched) query, not one wrapped transaction, sidesteps this.
      await client.unsafe(stmt);
      applied.push(stmt.slice(0, 60));
    }
    return NextResponse.json({ data: { applied: applied.length, statements: applied }, error: null }, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { data: { applied: applied.length }, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  } finally {
    await client.end();
  }
}
