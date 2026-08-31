import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { eq, and, gt, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts, sessions, passwordResetTokens } from "@/db/schema";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // ISC-13: 30 days
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const BCRYPT_ROUNDS = 12;

export const SESSION_COOKIE_NAME = "session_id";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS); // ISC-7
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) return "Password must be at least 8 characters."; // ISC-3
  return null;
}

export async function createAccount(email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await db.query.accounts.findFirst({
    where: eq(accounts.email, normalizedEmail),
  });
  if (existing) return { error: "email_taken" as const }; // ISC-2

  const passwordHash = await hashPassword(password);
  const inserted = await db
    .insert(accounts)
    .values({ email: normalizedEmail, passwordHash })
    .returning();
  const account = inserted[0];
  if (!account) throw new Error("account insert returned no row");
  return { account };
}

export async function createSession(accountId: string) {
  const inserted = await db
    .insert(sessions)
    .values({
      accountId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    })
    .returning();
  const session = inserted[0];
  if (!session) throw new Error("session insert returned no row");
  return session;
}

export async function getAccountBySession(sessionId: string | undefined) {
  if (!sessionId) return null;
  const session = await db.query.sessions.findFirst({
    where: and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())), // ISC-13
  });
  if (!session) return null;
  const account = await db.query.accounts.findFirst({
    where: eq(accounts.id, session.accountId),
  });
  return account ?? null;
}

export async function destroySession(sessionId: string) {
  await db.delete(sessions).where(eq(sessions.id, sessionId)); // ISC-6
}

export async function createPasswordResetToken(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const account = await db.query.accounts.findFirst({
    where: eq(accounts.email, normalizedEmail),
  });
  // ISC-10: always return success shape regardless of whether the account exists,
  // to avoid leaking which emails are registered (user enumeration).
  if (!account) return { queued: true as const };

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = await bcrypt.hash(rawToken, BCRYPT_ROUNDS);
  await db.insert(passwordResetTokens).values({
    accountId: account.id,
    tokenHash,
    expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
  });
  // In production this is handed to the email dispatch layer, not returned to the caller.
  return { queued: true as const, rawToken, accountId: account.id };
}

export async function consumePasswordResetToken(accountId: string, rawToken: string, newPassword: string) {
  const candidates = await db.query.passwordResetTokens.findMany({
    where: and(
      eq(passwordResetTokens.accountId, accountId),
      isNull(passwordResetTokens.usedAt),
      gt(passwordResetTokens.expiresAt, new Date())
    ),
  });

  for (const candidate of candidates) {
    const matches = await bcrypt.compare(rawToken, candidate.tokenHash);
    if (!matches) continue;
    // ISC-11 + ISC-106: single-use, invalidated immediately on success.
    await db
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.id, candidate.id));
    const passwordHash = await hashPassword(newPassword);
    await db.update(accounts).set({ passwordHash }).where(eq(accounts.id, accountId));
    return { success: true as const };
  }
  return { success: false as const }; // ISC-12: expired/used/invalid token
}
