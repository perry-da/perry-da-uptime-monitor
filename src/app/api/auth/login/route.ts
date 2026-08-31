import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts } from "@/db/schema";
import { verifyPassword, createSession, SESSION_COOKIE_NAME } from "@/lib/auth";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: "invalid_body" }, { status: 400 });
  }

  const account = await db.query.accounts.findFirst({
    where: eq(accounts.email, parsed.data.email.trim().toLowerCase()),
  });

  // Constant-shape failure whether the account is missing or the password is wrong —
  // avoids leaking which branch failed (ISC-5).
  const valid = account ? await verifyPassword(parsed.data.password, account.passwordHash) : false;
  if (!account || !valid) {
    return NextResponse.json({ data: null, error: "invalid_credentials" }, { status: 401 });
  }

  const session = await createSession(account.id); // ISC-4
  const res = NextResponse.json({ data: { id: account.id, email: account.email }, error: null }, { status: 200 });
  res.cookies.set(SESSION_COOKIE_NAME, session.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: session.expiresAt,
  });
  return res;
}
