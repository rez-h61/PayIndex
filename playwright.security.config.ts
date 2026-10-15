import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/security',
  testMatch: 'admin-security.spec.ts',
  use: {
    baseURL: 'http://127.0.0.1:4180',
    browserName: 'chromium',
    channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'chrome' : undefined),
  },
  webServer: {
    command: 'npm run dev -- --port 4180 --strictPort',
    url: 'http://127.0.0.1:4180',
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: 'https://security-fixture.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'fixture-public-key',
      VITE_TURNSTILE_SITE_KEY: 'fixture-site-key',
    },
  },
});

