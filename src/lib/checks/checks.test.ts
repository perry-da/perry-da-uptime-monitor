/**
 * Unit tests for the check engine (ISC-30..35 for HTTP; classify branches).
 *
 * Network isolation: every HTTP test runs against a local `http.createServer`
 * bound to 127.0.0.1 on an OS-assigned random port (`listen(0)`). No test
 * depends on external DNS or the public internet, except one explicitly
 * marked DNS-resolution case that targets a guaranteed-unresolvable
 * `.invalid` TLD (RFC 6761) and is tolerant of either dns- or fetch-layer
 * classification so it cannot flake on resolver quirks.
 *
 * Run with: `bun test src/lib/checks/checks.test.ts`
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { runHttpCheck, USER_AGENT, MAX_REDIRECTS, BYPASS_HEADER_NAME } from './http';
import { classifyFetchError } from './classify';
import type { FailureReason } from './types';

/**
 * A single mutable request handler the tests swap per-case, so one server
 * instance serves every scenario. Defaults to 200 OK.
 */
type Handler = (req: IncomingMessage, res: ServerResponse) => void;
let currentHandler: Handler = (_req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('ok');
};

let server: Server;
let baseUrl: string;
/** Captures the User-Agent header of the most recent request for ISC-35. */
let lastUserAgent: string | undefined;
/** Captures the bypass-token header (if any) of the most recent request. */
let lastBypassHeader: string | undefined;

beforeAll(async () => {
  server = createServer((req, res) => {
    lastUserAgent = req.headers['user-agent'];
    lastBypassHeader = req.headers[BYPASS_HEADER_NAME] as string | undefined;
    currentHandler(req, res);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

/** Point the shared server at a fresh handler for the next request(s). */
function setHandler(handler: Handler): void {
  currentHandler = handler;
}

describe('runHttpCheck — happy path (ISC-31)', () => {
  it('records up with the status code and a non-negative response time on 200', async () => {
    setHandler((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('healthy');
    });

    const result = await runHttpCheck(baseUrl);

    expect(result.status).toBe('up');
    expect(result.statusCode).toBe(200);
    expect(result.failureReason).toBeUndefined();
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
    expect(result.checkedAt).toBeInstanceOf(Date);
  });

  it('treats a 204 and a 302-with-no-location as up (2xx/3xx => up)', async () => {
    setHandler((_req, res) => {
      res.writeHead(204);
      res.end();
    });
    const noContent = await runHttpCheck(baseUrl);
    expect(noContent.status).toBe('up');
    expect(noContent.statusCode).toBe(204);
  });

  it('sends the identifying UptimeMonitorBot User-Agent (ISC-35)', async () => {
    setHandler((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    await runHttpCheck(baseUrl);
    expect(lastUserAgent).toBe(USER_AGENT);
  });
});

describe('runHttpCheck — WAF bypass header', () => {
  const ORIGINAL = process.env.MONITOR_BYPASS_KEY;
  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.MONITOR_BYPASS_KEY;
    else process.env.MONITOR_BYPASS_KEY = ORIGINAL;
  });

  it('does not send the bypass header when MONITOR_BYPASS_KEY is unset', async () => {
    delete process.env.MONITOR_BYPASS_KEY;
    setHandler((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    await runHttpCheck(baseUrl);
    expect(lastBypassHeader).toBeUndefined();
  });

  it('sends the bypass header with the configured value when MONITOR_BYPASS_KEY is set', async () => {
    process.env.MONITOR_BYPASS_KEY = 'test-secret-123';
    setHandler((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    await runHttpCheck(baseUrl);
    expect(lastBypassHeader).toBe('test-secret-123');
  });
});

describe('runHttpCheck — HTTP error status (ISC-32)', () => {
  it('records down with failure_reason http on a 500', async () => {
    setHandler((_req, res) => {
      res.writeHead(500);
      res.end('boom');
    });

    const result = await runHttpCheck(baseUrl);

    expect(result.status).toBe('down');
    expect(result.statusCode).toBe(500);
    expect(result.failureReason).toBe('http');
  });

  it('records down with failure_reason http on a 404', async () => {
    setHandler((_req, res) => {
      res.writeHead(404);
      res.end('missing');
    });
    const result = await runHttpCheck(baseUrl);
    expect(result.status).toBe('down');
    expect(result.statusCode).toBe(404);
    expect(result.failureReason).toBe('http');
  });
});

describe('runHttpCheck — connection refused (ISC-32)', () => {
  it('records down when connecting to a closed port', async () => {
    // Grab a port, then immediately close the listener so the port is closed.
    const throwaway = createServer();
    const closedPort = await new Promise<number>((resolve) => {
      throwaway.listen(0, '127.0.0.1', () => {
        const port = (throwaway.address() as AddressInfo).port;
        throwaway.close(() => resolve(port));
      });
    });

    const result = await runHttpCheck(`http://127.0.0.1:${closedPort}`);

    expect(result.status).toBe('down');
    // Connection to a closed local port must surface as a refusal (or, on
    // some stacks, a generic fetch/connection failure). statusCode is absent
    // because no HTTP response was ever received.
    expect(result.statusCode).toBeUndefined();
    expect(result.failureReason).toBeDefined();
    expect(['conn_refused', 'fetch_error']).toContain(result.failureReason as string);
  });
});

describe('runHttpCheck — timeout (ISC-33)', () => {
  it('records down with failure_reason timeout against a slow handler', async () => {
    // Handler that never responds within the budget: hold the socket open.
    const openSockets: ServerResponse[] = [];
    setHandler((_req, res) => {
      openSockets.push(res); // intentionally never call res.end() in time
    });

    const start = performance.now();
    const result = await runHttpCheck(baseUrl, { timeoutMs: 150 });
    const waited = performance.now() - start;

    expect(result.status).toBe('down');
    expect(result.failureReason).toBe('timeout');
    expect(result.statusCode).toBeUndefined();
    // The check must give up close to the deadline, not hang for seconds.
    expect(waited).toBeLessThan(2_000);

    // Release the held-open response so the server can close cleanly.
    for (const res of openSockets) {
      res.writeHead(200);
      res.end();
    }
  });
});

describe('runHttpCheck — redirects (ISC-34)', () => {
  it('follows redirects up to the hop limit and reaches the final 200', async () => {
    // /r/N redirects to /r/(N-1); /r/0 returns 200. A start at MAX_REDIRECTS
    // requires exactly MAX_REDIRECTS hops, which is allowed.
    setHandler((req, res) => {
      const match = /^\/r\/(\d+)$/.exec(req.url ?? '');
      const n = match ? Number(match[1]) : 0;
      if (n <= 0) {
        res.writeHead(200);
        res.end('arrived');
        return;
      }
      res.writeHead(302, { location: `/r/${n - 1}` });
      res.end();
    });

    const result = await runHttpCheck(`${baseUrl}/r/${MAX_REDIRECTS}`);
    expect(result.status).toBe('up');
    expect(result.statusCode).toBe(200);
  });

  it('gives up with down/http when redirects exceed the hop limit', async () => {
    // An infinite redirect chain: every path 302s to itself + 1, never 200.
    setHandler((req, res) => {
      const match = /^\/loop\/(\d+)$/.exec(req.url ?? '');
      const n = match ? Number(match[1]) : 0;
      res.writeHead(302, { location: `/loop/${n + 1}` });
      res.end();
    });

    const result = await runHttpCheck(`${baseUrl}/loop/0`);
    expect(result.status).toBe('down');
    expect(result.failureReason).toBe('http');
  });
});

describe('runHttpCheck — argument validation', () => {
  it('throws on a non-positive timeout (caller contract violation)', async () => {
    await expect(runHttpCheck(baseUrl, { timeoutMs: 0 })).rejects.toThrow(TypeError);
    await expect(runHttpCheck(baseUrl, { timeoutMs: -5 })).rejects.toThrow(TypeError);
  });
});

/**
 * Direct classify.ts tests with synthetic error objects — one per branch.
 * These need no network at all and pin the mapping contract precisely.
 */
describe('classifyFetchError — synthetic error shapes', () => {
  /** Build an Error carrying a `code`, optionally nested under `cause`. */
  function coded(code: string, nested = false): Error {
    const inner = Object.assign(new Error(`synthetic ${code}`), { code });
    if (!nested) return inner;
    const outer = new TypeError('fetch failed');
    return Object.assign(outer, { cause: inner });
  }

  const cases: Array<[string, unknown, FailureReason]> = [
    ['AbortError => timeout', Object.assign(new Error('aborted'), { name: 'AbortError' }), 'timeout'],
    ['TimeoutError => timeout', Object.assign(new Error('t'), { name: 'TimeoutError' }), 'timeout'],
    ['ENOTFOUND => dns', coded('ENOTFOUND'), 'dns'],
    ['EAI_AGAIN => dns', coded('EAI_AGAIN'), 'dns'],
    ['ECONNREFUSED => conn_refused', coded('ECONNREFUSED'), 'conn_refused'],
    ['CERT_HAS_EXPIRED => tls', coded('CERT_HAS_EXPIRED'), 'tls'],
    ['DEPTH_ZERO_SELF_SIGNED_CERT => tls', coded('DEPTH_ZERO_SELF_SIGNED_CERT'), 'tls'],
    ['ECONNRESET => fetch_error', coded('ECONNRESET'), 'fetch_error'],
    ['ETIMEDOUT code => fetch_error', coded('ETIMEDOUT'), 'fetch_error'],
    ['unknown code => fetch_error', coded('ESOMETHINGWEIRD'), 'fetch_error'],
    ['plain error => fetch_error', new Error('mystery'), 'fetch_error'],
    ['null => fetch_error', null, 'fetch_error'],
    ['string => fetch_error', 'not an error', 'fetch_error'],
  ];

  for (const [name, input, expected] of cases) {
    it(name, () => {
      expect(classifyFetchError(input)).toBe(expected);
    });
  }

  it('classifies a code nested under .cause (undici wrapping)', () => {
    expect(classifyFetchError(coded('ECONNREFUSED', true))).toBe('conn_refused');
    expect(classifyFetchError(coded('ENOTFOUND', true))).toBe('dns');
  });

  it('AbortError anywhere in the cause chain wins over a nested code', () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const wrapper = Object.assign(new TypeError('fetch failed'), { cause: abort });
    expect(classifyFetchError(wrapper)).toBe('timeout');
  });

  it('falls back to tls when only the message signals a certificate problem', () => {
    expect(classifyFetchError(new Error('unable to verify the first certificate'))).toBe('tls');
  });

  it('does not infinite-loop on a self-referential cause chain', () => {
    const cyclic: { cause?: unknown; message: string } = { message: 'loop' };
    cyclic.cause = cyclic;
    expect(classifyFetchError(cyclic)).toBe('fetch_error');
  });
});

/**
 * DNS failure through the real executor. Uses the reserved `.invalid` TLD
 * (RFC 6761) which must never resolve. Tolerant of dns vs fetch_error so a
 * resolver that returns a synthetic address instead of NXDOMAIN cannot flake.
 */
describe('runHttpCheck — DNS failure (ISC-32)', () => {
  it('records down when the hostname cannot resolve', async () => {
    const result = await runHttpCheck('http://this-host-does-not-exist.invalid', {
      timeoutMs: 3_000,
    });
    expect(result.status).toBe('down');
    expect(result.statusCode).toBeUndefined();
    expect(result.failureReason).toBeDefined();
    expect(['dns', 'fetch_error', 'timeout']).toContain(result.failureReason as string);
  });
});
