import { NextRequest, NextResponse } from "next/server";
import { eq, count, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { monitors } from "@/db/schema";
import { requireAccount } from "@/lib/require-account";
import { scopedToAccount } from "@/lib/tenant";
import { createMonitorSchema, defaultNameFor, FREE_TIER_MONITOR_CAP } from "@/lib/monitor-schema";

// ISC-22: list only monitors owned by the authenticated account, newest first.
export async function GET(req: NextRequest) {
  const auth = await requireAccount(req);
  if ("response" in auth) return auth.response;

  const rows = await db
    .select()
    .from(monitors)
    .where(scopedToAccount(monitors.accountId, auth.account.id))
    .orderBy(desc(monitors.createdAt));

  return NextResponse.json({ data: rows, error: null }, { status: 200 });
}

// ISC-15..21, ISC-27
export async function POST(req: NextRequest) {
  const auth = await requireAccount(req);
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = createMonitorSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: "invalid_body", details: parsed.error.flatten() }, { status: 400 }); // ISC-20, ISC-21
  }

  const countRows = await db
    .select({ value: count() })
    .from(monitors)
    .where(scopedToAccount(monitors.accountId, auth.account.id));
  const currentCount = countRows[0]?.value ?? 0;

  if (currentCount >= FREE_TIER_MONITOR_CAP) {
    return NextResponse.json({ data: null, error: "monitor_cap_reached" }, { status: 402 }); // ISC-27
  }

  const input = parsed.data;
  const [monitor] = await db
    .insert(monitors)
    .values({
      accountId: auth.account.id,
      type: input.type,
      name: defaultNameFor(input),
      intervalSeconds: input.intervalSeconds,
      webhookUrl: input.webhookUrl,
      url: "url" in input ? input.url : null,
      hostname: "hostname" in input ? input.hostname : null,
      port: "port" in input ? input.port : null,
      keyword: "keyword" in input ? input.keyword : null,
      sslExpiryWarningDays: "sslExpiryWarningDays" in input ? input.sslExpiryWarningDays : undefined,
      nextCheckAt: new Date(), // due immediately — first check fires on the next cron tick
    })
    .returning();

  return NextResponse.json({ data: monitor, error: null }, { status: 201 });
}
