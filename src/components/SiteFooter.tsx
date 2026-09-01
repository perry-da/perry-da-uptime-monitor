import Link from "next/link";

const COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "Product",
    links: [
      { href: "/features", label: "Features" },
      { href: "/pricing", label: "Pricing" },
      { href: "/signup", label: "Get started" },
    ],
  },
  {
    title: "Monitor types",
    links: [
      { href: "/features#http", label: "HTTP & HTTPS" },
      { href: "/features#ping", label: "Ping" },
      { href: "/features#ssl", label: "SSL expiry" },
    ],
  },
  {
    title: "Account",
    links: [
      { href: "/login", label: "Log in" },
      { href: "/signup", label: "Sign up" },
      { href: "/help", label: "Help & support" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-gray-100 bg-cream">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="grid grid-cols-2 gap-10 sm:grid-cols-4">
          <div className="col-span-2 sm:col-span-1">
            <div className="flex items-center gap-2 text-base font-extrabold text-ink">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand-yellow text-xs font-black">
                ⬤
              </span>
              Uptime Monitor
            </div>
            <p className="mt-3 max-w-[22ch] text-sm text-ink-soft">
              Know the instant your site goes down — before your customers do.
            </p>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h3 className="text-sm font-semibold text-ink">{col.title}</h3>
              <ul className="mt-3 space-y-2">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-sm text-ink-soft transition hover:text-ink">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 border-t border-gray-200 pt-6 text-xs text-ink-soft">
          © {new Date().getFullYear()} Uptime Monitor.
        </div>
      </div>
    </footer>
  );
}
