import { and, eq, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * Single scoped-query helper (ISA Decisions, advisor point 4): every read/write
 * that touches per-account data goes through this instead of ad-hoc
 * `where(eq(table.accountId, accountId))` sprinkled at each call site.
 * Retrofitting tenant isolation after the fact is how multi-tenant SaaS leaks
 * data (ISC-14, ISC-100) — so this is the ONLY way call sites are allowed to
 * scope a query, enforced by convention + code review, not just by type.
 */
export function scopedToAccount(
  accountIdColumn: PgColumn,
  accountId: string,
  extra?: SQL
): SQL {
  const base = eq(accountIdColumn, accountId);
  return extra ? and(base, extra)! : base;
}

/** Thrown by route handlers when a resource lookup misses the tenant scope. */
export class NotFoundInScopeError extends Error {
  constructor(resource: string) {
    // ISC-23: 404, not 403 — no existence leak across tenants.
    super(`${resource} not found`);
    this.name = "NotFoundInScopeError";
  }
}
