"use client";

import { useState } from "react";

export type MonitorType = "http" | "ping" | "tcp" | "keyword" | "ssl";

export interface MonitorFormValues {
  type: MonitorType;
  name: string;
  url: string;
  hostname: string;
  port: string;
  keyword: string;
  intervalSeconds: number;
}

const MIN_INTERVAL_SECONDS = 60; // mirrors src/lib/monitor-schema.ts (ISC-77)

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

// ISC-77: client-side validation mirrors server-side rules before submit.
function validate(values: MonitorFormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  if (values.intervalSeconds < MIN_INTERVAL_SECONDS) {
    errors.intervalSeconds = `Must be at least ${MIN_INTERVAL_SECONDS} seconds.`;
  }
  if ((values.type === "http" || values.type === "keyword") && !isValidUrl(values.url)) {
    errors.url = "Enter a valid URL, including https://.";
  }
  if ((values.type === "ping" || values.type === "tcp" || values.type === "ssl") && !values.hostname.trim()) {
    errors.hostname = "Hostname is required.";
  }
  if (values.type === "tcp") {
    const port = Number(values.port);
    if (!values.port || !Number.isInteger(port) || port < 1 || port > 65535) {
      errors.port = "Enter a port between 1 and 65535.";
    }
  }
  if (values.type === "keyword" && !values.keyword.trim()) {
    errors.keyword = "Enter the text to check for.";
  }
  return errors;
}

export function MonitorForm({
  initialValues,
  submitting,
  error,
  submitLabel,
  onSubmit,
}: {
  initialValues: MonitorFormValues;
  submitting: boolean;
  error: string | null;
  submitLabel: string;
  onSubmit: (values: MonitorFormValues) => void;
}) {
  const [values, setValues] = useState<MonitorFormValues>(initialValues);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function update<K extends keyof MonitorFormValues>(key: K, value: MonitorFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errors = validate(values);
    setFieldErrors(errors);
    if (Object.keys(errors).length === 0) onSubmit(values);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <label className="block">
        <span className="text-sm font-medium text-ink">Type</span>
        <select
          value={values.type}
          onChange={(e) => update("type", e.target.value as MonitorType)}
          className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-ink outline-none focus:border-ink"
        >
          <option value="http">HTTP / HTTPS</option>
          <option value="ping">Ping</option>
          <option value="tcp">TCP Port</option>
          <option value="keyword">Keyword</option>
          <option value="ssl">SSL Expiry</option>
        </select>
      </label>

      <label className="block">
        <span className="text-sm font-medium text-ink">Name (optional)</span>
        <input
          value={values.name}
          onChange={(e) => update("name", e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-ink outline-none focus:border-ink"
        />
      </label>

      {(values.type === "http" || values.type === "keyword") && (
        <label className="block">
          <span className="text-sm font-medium text-ink">URL</span>
          <input
            value={values.url}
            onChange={(e) => update("url", e.target.value)}
            placeholder="https://example.com"
            className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-ink outline-none focus:border-ink"
          />
          {fieldErrors.url && <p className="mt-1 text-xs text-red-600">{fieldErrors.url}</p>}
        </label>
      )}

      {(values.type === "ping" || values.type === "tcp" || values.type === "ssl") && (
        <label className="block">
          <span className="text-sm font-medium text-ink">Hostname</span>
          <input
            value={values.hostname}
            onChange={(e) => update("hostname", e.target.value)}
            placeholder="example.com"
            className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-ink outline-none focus:border-ink"
          />
          {fieldErrors.hostname && <p className="mt-1 text-xs text-red-600">{fieldErrors.hostname}</p>}
        </label>
      )}

      {values.type === "tcp" && (
        <label className="block">
          <span className="text-sm font-medium text-ink">Port</span>
          <input
            value={values.port}
            onChange={(e) => update("port", e.target.value)}
            placeholder="443"
            inputMode="numeric"
            className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-ink outline-none focus:border-ink"
          />
          {fieldErrors.port && <p className="mt-1 text-xs text-red-600">{fieldErrors.port}</p>}
        </label>
      )}

      {values.type === "keyword" && (
        <label className="block">
          <span className="text-sm font-medium text-ink">Keyword to look for</span>
          <input
            value={values.keyword}
            onChange={(e) => update("keyword", e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-ink outline-none focus:border-ink"
          />
          {fieldErrors.keyword && <p className="mt-1 text-xs text-red-600">{fieldErrors.keyword}</p>}
        </label>
      )}

      <label className="block">
        <span className="text-sm font-medium text-ink">Check interval (seconds)</span>
        <input
          type="number"
          min={MIN_INTERVAL_SECONDS}
          value={values.intervalSeconds}
          onChange={(e) => update("intervalSeconds", Number(e.target.value))}
          className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-ink outline-none focus:border-ink"
        />
        {fieldErrors.intervalSeconds && <p className="mt-1 text-xs text-red-600">{fieldErrors.intervalSeconds}</p>}
      </label>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-black disabled:opacity-60"
      >
        {submitting ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
