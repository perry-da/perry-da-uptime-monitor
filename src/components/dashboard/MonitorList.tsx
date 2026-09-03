import Link from "next/link";
import type { monitors, checks } from "@/db/schema";

type Monitor = typeof monitors.$inferSelect;
type Check = typeof checks.$inferSelect;

function StatusBadge({ monitor, latestCheck }: { monitor: Monitor; latestCheck: Check | null }) {
  if (!monitor.enabled) {
    return <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-ink-soft">Paused</span>;
  }
  if (!latestCheck) {
    return <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-ink-soft">Pending</span>;
  }
  if (latestCheck.status === "up") {
    return <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">Up</span>;
  }
  return <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">Down</span>;
}

function targetOf(monitor: Monitor): string {
  return monitor.url ?? monitor.hostname ?? "";
}

export function MonitorList({ items }: { items: { monitor: Monitor; latestCheck: Check | null }[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 px-8 py-16 text-center">
        <p className="text-ink-soft">No monitors yet. Add your first URL to get started.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-100">
      <table className="w-full text-left text-sm">
        <thead className="bg-cream text-xs font-semibold uppercase tracking-wide text-ink-soft">
          <tr>
            <th className="px-5 py-3">Monitor</th>
            <th className="px-5 py-3">Status</th>
            <th className="px-5 py-3">Response time</th>
            <th className="px-5 py-3">Last checked</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map(({ monitor, latestCheck }) => (
            <tr key={monitor.id} className="transition hover:bg-cream/60">
              <td className="px-5 py-4">
                <Link href={`/dashboard/monitors/${monitor.id}`} className="font-semibold text-ink hover:underline">
                  {monitor.name}
                </Link>
                <div className="text-xs text-ink-soft">
                  {monitor.type} · {targetOf(monitor)}
                </div>
              </td>
              <td className="px-5 py-4">
                <StatusBadge monitor={monitor} latestCheck={latestCheck} />
              </td>
              <td className="px-5 py-4 text-ink-soft">
                {latestCheck?.responseTimeMs != null ? `${latestCheck.responseTimeMs}ms` : "N/A"}
              </td>
              <td className="px-5 py-4 text-ink-soft">
                {latestCheck ? new Date(latestCheck.checkedAt).toLocaleString() : "Never"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
