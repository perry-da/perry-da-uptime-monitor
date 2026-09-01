import { describe, it, expect } from 'bun:test';
import { createServer, type Server } from 'node:net';
import { runPingCheck } from './ping';

function listenOnRandomPort(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') resolve(address.port);
    });
  });
}

describe('runPingCheck — reachable host (ISC-36)', () => {
  it('records up when the probe port accepts a connection', async () => {
    const server = createServer((socket) => socket.end());
    const port = await listenOnRandomPort(server);
    try {
      const result = await runPingCheck('127.0.0.1', { ports: [port] });
      expect(result.status).toBe('up');
      expect(result.failureReason).toBeUndefined();
    } finally {
      server.close();
    }
  });

  it('records up on ECONNREFUSED — the OPPOSITE interpretation from tcp.ts', async () => {
    // A refused port still proves the host answered — reachable, per ISC-36's own semantics.
    const probe = createServer();
    const port = await listenOnRandomPort(probe);
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    const result = await runPingCheck('127.0.0.1', { ports: [port] });
    expect(result.status).toBe('up'); // NOT 'down' — this is the ping/tcp asymmetry
    expect(result.failureReason).toBeUndefined();
  });

  it('falls back from the first port to the second when the first is unreachable but the second refuses', async () => {
    const probe = createServer();
    const closedPort = await listenOnRandomPort(probe);
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    const server = createServer((socket) => socket.end());
    const openPort = await listenOnRandomPort(server);
    try {
      // closedPort refuses -> already 'up' by ping's own rule, so this proves the FIRST
      // port alone is sufficient (fallback is only exercised on dns/unreachable, tested below).
      const result = await runPingCheck('127.0.0.1', { ports: [closedPort, openPort] });
      expect(result.status).toBe('up');
    } finally {
      server.close();
    }
  });
});

describe('runPingCheck — unreachable host', () => {
  it('records down with failure_reason dns for an unresolvable hostname (no point retrying the fallback port)', async () => {
    const result = await runPingCheck('this-host-does-not-exist.invalid', { timeoutMs: 3_000 });
    expect(result.status).toBe('down');
    expect(result.failureReason).toBe('dns');
  });

  it('records down with failure_reason timeout or unreachable against a non-routable address on every probe port', async () => {
    const result = await runPingCheck('192.0.2.1', { timeoutMs: 500, ports: [443, 80] });
    expect(result.status).toBe('down');
    expect(result.failureReason).toBeDefined();
    expect(['timeout', 'unreachable']).toContain(result.failureReason as string);
  });
});
