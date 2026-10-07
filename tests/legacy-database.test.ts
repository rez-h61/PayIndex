import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const ids = { pending: '10000000-0000-4000-8000-000000000001', member:'10000000-0000-4000-8000-000000000002', other:'10000000-0000-4000-8000-000000000003', admin:'10000000-0000-4000-8000-000000000004', revoked:'10000000-0000-4000-8000-000000000005' };
let db: PGlite;
async function asUser(id:string, sql:string, operation = 'object.get_authenticated') {
  await db.exec(`set role authenticated; set request.jwt.claim.sub='${id}'; set test.storage_operation='${operation}';`);
  try { return await db.query(sql); } finally { await db.exec('reset role'); }
}
beforeAll(async () => {
 db = new PGlite();
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create schema storage;
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create function storage.allow_only_operation(operation text) returns boolean language sql stable as $$ select current_setting('test.storage_operation',true)=operation $$;
 grant usage on schema auth,storage to authenticated; grant execute on function auth.uid() to authenticated;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,created_at timestamptz default now());
 alter table storage.objects enable row level security; grant select,insert,update,delete on storage.objects to authenticated;`);
 await db.exec(readFileSync('supabase/migrations/202610060001_payindex.sql','utf8'));
 for (const [name,id] of Object.entries(ids)) await db.query('insert into auth.users values($1,$2,$3)',[id,`${name}@example.test`,JSON.stringify({full_name:name,role:'admin',status:'approved',avatar_url:'https://evil.example/image'})]);
 await db.exec(`update public.group_members set status='approved' where user_id in ('${ids.member}','${ids.other}','${ids.admin}'); update public.group_members set role='admin' where user_id='${ids.admin}'; update public.group_members set status='revoked' where user_id='${ids.revoked}';`);
},30_000);
afterAll(async () => { await db?.close(); });
describe('real PostgreSQL migration / grants / row policies (local Supabase schemas stubbed)', () => {
 it('creates pending membership and sanitizes untrusted metadata', async () => {
  const result = await asUser(ids.pending, 'select * from public.group_members');
  expect(result.rows).toHaveLength(1); expect(result.rows[0]).toMatchObject({status:'pending',role:'member'});
  expect((await asUser(ids.pending,'select avatar_url from public.profiles')).rows).toEqual([{avatar_url:null}]);
 });
 it('pending/revoked see only their own profile, no QRs, files or emails', async () => {
  for (const id of [ids.pending,ids.revoked]) {
   expect((await asUser(id,'select * from public.profiles')).rows).toHaveLength(1);
   expect((await asUser(id,'select * from public.payment_qrs')).rows).toHaveLength(0);
   expect((await asUser(id,'select * from storage.objects')).rows).toHaveLength(0);
   await expect(asUser(id,'select * from public.admin_members()')).rejects.toThrow();
   await expect(asUser(id,'select * from public.admin_payment_qrs()')).rejects.toThrow();
   await expect(asUser(id,`select public.set_membership('${id}','approved')`)).rejects.toThrow();
  }
 });
 it('approved directory excludes pending and revoked, protects profile columns', async () => {
  expect((await asUser(ids.member,'select * from public.profiles')).rows).toHaveLength(3);
  await asUser(ids.member,`update public.profiles set display_name='Member A' where id='${ids.member}'`);
  expect((await asUser(ids.member,`update public.profiles set display_name='stolen' where id='${ids.other}' returning id`)).rows).toHaveLength(0);
  await expect(asUser(ids.member,`update public.profiles set id='${ids.other}' where id='${ids.member}'`)).rejects.toThrow();
  await expect(asUser(ids.member,`update public.profiles set avatar_url=null where id='${ids.member}'`)).rejects.toThrow();
 });
 it('members cannot promote themselves or invoke privileged file RPCs', async () => {
  await expect(asUser(ids.member,`update public.group_members set role='admin' where user_id='${ids.member}'`)).rejects.toThrow();
  await expect(asUser(ids.member,`select public.set_membership('${ids.member}','approved')`)).rejects.toThrow();
  await expect(asUser(ids.member,`select public.commit_qr('${ids.other}',gen_random_uuid(),'Maybank','Maybank','x',null)`)).rejects.toThrow();
  await expect(asUser(ids.member,`select public.remove_qr('${ids.admin}',gen_random_uuid(),'x')`)).rejects.toThrow();
  await expect(asUser(ids.member,`select * from public.cleanup_candidates()`)).rejects.toThrow();
  await expect(asUser(ids.member,`insert into storage.objects(bucket_id,name) values('payment-qrs','x')`)).rejects.toThrow();
 });
 it('commits original path, allows approved reads, denies direct writes and enforces ownership', async () => {
  const qr='20000000-0000-4000-8000-000000000001'; const path=`${ids.member}/${qr}/30000000-0000-4000-8000-000000000001.png`;
  await db.query(`insert into storage.objects(bucket_id,name) values('payment-qrs',$1)`,[path]);
  await db.query(`select public.commit_qr($1,$2,'Maybank','Maybank',$3,null)`,[ids.member,qr,path]);
  expect((await asUser(ids.other,'select * from public.payment_qrs')).rows).toHaveLength(1);
  expect((await asUser(ids.other,'select * from storage.objects')).rows).toHaveLength(1);
  expect((await asUser(ids.other,'select * from storage.objects','object.sign')).rows).toHaveLength(0);
  expect((await asUser(ids.pending,'select * from storage.objects')).rows).toHaveLength(0);
  await expect(asUser(ids.other,`update public.payment_qrs set user_id='${ids.other}'`)).rejects.toThrow();
  expect((await asUser(ids.other,`delete from storage.objects returning name`)).rows).toHaveLength(0);
  await expect(db.query(`select public.remove_qr($1,$2,$3)`,[ids.other,qr,path])).rejects.toThrow();
 });
 it('replacement enqueues obsolete file; stale writes cannot remove the active version', async () => {
  const qr='20000000-0000-4000-8000-000000000001', old=`${ids.member}/${qr}/30000000-0000-4000-8000-000000000001.png`, fresh=`${ids.member}/${qr}/30000000-0000-4000-8000-000000000002.png`;
  await db.query(`insert into storage.objects(bucket_id,name) values('payment-qrs',$1)`,[fresh]);
  await db.query(`select public.commit_qr($1,$2,'Maybank','Maybank',$3,$4)`,[ids.member,qr,fresh,old]);
  expect((await db.query('select * from public.cleanup_candidates()')).rows).toEqual([{path:old}]);
  expect((await asUser(ids.other,'select name from storage.objects')).rows).toEqual([{name:fresh}]);
  await expect(db.query(`select public.remove_qr($1,$2,$3)`,[ids.member,qr,old])).rejects.toThrow();
  await expect(db.query(`select public.commit_qr($1,$2,'Maybank','Maybank',$3,$4)`,[ids.member,qr,old,fresh])).rejects.toThrow();
 });
 it('admin can approve/revoke and revocation immediately blocks existing access', async () => {
  await asUser(ids.admin,`select public.set_membership('${ids.pending}','approved')`);
  expect((await asUser(ids.pending,'select * from public.payment_qrs')).rows).toHaveLength(1);
  await asUser(ids.admin,`select public.set_membership('${ids.pending}','revoked')`);
  expect((await asUser(ids.pending,'select * from public.payment_qrs')).rows).toHaveLength(0);
  expect((await asUser(ids.pending,'select * from storage.objects')).rows).toHaveLength(0);
  expect((await asUser(ids.admin,'select * from public.admin_members()')).rows).toHaveLength(5);
  await expect(asUser(ids.admin,`select public.set_membership('${ids.admin}','revoked')`)).rejects.toThrow();
 });
 it('admin moderation deletes metadata first and queues file cleanup', async () => {
  const q=(await db.query<{id:string;storage_path:string}>('select * from public.payment_qrs')).rows[0];
  await db.query(`select public.remove_qr($1,$2,$3)`,[ids.admin,q.id,q.storage_path]);
  expect((await asUser(ids.member,'select * from public.payment_qrs')).rows).toHaveLength(0);
  expect((await asUser(ids.member,'select * from storage.objects')).rows).toHaveLength(0);
  expect((await db.query('select * from public.cleanup_candidates()')).rows).toHaveLength(2);
 });
});
