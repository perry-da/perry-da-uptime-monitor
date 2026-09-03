"use client";

import { useState, type ReactNode } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBars, faXmark } from "@fortawesome/free-solid-svg-icons";

export function DashboardShell({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      <div className="fixed inset-x-0 top-0 z-30 flex items-center justify-between border-b border-gray-100 bg-white px-4 py-3 md:hidden">
        <span className="text-base font-extrabold tracking-tight text-ink">Uptime Monitor</span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-ink hover:bg-gray-100"
        >
          <FontAwesomeIcon icon={faBars} className="h-4 w-4" />
        </button>
      </div>

      {open && (
        <div aria-hidden onClick={() => setOpen(false)} className="fixed inset-0 z-40 bg-black/40 md:hidden" />
      )}

      <div
        className={
          "fixed inset-y-0 left-0 z-50 w-56 transition-transform duration-200 md:sticky md:top-0 md:h-screen md:translate-x-0 " +
          (open ? "translate-x-0" : "-translate-x-full")
        }
      >
        <div className="relative h-full">
          {sidebar}
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="absolute right-3 top-4 flex h-8 w-8 items-center justify-center rounded-lg text-white/60 transition hover:bg-white/10 hover:text-white md:hidden"
          >
            <FontAwesomeIcon icon={faXmark} className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="min-w-0 flex-1 bg-cream pt-14 md:pt-0">{children}</div>
    </div>
  );
}
