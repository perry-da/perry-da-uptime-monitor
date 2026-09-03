import Link from "next/link";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGaugeHigh, faCircleQuestion, faCircle } from "@fortawesome/free-solid-svg-icons";
import { FREE_TIER_MONITOR_CAP } from "@/lib/monitor-schema";
import { SignOutButton } from "@/components/dashboard/SignOutButton";

export function DashboardSidebar({ email, monitorCount }: { email: string; monitorCount: number }) {
  const initial = email.trim().charAt(0).toUpperCase() || "?";

  return (
    <aside className="flex w-56 shrink-0 flex-col bg-ink text-white">
      <div className="flex items-center gap-2 px-5 py-5 text-base font-extrabold tracking-tight">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand text-xs text-ink">
          <FontAwesomeIcon icon={faCircle} className="h-2.5 w-2.5" />
        </span>
        Uptime Monitor
      </div>

      <div className="px-5 pb-4">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-brand">
          Free plan
          <span className="text-white/50">
            {monitorCount}/{FREE_TIER_MONITOR_CAP} monitors
          </span>
        </span>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        <Link
          href="/dashboard"
          className="flex items-center gap-3 rounded-xl bg-white/10 px-3 py-2.5 text-sm font-semibold text-brand"
        >
          <FontAwesomeIcon icon={faGaugeHigh} className="h-4 w-4" />
          Dashboard
        </Link>
        <Link
          href="/help"
          className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-white/60 transition hover:bg-white/5 hover:text-white"
        >
          <FontAwesomeIcon icon={faCircleQuestion} className="h-4 w-4" />
          Help &amp; support
        </Link>
      </nav>

      <div className="flex items-center gap-3 border-t border-white/10 px-5 py-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-ink">
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">{email}</p>
          <SignOutButton />
        </div>
      </div>
    </aside>
  );
}
