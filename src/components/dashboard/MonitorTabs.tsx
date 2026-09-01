"use client";

import { useState } from "react";
import type { monitors, checks } from "@/db/schema";
import { MonitorList } from "@/components/dashboard/MonitorList";

type Monitor = typeof monitors.$inferSelect;
type Check = typeof checks.$inferSelect;
type Item = { monitor: Monitor; latestCheck: Check | null };

const TABS = [
  { key: "all", label: "All" },
  { key: "http", label: "HTTP" },
  { key: "ping", label: "Ping" },
  { key: "tcp", label: "TCP" },
  { key: "keyword", label: "Keyword" },
  { key: "ssl", label: "SSL" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function MonitorTabs({ items }: { items: Item[] }) {
  const [active, setActive] = useState<TabKey>("all");

  const counts: Record<TabKey, number> = {
    all: items.length,
    http: 0,
    ping: 0,
    tcp: 0,
    keyword: 0,
    ssl: 0,
  };
  for (const item of items) counts[item.monitor.type] += 1;

  const filtered = active === "all" ? items : items.filter((item) => item.monitor.type === active);

  return (
    <div>
      <div className="flex flex-wrap gap-2 border-b border-gray-100 pb-3">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActive(tab.key)}
            className={
              active === tab.key
                ? "rounded-full bg-ink px-4 py-1.5 text-sm font-semibold text-white"
                : "rounded-full px-4 py-1.5 text-sm font-semibold text-ink-soft transition hover:bg-cream"
            }
          >
            {tab.label}
            <span className={active === tab.key ? "ml-1.5 text-white/60" : "ml-1.5 text-ink-soft/60"}>
              {counts[tab.key]}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-6">
        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 px-8 py-16 text-center">
            <p className="text-ink-soft">
              {active === "all" ? "No monitors yet. Add your first URL to get started." : `No ${active} monitors yet.`}
            </p>
          </div>
        ) : (
          <MonitorList items={filtered} />
        )}
      </div>
    </div>
  );
}
