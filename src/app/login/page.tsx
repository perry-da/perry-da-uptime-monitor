"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error === "invalid_credentials" ? "Wrong email or password." : "Login failed.");
        setSubmitting(false);
        return;
      }
      router.push("/dashboard"); // ISC-72-adjacent: the dashboard is real now, go straight there
      router.refresh();
    } catch {
      setError("Network error — please try again.");
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-md flex-col px-6 py-24">
      <h1 className="text-3xl font-extrabold tracking-tight text-ink">Log in</h1>

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        <label className="block">
          <span className="text-sm font-medium text-ink">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-gray-300 px-4 py-2.5 text-ink outline-none focus:border-ink"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-ink">Password</span>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-gray-300 px-4 py-2.5 text-ink outline-none focus:border-ink"
          />
        </label>
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-700">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-full bg-ink px-6 py-3 text-sm font-semibold text-white transition hover:bg-black disabled:opacity-60"
        >
          {submitting ? "Logging in…" : "Log in"}
        </button>
      </form>
      <p className="mt-6 text-sm text-ink-soft">
        No account yet?{" "}
        <Link href="/signup" className="font-semibold text-ink hover:underline">
          Sign up
        </Link>
      </p>
    </main>
  );
}
