import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { incidents, monitors } from "@/db/schema";
import { requireAccount } from "@/lib/require-account";

// ISC-57: incident history for a monitor, scoped to the owning account.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAccount(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;
  const owned = await db.query.monitors.findFirst({
    where: and(eq(monitors.id, id), eq(monitors.accountId, auth.account.id)),
  });
  if (!owned) {
    return NextResponse.json({ data: null, error: "not_found" }, { status: 404 }); // ISC-23 pattern
  }

  const rows = await db
    .select()
    .from(incidents)
    .where(and(eq(incidents.monitorId, id), eq(incidents.accountId, auth.account.id)))
    .orderBy(desc(incidents.startedAt));

  return NextResponse.json({ data: rows, error: null }, { status: 200 });
}
