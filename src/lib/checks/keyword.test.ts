import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { runKeywordCheck } from './keyword';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;
let currentHandler: Handler = (_req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('ok');
};

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => currentHandler(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

function setHandler(handler: Handler): void {
  currentHandler = handler;
}

describe('runKeywordCheck — keyword present (ISC-38)', () => {
  it('records up when the response body contains the keyword', async () => {
    setHandler((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('all systems operational, no incidents');
    });
    const result = await runKeywordCheck(baseUrl, 'operational');
    expect(result.status).toBe('up');
    expect(result.statusCode).toBe(200);
    expect(result.failureReason).toBeUndefined();
  });

  it('checks the keyword even on a non-2xx response', async () => {
    setHandler((_req, res) => {
      res.writeHead(503, { 'content-type': 'text/plain' });
      res.end('maintenance mode: operational again soon');
    });
    const result = await runKeywordCheck(baseUrl, 'operational');
    expect(result.status).toBe('up');
    expect(result.statusCode).toBe(503);
  });
});

describe('runKeywordCheck — keyword missing (ISC-38)', () => {
  it('records down with failure_reason keyword_missing when the body lacks the keyword', async () => {
    setHandler((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('something went wrong');
    });
    const result = await runKeywordCheck(baseUrl, 'operational');
    expect(result.status).toBe('down');
    expect(result.statusCode).toBe(200);
    expect(result.failureReason).toBe('keyword_missing');
  });
});

describe('runKeywordCheck — network failure (ISC-39)', () => {
  it('records down with failure_reason fetch_error on connection refused, distinct from keyword_missing', async () => {
    const throwaway = createServer();
    const closedPort = await new Promise<number>((resolve) => {
      throwaway.listen(0, '127.0.0.1', () => {
        const port = (throwaway.address() as AddressInfo).port;
        throwaway.close(() => resolve(port));
      });
    });
    const result = await runKeywordCheck(`http://127.0.0.1:${closedPort}`, 'operational');
    expect(result.status).toBe('down');
    expect(result.failureReason).toBe('fetch_error');
    expect(result.statusCode).toBeUndefined();
  });

  it('records down with failure_reason fetch_error on timeout', async () => {
    const openSockets: ServerResponse[] = [];
    setHandler((_req, res) => {
      openSockets.push(res); // never call res.end() in time
    });
    const result = await runKeywordCheck(baseUrl, 'operational', { timeoutMs: 150 });
    expect(result.status).toBe('down');
    expect(result.failureReason).toBe('fetch_error');
    for (const res of openSockets) {
      res.writeHead(200);
      res.end();
    }
  });

  it('records down with failure_reason fetch_error on DNS failure', async () => {
    const result = await runKeywordCheck('http://this-host-does-not-exist.invalid', 'x', { timeoutMs: 3_000 });
    expect(result.status).toBe('down');
    expect(result.failureReason).toBe('fetch_error');
  });
});

describe('runKeywordCheck — argument validation', () => {
  it('throws on a non-positive timeout', async () => {
    await expect(runKeywordCheck(baseUrl, 'x', { timeoutMs: 0 })).rejects.toThrow(TypeError);
  });
});
