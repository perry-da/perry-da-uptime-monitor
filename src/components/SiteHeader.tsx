import Link from "next/link";

const NAV_LINKS = [
  { href: "/features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/help", label: "Help" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-gray-100 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-ink">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-brand text-sm font-black text-ink">
            ⬤
          </span>
          Uptime Monitor
        </Link>

        <nav className="hidden items-center gap-1 text-sm font-medium text-ink-soft md:flex">
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
