import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { runDueChecks } from "@/lib/scheduler";
import { ResendEmailSender } from "@/lib/alerts/email-sender";

// ResendEmailSender is only constructed if RESEND_API_KEY is set — no key exists in this
// sandbox (see ISA Verification), so alert emails are a no-op locally until a real key is
// provisioned. Absence never blocks checks/incidents from being recorded (ISC-61 pattern
// applied to email too — a missing/failing send channel can't break the core loop).
const emailSender = process.env.RESEND_API_KEY ? new ResendEmailSender(process.env.RESEND_API_KEY) : undefined;

// ISC-46, ISC-105: shared-secret header, not a bearer-of-convenience — Vercel Cron sends
// `Authorization: Bearer ${CRON_SECRET}` by convention; we check it explicitly rather than
// trusting request origin (Vercel Cron requests aren't otherwise distinguishable).
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get("authorization");
  if (!secret || provided !== `Bearer ${secret}`) {
    return NextResponse.json({ data: null, error: "unauthorized" }, { status: 401 });
  }

  const results = await runDueChecks(db, undefined, emailSender); // ISC-44, ISC-47, ISC-48
  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;
  if (failCount > 0) {
    // ISC-120: failed checks are logged, not silently swallowed.
    console.error("cron/run-checks: per-monitor failures", results.filter((r) => !r.ok));
  }

  return NextResponse.json(
    { data: { checked: results.length, ok: okCount, failed: failCount }, error: null },
    { status: 200 }
  );
}
