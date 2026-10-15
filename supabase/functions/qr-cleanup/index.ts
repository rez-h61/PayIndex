import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
// Server scheduler only. Never put CLEANUP_SECRET or a service key in the app.
Deno.serve(async req => {
  const secret = Deno.env.get('CLEANUP_SECRET');
  if (req.method !== 'POST' || !secret || req.headers.get('Authorization') !== `Bearer ${secret}`) return new Response('Forbidden', { status: 403 });
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.rpc('cleanup_candidates');
  if (error) return new Response('Retry cleanup', { status: 503 });
  const paths = (data ?? []).map((row: { path: string }) => row.path);
  if (paths.length) {
    const removed = await db.storage.from('payment-qrs').remove(paths);
    if (removed.error) return new Response('Retry cleanup', { status: 503 });
    const marked = await db.rpc('mark_files_cleaned', { paths });
    if (marked.error) return new Response('Retry cleanup', { status: 503 });
  }
  return Response.json({ removed: paths.length }, { headers: { 'Cache-Control': 'no-store' } });
});
