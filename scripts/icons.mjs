import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Draft D: one vector master for header, favicon and installed app icons.
const mark = '<rect x="14" y="25" width="14" height="18" rx="5" fill="#ff5964"/><path fill="#fff" fill-rule="evenodd" d="M22 14h13c9 0 15 5 15 13s-6 13-15 13h-3v10H22V14Zm10 9v9h3c4 0 6-1.5 6-4.5S39 23 35 23h-3Z"/>';
const svg = (background = true, maskable = false) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${background ? '0 0 64 64' : '12 12 40 40'}">${background ? `<rect width="64" height="64" rx="${maskable ? 0 : 14}" fill="#040506"/>` : ''}${mark}</svg>`;
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
