import Link from "next/link";

const FEATURES = [
  {
    id: "http",
    icon: "🌐",
    title: "HTTP & HTTPS monitoring",
    desc: "We GET your URL on the interval you set, follow redirects up to 5 hops, and record status code, response time, and exactly what went wrong when it doesn't come back clean.",
  },
  {
    id: "ping",
    icon: "📡",
    title: "Ping monitoring",
    desc: "For anything that doesn't speak HTTP — is the host even reachable on the network.",
  },
  {
    id: "tcp",
    icon: "🔌",
    title: "TCP port checks",
    desc: "Database, mail server, custom service — if it listens on a port, we can confirm it's accepting connections.",
  },
  {
    id: "keyword",
    icon: "🔑",
    title: "Keyword monitoring",
    desc: "A 200 response isn't always a healthy page. We check the response body actually contains the text you expect.",
  },
  {
    id: "ssl",
    icon: "🔒",
    title: "SSL expiry monitoring",
    desc: "Certificate expiry is a silent outage waiting to happen. We warn you weeks before it lapses, not the day of.",
  },
];

const CAPABILITIES = [
  {
    title: "Debounced alerts, not noise",
    desc: "One transient blip doesn't page you. Two consecutive failures spanning a real time window does — the same signal a human would trust.",
  },
  {
    title: "Recovery notifications",
    desc: "You get told the moment it opens, and the moment it closes, with how long it was actually down.",
  },
  {
    title: "Public status pages",
    desc: "Publish a clean, read-only status page for any monitor — the link your customers check before they email you.",
  },
  {
    title: "Webhooks",
    desc: "Pipe incident open/recovery events into Slack, PagerDuty, or anything else that takes a POST.",
  },
];

export default function FeaturesPage() {
  return (
    <main>
      <section className="bg-cream px-6 py-24 text-center">
        <h1 className="text-5xl font-extrabold tracking-tight text-ink sm:text-6xl">
          Everything you need.
          <br />
          Nothing you have to configure.
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-ink-soft">
          Five check types, real debounced alerting, and a status page you can actually
          share — all live in under a minute.
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-24">
        <div className="grid grid-cols-1 gap-16 sm:grid-cols-2">
          {FEATURES.map((f, i) => (
            <div key={f.id} id={f.id} className={i % 2 === 1 ? "sm:mt-16" : ""}>
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand/20 text-3xl">
                {f.icon}
              </div>
              <h2 className="mt-5 text-2xl font-bold text-ink">{f.title}</h2>
              <p className="mt-2 text-ink-soft">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-ink px-6 py-24 text-white">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-3xl font-extrabold tracking-tight sm:text-4xl">
            Built so the alerts you get are the ones worth trusting
          </h2>
          <div className="mt-16 grid grid-cols-1 gap-10 sm:grid-cols-2">
            {CAPABILITIES.map((c) => (
              <div key={c.title} className="rounded-2xl border border-white/10 bg-white/5 p-8">
                <h3 className="text-xl font-semibold">{c.title}</h3>
                <p className="mt-2 text-white/70">{c.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-24 text-center">
        <h2 className="text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
          Ready to see it running?
        </h2>
        <Link
          href="/signup"
          className="mt-8 inline-block rounded-full bg-ink px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-ink/10 transition hover:bg-black"
        >
          Start free
        </Link>
      </section>
    </main>
  );
}
