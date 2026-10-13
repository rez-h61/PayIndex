import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Draft D: one vector master for header, favicon and installed app icons.
const master = readFileSync(new URL('../src/assets/payindex-icon.svg', import.meta.url), 'utf8');
const svg = (background = true, maskable = false) => master
  .replace('viewBox="0 0 64 64"', `viewBox="${background ? '0 0 64 64' : '12 12 40 40'}"`)
  .replace('<rect width="64" height="64" rx="14" fill="#040506"/>', background ? `<rect width="64" height="64" rx="${maskable ? 0 : 14}" fill="#040506"/>` : '');
const root = new URL('../public/', import.meta.url);
writeFileSync(new URL('favicon.svg', root), svg());
writeFileSync(new URL('brand-mark.svg', root), svg(false));

// Rasterize the SVG at each native resolution for clean antialiased edges.
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'chrome' : undefined) });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [name, size, maskable] of [['icon-192.png',192,false],['icon-512.png',512,false],['icon-maskable.png',512,true],['apple-touch-icon.png',180,false]]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${svg(true,maskable)}`);
    await page.screenshot({ path: fileURLToPath(new URL(name, root)), omitBackground: true });
  }
} finally { await browser.close(); }
