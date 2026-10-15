import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAdmin, seal, unseal } from '../server/admin';

const secret = Buffer.alloc(32, 7);
const origin = 'https://payindex.example.test';
const session = () => ({ access: 'private-access-token', refresh: 'private-refresh-token', expires: Date.now() / 1000 + 3600, until: Date.now() / 1000 + 43200 });
const authBody = { access_token: 'private-access-token', refresh_token: 'private-refresh-token', expires_in: 3600 };
const req = (action: string, options: { body?: BodyInit; cookie?: string; headers?: Record<string, string>; method?: string } = {}) => new Request(`${origin}/api/admin?action=${action}`, {
  method: options.method ?? 'POST',
  headers: { Origin: origin, 'X-PayIndex-Request': 'admin', 'Content-Type': 'application/json', ...(options.cookie ? { Cookie: options.cookie } : {}), ...options.headers },
  body: options.method === 'GET' ? undefined : options.body ?? '{}',
});
const loginBody = JSON.stringify({ email: 'admin@example.test', password: 'fixture-password', captchaToken: 'fixture-captcha' });
let active: boolean;
let admin: boolean;
let calls: { url: string; init: RequestInit }[];
beforeEach(() => {
  vi.stubEnv('PAYINDEX_APP_ORIGIN', origin);
  vi.stubEnv('SUPABASE_URL', 'https://fixture.supabase.co');
  vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'fixture-public-key');
  vi.stubEnv('PAYINDEX_COOKIE_SECRET', secret.toString('base64'));
  active = true; admin = true; calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/auth/v1/token')) return Response.json(authBody);
    if (String(url).includes('/auth/v1/user')) return Response.json({ id: 'admin-id' });
    if (String(url).includes('/is_active_directory_admin')) return Response.json(active && admin);
    if (String(url).includes('/auth/v1/logout')) { active = false; return new Response(null, { status: 204 }); }
    if (String(url).includes('/functions/v1/directory-manage')) return Response.json({ id: 'saved-id', cleanupPending: false, access_token: 'never-relay-this' });
    throw new Error('Unexpected fixture URL');
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('admin cookie API security boundaries', () => {
  it('issues an encrypted Secure HttpOnly host cookie and never returns tokens to JavaScript', async () => {
    const result = await handleAdmin(req('login', { body: loginBody }));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ admin: true });
    const value = result.headers.get('set-cookie')!;
    expect(value).toContain('__Host-payindex-admin=');
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) expect(value).toContain(flag);
    expect(value).not.toContain('Domain=');
    expect(value).not.toContain('private-access-token');
    expect(value).not.toContain('private-refresh-token');
    expect(result.headers.get('Cache-Control')).toContain('no-store');
    const submitted = JSON.parse(String(calls[0].init.body));
    expect(submitted.gotrue_meta_security.captcha_token).toBe('fixture-captcha');
  });
  it('requires CAPTCHA even when calling login directly', async () => {
    const result = await handleAdmin(req('login', { body: JSON.stringify({ email: 'admin@example.test', password: 'fixture-password' }) }));
    expect(result.status).toBe(400); expect(calls).toHaveLength(0);
  });
  it.each(['login', 'logout', 'session', 'manage'])('blocks cross-site and missing-Origin %s requests before calling Supabase', async action => {
    for (const headers of [{ Origin: 'https://evil.example.test' }, { Origin: 'null' }, { 'X-PayIndex-Request': '' }, { 'Sec-Fetch-Site': 'same-site' }]) {
      expect((await handleAdmin(req(action, { headers }))).status).toBe(403);
    }
    const missing = req(action); missing.headers.delete('Origin');
    expect((await handleAdmin(missing)).status).toBe(403); expect(calls).toHaveLength(0);
  });
  it('rejects tampered, expired, duplicate and absent session cookies', async () => {
    const valid = seal(session(), secret);
    const expired = seal({ ...session(), until: Date.now() / 1000 - 1 }, secret);
    for (const cookie of ['', `__Host-payindex-admin=${valid.slice(0, -8)}AAAAAAAA`, `__Host-payindex-admin=${expired}`, `__Host-payindex-admin=${valid}; __Host-payindex-admin=${valid}`]) {
      expect((await handleAdmin(req('manage', { cookie }))).status).toBe(401);
    }
    expect(calls).toHaveLength(0);
    expect(unseal(valid, Buffer.alloc(32, 9))).toBeNull();
  });
  it('rejects authenticated non-admins and revokes their newly-created login', async () => {
    admin = false;
    expect((await handleAdmin(req('login', { body: loginBody }))).status).toBe(403);
    expect(calls.some(call => call.url.includes('/logout'))).toBe(true);
  });
  it('refreshes on the server without extending the absolute session lifetime', async () => {
    const old = { ...session(), expires: Date.now() / 1000 - 1 };
    const result = await handleAdmin(req('session', { cookie: `__Host-payindex-admin=${seal(old, secret)}` }));
    expect(await result.json()).toEqual({ admin: true });
    expect(calls.some(call => call.url.includes('grant_type=refresh_token'))).toBe(true);
    const cookieValue = result.headers.get('set-cookie')!.split(';')[0].split('=')[1];
    expect(unseal(cookieValue, secret)?.until).toBe(old.until);
    expect(unseal(cookieValue, secret)!.expires).toBeGreaterThan(old.expires);
  });
  it('clears and revokes logout, then denies a replayed pre-logout cookie', async () => {
    const cookie = `__Host-payindex-admin=${seal(session(), secret)}`;
    const logout = await handleAdmin(req('logout', { cookie }));
    expect(logout.status).toBe(200); expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');
    expect((await handleAdmin(req('manage', { cookie }))).status).toBe(403);
    expect(calls.some(call => call.url.includes('/directory-manage'))).toBe(false);
  });
  it('authenticates and forwards multipart mutations without exposing tokens in responses', async () => {
    const form = new FormData(); form.set('action', 'save_person'); form.set('display_name', 'Fixture');
    const multipart = new Request('https://fixture.test', { method: 'POST', body: form });
    const result = await handleAdmin(req('manage', {
      cookie: `__Host-payindex-admin=${seal(session(), secret)}`,
      body: await multipart.text(), headers: { 'Content-Type': multipart.headers.get('content-type')! },
    }));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ id: 'saved-id', cleanupPending: false });
    const forwarded = calls.find(call => call.url.includes('/directory-manage'))!;
    expect((forwarded.init.headers as Record<string, string>).Authorization).toBe('Bearer private-access-token');
  });
  it('enforces request bounds before forwarding uploads', async () => {
    const result = await handleAdmin(req('manage', {
      cookie: `__Host-payindex-admin=${seal(session(), secret)}`,
      headers: { 'Content-Type': 'multipart/form-data; boundary=fixture', 'Content-Length': '5000000' },
    }));
    expect(result.status).toBe(413);
    expect(calls.some(call => call.url.includes('/directory-manage'))).toBe(false);
  });
  it('fails closed when production configuration is missing or insecure', async () => {
    vi.stubEnv('PAYINDEX_COOKIE_SECRET', 'not-a-key');
    expect((await handleAdmin(req('login', { body: loginBody }))).status).toBe(503);
    expect(calls).toHaveLength(0);
  });
  it('preserves the cookie during temporary upstream failures and rate limiting', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 429 })));
    const old = { ...session(), expires: Date.now() / 1000 - 1 };
    const result = await handleAdmin(req('session', { cookie: `__Host-payindex-admin=${seal(old, secret)}` }));
    expect(result.status).toBe(429); expect(result.headers.has('set-cookie')).toBe(false);
  });
});
