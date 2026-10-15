// Browser fixtures verify token handling; real CAPTCHA enforcement lives in Supabase Auth.
import { test, expect } from '@playwright/test';

test('login requires verification, clears expired/used tokens, and handles rate limits', async ({ page }) => {
  const attempts: Record<string, unknown>[] = [];
  await page.route('https://challenges.cloudflare.com/**', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.turnstile = {
      render(container, options) { window.__captchaOptions = options; window.__captchaRenders = (window.__captchaRenders || 0) + 1; return 'fixture-widget'; },
      remove() {}
    };`,
  }));
  await page.route('https://security-fixture.supabase.co/**', route => {
    if (route.request().url().includes('/auth/v1/token')) {
      attempts.push(route.request().postDataJSON());
      return route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ code: 'over_request_rate_limit', message: 'Rate limit exceeded' }) });
    }
    return route.fulfill({ contentType: 'application/json', body: '[]' });
  });
  await page.goto('/admin/login');
  const signIn = page.getByRole('button', { name: 'Sign in', exact: true });
  await page.getByLabel('Email', { exact: true }).fill('admin@example.test');
  await page.getByLabel('Password', { exact: true }).fill('fixture-password');
  await expect.poll(() => page.evaluate(() => (window as any).__captchaRenders || 0)).toBeGreaterThan(0);
  const initialRenders = await page.evaluate(() => (window as any).__captchaRenders);
  await expect(signIn).toBeDisabled();
  // Submitting the form programmatically must also respect the token guard.
  await page.locator('form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(attempts).toHaveLength(0);
  await page.evaluate(() => (window as any).__captchaOptions.callback('expired-token'));
  await expect(signIn).toBeEnabled();
  await page.evaluate(() => (window as any).__captchaOptions['expired-callback']());
  await expect(signIn).toBeDisabled();
  await page.evaluate(() => (window as any).__captchaOptions.callback('fresh-token'));
  await signIn.click();
  await expect(page.getByRole('alert')).toContainText('Too many sign-in attempts');
  expect(attempts).toHaveLength(1);
  expect(attempts[0].gotrue_meta_security).toEqual({ captcha_token: 'fresh-token' });
  await expect.poll(() => page.evaluate(() => (window as any).__captchaRenders)).toBeGreaterThan(initialRenders);
  await expect(signIn).toBeDisabled();
  await page.evaluate(() => (window as any).__captchaOptions['error-callback']());
  await expect(page.getByText('Verification couldn’t load. Check your connection and try again.')).toBeVisible();
  const beforeRetry = await page.evaluate(() => (window as any).__captchaRenders);
  await page.getByRole('button', { name: 'Retry verification' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__captchaRenders)).toBeGreaterThan(beforeRetry);
  await expect(signIn).toBeDisabled();
});

test('Turnstile is not loaded for public directory visitors', async ({ page }) => {
  let requests = 0;
  await page.route('https://challenges.cloudflare.com/**', route => { requests++; return route.abort(); });
  await page.route('https://security-fixture.supabase.co/**', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'A place for your people.' })).toBeVisible();
  expect(requests).toBe(0);
});
