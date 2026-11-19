import { test, expect } from '@playwright/test';
import type { Database } from '@market/db';
import { createHttpServer, logRequestPath } from '@market/core/http';
import { CLIENT_IP_HEADER } from '@market/core/client-ip';

test('request logs redact reset credentials across auth surfaces and URL encodings', () => {
  for (const prefix of [
    '/api/auth',
    '/admin/auth',
    '/oauth/auth',
    '/networks/network-id/oauth/auth',
  ]) {
    for (const suffix of [
      '/reset-password/secret-token',
      '/%72eset-password/secret%2Ftoken',
      '/reset-password/secret%0Atoken',
    ]) {
      const logged = logRequestPath(
        prefix + suffix + '?callbackURL=private-query',
      );
      expect(logged).toContain('/reset-password/[REDACTED]');
      expect(logged).not.toMatch(/secret|private-query/);
    }
  }
  expect(
    logRequestPath('/api/auth/%72eset-password/%invalid-secret'),
  ).not.toContain('secret');
  expect(logRequestPath('/trpc/me?input=private-query')).toBe('/trpc/me');
});

test('request budgets and batch limits reject before DB hooks and ignore spoofed IP headers', async () => {
  let reads = 0;
  const db = {
    execute: async () => {
      reads++;
    },
  } as unknown as Database;
  const environment = process.env.NODE_ENV;
  const vercel = process.env.VERCEL;
  process.env.NODE_ENV = 'production';
  process.env.VERCEL = '0';
  const server = createHttpServer(db);
  if (environment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = environment;
  server.log.level = 'silent';
  server.addHook('onRequest', async () => {
    await db.execute(undefined as never);
  });
  server.get('/api/public/probe', async (request) => ({
    ip: request.headers[CLIENT_IP_HEADER],
  }));
  server.get('/trpc/:path', async () => ({ ok: true }));
  server.get('/admin/trpc/:path', async () => ({ ok: true }));
  const realNow = Date.now;
  try {
    await server.ready();
    for (let i = 0; i < 60; i++) {
      const response = await server.inject({
        method: 'GET',
        url: '/api/public/probe',
        remoteAddress: '198.51.100.10',
        headers: {
          'x-forwarded-for': `203.0.113.${i}`,
          [CLIENT_IP_HEADER]: `203.0.113.${i}`,
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().ip).toBe('198.51.100.10');
    }
    expect(reads).toBe(60);
    const blocked = await server.inject({
      method: 'GET',
      url: '/api/public/probe',
      remoteAddress: '198.51.100.10',
    });
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(reads).toBe(60);
    expect(
      (
        await server.inject({
          method: 'GET',
          url: '/api/public/probe',
          remoteAddress: '198.51.100.11',
        })
      ).statusCode,
    ).toBe(200);
    for (const prefix of ['/trpc/', '/admin/trpc/']) {
      for (const delimiter of [',', '%2C']) {
        const response = await server.inject({
          method: 'GET',
          url: prefix + Array(11).fill('me').join(delimiter) + '?batch=1',
        });
        expect(response.statusCode).toBe(400);
      }
    }
    expect(reads).toBe(61);
    Date.now = () => realNow() + 61_000;
    expect(
      (
        await server.inject({
          method: 'GET',
          url: '/api/public/probe',
          remoteAddress: '198.51.100.10',
        })
      ).statusCode,
    ).toBe(200);
    expect(reads).toBe(62);
  } finally {
    Date.now = realNow;
    if (vercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = vercel;
    await server.close();
  }
});

test('readiness shares concurrent checks and briefly caches successful and failed DB probes', async () => {
  let reads = 0;
  let available = true;
  const server = createHttpServer({
    execute: async () => {
      reads++;
      if (!available) throw new Error('offline');
    },
  } as unknown as Database);
  server.log.level = 'silent';
  const realNow = Date.now;
  try {
    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        server.inject({ method: 'GET', url: '/ready' }),
      ),
    );
    expect(responses.every((response) => response.statusCode === 200)).toBe(
      true,
    );
    expect(reads).toBe(1);
    available = false;
    Date.now = () => realNow() + 1100;
    expect(
      (await server.inject({ method: 'GET', url: '/ready' })).statusCode,
    ).toBe(503);
    expect(
      (await server.inject({ method: 'GET', url: '/ready' })).statusCode,
    ).toBe(503);
    expect(reads).toBe(2);
  } finally {
    Date.now = realNow;
    await server.close();
  }
});
