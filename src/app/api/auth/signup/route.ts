import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAccount, createSession, validatePasswordStrength, SESSION_COOKIE_NAME } from "@/lib/auth";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: "invalid_body" }, { status: 400 });
  }

  const { email, password } = parsed.data;
  const strengthError = validatePasswordStrength(password);
  if (strengthError) {
    return NextResponse.json({ data: null, error: strengthError }, { status: 400 }); // ISC-3
  }

  const result = await createAccount(email, password);
  if ("error" in result) {
    return NextResponse.json({ data: null, error: "email_taken" }, { status: 409 }); // ISC-2
  }

  const session = await createSession(result.account.id); // ISC-1
  const res = NextResponse.json({ data: { id: result.account.id, email: result.account.email }, error: null }, { status: 201 });
  res.cookies.set(SESSION_COOKIE_NAME, session.id, {
    httpOnly: true, // ISC-8
    secure: process.env.NODE_ENV === "production", // ISC-8
    sameSite: "lax", // ISC-102: same-site cookie CSRF protection
    path: "/",
    expires: session.expiresAt,
  });
  return res;
}
