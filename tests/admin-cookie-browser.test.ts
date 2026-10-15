import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { chromium } from '@playwright/test';
import { expect, it, vi } from 'vitest';
import { handleAdmin } from '../server/admin';

it('real browser sends HttpOnly cookies to the real API handler, refreshes, and signs out without exposing tokens', async () => {
  let active = true, refreshes = 0, writes = 0;
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes('grant_type=refresh_token')) refreshes++;
    if (url.includes('/auth/v1/token')) return Response.json({ access_token: 'private-access', refresh_token: 'private-refresh', expires_in: 120 });
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: 'fixture-admin' });
    if (url.endsWith('/is_active_directory_admin')) return Response.json(active);
    if (url.includes('/auth/v1/logout')) { active = false; return new Response(null, { status: 204 }); }
    if (url.includes('/directory-manage')) { writes++; return Response.json({ saved: true }); }
    throw new Error('Unexpected upstream fixture');
  });
  vi.stubGlobal('fetch', fetchMock);
  let origin = '';
  const server = createServer(async (req, res) => {
    if (!req.url?.startsWith('/api/admin')) { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Cookie integration fixture</title>'); return; }
    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(',') : value);
      const request = new Request(origin + req.url, { method: req.method, headers, body: Readable.toWeb(req), duplex: 'half' } as RequestInit);
      const response = await handleAdmin(request, {
        PAYINDEX_APP_ORIGIN: origin, SUPABASE_URL: 'https://fixture.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: 'fixture-public', PAYINDEX_COOKIE_SECRET: Buffer.alloc(32, 3).toString('base64'), NODE_ENV: 'test',
      });
      res.statusCode = response.status; response.headers.forEach((value, key) => res.setHeader(key, value));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch { res.statusCode = 500; res.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'chrome' : undefined });
  try {
    const context = await browser.newContext();
    const page = await context.newPage(); await page.goto(origin);
    const login = await page.evaluate(async () => {
      const result = await fetch('/api/admin?action=login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PayIndex-Request': 'admin' }, body: JSON.stringify({ email: 'fixture@example.test', password: 'fictional', captchaToken: 'fixture-captcha' }) });
      return { status: result.status, body: await result.json() };
    });
    expect(login).toEqual({ status: 200, body: { admin: true } });
    const cookies = await context.cookies();
    expect(cookies.find(cookie => cookie.name === 'payindex-admin-dev')).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' });
    expect(await page.evaluate(() => document.cookie)).toBe('');
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
    const call = (action: string) => page.evaluate(async action => {
      const form = new FormData(); form.set('action', 'save_person');
      const result = await fetch(`/api/admin?action=${action}`, { method: 'POST', headers: { 'X-PayIndex-Request': 'admin' }, body: action === 'manage' ? form : undefined });
      return { status: result.status, body: await result.json() };
    }, action);
    expect(await call('session')).toEqual({ status: 200, body: { admin: true } });
    expect(await call('manage')).toEqual({ status: 200, body: { saved: true } });
    expect(writes).toBe(1);
    vi.setSystemTime(Date.now() + 90_000);
    expect(await call('session')).toEqual({ status: 200, body: { admin: true } });
    expect(refreshes).toBe(1);
    expect(await call('logout')).toEqual({ status: 200, body: { admin: false } });
    expect(await context.cookies()).toEqual([]);
    expect((await call('manage')).status).toBe(401);
    expect(writes).toBe(1);
  } finally {
    vi.useRealTimers(); vi.unstubAllGlobals();
    await browser.close(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}, 60_000);
