import Link from "next/link";

const TIERS = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    tagline: "Everything you need to stop finding out from your customers.",
    features: [
      "Up to 50 monitors",
      "HTTP, ping, TCP, keyword, and SSL-expiry checks",
      "Debounced email alerts",
      "Public status pages",
      "Webhook notifications",
    ],
    cta: { label: "Start free", href: "/signup" },
    highlighted: true,
  },
  {
    name: "Pro",
    price: "—",
    period: "coming soon",
    tagline: "Faster check intervals, team seats, and priority alerting.",
    features: [
      "Sub-minute check intervals",
      "Team seats & shared dashboards",
      "SMS & voice alerting",
      "Multi-region checks",
      "Priority support",
    ],
    cta: { label: "Join the waitlist", href: "/signup" },
    highlighted: false,
  },
];

const FAQ = [
  {
    q: "Is the free tier actually free?",
    a: "Yes — up to 50 monitors, no credit card, no trial countdown. This is the whole product today.",
  },
  {
    q: "What happens when Pro launches?",
    a: "Nothing changes for existing free monitors. Pro will be an optional upgrade for faster intervals and team features, not a paywall on what already works.",
  },
  {
    q: "How often are monitors checked?",
    a: "You choose the interval, minimum 60 seconds, on the free tier.",
  },
];

export default function PricingPage() {
  return (
    <main>
      <section className="bg-cream px-6 py-24 text-center">
        <h1 className="text-5xl font-extrabold tracking-tight text-ink sm:text-6xl">
          Simple, honest pricing
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-ink-soft">
          The free tier is not a trial. It&rsquo;s the product.
        </p>
      </section>

      <section className="mx-auto max-w-4xl px-6 py-24">
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
          {TIERS.map((tier) => (
            <div
              key={tier.name}
              className={
                "rounded-3xl border p-8 " +
                (tier.highlighted
                  ? "border-ink bg-ink text-white shadow-xl"
                  : "border-gray-200 bg-white")
              }
            >
              <h2 className={"text-xl font-bold " + (tier.highlighted ? "text-white" : "text-ink")}>
                {tier.name}
              </h2>
              <p className={"mt-1 text-sm " + (tier.highlighted ? "text-white/70" : "text-ink-soft")}>
                {tier.tagline}
              </p>
              <div className="mt-6 flex items-baseline gap-2">
                <span className="text-4xl font-extrabold">{tier.price}</span>
                <span className={tier.highlighted ? "text-white/60" : "text-ink-soft"}>{tier.period}</span>
              </div>
              <ul className="mt-8 space-y-3">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <span className={tier.highlighted ? "text-brand" : "text-brand-dark"}>✓</span>
                    <span className={tier.highlighted ? "text-white/90" : "text-ink-soft"}>{f}</span>
                  </li>
                ))}
              </ul>
              <Link
                href={tier.cta.href}
                className={
                  "mt-10 block rounded-full px-6 py-3 text-center text-sm font-semibold transition " +
                  (tier.highlighted
                    ? "bg-brand text-ink hover:bg-brand-dark"
                    : "border border-gray-300 text-ink hover:border-gray-400")
                }
              >
                {tier.cta.label}
              </Link>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-6 pb-28">
        <h2 className="text-center text-3xl font-extrabold tracking-tight text-ink">FAQ</h2>
        <div className="mt-12 space-y-8">
          {FAQ.map((item) => (
            <div key={item.q} className="border-b border-gray-100 pb-8">
              <h3 className="font-semibold text-ink">{item.q}</h3>
              <p className="mt-2 text-ink-soft">{item.a}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
