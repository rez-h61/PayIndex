import { createClient } from '@supabase/supabase-js';
import { MAX_BYTES, validImageURL } from './config';
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const configured = !!url && !!key && !url.includes('YOUR_PROJECT') && !key.includes('YOUR_');
export const supabase = configured ? createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
}) : null;
const urls = new Set<string>();
export function objectURL(blob: Blob) { const u = URL.createObjectURL(blob); urls.add(u); return u; }
export function releaseURL(u: string) { URL.revokeObjectURL(u); urls.delete(u); }
export function clearURLs() { urls.forEach(u => URL.revokeObjectURL(u)); urls.clear(); }
export async function validateImage(file: File) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > MAX_BYTES || !file.size) throw new Error('Choose a PNG, JPEG, or WebP image up to 5 MB.');
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('This image could not be opened. Choose another file.'); });
  const safe = bitmap.width > 0 && bitmap.height > 0 && bitmap.width * bitmap.height <= 40_000_000;
  bitmap.close();
  if (!safe) throw new Error('Choose an image smaller than 40 megapixels.');
}
// Imported QR links are fetched by the admin's browser (no server-side URL fetch),
// validated, then uploaded unchanged. Sites must allow CORS for import to work.
export async function imageFromLink(url: string): Promise<File> {
  if (!validImageURL(url)) throw new Error('Use a direct image link starting with https://.');
  try {
    const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: AbortSignal.timeout(20_000) });
    if (!response.ok || !response.body || Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error();
    const mime = response.headers.get('content-type')?.split(';')[0] ?? '';
    if (!['image/png','image/jpeg','image/webp'].includes(mime)) throw new Error();
    const reader = response.body.getReader(); const parts: Uint8Array<ArrayBuffer>[] = []; let size = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > MAX_BYTES) { await reader.cancel(); throw new Error(); } parts.push(new Uint8Array(value)); }
    const file = new File(parts, 'linked-image', { type: mime }); await validateImage(file); return file;
  } catch { throw new Error('This link couldn’t be imported. Use a direct PNG, JPEG or WebP link that allows sharing, or upload the image instead.'); }
}
export async function manageDirectory(form: FormData, progress: (value: number) => void = () => {}) {
  const { data } = await supabase!.auth.getSession();
  if (!data.session) throw new Error('Please sign in again.');
  return new Promise<{ cleanupPending?: boolean; id?: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${url}/functions/v1/directory-manage`);
    xhr.setRequestHeader('Authorization', `Bearer ${data.session!.access_token}`);
    xhr.setRequestHeader('apikey', key);
    xhr.timeout = 120_000;
    xhr.upload.onprogress = e => { if (e.lengthComputable) progress(Math.min(95, Math.round(e.loaded / e.total * 95))); };
    xhr.onerror = xhr.ontimeout = () => reject(new Error('Connection interrupted. Refresh the directory before retrying; your change may have completed.'));
    xhr.onload = () => {
      let body; try { body = JSON.parse(xhr.responseText); } catch { reject(new Error('Unable to save right now. Please retry.')); return; }
      if (xhr.status >= 200 && xhr.status < 300) { progress(100); resolve(body); }
      else reject(new Error(body.code === 'conflict' ? 'This payment option already exists or was changed. Refresh and try again.' : body.code === 'invalid_image' ? 'Choose a valid PNG, JPEG, or WebP image up to 5 MB.' : body.code === 'forbidden' ? 'Your access has changed. Refresh to continue.' : 'Unable to save right now. Please retry.'));
    };
    xhr.send(form);
  });
}
