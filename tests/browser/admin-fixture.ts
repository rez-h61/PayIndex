import type { Page, Route } from '@playwright/test';

// UI fixtures only. Server authentication/CSRF is tested against handleAdmin separately.
export async function installAdminFixture(page: Page, mutate: (route: Route) => Promise<unknown>) {
  await page.route('**/api/admin?*', async route => {
    const action = new URL(route.request().url()).searchParams.get('action');
    const admin = (route.request().headers().cookie ?? '').includes('payindex-admin-fixture=opaque');
    const reply = (body: unknown, cookie?: string) => route.fulfill({
      contentType: 'application/json', body: JSON.stringify(body),
      headers: { 'Cache-Control': 'no-store', ...(cookie ? { 'Set-Cookie': cookie } : {}) },
    });
    if (action === 'login') return reply({ admin: true }, 'payindex-admin-fixture=opaque; Path=/; HttpOnly; SameSite=Strict');
    if (action === 'logout') return reply({ admin: false }, 'payindex-admin-fixture=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
    if (action === 'session') return reply({ admin });
    if (action === 'manage' && admin) return mutate(route);
    return route.fulfill({ status: 401, contentType: 'application/json', body: '{"code":"forbidden"}' });
  });
}
