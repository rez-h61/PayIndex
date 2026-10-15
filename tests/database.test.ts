import { PGlite } from '@electric-sql/pglite';
import { beforeAll,afterAll,describe,it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
const admin='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',person='20000000-0000-4000-8000-000000000001',qr='30000000-0000-4000-8000-000000000001';
const avatar=`people/${person}/avatar/40000000-0000-4000-8000-000000000001.png`,file=`people/${person}/qr/${qr}/40000000-0000-4000-8000-000000000002.png`,replacement=`people/${person}/qr/${qr}/40000000-0000-4000-8000-000000000003.png`;
let db:PGlite;
async function asRole(role:string,id:string,sql:string,operation='object.get_authenticated') {
 await db.exec(`set role ${role}; set request.jwt.claim.sub='${id}'; set test.storage_operation='${operation}';`);
 try{return await db.query(sql);}finally{await db.exec('reset role');}
}
async function mutate(args:Record<string,unknown>){const values={actor:admin,action:'save_person',entity_id:person,...args};const names=Object.keys(values);return db.query(`select public.directory_mutate(${names.map((n,i)=>`${n}=>$${i+1}`).join(',')})`,Object.values(values));}
beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;create schema auth;create schema storage;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function storage.allow_only_operation(operation text) returns boolean language sql stable as $$select current_setting('test.storage_operation',true)=operation$$;
 grant usage on schema auth,storage to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id));
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,created_at timestamptz default now());alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to anon,authenticated;`);
 await db.exec(readFileSync('supabase/migrations/202610060001_payindex.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/202610060002_single_admin_directory.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/202610120001_optional_duitnow_account.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/202610120002_edit_qr_without_upload.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261013060157_per_qr_design.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261013084229_restrict_directory_mutate_execute.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261013085314_qr_palette_and_bulk_style.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261013100526_separate_qr_design_colour.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261013104617_scope_bulk_qr_style_update.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261013114437_website_share_qr.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261013122110_restrict_share_settings_writes.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261015131407_active_directory_admin_session.sql','utf8'));
 await db.query('insert into auth.users values($1,$2,$3),($4,$5,$6)',[admin,'admin@example.test','{}',other,'other@example.test','{"role":"admin"}']);
 await db.query('insert into private.directory_admin(user_id) values($1)',[admin]);
},30_000);
afterAll(async()=>{await db?.close();});
describe('single-admin directory migration and access boundaries',()=>{
 it('shares website settings publicly but permits only the admin backend to change the link',async()=>{
  await db.exec('begin');
  try {
   const initial=(await asRole('anon','','select share_url,updated_at from public.directory_settings')).rows[0];
   expect((await db.query("select has_table_privilege('authenticated','public.directory_settings','update') as writable")).rows[0]).toEqual({writable:false});
   expect(initial.share_url).toBe('https://payindex-kokoro.vercel.app/');
   expect((await db.query("select has_function_privilege('anon','public.directory_save_share_url(uuid,text,timestamptz)','execute') as anon,has_function_privilege('authenticated','public.directory_save_share_url(uuid,text,timestamptz)','execute') as authenticated")).rows[0]).toEqual({anon:false,authenticated:false});
   const rejected=async(actor:string,link:string)=>{
    await db.exec('savepoint rejected');
    try{await expect(db.query('select public.directory_save_share_url($1,$2,$3)',[actor,link,initial.updated_at])).rejects.toThrow();}finally{await db.exec('rollback to savepoint rejected');}
   };
   await rejected(other,'https://example.test/');await rejected(admin,'javascript:alert(1)');
   await db.query('select public.directory_save_share_url($1,$2,$3)',[admin,'https://example.test/payindex',initial.updated_at]);
   expect((await asRole('anon','','select share_url from public.directory_settings')).rows[0]).toEqual({share_url:'https://example.test/payindex'});
   await rejected(admin,'https://stale.example.test/');
  } finally {await db.exec('rollback');}
 });
 it('checks the active Auth session and admin identity, and rejects revoked or fabricated sessions',async()=>{
  const session='50000000-0000-4000-8000-000000000001';
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session,admin]);
  await db.exec(`set request.jwt.claims='{"session_id":"${session}"}'`);
  expect((await asRole('authenticated',admin,'select public.is_active_directory_admin() as allowed')).rows[0]).toEqual({allowed:true});
  expect((await asRole('authenticated',other,'select public.is_active_directory_admin() as allowed')).rows[0]).toEqual({allowed:false});
  await expect(asRole('anon','','select public.is_active_directory_admin()')).rejects.toThrow();
  await db.query('delete from auth.sessions where id=$1',[session]);
  expect((await asRole('authenticated',admin,'select public.is_active_directory_admin() as allowed')).rows[0]).toEqual({allowed:false});
  await db.exec(`set request.jwt.claims='{"session_id":"invalid"}'`);
  expect((await asRole('authenticated',admin,'select public.is_active_directory_admin() as allowed')).rows[0]).toEqual({allowed:false});
 });
 it('has exactly one admin, with no signup membership or self-promotion',async()=>{
  expect((await db.query('select * from public.profiles')).rows).toHaveLength(0);
  expect((await asRole('authenticated',admin,'select public.is_directory_admin() as allowed')).rows[0]).toEqual({allowed:true});
  expect((await asRole('authenticated',other,'select public.is_directory_admin() as allowed')).rows[0]).toEqual({allowed:false});
  expect((await asRole('anon','','select public.is_directory_admin() as allowed')).rows[0]).toEqual({allowed:false});
  await expect(db.query('insert into private.directory_admin(user_id) values($1)',[other])).rejects.toThrow();
  await expect(asRole('authenticated',other,`update private.directory_admin set user_id='${other}'`)).rejects.toThrow();
 });
 it('only the verified server may mutate; visitor and authenticated non-admin cannot',async()=>{
  for(const [role,id]of [['anon',''],['authenticated',other],['authenticated',admin]]){
   await expect(asRole(role,id,`insert into public.directory_people(display_name) values('Intruder')`)).rejects.toThrow();
   await expect(asRole(role,id,`select public.directory_mutate('${admin}','save_person','${person}',name=>'Intruder',avatar_mode=>'none')`)).rejects.toThrow();
   await expect(asRole(role,id,`insert into storage.objects(bucket_id,name) values('directory-assets','bad')`)).rejects.toThrow();
  }
  await expect(mutate({actor:other,name:'Intruder',avatar_mode:'none'})).rejects.toThrow();
 });
 it('publishes new directory records only; legacy tables and emails remain unavailable',async()=>{
  await db.query(`insert into storage.objects(bucket_id,name) values('directory-assets',$1)`,[avatar]);
  await mutate({name:'Alex',avatar_mode:'upload',asset_path:avatar});
  expect((await asRole('anon','','select display_name from public.directory_people')).rows).toEqual([{display_name:'Alex'}]);
  expect((await asRole('anon','','select name from storage.objects')).rows).toEqual([{name:avatar}]);
  await expect(asRole('anon','','select * from public.profiles')).rejects.toThrow();
  await expect(asRole('authenticated',admin,'select * from auth.users')).rejects.toThrow();
  await expect(asRole('authenticated',admin,'select * from public.admin_members()')).rejects.toThrow();
 });
 it('normalizes labels and prevents duplicate payment options',async()=>{
  await db.query(`insert into storage.objects(bucket_id,name) values('directory-assets',$1)`,[file]);
  await mutate({action:'save_qr',entity_id:qr,person,qr_label:'ACME Pay',asset_path:file});
  expect((await asRole('anon','','select label_key from public.directory_qrs')).rows).toEqual([{label_key:'acmepay'}]);
  const duplicate='30000000-0000-4000-8000-000000000002',duplicatePath=`people/${person}/qr/${duplicate}/40000000-0000-4000-8000-000000000004.png`;
  await db.query(`insert into storage.objects(bucket_id,name) values('directory-assets',$1)`,[duplicatePath]);
  await expect(mutate({action:'save_qr',entity_id:duplicate,person,qr_label:'acme-pay',asset_path:duplicatePath})).rejects.toThrow();
 });
 it('stores optional transfer accounts as text, preserves leading zeros and rejects invalid values',async()=>{
  const save=async(account:string|null)=>{const row=(await db.query<{updated_at:string}>('select updated_at from public.directory_qrs where id=$1',[qr])).rows[0];return mutate({action:'save_qr',entity_id:qr,person,qr_label:'ACME Pay',expected_updated_at:row.updated_at,duitnow_account:account});};
  await db.query("update storage.objects set created_at=now()-interval '2 days' where name=$1",[file]);
  await save('00123456789');
  expect((await db.query('select storage_path from public.directory_qrs')).rows).toEqual([{storage_path:file}]);
  await db.query('update storage.objects set created_at=now() where name=$1',[file]);
  expect((await asRole('anon','','select duitnow_account from public.directory_qrs')).rows).toEqual([{duitnow_account:'00123456789'}]);
  await expect(save('123abc')).rejects.toThrow();
  await expect(save('1'.repeat(35))).rejects.toThrow();
  await save('');
  expect((await db.query('select duitnow_account from public.directory_qrs')).rows).toEqual([{duitnow_account:null}]);
 });
 it('only the verified admin server can save a design for one QR, with validation and stale-write protection',async()=>{
  await db.exec('begin');
  const rejected=async(fn:()=>Promise<unknown>)=>{await db.exec('savepoint rejected');try{await expect(fn()).rejects.toThrow();}finally{await db.exec('rollback to savepoint rejected');}};
  try {
   const second='30000000-0000-4000-8000-000000000009';
   const secondPath=`people/${person}/qr/${second}/40000000-0000-4000-8000-000000000009.png`;
   await db.query('insert into public.directory_qrs(id,person_id,label,storage_path) values($1,$2,$3,$4)',[second,person,'Second bank',secondPath]);
   const before=(await db.query<{updated_at:string}>('select updated_at from public.directory_qrs where id=$1',[qr])).rows[0].updated_at;
   const design={palette:'payindex',shape:'rounded',logo:true};
   const save=(actor:string,style:unknown,expected=before)=>db.query('select public.directory_save_qr_style($1,$2,$3,$4)',[actor,qr,style===null?null:JSON.stringify(style),expected]);
   for(const role of ['anon','authenticated']) {
    await db.exec(`savepoint denied;set role ${role}`);
    await expect(db.query('select public.directory_save_qr_style($1,$2,$3,$4)',[admin,qr,JSON.stringify(design),before])).rejects.toThrow();
    await db.exec('rollback to savepoint denied;reset role');
   }
   await rejected(()=>save(other,design));
   for(const bad of [{...design,palette:'javascript:bad'}, {...design,shape:'triangle'}, {...design,logo:'yes'}, {...design,extra:'bad'}, {palette:null,shape:'square',logo:false}, {}])await rejected(()=>save(admin,bad));
   await save(admin,design);
   const rows=(await asRole('anon','','select id,qr_style,storage_path from public.directory_qrs order by id')).rows;
   expect(rows).toEqual([{id:qr,qr_style:design,storage_path:file},{id:second,qr_style:null,storage_path:secondPath}]);
   await rejected(()=>save(admin,{...design,logo:false},'2020-01-01T00:00:00Z'));
   const after=(await db.query<{updated_at:string}>('select updated_at from public.directory_qrs where id=$1',[qr])).rows[0].updated_at;
   await save(admin,null,after);
   expect((await db.query('select qr_style from public.directory_qrs where id=$1',[qr])).rows[0]).toEqual({qr_style:null});
  } finally {await db.exec('rollback');}
 });
 it('applies and resets a complete directory snapshot atomically and only through the admin backend',async()=>{
  await db.exec('begin');
  const rejected=async(fn:()=>Promise<unknown>)=>{await db.exec('savepoint rejected');try{await expect(fn()).rejects.toThrow();}finally{await db.exec('rollback to savepoint rejected');}};
  try{
   const second='30000000-0000-4000-8000-000000000009';
   const path=`people/${person}/qr/${second}/40000000-0000-4000-8000-000000000009.png`;
   await db.query('insert into public.directory_qrs(id,person_id,label,storage_path) values($1,$2,$3,$4)',[second,person,'Second bank',path]);
   const snapshot=async()=>(await db.query('select id,updated_at from public.directory_qrs order by id')).rows;
   const initial=await snapshot(),design={palette:'pink',shape:'rounded',logo:true};
   const apply=(style:unknown,rows:unknown,actor=admin)=>db.query('select public.directory_bulk_qr_style($1,$2,$3) as changed',[actor,style===null?null:JSON.stringify(style),JSON.stringify(rows)]);
   expect((await db.query("select has_function_privilege('anon','public.directory_bulk_qr_style(uuid,jsonb,jsonb)','execute') as anon,has_function_privilege('authenticated','public.directory_bulk_qr_style(uuid,jsonb,jsonb)','execute') as authenticated")).rows[0]).toEqual({anon:false,authenticated:false});
   await rejected(()=>apply(design,initial,other));
   await rejected(()=>apply(design,initial.slice(0,1)));
   await rejected(()=>apply(design,[initial[0],initial[0]]));
   await rejected(()=>apply(design,initial.map(row=>({...row,updated_at:'2020-01-01T00:00:00Z'}))));
   expect((await apply(design,initial)).rows[0]).toEqual({changed:2});
   const rows=(await db.query('select qr_style,storage_path from public.directory_qrs order by id')).rows;
   expect(rows).toEqual([{qr_style:design,storage_path:file},{qr_style:design,storage_path:path}]);
   const afterApply=await snapshot();await rejected(()=>apply({...design,palette:'invalid'},afterApply));
   expect((await db.query('select count(*)::int as count from public.directory_qrs where qr_style=$1',[JSON.stringify(design)])).rows[0]).toEqual({count:2});
   const outdated=await snapshot();await db.query("update public.directory_qrs set label='Second changed bank' where id=$1",[second]);
   await rejected(()=>apply(null,outdated));
   const fresh=await snapshot();expect((await apply(null,fresh)).rows[0]).toEqual({changed:2});
   expect((await db.query('select qr_style from public.directory_qrs')).rows).toEqual([{qr_style:null},{qr_style:null}]);
  }finally{await db.exec('rollback');}
 });
 it('serves only linked images through download; signing/listing and unlinked files are denied',async()=>{
  expect((await asRole('anon','','select name from storage.objects')).rows).toHaveLength(2);
  expect((await asRole('anon','','select name from storage.objects','object.sign')).rows).toHaveLength(0);
  expect((await asRole('anon','','select name from storage.objects','object.list')).rows).toHaveLength(0);
  expect((await asRole('anon','','delete from storage.objects returning name')).rows).toHaveLength(0);
 });
 it('retains the active version on stale edits and queues old files for reliable cleanup',async()=>{
  const before=(await db.query<{updated_at:string}>('select updated_at from public.directory_qrs')).rows[0].updated_at;
  await db.query(`insert into storage.objects(bucket_id,name) values('directory-assets',$1)`,[replacement]);
  await mutate({action:'save_qr',entity_id:qr,person,qr_label:'ACME Pay',asset_path:replacement,expected_updated_at:before});
  await expect(mutate({action:'delete_qr',entity_id:qr,expected_updated_at:before})).rejects.toThrow();
  expect((await asRole('anon','',`select name from storage.objects where name='${file}'`)).rows).toHaveLength(0);
  expect((await db.query('select * from public.directory_cleanup_candidates()')).rows).toEqual([{path:file}]);
  const after=(await db.query<{updated_at:string}>('select updated_at from public.directory_qrs')).rows[0].updated_at;
  await expect(mutate({action:'save_qr',entity_id:qr,person,qr_label:'ACME Pay',asset_path:file,expected_updated_at:after})).rejects.toThrow();
 });
 it('supports HTTPS photo links and safely queues replaced uploaded avatars',async()=>{
  const before=(await db.query<{updated_at:string}>('select updated_at from public.directory_people')).rows[0].updated_at;
  await expect(mutate({name:'Alex',avatar_mode:'link',image_url:'javascript:alert(1)',expected_updated_at:before})).rejects.toThrow();
  await mutate({name:'Alex',avatar_mode:'link',image_url:'https://example.com/photo.jpg',expected_updated_at:before});
  expect((await db.query('select avatar_path,avatar_url from public.directory_people')).rows[0]).toEqual({avatar_path:null,avatar_url:'https://example.com/photo.jpg'});
  expect((await asRole('anon','',`select name from storage.objects where name='${avatar}'`)).rows).toHaveLength(0);
 });
 it('deleting a person cascades QRs and durably queues all owned files',async()=>{
  const before=(await db.query<{updated_at:string}>('select updated_at from public.directory_people')).rows[0].updated_at;
  await mutate({action:'delete_person',expected_updated_at:before});
  expect((await asRole('anon','','select * from public.directory_qrs')).rows).toHaveLength(0);
  expect((await asRole('anon','','select * from storage.objects')).rows).toHaveLength(0);
  expect((await db.query('select * from public.directory_cleanup_candidates()')).rows).toHaveLength(3);
 });
});
