import { describe, it, expect } from 'bun:test';
import { createServer as createTlsServer, type TLSSocket } from 'node:tls';
import { createServer as createNetServer } from 'node:net';
import forge from 'node-forge';
import { runSslCheck } from './ssl';

/**
 * Generates a self-signed cert/key pair with an explicit `notAfter` date.
 * `openssl req -x509 -days N` in this environment only accepts a *relative*
 * future duration from the real system clock — there is no way to produce an
 * already-expired certificate through it. `node-forge` gives direct control
 * over `certificate.validity.notAfter`, which is the only way to exercise
 * ISC-41 (already-expired) deterministically without a live time machine.
 */
function generateCert(notAfter: Date): { key: string; cert: string } {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
  cert.validity.notAfter = notAfter;
  const attrs = [{ name: 'commonName', value: '127.0.0.1' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return {
    key: forge.pki.privateKeyToPem(keys.privateKey),
    cert: forge.pki.certificateToPem(cert),
  };
}

async function withTlsServer(
  notAfter: Date,
  fn: (port: number) => Promise<void>,
): Promise<void> {
  const { key, cert } = generateCert(notAfter);
  const server = createTlsServer({ key, cert }, (socket: TLSSocket) => socket.end());
  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') resolve(addr.port);
    });
  });
  try {
    await fn(port);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe('runSslCheck — valid, not expiring soon (ISC-40, ISC-43)', () => {
  it('records up and reports certExpiresAt for a cert valid well beyond the warning window', async () => {
    const notAfter = new Date(Date.now() + 365 * DAY_MS);
    await withTlsServer(notAfter, async (port) => {
      const result = await runSslCheck('127.0.0.1', { port });
      expect(result.status).toBe('up');
      expect(result.failureReason).toBeUndefined();
      expect(result.certExpiresAt).toBeInstanceOf(Date);
      // OpenSSL/forge certs truncate sub-second precision — compare to the minute.
      expect(Math.abs(result.certExpiresAt!.getTime() - notAfter.getTime())).toBeLessThan(60_000);
    });
  });
});

describe('runSslCheck — expiring soon (ISC-40, ISC-42)', () => {
  it('records down with failure_reason cert_expiring_soon inside the warning threshold', async () => {
    const notAfter = new Date(Date.now() + 5 * DAY_MS); // inside the default 14-day window
    await withTlsServer(notAfter, async (port) => {
      const result = await runSslCheck('127.0.0.1', { port });
      expect(result.status).toBe('down');
      expect(result.failureReason).toBe('cert_expiring_soon');
      expect(result.certExpiresAt).toBeInstanceOf(Date);
    });
  });

  it('respects a custom warningDays threshold', async () => {
    const notAfter = new Date(Date.now() + 20 * DAY_MS); // outside default 14d, inside a 30d threshold
    await withTlsServer(notAfter, async (port) => {
      const defaultResult = await runSslCheck('127.0.0.1', { port });
      expect(defaultResult.status).toBe('up'); // 20 days > default 14-day window

      const customResult = await runSslCheck('127.0.0.1', { port, warningDays: 30 });
      expect(customResult.status).toBe('down');
      expect(customResult.failureReason).toBe('cert_expiring_soon');
    });
  });
});

describe('runSslCheck — already expired (ISC-40, ISC-41)', () => {
  it('records down with failure_reason cert_expired, distinct from cert_expiring_soon', async () => {
    const notAfter = new Date(Date.now() - 5 * DAY_MS);
    await withTlsServer(notAfter, async (port) => {
      const result = await runSslCheck('127.0.0.1', { port });
      expect(result.status).toBe('down');
      expect(result.failureReason).toBe('cert_expired');
      expect(result.certExpiresAt).toBeInstanceOf(Date);
    });
  });
});

describe('runSslCheck — connection failure', () => {
  it('records down with no certExpiresAt when the port refuses the connection', async () => {
    const probe = createNetServer();
    const closedPort = await new Promise<number>((resolve) => {
      probe.listen(0, '127.0.0.1', () => {
        const addr = probe.address();
        const port = addr && typeof addr === 'object' ? addr.port : 0;
        probe.close(() => resolve(port));
      });
    });
    const result = await runSslCheck('127.0.0.1', { port: closedPort });
    expect(result.status).toBe('down');
    expect(result.certExpiresAt).toBeUndefined();
    expect(result.failureReason).toBeDefined();
  });

  it('records down on DNS failure', async () => {
    const result = await runSslCheck('this-host-does-not-exist.invalid', { timeoutMs: 3_000 });
    expect(result.status).toBe('down');
    expect(result.failureReason).toBeDefined();
    expect(['dns', 'fetch_error']).toContain(result.failureReason as string);
  });
});

describe('runSslCheck — argument validation', () => {
  it('throws on a non-positive timeout', async () => {
    await expect(runSslCheck('127.0.0.1', { timeoutMs: 0 })).rejects.toThrow(TypeError);
  });
});
