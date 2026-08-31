import { NextRequest, NextResponse } from "next/server";
import { getAccountBySession, SESSION_COOKIE_NAME } from "@/lib/auth";
import type { accounts } from "@/db/schema";

export type Account = typeof accounts.$inferSelect;

/**
 * Every authenticated route calls this first. Returns the account or a ready-to-return
 * 401 response — never trusts a client-supplied account/tenant id (ISC-9, ISC-100).
 */
export async function requireAccount(
  req: NextRequest
): Promise<{ account: Account } | { response: NextResponse }> {
  const sessionId = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const account = await getAccountBySession(sessionId);
  if (!account) {
    return { response: NextResponse.json({ data: null, error: "unauthenticated" }, { status: 401 }) };
  }
  return { account };
}
