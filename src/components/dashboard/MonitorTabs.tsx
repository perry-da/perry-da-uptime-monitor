"use client";

import { useState } from "react";
import type { monitors, checks } from "@/db/schema";
import { MonitorList } from "@/components/dashboard/MonitorList";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faMagnifyingGlass } from "@fortawesome/free-solid-svg-icons";

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

function targetOf(monitor: Monitor): string {
  return monitor.url ?? monitor.hostname ?? "";
}

export function MonitorTabs({ items }: { items: Item[] }) {
  const [active, setActive] = useState<TabKey>("all");
  const [search, setSearch] = useState("");

  const counts: Record<TabKey, number> = {
    all: items.length,
    http: 0,
    ping: 0,
    tcp: 0,
    keyword: 0,
    ssl: 0,
  };
  for (const item of items) counts[item.monitor.type] += 1;

  const query = search.trim().toLowerCase();
  const filtered = items.filter((item) => {
    if (active !== "all" && item.monitor.type !== active) return false;
    if (!query) return true;
    return (
      item.monitor.name.toLowerCase().includes(query) || targetOf(item.monitor).toLowerCase().includes(query)
    );
  });

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-3">
        <div className="flex flex-wrap gap-2">
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
        <div className="relative">
          <FontAwesomeIcon
            icon={faMagnifyingGlass}
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-soft"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search monitors"
            className="w-56 rounded-full border border-gray-300 py-1.5 pl-9 pr-4 text-sm text-ink outline-none focus:border-ink"
          />
        </div>
      </div>

      <div className="mt-6">
        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 px-8 py-16 text-center">
            <p className="text-ink-soft">
              {items.length === 0
                ? "No monitors yet. Add your first URL to get started."
                : "No monitors match your filters."}
            </p>
          </div>
        ) : (
          <MonitorList items={filtered} />
        )}
      </div>
    </div>
  );
}
