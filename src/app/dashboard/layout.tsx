import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { monitors } from "@/db/schema";
import { getServerAccount } from "@/lib/session-server";
import { scopedToAccount } from "@/lib/tenant";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { DashboardShell } from "@/components/dashboard/DashboardShell";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const account = await getServerAccount();
  if (!account) redirect("/login"); // ISC-81

  const accountMonitors = await db
    .select({ id: monitors.id })
    .from(monitors)
    .where(scopedToAccount(monitors.accountId, account.id));

  return (
    <DashboardShell sidebar={<DashboardSidebar email={account.email} monitorCount={accountMonitors.length} />}>
      {children}
    </DashboardShell>
  );
}
