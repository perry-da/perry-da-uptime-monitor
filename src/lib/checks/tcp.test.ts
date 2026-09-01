import { describe, it, expect } from 'bun:test';
import { createServer, type Server } from 'node:net';
import { runTcpCheck } from './tcp';

function listenOnRandomPort(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') resolve(address.port);
    });
  });
}

describe('runTcpCheck — open port (ISC-37)', () => {
  it('records up when the port accepts a connection', async () => {
    const server = createServer((socket) => socket.end());
    const port = await listenOnRandomPort(server);
    try {
      const result = await runTcpCheck('127.0.0.1', port);
      expect(result.status).toBe('up');
      expect(result.failureReason).toBeUndefined();
      expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
    } finally {
      server.close();
    }
  });
});

describe('runTcpCheck — refused port (ISC-37)', () => {
  it('records down with failure_reason conn_refused — the OPPOSITE interpretation from ping', async () => {
    // Bind then immediately close to get a port that is guaranteed to refuse.
    const probe = createServer();
    const port = await listenOnRandomPort(probe);
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    const result = await runTcpCheck('127.0.0.1', port);
    expect(result.status).toBe('down');
    expect(result.failureReason).toBe('conn_refused'); // NOT 'up' — this is the tcp/ping asymmetry
  });
});

describe('runTcpCheck — DNS failure', () => {
  it('records down with failure_reason dns for an unresolvable hostname', async () => {
    const result = await runTcpCheck('this-host-does-not-exist.invalid', 443, { timeoutMs: 3_000 });
    expect(result.status).toBe('down');
    expect(result.failureReason).toBeDefined();
    expect(['dns', 'unreachable']).toContain(result.failureReason as string);
  });
});

describe('runTcpCheck — timeout', () => {
  it('records down with failure_reason timeout or unreachable against a non-routable address', async () => {
    // TEST-NET-1 (RFC 5737) — reserved, never routable. Sandboxes vary on whether this
    // manifests as an immediate network-unreachable error or a genuine connect timeout,
    // so both are accepted; what matters is it never reports `up`.
    const result = await runTcpCheck('192.0.2.1', 443, { timeoutMs: 500 });
    expect(result.status).toBe('down');
    expect(result.failureReason).toBeDefined();
    expect(['timeout', 'unreachable']).toContain(result.failureReason as string);
  });
});
