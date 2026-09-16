/**
 * DNS change tracking ("the DNS timeline").
 *
 * Orchestrates a DNS check: runs the pure `dns.ts` resolver, compares each
 * record type's result against its most recent stored snapshot, writes a
 * `dns_changes` row for any type whose resolved values differ (or that has
 * never been seen before), and writes a fresh `dns_snapshots` row for every
 * type regardless of whether it changed (so "no change" is still recorded
 * history, not silence).
 *
 * Per this feature's scope (Anup's explicit choice): a DNS record change is
 * logged only, never an alert or an incident — a DNS monitor's `checks` row
 * status is `up` as long as the domain resolves at all, matching `dns.ts`'s
 * own up/down semantics.
 */

import { eq, and, desc } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { dnsSnapshots, dnsChanges } from '@/db/schema';
import { runDnsCheck, DNS_RECORD_TYPES, type DnsCheckResult } from '@/lib/checks/dns';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/** Sorted-array JSON is the on-disk comparison key — order-independent, stable across runs. */
export function serialize(values: string[]): string {
  return JSON.stringify([...values].sort());
}

/**
 * Run a DNS check for `hostname` and persist its snapshot + any detected
 * changes for `monitorId`. Returns the same shape the scheduler needs for
 * the `checks` table insert (status/failureReason/responseTimeMs/checkedAt) —
 * DNS checks never populate `statusCode` or `certExpiresAt`.
 */
export async function runDnsCheckAndRecordHistory(
  db: Db,
  monitorId: string,
  hostname: string,
): Promise<DnsCheckResult> {
  const result = await runDnsCheck(hostname);

  for (const recordType of DNS_RECORD_TYPES) {
    const newSerialized = serialize(result.records[recordType]);

    const [previous] = await db
      .select({ values: dnsSnapshots.values })
      .from(dnsSnapshots)
      .where(and(eq(dnsSnapshots.monitorId, monitorId), eq(dnsSnapshots.recordType, recordType)))
      .orderBy(desc(dnsSnapshots.checkedAt))
      .limit(1);

    if (previous === undefined || previous.values !== newSerialized) {
      await db.insert(dnsChanges).values({
        monitorId,
        recordType,
        oldValues: previous?.values ?? null,
        newValues: newSerialized,
        detectedAt: result.checkedAt,
      });
    }

    await db.insert(dnsSnapshots).values({
      monitorId,
      recordType,
      values: newSerialized,
      checkedAt: result.checkedAt,
    });
  }

  return result;
}

export type DnsChangeRow = typeof schema.dnsChanges.$inferSelect;

/** The timeline: every recorded change for a monitor, most recent first. */
export async function getDnsTimeline(db: Db, monitorId: string, limit = 50): Promise<DnsChangeRow[]> {
  return db
    .select()
    .from(dnsChanges)
    .where(eq(dnsChanges.monitorId, monitorId))
    .orderBy(desc(dnsChanges.detectedAt))
    .limit(limit);
}
