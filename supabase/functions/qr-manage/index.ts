import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { inspectImage } from '../_shared/images.ts';
import { cors, json } from '../_shared/http.ts';
const url = Deno.env.get('SUPABASE_URL')!;
const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
  if (req.method !== 'POST') return json(req, { code: 'method' }, 405);
  const token = req.headers.get('Authorization')?.replace(/^Bearer /, '');
  if (!token) return json(req, { code: 'forbidden' }, 401);
  const { data: auth, error: authError } = await service.auth.getUser(token);
  if (authError || !auth.user) return json(req, { code: 'forbidden' }, 401);
  const actor = auth.user.id;
  const { data: membership } = await service.from('group_members').select('status').eq('user_id', actor).single();
  if (membership?.status !== 'approved') return json(req, { code: 'forbidden' }, 403);
  try {
    // Bound the actual stream too; Content-Length alone is not trustworthy.
    const reader = req.body?.getReader(); if (!reader) return json(req, { code: 'invalid_image' }, 400);
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 5 * 1024 * 1024 + 65536) { await reader.cancel(); return json(req, { code: 'invalid_image' }, 413); } chunks.push(value); }
    const bytes = new Uint8Array(size); let offset=0; for (const chunk of chunks) { bytes.set(chunk,offset); offset+=chunk.length; }
    const form = await new Response(bytes, { headers: { 'Content-Type': req.headers.get('Content-Type') ?? '' } }).formData();
    const action = form.get('action'), id = String(form.get('id') ?? ''), expected = form.get('expected_path');
    if (!uuid.test(id) || (expected !== null && typeof expected !== 'string')) return json(req, { code: 'invalid' }, 400);
    if (action === 'delete') {
      const { data: path, error } = await service.rpc('remove_qr', { actor, qr_id: id, expected_path: expected });
      if (error) return json(req, { code: error.code === '42501' ? 'forbidden' : 'conflict' }, error.code === '42501' ? 403 : 409);
      const cleanupPending = path ? !!(await service.storage.from('payment-qrs').remove([path])).error : false;
      if (path && !cleanupPending) await service.rpc('mark_files_cleaned', { paths: [path] });
      return json(req, { cleanupPending });
    }
    if (action !== 'save' || form.get('acknowledged') !== 'true') return json(req, { code: 'invalid' }, 400);
    const provider = String(form.get('provider')), label = String(form.get('label'));
    if (!['Maybank','TnG eWallet','ShopeePay','GXBank','Other'].includes(provider) || (provider === 'Other' && !/^[A-Za-z0-9][A-Za-z0-9 .&()'_-]{0,39}$/.test(label.trim()))) return json(req, { code: 'invalid' }, 400);
    const file = form.get('file'); if (!(file instanceof File)) return json(req, { code: 'invalid_image' }, 400);
    const content = new Uint8Array(await file.arrayBuffer()), image = inspectImage(content);
    if (!image || image.mime !== file.type) return json(req, { code: 'invalid_image' }, 400);
    const path = `${actor}/${id}/${crypto.randomUUID()}.${image.ext}`;
    const { error: uploadError } = await service.storage.from('payment-qrs').upload(path, content, { contentType: image.mime, cacheControl: '0', upsert: false });
    if (uploadError) return json(req, { code: 'save_failed' }, 503);
    const { error } = await service.rpc('commit_qr', { actor, qr_id: id, provider, label, path, expected_path: expected });
    if (error) {
      // A network error can hide a committed transaction. Never delete a file
      // until an authoritative read proves it is unreferenced. GC handles outages.
      const check = await service.from('payment_qrs').select('id').eq('storage_path', path);
      if (!check.error && check.data.length === 0) await service.storage.from('payment-qrs').remove([path]);
      if (!check.error && check.data.length > 0) return json(req, { cleanupPending: true });
      return json(req, { code: error.code === '42501' ? 'forbidden' : 'conflict' }, error.code === '42501' ? 403 : 409);
    }
    const cleanupPending = expected ? !!(await service.storage.from('payment-qrs').remove([expected as string])).error : false;
    if (expected && !cleanupPending) await service.rpc('mark_files_cleaned', { paths: [expected] });
    return json(req, { cleanupPending });
  } catch { return json(req, { code: 'save_failed' }, 503); }
});
