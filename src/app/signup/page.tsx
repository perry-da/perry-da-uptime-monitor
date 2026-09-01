"use client";

import { useState } from "react";
import Link from "next/link";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(
          body.error === "email_taken"
            ? "An account with that email already exists."
            : typeof body.error === "string"
              ? body.error
              : "Signup failed."
        );
        return;
      }
      setDone(true);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <main className="mx-auto flex max-w-md flex-col items-center px-6 py-28 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-yellow/25 text-3xl">✓</div>
        <h1 className="mt-6 text-3xl font-extrabold tracking-tight text-ink">You&apos;re in</h1>
        <p className="mt-3 text-ink-soft">
          Account created and you&apos;re signed in. The monitor dashboard is still being built — check back soon.
        </p>
        <Link href="/" className="mt-8 rounded-full bg-ink px-6 py-3 text-sm font-semibold text-white hover:bg-black">
          Back home
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-md flex-col px-6 py-24">
      <h1 className="text-3xl font-extrabold tracking-tight text-ink">Sign up</h1>
      <p className="mt-2 text-ink-soft">Free forever, up to 50 monitors. No credit card.</p>

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
            minLength={8}
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
          {submitting ? "Creating account…" : "Sign up"}
        </button>
      </form>
      <p className="mt-6 text-sm text-ink-soft">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-ink hover:underline">
          Log in
        </Link>
      </p>
    </main>
  );
}
