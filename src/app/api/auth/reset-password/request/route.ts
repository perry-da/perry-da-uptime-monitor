import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createPasswordResetToken } from "@/lib/auth";

const bodySchema = z.object({ email: z.string().email() });

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: "invalid_body" }, { status: 400 });
  }

  const result = await createPasswordResetToken(parsed.data.email);
  if ("rawToken" in result) {
    // TODO(follow-up session): hand result.rawToken + result.accountId to the
    // transactional-email dispatch layer (Resend, per ISA Decisions) instead of
    // discarding it here. Not wired yet — alert/email delivery is a later Feature.
  }

  // ISC-10: always 200, same shape, regardless of whether the email exists.
  return NextResponse.json({ data: { queued: true }, error: null }, { status: 200 });
}
