import { Readable } from 'node:stream';
import { loadEnv, type Plugin } from 'vite';
import { handleAdmin } from './admin';

// Run the same Web Request handler locally; no proxy to production or browser tokens.
export function adminApiPlugin(): Plugin {
  let env: Record<string, string>;
  return {
    name: 'payindex-admin-api',
    configResolved(config) { env = loadEnv(config.mode, config.root, ''); },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split('?')[0] !== '/api/admin') return next();
        try {
          const headers = new Headers();
          for (const [key, value] of Object.entries(req.headers)) {
            if (Array.isArray(value)) value.forEach(v => headers.append(key, v));
            else if (value !== undefined) headers.set(key, value);
          }
          const request = new Request(new URL(req.url, env.PAYINDEX_APP_ORIGIN || 'http://127.0.0.1:5173'), {
            method: req.method, headers,
            ...(req.method !== 'GET' && req.method !== 'HEAD' ? { body: Readable.toWeb(req), duplex: 'half' } : {}),
          } as RequestInit);
          const response = await handleAdmin(request, env);
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch {
          res.statusCode = 503; res.setHeader('Cache-Control', 'no-store');
          res.setHeader('Content-Type', 'application/json'); res.end('{"code":"unavailable"}');
        }
      });
    },
  };
}
