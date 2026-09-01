import Link from "next/link";

const MONITOR_TYPES = [
  { icon: "🌐", name: "HTTP & HTTPS", desc: "Status code, response time, redirect chains." },
  { icon: "📡", name: "Ping", desc: "Is the host even reachable." },
  { icon: "🔌", name: "TCP Port", desc: "Check any port on any host is accepting connections." },
  { icon: "🔑", name: "Keyword", desc: "Confirm a page still contains the text it should." },
  { icon: "🔒", name: "SSL Expiry", desc: "Get warned weeks before a certificate lapses." },
];

const STEPS = [
  { n: "01", title: "Add a URL", desc: "Paste any URL or hostname. Pick a check type. That's it." },
  { n: "02", title: "We check it for you", desc: "On an interval you choose, from a schedule you never think about again." },
  { n: "03", title: "Get alerted before your customers notice", desc: "One email the moment something goes down. Another the moment it recovers." },
];

export default function LandingPage() {
  return (
    <main>
      {/* Hero */}
      <section className="relative overflow-hidden bg-cream">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-brand-yellow/30 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -left-32 bottom-0 h-72 w-72 rounded-full bg-brand-yellow/20 blur-3xl"
        />
        <div className="relative mx-auto max-w-6xl px-6 py-24 text-center sm:py-32">
          <span className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-1.5 text-sm font-medium text-ink-soft shadow-sm">
            ⬤ Free while you're getting started
          </span>
          <h1 className="mt-8 text-5xl font-extrabold tracking-tight text-ink sm:text-6xl">
            Know the instant
            <br />
            your site goes down
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-ink-soft">
            Add a URL, get alerted before your customers notice. HTTP, ping, TCP,
            keyword, and SSL-expiry monitoring — set up in under a minute.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/signup"
              className="rounded-full bg-ink px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-ink/10 transition hover:bg-black"
            >
              Start free — it takes 60 seconds
            </Link>
            <Link
              href="/features"
              className="rounded-full border border-gray-300 bg-white px-8 py-3.5 text-base font-semibold text-ink transition hover:border-gray-400"
            >
              See how it works
            </Link>
          </div>
        </div>
      </section>

      {/* Monitor type grid */}
      <section className="mx-auto max-w-6xl px-6 py-24">
        <h2 className="text-center text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
          Every check your stack needs
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-ink-soft">
          Five monitor types, one dashboard. No plugins, no agents to install.
        </p>
        <div className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-5">
          {MONITOR_TYPES.map((m) => (
            <div
              key={m.name}
              className="rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-sm transition hover:-translate-y-1 hover:shadow-md"
            >
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-yellow/25 text-2xl">
                {m.icon}
              </div>
              <h3 className="mt-4 font-semibold text-ink">{m.name}</h3>
              <p className="mt-1 text-sm text-ink-soft">{m.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="bg-ink py-24 text-white">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-3xl font-extrabold tracking-tight sm:text-4xl">
            Three steps. No dashboards to configure.
          </h2>
          <div className="mt-16 grid grid-cols-1 gap-12 sm:grid-cols-3">
            {STEPS.map((step) => (
              <div key={step.n}>
                <div className="text-5xl font-black text-brand-yellow">{step.n}</div>
                <h3 className="mt-4 text-xl font-semibold">{step.title}</h3>
                <p className="mt-2 text-white/70">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Social-proof style stat block */}
      <section className="mx-auto max-w-6xl px-6 py-24">
        <div className="rounded-3xl bg-brand-yellow/15 px-8 py-16 text-center sm:px-16">
          <p className="text-2xl font-semibold leading-relaxed text-ink sm:text-3xl">
            &ldquo;The whole point of monitoring is finding out before your customers do.
            That&rsquo;s the only feature that matters, and it&rsquo;s the one thing this
            actually does.&rdquo;
          </p>
          <p className="mt-6 text-sm font-medium text-ink-soft">— every engineer who's been paged by a customer first</p>
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-6xl px-6 pb-28 text-center">
        <h2 className="text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
          Unleash your uptime
        </h2>
        <p className="mx-auto mt-3 max-w-md text-ink-soft">
          Free to start. No credit card. Your first check runs within a minute of signing up.
        </p>
        <Link
          href="/signup"
          className="mt-8 inline-block rounded-full bg-ink px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-ink/10 transition hover:bg-black"
        >
          Start monitoring free
        </Link>
      </section>
    </main>
  );
}
