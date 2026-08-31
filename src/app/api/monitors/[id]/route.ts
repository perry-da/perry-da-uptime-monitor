import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { monitors } from "@/db/schema";
import { requireAccount } from "@/lib/require-account";
import { scopedToAccount } from "@/lib/tenant";

async function findOwnedMonitor(accountId: string, monitorId: string) {
  return db.query.monitors.findFirst({
    where: and(eq(monitors.id, monitorId), eq(monitors.accountId, accountId)),
  });
}

// ISC-23: 404 (not 403) for a monitor owned by another account — no existence leak.
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  const auth = await requireAccount(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;
  const monitor = await findOwnedMonitor(auth.account.id, id);
  if (!monitor) {
    return NextResponse.json({ data: null, error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ data: monitor, error: null }, { status: 200 });
}

const patchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  intervalSeconds: z.number().int().min(60).optional(), // ISC-24, ISC-26
  enabled: z.boolean().optional(), // ISC-29: pause/resume
  slug: z.string().trim().min(1).max(80).optional(), // ISC-68
  published: z.boolean().optional(),
  webhookUrl: z.string().url().optional(),
});

// ISC-24, ISC-29, ISC-68
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const auth = await requireAccount(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;
  const existing = await findOwnedMonitor(auth.account.id, id);
  if (!existing) {
    return NextResponse.json({ data: null, error: "not_found" }, { status: 404 }); // ISC-23
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: "invalid_body" }, { status: 400 });
  }

  if (parsed.data.slug) {
    const collision = await db.query.monitors.findFirst({
      where: eq(monitors.slug, parsed.data.slug),
    });
    if (collision && collision.id !== existing.id) {
      return NextResponse.json({ data: null, error: "slug_taken" }, { status: 409 }); // ISC-68
    }
  }

  const updatedRows = await db
    .update(monitors)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(scopedToAccount(monitors.accountId, auth.account.id, eq(monitors.id, id)))
    .returning();

  return NextResponse.json({ data: updatedRows[0] ?? null, error: null }, { status: 200 });
}

// ISC-25: delete cascades to check-history rows via FK ON DELETE CASCADE (see schema.ts).
export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const auth = await requireAccount(req);
  if ("response" in auth) return auth.response;

  const { id } = await params;
  const existing = await findOwnedMonitor(auth.account.id, id);
  if (!existing) {
    return NextResponse.json({ data: null, error: "not_found" }, { status: 404 }); // ISC-23
  }

  await db.delete(monitors).where(scopedToAccount(monitors.accountId, auth.account.id, eq(monitors.id, id)));
  return NextResponse.json({ data: { deleted: true }, error: null }, { status: 200 });
}
