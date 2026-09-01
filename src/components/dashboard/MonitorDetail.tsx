"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import type { monitors, checks } from "@/db/schema";
import { ResponseTimeChart } from "@/components/dashboard/ResponseTimeChart";

type Monitor = typeof monitors.$inferSelect;
type Check = typeof checks.$inferSelect;

function targetOf(monitor: Monitor): string {
  return monitor.url ?? (monitor.hostname ? `${monitor.hostname}${monitor.port ? ":" + monitor.port : ""}` : "");
}

export function MonitorDetail({ monitor, checks: recentChecks }: { monitor: Monitor; checks: Check[] }) {
  const router = useRouter();
  const [name, setName] = useState(monitor.name);
  const [intervalSeconds, setIntervalSeconds] = useState(monitor.intervalSeconds);
  const [webhookUrl, setWebhookUrl] = useState(monitor.webhookUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const responseTimePoints = recentChecks
    .slice()
    .reverse()
    .map((c) => c.responseTimeMs)
    .filter((v): v is number => v != null);

  async function patchMonitor(body: Record<string, unknown>) {
    setError(null);
    const res = await fetch(`/api/monitors/${monitor.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setError("Update failed.");
      return false;
    }
    router.refresh();
    return true;
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (intervalSeconds < 60) {
      setError("Interval must be at least 60 seconds.");
      return;
    }
    setSaving(true);
    await patchMonitor({ name, intervalSeconds, webhookUrl: webhookUrl || undefined });
    setSaving(false);
  }

  async function togglePause() {
    await patchMonitor({ enabled: !monitor.enabled }); // ISC-79: pause/resume
  }

  async function handleDelete() {
    setDeleting(true);
    const res = await fetch(`/api/monitors/${monitor.id}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/dashboard");
      router.refresh();
    } else {
      setError("Delete failed.");
      setDeleting(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/dashboard" className="text-sm text-ink-soft hover:text-ink">
        ← Back to monitors
      </Link>

      <div className="mt-4 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-ink">{monitor.name}</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {monitor.type} · {targetOf(monitor)}
          </p>
        </div>
        <span
          className={
            "rounded-full px-3 py-1 text-xs font-semibold " +
            (monitor.enabled ? "bg-green-100 text-green-700" : "bg-gray-100 text-ink-soft")
          }
        >
          {monitor.enabled ? "Active" : "Paused"}
        </span>
      </div>

      {(monitor.type === "http" || monitor.type === "keyword") && (
        <div className="mt-8 rounded-2xl border border-gray-100 p-6">
          <h2 className="text-sm font-semibold text-ink">Response time</h2>
          <div className="mt-4">
            <ResponseTimeChart points={responseTimePoints} />
          </div>
        </div>
      )}

      <div className="mt-8 rounded-2xl border border-gray-100 p-6">
        <h2 className="text-sm font-semibold text-ink">Recent checks</h2>
        <div className="mt-4 overflow-hidden rounded-xl border border-gray-100">
          <table className="w-full text-left text-sm">
            <thead className="bg-cream text-xs font-semibold uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="px-4 py-2">Time</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Response time</th>
                <th className="px-4 py-2">Failure reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {recentChecks.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-ink-soft">
                    No checks yet — the first one runs on the next scheduled tick.
                  </td>
                </tr>
              ) : (
                recentChecks.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-2 text-ink-soft">{new Date(c.checkedAt).toLocaleString()}</td>
                    <td className="px-4 py-2">
                      <span className={c.status === "up" ? "font-medium text-green-700" : "font-medium text-red-700"}>
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-ink-soft">{c.responseTimeMs != null ? `${c.responseTimeMs}ms` : "—"}</td>
                    <td className="px-4 py-2 text-ink-soft">{c.failureReason ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <form onSubmit={handleSave} className="mt-8 space-y-4 rounded-2xl border border-gray-100 p-6">
        <h2 className="text-sm font-semibold text-ink">Settings</h2>
        <label className="block">
          <span className="text-sm font-medium text-ink">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-ink outline-none focus:border-ink"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-ink">Check interval (seconds)</span>
          <input
            type="number"
            min={60}
            value={intervalSeconds}
            onChange={(e) => setIntervalSeconds(Number(e.target.value))}
            className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-ink outline-none focus:border-ink"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-ink">Webhook URL (optional)</span>
          <input
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://hooks.example.com/..."
            className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-ink outline-none focus:border-ink"
          />
        </label>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex flex-wrap gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-black disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          <button
            type="button"
            onClick={togglePause}
            className="rounded-full border border-gray-300 px-5 py-2.5 text-sm font-semibold text-ink transition hover:border-gray-400"
          >
            {monitor.enabled ? "Pause" : "Resume"}
          </button>

          {!confirmingDelete ? (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="ml-auto rounded-full px-5 py-2.5 text-sm font-semibold text-red-600 transition hover:bg-red-50"
            >
              Delete monitor
            </button>
          ) : (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-sm text-ink-soft">Delete this monitor and all its history?</span>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
              >
                {deleting ? "Deleting…" : "Confirm delete"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="rounded-full border border-gray-300 px-4 py-2 text-sm font-semibold text-ink hover:border-gray-400"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </form>
    </main>
  );
}
