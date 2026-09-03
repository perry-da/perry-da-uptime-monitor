import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { checks, incidents, monitors } from "@/db/schema";
import { getServerAccount } from "@/lib/session-server";
import { scopedToAccount } from "@/lib/tenant";
import { AddMonitorButton } from "@/components/dashboard/AddMonitorButton";
import { MonitorTabs } from "@/components/dashboard/MonitorTabs";
import { IncidentBanner } from "@/components/dashboard/IncidentBanner";

export const dynamic = "force-dynamic";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function displayName(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

export default async function DashboardPage() {
  // Auth is enforced by dashboard/layout.tsx; getServerAccount() here is guaranteed non-null.
  const account = (await getServerAccount())!;

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

  const upCount = monitorsWithLatestCheck.filter((i) => i.latestCheck?.status === "up").length;
  const downCount = monitorsWithLatestCheck.filter((i) => i.latestCheck?.status === "down").length;

  const stats = [
    { label: "Active monitors", value: accountMonitors.length, caption: "on your account" },
    { label: "Up now", value: upCount, caption: "responding normally" },
    { label: "Down now", value: downCount, caption: "needs attention" },
    { label: "Open incidents", value: openIncidents.length, caption: "unresolved" },
  ];

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <IncidentBanner openIncidents={openIncidents} monitors={accountMonitors} />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-ink">
            {greeting()}, {displayName(account.email)}
          </h1>
          <p className="mt-1 text-sm text-ink-soft">{account.email}</p>
        </div>
        <AddMonitorButton />
      </div>

      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-2xl border border-gray-100 bg-white p-5">
            <p className="text-sm font-medium text-ink-soft">{stat.label}</p>
            <p className="mt-1 text-3xl font-extrabold text-ink">{stat.value}</p>
            <p className="mt-1 text-xs text-ink-soft">{stat.caption}</p>
          </div>
        ))}
      </div>

      <div className="mt-8">
        <MonitorTabs items={monitorsWithLatestCheck} />
      </div>
    </main>
  );
}
