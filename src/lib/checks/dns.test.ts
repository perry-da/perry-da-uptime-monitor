import { describe, it, expect } from 'bun:test';
import { runDnsCheck } from './dns';

// Real DNS resolution against real, stable public domains and a guaranteed
// non-existent one — same "no mocking" discipline as the rest of this
// directory. example.com is IANA-reserved specifically for documentation/
// testing and has a stable, minimal record set (A/AAAA present, no MX/TXT/NS
// surprises), making it a good target for asserting on the actual shape.

describe('runDnsCheck — resolvable domain', () => {
  it('records up and returns sorted A records for example.com', async () => {
    const result = await runDnsCheck('example.com');
    expect(result.status).toBe('up');
    expect(result.failureReason).toBeUndefined();
    expect(result.records.A.length).toBeGreaterThan(0);
    // sorted ascending — verifies the stable-comparison-key contract, not just presence
    const sorted = [...result.records.A].sort();
    expect(result.records.A).toEqual(sorted);
  });

  it('reports an empty array (not a failure) for a record type the domain has none of', async () => {
    const result = await runDnsCheck('example.com');
    expect(result.status).toBe('up');
    // example.com is not known to publish TXT records; either is fine, but if
    // it comes back empty that must not affect overall status.
    expect(Array.isArray(result.records.TXT)).toBe(true);
  });

  it('reports all six record types in the result shape regardless of which resolved', async () => {
    const result = await runDnsCheck('example.com');
    for (const type of ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME'] as const) {
      expect(Array.isArray(result.records[type])).toBe(true);
    }
  });
});

describe('runDnsCheck — unresolvable domain', () => {
  it('records down with a failure reason when neither A nor AAAA resolves', async () => {
    const result = await runDnsCheck('this-host-does-not-exist.invalid', { timeoutMs: 3_000 });
    expect(result.status).toBe('down');
    expect(result.failureReason).toBeDefined();
    expect(result.records.A).toEqual([]);
    expect(result.records.AAAA).toEqual([]);
  });
});

describe('runDnsCheck — argument validation', () => {
  it('throws on a non-positive timeout', async () => {
    await expect(runDnsCheck('example.com', { timeoutMs: 0 })).rejects.toThrow(TypeError);
    await expect(runDnsCheck('example.com', { timeoutMs: -1 })).rejects.toThrow(TypeError);
  });
});
