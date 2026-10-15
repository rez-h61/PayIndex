import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const MAX_SESSION_SECONDS = 12 * 60 * 60;
const MAX_BODY = 4 * 1024 * 1024 + 65536;
type Session = { access: string; refresh: string; expires: number; until: number };
type Settings = { origin: string; url: string; key: string; secret: Buffer; secure: boolean; cookie: string };
class Failure extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

function settings(env: Record<string, string | undefined>): Settings {
  const origin = new URL(env.PAYINDEX_APP_ORIGIN ?? '');
  const local = !env.VERCEL && env.NODE_ENV !== 'production' &&
    origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname);
  const url = new URL(env.SUPABASE_URL ?? '');
  const key = env.SUPABASE_PUBLISHABLE_KEY ?? '';
  const secretText = env.PAYINDEX_COOKIE_SECRET ?? '';
  const secret = Buffer.from(secretText, 'base64');
  if ((!local && origin.protocol !== 'https:') || origin.href !== origin.origin + '/' ||
      url.protocol !== 'https:' || url.username || url.password || !key ||
      secret.length !== 32 || secret.toString('base64') !== secretText) throw new Failure(503, 'setup_required');
  return { origin: origin.origin, url: url.origin, key, secret, secure: !local,
    cookie: local ? 'payindex-admin-dev' : '__Host-payindex-admin' };
}

export function seal(session: Session, secret: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secret, iv);
  cipher.setAAD(Buffer.from('payindex-admin-v1'));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(session)), cipher.final()]);
  const value = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
  if (value.length > 3700) throw new Failure(503, 'session_too_large');
  return value;
}

export function unseal(value: string, secret: Buffer): Session | null {
  try {
    if (!/^[A-Za-z0-9_-]{40,3700}$/.test(value)) return null;
    const bytes = Buffer.from(value, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', secret, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from('payindex-admin-v1'));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const session = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
    if (typeof session.access !== 'string' || !session.access || typeof session.refresh !== 'string' || !session.refresh ||
        !Number.isFinite(session.expires) || !Number.isFinite(session.until) || session.until <= Date.now() / 1000) return null;
    return session;
  } catch { return null; }
}

function cookie(value: string, config: Settings, maxAge: number) {
  return `${config.cookie}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0, Math.floor(maxAge))}${config.secure ? '; Secure' : ''}`;
}
function readSession(req: Request, config: Settings) {
  const values = (req.headers.get('cookie') ?? '').split(';').map(v => v.trim()).filter(v => v.startsWith(config.cookie + '='));
  return values.length === 1 ? unseal(values[0].slice(config.cookie.length + 1), config.secret) : null;
}
async function readBody(req: Request, max: number) {
  if (Number(req.headers.get('content-length')) > max) throw new Failure(413, 'invalid_image');
  const reader = req.body?.getReader();
  if (!reader) throw new Failure(400, 'invalid');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.length;
    if (size > max) { await reader.cancel(); throw new Failure(413, 'invalid_image'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

// Deliberately no automatic retries: replaying a mutation or a refresh is unsafe.
async function upstream(config: Settings, path: string, init: RequestInit = {}) {
  try {
    return await fetch(config.url + path, { ...init, redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(90_000),
      headers: { apikey: config.key, ...init.headers } });
  } catch { throw new Failure(503, 'unavailable'); }
}
async function activeAdmin(config: Settings, access: string) {
  const headers = { Authorization: `Bearer ${access}` };
  const user = await upstream(config, '/auth/v1/user', { headers });
  if (user.status === 401 || user.status === 403) throw new Failure(401, 'forbidden');
  if (!user.ok) throw new Failure(503, 'unavailable');
  // This RPC also checks auth.sessions, so a logged-out session cannot replay its JWT.
  const allowed = await upstream(config, '/rest/v1/rpc/is_active_directory_admin', {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}',
  });
  if (!allowed.ok) throw new Failure(503, 'setup_required');
  if (await allowed.json() !== true) throw new Failure(403, 'forbidden');
}
async function refresh(config: Settings, session: Session): Promise<Session> {
  const result = await upstream(config, '/auth/v1/token?grant_type=refresh_token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: session.refresh }),
  });
  if (result.status === 429) throw new Failure(429, 'rate_limited');
  if (result.status >= 500) throw new Failure(503, 'unavailable');
  if (!result.ok) throw new Failure(401, 'forbidden');
  return sessionFrom(await result.json(), session.until);
}
function sessionFrom(body: Record<string, unknown>, until = Date.now() / 1000 + MAX_SESSION_SECONDS): Session {
  if (typeof body.access_token !== 'string' || typeof body.refresh_token !== 'string' ||
      typeof body.expires_in !== 'number' || body.expires_in <= 0) throw new Failure(503, 'unavailable');
  return { access: body.access_token, refresh: body.refresh_token,
    expires: Date.now() / 1000 + body.expires_in, until };
}

export async function handleAdmin(req: Request, env: Record<string, string | undefined> = process.env): Promise<Response> {
  const headers = new Headers({ 'Cache-Control': 'private, no-store, max-age=0',
    'Vercel-CDN-Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store',
    'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Cookie' });
  const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });
  let config: Settings | undefined;
  try {
    if (req.method !== 'POST') return reply({ code: 'method' }, 405);
    config = settings(env);
    // Strict Origin + a non-simple custom header protect login/logout and mutations
    // from CSRF. Never derive the trusted origin from Host or forwarded headers.
    if (req.headers.get('origin') !== config.origin || req.headers.get('x-payindex-request') !== 'admin' ||
        (req.headers.has('sec-fetch-site') && req.headers.get('sec-fetch-site') !== 'same-origin')) return reply({ code: 'csrf' }, 403);
    const action = new URL(req.url).searchParams.get('action');
    if (!['login', 'session', 'logout', 'manage'].includes(action ?? '')) return reply({ code: 'invalid' }, 404);
    let session = readSession(req, config);
    if (action === 'login') {
      if (req.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new Failure(415, 'invalid');
      let body;
      try { body = JSON.parse((await readBody(req, 8192)).toString()); } catch (e) { if (e instanceof Failure) throw e; throw new Failure(400, 'invalid'); }
      if (!body || typeof body.email !== 'string' || body.email.length > 254 ||
          typeof body.password !== 'string' || !body.password || body.password.length > 1024 ||
          typeof body.captchaToken !== 'string' || !body.captchaToken || body.captchaToken.length > 4096) throw new Failure(400, 'captcha_failed');
      const result = await upstream(config, '/auth/v1/token?grant_type=password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: body.email.trim(), password: body.password, gotrue_meta_security: { captcha_token: body.captchaToken } }),
      });
      if (!result.ok) {
        if (result.status === 429) throw new Failure(429, 'rate_limited');
        if (result.status >= 500) throw new Failure(503, 'unavailable');
        const error = await result.json().catch(() => ({}));
        throw new Failure(401, error.error_code === 'captcha_failed' || error.code === 'captcha_failed' ? 'captcha_failed' : 'invalid_credentials');
      }
      session = sessionFrom(await result.json());
      try { await activeAdmin(config, session.access); }
      catch (e) {
        await upstream(config, '/auth/v1/logout?scope=local', { method: 'POST', headers: { Authorization: `Bearer ${session.access}` } }).catch(() => {});
        throw e;
      }
      headers.set('Set-Cookie', cookie(seal(session, config.secret), config, session.until - Date.now() / 1000));
      return reply({ admin: true });
    }
    if (action === 'logout') {
      // Always remove the browser cookie, even during an upstream outage.
      headers.set('Set-Cookie', cookie('', config, 0));
      if (session) {
        if (session.expires <= Date.now() / 1000) session = await refresh(config, session);
        const result = await upstream(config, '/auth/v1/logout?scope=local', { method: 'POST', headers: { Authorization: `Bearer ${session.access}` } });
        if (!result.ok && result.status !== 401 && result.status !== 403) throw new Failure(503, 'logout_incomplete');
      }
      return reply({ admin: false });
    }
    if (!session) {
      headers.set('Set-Cookie', cookie('', config, 0));
      return reply(action === 'session' ? { admin: false } : { code: 'forbidden' }, action === 'session' ? 200 : 401);
    }
    const refreshed = session.expires <= Date.now() / 1000 + 60;
    if (refreshed) session = await refresh(config, session);
    await activeAdmin(config, session.access);
    if (refreshed) headers.set('Set-Cookie', cookie(seal(session, config.secret), config, session.until - Date.now() / 1000));
    if (action === 'session') return reply({ admin: true });
    const type = req.headers.get('content-type') ?? '';
    if (!type.startsWith('multipart/form-data;')) throw new Failure(415, 'invalid');
    const bytes = await readBody(req, MAX_BODY);
    const result = await upstream(config, '/functions/v1/directory-manage', {
      method: 'POST', headers: { Authorization: `Bearer ${session.access}`, 'Content-Type': type }, body: bytes,
    });
    // Allowlist responses; never relay arbitrary headers, cookies or token bodies.
    const body = await result.json().catch(() => ({}));
    if (!result.ok) return reply({ code: typeof body.code === 'string' ? body.code : 'save_failed' }, result.status);
    return reply({ id: body.id, changed: body.changed, saved: body.saved, cleanupPending: body.cleanupPending });
  } catch (error) {
    const failure = error instanceof Failure ? error : new Failure(503, 'unavailable');
    if (config && (failure.status === 401 || failure.status === 403)) headers.set('Set-Cookie', cookie('', config, 0));
    // Log classification only; credentials, request bodies and tokens stay out of logs.
    if (failure.status >= 500) console.error('PayIndex admin API failure', failure.code);
    return reply({ code: failure.code }, failure.status);
  }
}
