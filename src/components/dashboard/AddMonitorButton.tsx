"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MonitorForm, type MonitorFormValues } from "@/components/dashboard/MonitorForm";

const DEFAULT_VALUES: MonitorFormValues = {
  type: "http",
  name: "",
  url: "",
  hostname: "",
  port: "",
  keyword: "",
  intervalSeconds: 60,
};

export function AddMonitorButton() {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(values: MonitorFormValues) {
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { type: values.type, name: values.name || undefined, intervalSeconds: values.intervalSeconds };
      if (values.type === "http" || values.type === "keyword") body.url = values.url;
      if (values.type === "ping" || values.type === "tcp" || values.type === "ssl") body.hostname = values.hostname;
      if (values.type === "tcp") body.port = Number(values.port);
      if (values.type === "keyword") body.keyword = values.keyword;

      const res = await fetch("/api/monitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error === "monitor_cap_reached" ? "You've hit the 50-monitor limit." : "Could not create monitor.");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-black"
      >
        Add monitor
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-ink">Add monitor</h2>
              <button onClick={() => setOpen(false)} className="text-ink-soft hover:text-ink" aria-label="Close">
                ✕
              </button>
            </div>
            <div className="mt-4">
              <MonitorForm
                initialValues={DEFAULT_VALUES}
                submitting={submitting}
                error={error}
                submitLabel="Add monitor"
                onSubmit={handleSubmit}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
