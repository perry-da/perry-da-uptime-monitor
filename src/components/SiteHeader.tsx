import Link from "next/link";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGlobe, faSatelliteDish, faPlug, faKey, faLock, faCircle, faChevronDown } from "@fortawesome/free-solid-svg-icons";

const FEATURE_MENU = [
  { href: "/features#http", icon: faGlobe, title: "HTTP & HTTPS", desc: "Status code, response time, redirects." },
  { href: "/features#ping", icon: faSatelliteDish, title: "Ping", desc: "Is the host even reachable." },
  { href: "/features#tcp", icon: faPlug, title: "TCP Port", desc: "Confirm a port is accepting connections." },
  { href: "/features#keyword", icon: faKey, title: "Keyword", desc: "Check the response body, not just the code." },
  { href: "/features#ssl", icon: faLock, title: "SSL Expiry", desc: "Get warned before a certificate lapses." },
];

const NAV_LINKS = [
  { href: "/pricing", label: "Pricing" },
  { href: "/help", label: "Help" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-gray-100 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-ink">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-brand text-xs text-ink">
            <FontAwesomeIcon icon={faCircle} className="h-3 w-3" />
          </span>
          Uptime Monitor
        </Link>

        <nav className="hidden items-center gap-1 text-sm font-medium text-ink-soft md:flex">
          <div className="group relative">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full px-4 py-2 transition hover:bg-gray-100 hover:text-ink"
            >
              Features
              <FontAwesomeIcon icon={faChevronDown} className="h-2.5 w-2.5 transition group-hover:rotate-180" />
            </button>
            <div className="invisible absolute left-1/2 top-full w-80 -translate-x-1/2 pt-3 opacity-0 transition group-hover:visible group-hover:opacity-100">
              <div className="grid gap-1 rounded-2xl border border-gray-100 bg-white p-3 shadow-xl">
                {FEATURE_MENU.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex items-start gap-3 rounded-xl p-2.5 transition hover:bg-gray-50"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/20 text-sm text-brand-dark">
                      <FontAwesomeIcon icon={item.icon} />
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-ink">{item.title}</span>
                      <span className="block text-xs text-ink-soft">{item.desc}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-full px-4 py-2 transition hover:bg-gray-100 hover:text-ink"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="hidden rounded-full border border-gray-300 px-5 py-2.5 text-sm font-semibold text-ink transition hover:border-gray-400 sm:inline-block"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-black"
          >
            Start free
          </Link>
        </div>
      </div>
    </header>
  );
}
