import { notFound, redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { checks, monitors } from "@/db/schema";
import { getServerAccount } from "@/lib/session-server";
import { MonitorDetail } from "@/components/dashboard/MonitorDetail";

export const dynamic = "force-dynamic";

export default async function MonitorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const account = await getServerAccount();
  if (!account) redirect("/login"); // ISC-81

  const { id } = await params;
  const monitor = await db.query.monitors.findFirst({
    where: and(eq(monitors.id, id), eq(monitors.accountId, account.id)),
  });
  if (!monitor) notFound(); // ISC-23 pattern — no cross-tenant existence leak

  // ISC-75: last 50 check results.
  const recentChecks = await db
    .select()
    .from(checks)
    .where(eq(checks.monitorId, monitor.id))
    .orderBy(desc(checks.checkedAt))
    .limit(50);

  return <MonitorDetail monitor={monitor} checks={recentChecks} />;
}
