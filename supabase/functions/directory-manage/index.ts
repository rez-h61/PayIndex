import { validQRStyle } from '../_shared/qr-style.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { inspectImage } from '../_shared/images.ts';
import { cors, json } from '../_shared/http.ts';
const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bucket = 'directory-assets';
async function flushCleanup() {
  const { data, error } = await service.rpc('directory_cleanup_candidates');
  if (error) return true;
  const paths = (data ?? []).map((row: { path: string }) => row.path);
  if (!paths.length) return false;
  const removed = await service.storage.from(bucket).remove(paths);
  if (removed.error) return true;
  return !!(await service.rpc('directory_mark_cleaned', { paths })).error;
}
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
  if (req.method !== 'POST') return json(req, { code: 'method' }, 405);
  try {
    const token = req.headers.get('Authorization')?.replace(/^Bearer /, '');
    if (!token) return json(req, { code: 'forbidden' }, 401);
    const { data: auth, error: authError } = await service.auth.getUser(token);
    if (authError || !auth.user) return json(req, { code: 'forbidden' }, 401);
    const actor = auth.user.id;
    const access = await service.rpc('directory_check_admin', { actor });
    if (access.error || access.data !== true) return json(req, { code: 'forbidden' }, 403);
    const reader = req.body?.getReader(); if (!reader) return json(req, { code: 'invalid' }, 400);
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 5 * 1024 * 1024 + 65536) { await reader.cancel(); return json(req, { code: 'invalid_image' }, 413); } chunks.push(value); }
    const bytes = new Uint8Array(size); let offset=0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const form = await new Response(bytes, { headers: { 'Content-Type': req.headers.get('Content-Type') ?? '' } }).formData();
    const text = (key: string) => typeof form.get(key) === 'string' ? String(form.get(key)) : null;
    const action = text('action'), id = text('id'), person = text('person_id'), mode = text('avatar_mode'), expected = text('expected_updated_at');
    if ((!['bulk_qr_style','save_share_url'].includes(action ?? '') && (!id || !uuid.test(id))) || !['save_person','delete_person','save_qr','delete_qr','save_qr_style','bulk_qr_style','save_share_url'].includes(action ?? '')) return json(req,{code:'invalid'},400);
    if (action === 'save_share_url') {
      let link:URL;
      try {link=new URL(text('share_url')??'');if(link.protocol!=='https:'||link.username||link.password||link.href.length>2048||!expected||!Number.isFinite(Date.parse(expected)))throw new Error();}
      catch {return json(req,{code:'invalid_link'},400);}
      const {error}=await service.rpc('directory_save_share_url',{actor,link:link.href,expected_updated_at:expected});
      if(error)return json(req,{code:error.code==='23505'?'conflict':error.code==='42501'?'forbidden':'save_failed'},error.code==='42501'?403:409);
      return json(req,{saved:true});
    }
    if (action === 'bulk_qr_style') {
      let design: unknown, snapshot: unknown;
      try { design=JSON.parse(text('qr_style')??'null'); snapshot=JSON.parse(text('snapshot')??'null'); } catch { return json(req,{code:'invalid'},400); }
      if (design!==null&&!validQRStyle(design)) return json(req,{code:'invalid_style'},400);
      if (!Array.isArray(snapshot)||snapshot.length>5000||snapshot.some(row=>!row||typeof row!=='object'||!uuid.test(row.id)||typeof row.updated_at!=='string'||!Number.isFinite(Date.parse(row.updated_at))))return json(req,{code:'invalid'},400);
      const {data:changed,error}=await service.rpc('directory_bulk_qr_style',{actor,design,snapshot});
      if(error){
        const code=['42703','42883','42P01','PGRST202','PGRST204'].includes(error.code)?'setup_required':error.code==='42501'?'forbidden':error.code==='23505'?'conflict':error.code==='23514'?'invalid_style':'save_failed';
        return json(req,{code},error.code==='42501'?403:409);
      }
      return json(req,{changed});
    }
    if (action === 'save_qr_style') {
      let design: unknown;
      try { design=JSON.parse(text('qr_style') ?? 'null'); } catch { return json(req,{code:'invalid'},400); }
      if (design !== null && !validQRStyle(design)) return json(req,{code:'invalid_style'},400);
      if (!expected) return json(req,{code:'invalid'},400);
      const { error }=await service.rpc('directory_save_qr_style',{actor,entity_id:id,design,expected_updated_at:expected});
      if (error) {
        const code=['42703','42883','42P01','PGRST202','PGRST204'].includes(error.code)?'setup_required':error.code==='42501'?'forbidden':error.code==='23505'?'conflict':error.code==='23514'?'invalid_style':'save_failed';
        return json(req,{code},error.code==='42501'?403:409);
      }
      return json(req,{id});
    }
    if (action === 'save_qr' && (!person || !uuid.test(person) || form.get('acknowledged') !== 'true' || !/^[A-Za-z0-9][A-Za-z0-9 .&()'_-]{0,39}$/.test(text('label')?.trim() ?? ''))) return json(req,{code:'invalid'},400);
    if (action === 'save_person') {
      const name = text('display_name')?.trim() ?? '';
      if (!name || name.length > 60 || /[\x00-\x1f\x7f]/.test(name) || !['upload','link','none'].includes(mode ?? '')) return json(req,{code:'invalid'},400);
      if (mode === 'link') {
        try { const link=text('avatar_url') ?? '', parsed=new URL(link); if(parsed.protocol!=='https:'||parsed.username||parsed.password||link.length>2048)throw new Error(); }
        catch { return json(req,{code:'invalid'},400); }
      }
    }
    const account = text('duitnow_account')?.trim() ?? '';
    if (action === 'save_qr' && account && !/^[0-9]{1,34}$/.test(account)) return json(req,{code:'invalid'},400);
    let path: string | null = null;
    const file = form.get('file');
    if ((action === 'save_qr' && file instanceof File) || (action === 'save_person' && mode === 'upload' && file instanceof File)) {
      if (!(file instanceof File)) return json(req,{code:'invalid_image'},400);
      const content = new Uint8Array(await file.arrayBuffer()), image = inspectImage(content);
      if (!image || image.mime !== file.type) return json(req,{code:'invalid_image'},400);
      path = action === 'save_qr' ? `people/${person}/qr/${id}/${crypto.randomUUID()}.${image.ext}` : `people/${id}/avatar/${crypto.randomUUID()}.${image.ext}`;
      const uploaded = await service.storage.from(bucket).upload(path,content,{contentType:image.mime,cacheControl:'0',upsert:false});
      if (uploaded.error) return json(req,{code:'save_failed'},503);
    }
    const { error } = await service.rpc('directory_mutate', { actor, action, entity_id: id, person, name:text('display_name'), qr_label:text('label'), avatar_mode:mode, image_url:mode==='link'?text('avatar_url'):null, asset_path:path, expected_updated_at:expected, duitnow_account: action === 'save_qr' ? account || null : null });
    if (error) {
      if (path) {
        // A lost response may hide a successful commit. Never delete a referenced
        // object; leave uncertain uploads to the age-bounded orphan cleanup.
        const [people,qrs] = await Promise.all([service.from('directory_people').select('id').eq('avatar_path',path),service.from('directory_qrs').select('id').eq('storage_path',path)]);
        if (!people.error && !qrs.error) {
          if (people.data.length || qrs.data.length) return json(req,{id,cleanupPending:true});
          await service.storage.from(bucket).remove([path]);
        }
      }
      return json(req,{code:error.code==='42501'?'forbidden':error.code==='23505'?'conflict':'save_failed'},error.code==='42501'?403:409);
    }
    return json(req,{id,cleanupPending:await flushCleanup()});
  } catch { return json(req,{code:'save_failed'},503); }
});
