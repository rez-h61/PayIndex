// All credentials remain in HttpOnly cookies. This module only handles public status.
export async function withAdminLock<T>(operation: () => Promise<T>): Promise<T> {
  return navigator.locks ? await navigator.locks.request('payindex-admin-session', operation) : await operation();
}

function message(code: string) {
  if (code === 'rate_limited') return 'Too many sign-in attempts. Please wait a few minutes before trying again.';
  if (code === 'captcha_failed') return 'Verification expired or was not accepted. Please verify again.';
  if (code === 'invalid_credentials') return 'Email or password was not accepted. Please try again.';
  if (code === 'forbidden') return 'Your admin session has ended. Please sign in again.';
  if (code === 'setup_required') return 'Admin login setup is incomplete. Contact the site owner.';
  if (code === 'logout_incomplete') return 'Signed out on this browser, but server sign-out could not finish. Please contact the site owner.';
  return 'Admin service is temporarily unavailable. Please try again.';
}

async function request(action: string, body?: unknown): Promise<{ admin: boolean }> {
  return withAdminLock(async () => {
    const response = await fetch(`/api/admin?action=${action}`, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'X-PayIndex-Request': 'admin', 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(100_000),
    });
    const result = await response.json().catch(() => { throw new Error(message('unavailable')); });
    if (!response.ok) throw new Error(message(result.code));
    return result;
  });
}
let checking: Promise<boolean> | undefined;
export function adminSession(): Promise<boolean> {
  checking ??= request('session').then(body => body.admin === true).finally(() => { checking = undefined; });
  return checking;
}
export async function adminSignIn(email: string, password: string, captchaToken: string) {
  await request('login', { email, password, captchaToken });
}
export async function adminSignOut() { await request('logout'); }
