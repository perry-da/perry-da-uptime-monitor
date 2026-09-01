import { cookies } from "next/headers";
import { getAccountBySession, SESSION_COOKIE_NAME } from "@/lib/auth";

/** Server Component / layout equivalent of requireAccount — reads the httpOnly cookie directly. */
export async function getServerAccount() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return getAccountBySession(sessionId);
}
