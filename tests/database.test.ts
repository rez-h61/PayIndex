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
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,created_at timestamptz default now());alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to anon,authenticated;`);
 await db.exec(readFileSync('supabase/migrations/202610060001_payindex.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/202610060002_single_admin_directory.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/202610120001_optional_duitnow_account.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/202610120002_edit_qr_without_upload.sql','utf8'));
 await db.query('insert into auth.users values($1,$2,$3),($4,$5,$6)',[admin,'admin@example.test','{}',other,'other@example.test','{"role":"admin"}']);
 await db.query('insert into private.directory_admin(user_id) values($1)',[admin]);
},30_000);
afterAll(async()=>{await db?.close();});
describe('single-admin directory migration and access boundaries',()=>{
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
