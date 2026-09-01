import Link from "next/link";

type Entry = { q: string; a: string };
type Category = { title: string; entries: Entry[] };

const CATEGORIES: Category[] = [
  {
    title: "Getting started",
    entries: [
      {
        q: "How do I add my first monitor?",
        a: "Sign up, then use “Add monitor” on the dashboard. Pick a check type, enter the URL/host, set an interval, and save — your first check runs on the next scheduled tick.",
      },
      {
        q: "How often are monitors checked?",
        a: "You set an interval (minimum 60 seconds) per monitor. The interval controls when a check becomes due; how quickly it actually runs depends on your plan's check cadence.",
      },
      {
        q: "Why does a brand-new monitor show “Pending”?",
        a: "Pending just means no check has run yet — it's not an error. It clears automatically the first time a check executes for that monitor.",
      },
    ],
  },
  {
    title: "Monitor types & how they differ",
    entries: [
      {
        q: "HTTP vs. Ping vs. TCP — what's the real difference?",
        a: "HTTP sends a real GET request and reads the response status code — it's checking whether your application answered correctly, not just whether the server is reachable. Ping and TCP only open a raw network connection; they never send an HTTP request, so they can't see application-level problems like a 500 error page, a WAF block, or bad content.",
      },
      {
        q: "Why does Ping show “Up” when TCP shows “Down” for the exact same host and port?",
        a: "This is intentional, not a bug. Ping's job is “is this host reachable at all” — a connection refused (ECONNREFUSED) still proves the host answered on the network, so Ping counts that as up. TCP's job is “is this specific port accepting connections” — for TCP, that same refused connection means the port isn't open, so it's down. Same event, two different questions being asked.",
      },
      {
        q: "What does Keyword monitoring check that HTTP doesn't?",
        a: "HTTP only looks at the status code — a page can return 200 OK while showing an error message, an empty cart, or a broken checkout. Keyword monitoring additionally checks that the response body contains text you specify, so it catches “technically online, actually broken” pages.",
      },
      {
        q: "What does SSL expiry monitoring do?",
        a: "It checks your certificate's expiry date on each run and warns you a configurable number of days ahead of time, so a lapsed certificate never becomes a surprise outage.",
      },
    ],
  },
  {
    title: "Troubleshooting a “Down” result",
    entries: [
      {
        q: "My site works fine in a browser, but the HTTP monitor shows Down — why?",
        a: "The most common cause is a firewall or bot-protection rule (Cloudflare Bot Fight Mode, a WAF, or a security plugin) blocking automated requests specifically, while allowing normal browser traffic through. Our checker identifies itself with a distinct User-Agent for exactly this reason — if your host is behind Cloudflare or a similar service, add an allowlist rule for that User-Agent (or for our check traffic generally) in your security settings.",
      },
      {
        q: "Ping shows Up for my site, but HTTP shows Down — doesn't that prove it's a false alarm?",
        a: "No — Ping and HTTP check fundamentally different things, so they can disagree correctly. Ping only opens a bare network connection and never sends a User-Agent or any HTTP request, so it will never trigger an HTTP-layer bot-protection rule. If HTTP is blocked but Ping is fine, that's consistent with a firewall/WAF blocking automated HTTP requests specifically — not proof the HTTP check is wrong.",
      },
      {
        q: "What does each failure reason mean?",
        a: "timeout — no response within the check's time budget. dns — the hostname didn't resolve. conn_refused — the target actively refused the connection on that port. unreachable — the network path itself failed (routing, firewall drop). http — the server responded, but with an error status code or too many redirects.",
      },
    ],
  },
  {
    title: "Alerts & incidents",
    entries: [
      {
        q: "Does one failed check trigger an alert?",
        a: "No. A single blip doesn't page you — an incident only opens after checks fail consecutively across a real time window, the same bar a human would use before trusting a “down” signal. This avoids noisy false alarms from a single transient network hiccup.",
      },
      {
        q: "Do I get told when something recovers?",
        a: "Yes — a recovery notification goes out the moment an incident closes, including how long it was down.",
      },
    ],
  },
  {
    title: "Status pages",
    entries: [
      {
        q: "Can I share uptime with customers?",
        a: "Yes — publish any monitor to get a public, read-only status page showing uptime percentage, check history, and past incidents. Nothing about your account (email, other monitors) is ever exposed on a public status page.",
      },
      {
        q: "Can I unpublish a status page later?",
        a: "Yes, from the monitor's detail page — unpublishing immediately makes the public URL return a 404.",
      },
    ],
  },
  {
    title: "Account & billing",
    entries: [
      {
        q: "Is the free tier actually free?",
        a: "Yes — no credit card required, and it's the full product today, not a trial.",
      },
      {
        q: "Can I invite teammates?",
        a: "Not yet — every account is single-user for now. Team roles are a planned future capability.",
      },
    ],
  },
];

export default function HelpPage() {
  return (
    <main>
      <section className="bg-cream px-6 py-24 text-center">
        <h1 className="text-5xl font-extrabold tracking-tight text-ink sm:text-6xl">
          Help &amp; support
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-ink-soft">
          Answers to the questions we hear most — including why two check types can
          honestly disagree about the same host.
        </p>
      </section>

      <section className="mx-auto max-w-3xl px-6 py-24">
        <div className="space-y-16">
          {CATEGORIES.map((category) => (
            <div key={category.title}>
              <h2 className="text-2xl font-bold text-ink">{category.title}</h2>
              <div className="mt-6 divide-y divide-gray-100 border-t border-gray-100">
                {category.entries.map((entry) => (
                  <details key={entry.q} className="group py-5">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-ink marker:content-none">
                      {entry.q}
                      <span className="shrink-0 text-ink-soft transition group-open:rotate-45">+</span>
                    </summary>
                    <p className="mt-3 text-ink-soft">{entry.a}</p>
                  </details>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-20 rounded-2xl border border-gray-100 bg-cream p-8 text-center">
          <h2 className="text-xl font-bold text-ink">Still stuck?</h2>
          <p className="mt-2 text-ink-soft">
            Reach out and we&rsquo;ll help you dig into a specific monitor or result.
          </p>
          <Link
            href="/signup"
            className="mt-6 inline-block rounded-full bg-ink px-6 py-3 text-sm font-semibold text-white transition hover:bg-black"
          >
            Get started
          </Link>
        </div>
      </section>
    </main>
  );
}
