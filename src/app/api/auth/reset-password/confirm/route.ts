import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { consumePasswordResetToken, validatePasswordStrength } from "@/lib/auth";

const bodySchema = z.object({
  accountId: z.string().uuid(),
  token: z.string(),
  newPassword: z.string(),
});

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: "invalid_body" }, { status: 400 });
  }

  const strengthError = validatePasswordStrength(parsed.data.newPassword);
  if (strengthError) {
    return NextResponse.json({ data: null, error: strengthError }, { status: 400 });
  }

  const result = await consumePasswordResetToken(parsed.data.accountId, parsed.data.token, parsed.data.newPassword);
  if (!result.success) {
    return NextResponse.json({ data: null, error: "invalid_or_expired_token" }, { status: 400 }); // ISC-12
  }

  return NextResponse.json({ data: { reset: true }, error: null }, { status: 200 }); // ISC-11
}
