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
    <footer className="bg-footer-bg">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid grid-cols-2 gap-10 sm:grid-cols-4">
          <div className="col-span-2 sm:col-span-1">
            <div className="flex items-center gap-2 text-base font-extrabold text-footer-ink">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand text-xs font-black text-footer-bg">
                ⬤
              </span>
              Uptime Monitor
            </div>
            <p className="mt-3 max-w-[22ch] text-sm text-footer-ink-soft">
              Know the instant your site goes down — before your customers do.
            </p>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-footer-ink-soft">{col.title}</h3>
              <ul className="mt-3 space-y-2">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-footer-ink-soft transition hover:text-footer-ink"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-2 border-t border-white/10 pt-6 text-xs text-footer-ink-soft sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Uptime Monitor. All rights reserved.</span>
        </div>
      </div>
    </footer>
  );
}
