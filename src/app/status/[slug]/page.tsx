import { notFound } from "next/navigation";
import { getStatusPageData } from "@/lib/status-page";
import { ResponseTimeChart } from "@/components/dashboard/ResponseTimeChart";

export const dynamic = "force-dynamic"; // always reflect current status, never cache a stale "up"

function statusLabel(status: "up" | "down" | "unknown"): { text: string; className: string } {
  if (status === "up") return { text: "All systems operational", className: "bg-green-100 text-green-700" };
  if (status === "down") return { text: "Experiencing downtime", className: "bg-red-100 text-red-700" };
  return { text: "No data yet", className: "bg-gray-100 text-ink-soft" };
}

export default async function StatusPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await getStatusPageData(slug); // ISC-63, ISC-64
  if (!data) notFound();

  const badge = statusLabel(data.currentStatus);

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <div className="text-center">
        <h1 className="text-3xl font-extrabold tracking-tight text-ink">{data.name}</h1>
        <span className={`mt-4 inline-block rounded-full px-4 py-1.5 text-sm font-semibold ${badge.className}`}>
          {badge.text}
        </span>
        {data.uptimePercent90d != null && (
          <p className="mt-3 text-sm text-ink-soft">{data.uptimePercent90d}% uptime over the last 90 days</p>
        )}
      </div>

      {/* ISC-66: 90-day history bar */}
      <div className="mt-10">
        <div className="flex gap-[2px]">
          {data.historyBar.map((day) => (
            <div
              key={day.date}
              title={`${day.date}: ${day.status}`}
              className={
                "h-8 flex-1 rounded-[2px] " +
                (day.status === "up" ? "bg-green-400" : day.status === "down" ? "bg-red-400" : "bg-gray-200")
              }
            />
          ))}
        </div>
        <div className="mt-1 flex justify-between text-xs text-ink-soft">
          <span>90 days ago</span>
          <span>Today</span>
        </div>
      </div>

      {/* ISC-67: response-time chart, HTTP/keyword only */}
      {data.responseTimeSeries24h.length > 0 && (
        <div className="mt-10 rounded-2xl border border-gray-100 p-6">
          <h2 className="text-sm font-semibold text-ink">Response time (last 24h)</h2>
          <div className="mt-4">
            <ResponseTimeChart points={data.responseTimeSeries24h.map((p) => p.responseTimeMs)} />
          </div>
        </div>
      )}

      {/* ISC-70: incidents */}
      {(data.openIncidents.length > 0 || data.closedIncidents.length > 0) && (
        <div className="mt-10">
          <h2 className="text-sm font-semibold text-ink">Incident history</h2>
          <ul className="mt-4 space-y-3">
            {data.openIncidents.map((incident) => (
              <li key={incident.startedAt} className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm">
                <span className="font-semibold text-red-700">Ongoing</span>{" "}
                <span className="text-ink-soft">— started {new Date(incident.startedAt).toLocaleString()}</span>
              </li>
            ))}
            {data.closedIncidents.map((incident) => (
              <li key={incident.startedAt} className="rounded-xl border border-gray-100 px-4 py-3 text-sm">
                <span className="font-semibold text-ink">Resolved</span>{" "}
                <span className="text-ink-soft">
                  — {new Date(incident.startedAt).toLocaleString()}, down for{" "}
                  {Math.round(incident.durationSeconds / 60)} min
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-16 text-center text-xs text-ink-soft">Powered by Uptime Monitor</p>
    </main>
  );
}
