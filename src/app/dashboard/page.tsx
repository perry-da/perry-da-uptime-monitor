import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { checks, incidents, monitors } from "@/db/schema";
import { getServerAccount } from "@/lib/session-server";
import { scopedToAccount } from "@/lib/tenant";
import { AddMonitorButton } from "@/components/dashboard/AddMonitorButton";
import { MonitorTabs } from "@/components/dashboard/MonitorTabs";
import { IncidentBanner } from "@/components/dashboard/IncidentBanner";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const account = await getServerAccount();
  if (!account) redirect("/login"); // ISC-81

  const accountMonitors = await db
    .select()
    .from(monitors)
    .where(scopedToAccount(monitors.accountId, account.id))
    .orderBy(desc(monitors.createdAt));

  const monitorsWithLatestCheck = await Promise.all(
    accountMonitors.map(async (m) => {
      const [latest] = await db
        .select()
        .from(checks)
        .where(eq(checks.monitorId, m.id))
        .orderBy(desc(checks.checkedAt))
        .limit(1);
      return { monitor: m, latestCheck: latest ?? null };
    })
  );

  const openIncidents = await db
    .select()
    .from(incidents)
    .where(scopedToAccount(incidents.accountId, account.id, eq(incidents.status, "open")));

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <IncidentBanner openIncidents={openIncidents} monitors={accountMonitors} />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-ink">Monitors</h1>
          <p className="mt-1 text-sm text-ink-soft">{account.email}</p>
        </div>
        <AddMonitorButton />
      </div>

      <div className="mt-8">
        <MonitorTabs items={monitorsWithLatestCheck} />
      </div>
    </main>
  );
}
