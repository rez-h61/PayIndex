import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { adminApiPlugin } from './server/dev-plugin';
export default defineConfig({
  plugins: [adminApiPlugin(), react(), VitePWA({
    registerType: 'prompt', strategies: 'injectManifest', srcDir: 'src', filename: 'sw.ts',
    injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'] },
    manifest: { name: 'PayIndex', short_name: 'PayIndex', description: 'Your group’s payment directory.',
      start_url: '/', scope: '/', display: 'standalone', theme_color: '#040506', background_color: '#040506',
      icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }, { src: '/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }] }
  })],
});
