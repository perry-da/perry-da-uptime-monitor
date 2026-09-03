import Link from "next/link";
import type { incidents, monitors } from "@/db/schema";

type Incident = typeof incidents.$inferSelect;
type Monitor = typeof monitors.$inferSelect;

// ISC-78: top-level banner when any monitor has an open incident, linking to it.
export function IncidentBanner({ openIncidents, monitors: allMonitors }: { openIncidents: Incident[]; monitors: Monitor[] }) {
  if (openIncidents.length === 0) return null;

  const monitorById = new Map(allMonitors.map((m) => [m.id, m]));

  return (
    <div className="mb-8 rounded-2xl border border-red-200 bg-red-50 px-6 py-4">
      <p className="font-semibold text-red-800">
        {openIncidents.length} monitor{openIncidents.length > 1 ? "s are" : " is"} currently down
      </p>
      <ul className="mt-2 space-y-1">
        {openIncidents.map((incident) => {
          const monitor = monitorById.get(incident.monitorId);
          return (
            <li key={incident.id} className="text-sm text-red-700">
              <Link href={`/dashboard/monitors/${incident.monitorId}`} className="underline hover:no-underline">
                {monitor?.name ?? "Unknown monitor"}
              </Link>{" "}
              down since {new Date(incident.startedAt).toLocaleString()}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
