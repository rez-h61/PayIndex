-- Fresh PayIndex installations only. Existing installations: run the unapplied migrations in order.

begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create type public.member_status as enum ('pending', 'approved', 'revoked');
create type public.member_role as enum ('member', 'admin');
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null check (char_length(btrim(display_name)) between 1 and 60 and display_name !~ '[[:cntrl:]]'),
 nickname text check (nickname is null or (char_length(btrim(nickname)) between 1 and 40 and nickname !~ '[[:cntrl:]]')),
 avatar_url text check (avatar_url is null or (char_length(avatar_url) <= 2048 and avatar_url ~ '^https://[a-zA-Z0-9.-]+\.googleusercontent\.com/')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.group_members (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 status public.member_status not null default 'pending', role public.member_role not null default 'member',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index group_members_status_idx on public.group_members(status);
create index profiles_display_name_idx on public.profiles(lower(display_name));
create table public.payment_qrs (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
 provider_key text not null, provider_label text not null check (char_length(provider_label) between 1 and 40),
 storage_path text not null unique,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(user_id, provider_key),
 check (storage_path ~ ('^' || user_id::text || '/' || id::text || '/[a-f0-9-]+\.(png|jpg|webp)$')),
 check ((provider_key = 'maybank' and provider_label = 'Maybank') or
 (provider_key = 'tng' and provider_label = 'TnG eWallet') or
 (provider_key = 'shopeepay' and provider_label = 'ShopeePay') or
 (provider_key = 'gxbank' and provider_label = 'GXBank') or
 (provider_label ~ '^[A-Za-z0-9][A-Za-z0-9 .&()''_-]{0,39}$' and regexp_replace(lower(provider_label), '[^a-z0-9]', '', 'g') not in ('maybank','tng','tngewallet','shopeepay','gxbank') and
 provider_key = 'other:' || regexp_replace(lower(provider_label), '[^a-z0-9]', '', 'g')))
);
create table private.file_cleanup (
 path text primary key, queued_at timestamptz not null default now(), deleted_at timestamptz
);
alter table public.profiles enable row level security;
alter table public.group_members enable row level security;
alter table public.payment_qrs enable row level security;
alter table private.file_cleanup enable row level security;

create function private.is_approved(who uuid) returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.group_members where user_id = who and status = 'approved');
$$;
create function private.is_admin(who uuid) returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.group_members where user_id = who and status = 'approved' and role = 'admin');
$$;
revoke all on function private.is_approved(uuid), private.is_admin(uuid) from public;
grant usage on schema private to authenticated;
grant execute on function private.is_approved(uuid), private.is_admin(uuid) to authenticated;

create policy profiles_read on public.profiles for select to authenticated using
 (id = (select auth.uid()) or (private.is_approved((select auth.uid())) and private.is_approved(id)));
create policy profiles_edit on public.profiles for update to authenticated using
 (id = (select auth.uid()) and private.is_approved((select auth.uid()))) with check (id = (select auth.uid()));
create policy membership_read on public.group_members for select to authenticated using (user_id = (select auth.uid()));
create policy qrs_read on public.payment_qrs for select to authenticated using
 (private.is_approved((select auth.uid())) and private.is_approved(user_id));
revoke all on public.profiles, public.group_members, public.payment_qrs from anon, authenticated;
grant select on public.profiles, public.group_members, public.payment_qrs to authenticated;
grant update(display_name, nickname) on public.profiles to authenticated;
-- QR writes and membership changes use authorized functions; no table-write grants.
grant all on public.profiles, public.group_members, public.payment_qrs to service_role;

create function private.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
 begin new.updated_at := clock_timestamp(); return new; end;
$$;
create trigger profiles_touch before update on public.profiles for each row execute function private.touch_updated_at();
create trigger members_touch before update on public.group_members for each row execute function private.touch_updated_at();
create trigger qrs_touch before update on public.payment_qrs for each row execute function private.touch_updated_at();

create function private.create_member() returns trigger language plpgsql security definer set search_path = '' as $$
 declare label text; avatar text;
 begin
 label := left(btrim(regexp_replace(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''), '[[:cntrl:]]', '', 'g')), 60);
 if label = '' then label := 'New member'; end if;
 avatar := new.raw_user_meta_data->>'avatar_url';
 if avatar is null or length(avatar) > 2048 or avatar !~ '^https://[a-zA-Z0-9.-]+\.googleusercontent\.com/' then avatar := null; end if;
 insert into public.profiles(id, display_name, avatar_url) values(new.id, label, avatar);
 insert into public.group_members(user_id, status, role) values(new.id, 'pending', 'member');
 return new;
 end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.create_member();

-- All role/status writes, including administrative SQL, serialize to protect the last admin.
create function private.guard_last_admin() returns trigger language plpgsql security definer set search_path = '' as $$
 begin
 perform pg_advisory_xact_lock(7081941);
 if old.role = 'admin' and old.status = 'approved' and
 (tg_op = 'DELETE' or new.role <> 'admin' or new.status <> 'approved') and
 not exists(select 1 from public.group_members where user_id <> old.user_id and role = 'admin' and status = 'approved') then
 raise exception 'last_admin' using errcode = '23514';
 end if;
 if tg_op = 'DELETE' then return old; end if; return new;
 end;
$$;
create trigger guard_last_admin before update or delete on public.group_members for each row execute function private.guard_last_admin();
create function public.set_membership(target uuid, new_status public.member_status) returns void language plpgsql security definer set search_path = '' as $$
 begin
 perform pg_advisory_xact_lock(7081941);
 if not private.is_admin(auth.uid()) or new_status not in ('approved','revoked') then raise exception 'forbidden' using errcode='42501'; end if;
 update public.group_members set status = new_status where user_id = target;
 if not found then raise exception 'not_found'; end if;
 end;
$$;
create function public.admin_members() returns table(id uuid, display_name text, nickname text, avatar_url text, email text, status public.member_status, role public.member_role, created_at timestamptz)
 language plpgsql stable security definer set search_path = '' as $$
 begin
 if not private.is_admin(auth.uid()) then raise exception 'forbidden' using errcode='42501'; end if;
 return query select p.id, p.display_name, p.nickname, p.avatar_url, u.email::text, m.status, m.role, m.created_at
 from public.profiles p join public.group_members m on m.user_id = p.id join auth.users u on u.id = p.id order by p.display_name;
 end;
$$;
revoke all on function public.set_membership(uuid, public.member_status), public.admin_members() from public, anon;
grant execute on function public.set_membership(uuid, public.member_status), public.admin_members() to authenticated;

create function public.admin_payment_qrs() returns setof public.payment_qrs language plpgsql stable security definer set search_path = '' as $$
 begin
 if not private.is_admin(auth.uid()) then raise exception 'forbidden' using errcode='42501'; end if;
 return query select * from public.payment_qrs order by updated_at desc;
 end;
$$;
revoke all on function public.admin_payment_qrs() from public, anon;
grant execute on function public.admin_payment_qrs() to authenticated;

-- Durable deletion tombstones also prohibit reattaching a file while a cleanup runs.
create function private.queue_old_file() returns trigger language plpgsql security definer set search_path = '' as $$
 begin
 if tg_op = 'DELETE' or old.storage_path <> new.storage_path then
 insert into private.file_cleanup(path) values(old.storage_path) on conflict do nothing;
 end if;
 if tg_op = 'DELETE' then return old; end if; return new;
 end;
$$;
create trigger qr_cleanup after update or delete on public.payment_qrs for each row execute function private.queue_old_file();

-- Only the Edge Function's service client can call these. actor comes from getUser(JWT).
create function public.commit_qr(actor uuid, qr_id uuid, label text, provider text, path text, expected_path text default null)
 returns public.payment_qrs language plpgsql security definer set search_path = '' as $$
 declare result public.payment_qrs; current_row public.payment_qrs; k text;
 begin
 perform 1 from public.group_members where user_id = actor and status = 'approved' for share;
 if not found then raise exception 'forbidden' using errcode='42501'; end if;
 if path !~ ('^' || actor::text || '/' || qr_id::text || '/[a-f0-9-]+\.(png|jpg|webp)$') or
 not exists(select 1 from storage.objects where bucket_id='payment-qrs' and name=path and created_at > now()-interval '1 hour') or
 exists(select 1 from private.file_cleanup where private.file_cleanup.path=commit_qr.path) then raise exception 'invalid_path'; end if;
 label := btrim(label);
 k := case provider when 'Maybank' then 'maybank' when 'TnG eWallet' then 'tng' when 'ShopeePay' then 'shopeepay' when 'GXBank' then 'gxbank'
 when 'Other' then 'other:' || regexp_replace(lower(label), '[^a-z0-9]', '', 'g') else null end;
 if provider <> 'Other' then label := provider; end if;
 if k is null then raise exception 'invalid_provider'; end if;
 select * into current_row from public.payment_qrs where id=qr_id for update;
 if found then
 if current_row.user_id <> actor then raise exception 'forbidden' using errcode='42501'; end if;
 if expected_path is distinct from current_row.storage_path then raise exception 'conflict' using errcode='23505'; end if;
 update public.payment_qrs set provider_key=k, provider_label=label, storage_path=path where id=qr_id returning * into result;
 else
 if expected_path is not null then raise exception 'conflict' using errcode='23505'; end if;
 insert into public.payment_qrs(id,user_id,provider_key,provider_label,storage_path) values(qr_id,actor,k,label,path) returning * into result;
 end if;
 return result;
 end;
$$;
create function public.remove_qr(actor uuid, qr_id uuid, expected_path text) returns text language plpgsql security definer set search_path = '' as $$
 declare q public.payment_qrs;
 begin
 perform 1 from public.group_members where user_id=actor and status='approved' for share;
 if not found then raise exception 'forbidden' using errcode='42501'; end if;
 select * into q from public.payment_qrs where id=qr_id for update;
 if not found then return null; end if;
 if q.user_id <> actor and not private.is_admin(actor) then raise exception 'forbidden' using errcode='42501'; end if;
 if q.storage_path is distinct from expected_path then raise exception 'conflict' using errcode='23505'; end if;
 delete from public.payment_qrs where id=qr_id;
 return q.storage_path;
 end;
$$;
create function public.cleanup_candidates() returns table(path text) language plpgsql security definer set search_path = '' as $$
 begin
 -- Files this old cannot be committed (commit window is one hour).
 insert into private.file_cleanup(path)
 select o.name from storage.objects o where o.bucket_id='payment-qrs' and o.created_at < now()-interval '24 hours'
 and not exists(select 1 from public.payment_qrs q where q.storage_path=o.name)
 on conflict do nothing;
 return query select f.path from private.file_cleanup f where f.deleted_at is null
 and not exists(select 1 from public.payment_qrs q where q.storage_path=f.path) order by f.queued_at limit 100;
 end;
$$;
create function public.mark_files_cleaned(paths text[]) returns void language sql security definer set search_path = '' as $$
 update private.file_cleanup set deleted_at=now() where path=any(paths);
$$;
revoke all on function public.commit_qr(uuid,uuid,text,text,text,text), public.remove_qr(uuid,uuid,text), public.cleanup_candidates(), public.mark_files_cleaned(text[]) from public, anon, authenticated;
grant execute on function public.commit_qr(uuid,uuid,text,text,text,text), public.remove_qr(uuid,uuid,text), public.cleanup_candidates(), public.mark_files_cleaned(text[]) to service_role;
revoke all on function private.touch_updated_at(), private.create_member(), private.guard_last_admin(), private.queue_old_file() from public, anon, authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('payment-qrs','payment-qrs',false,5242880,array['image/png','image/jpeg','image/webp'])
on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=excluded.allowed_mime_types;
create policy qr_image_read on storage.objects for select to authenticated using (
 bucket_id='payment-qrs' and storage.allow_only_operation('object.get_authenticated') and private.is_approved((select auth.uid())) and exists (
 select 1 from public.payment_qrs q where q.storage_path=name and private.is_approved(q.user_id))
);
-- No direct insert/update/delete policies: the Edge Function validates the bytes,
-- authenticates the caller, and performs ownership-checked operations. No upserts.
commit;


begin;
-- Archive the original private membership model without publishing or deleting it.
drop trigger if exists on_auth_user_created on auth.users;
revoke all on public.profiles, public.group_members, public.payment_qrs from anon, authenticated;
revoke update(display_name, nickname) on public.profiles from authenticated;
revoke execute on function public.set_membership(uuid,public.member_status), public.admin_members(), public.admin_payment_qrs() from authenticated, anon;
revoke execute on function public.commit_qr(uuid,uuid,text,text,text,text), public.remove_qr(uuid,uuid,text) from service_role;
drop policy if exists qr_image_read on storage.objects;

create table private.directory_admin (
 singleton boolean primary key default true check(singleton),
 user_id uuid not null unique references auth.users(id) on delete restrict
);
alter table private.directory_admin enable row level security;
revoke all on private.directory_admin from public, anon, authenticated;

create function public.is_directory_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.directory_admin where user_id=auth.uid());
$$;
revoke all on function public.is_directory_admin() from public;
grant execute on function public.is_directory_admin() to anon, authenticated;
create function public.directory_check_admin(actor uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.directory_admin where user_id=actor);
$$;
revoke all on function public.directory_check_admin(uuid) from public, anon, authenticated;
grant execute on function public.directory_check_admin(uuid) to service_role;

create table public.directory_people (
 id uuid primary key default gen_random_uuid(),
 display_name text not null check(length(btrim(display_name)) between 1 and 60 and display_name !~ '[[:cntrl:]]'),
 avatar_path text unique,
 avatar_url text check(avatar_url is null or (length(avatar_url)<=2048 and avatar_url ~ '^https://[^/@[:space:]]+(:[0-9]+)?(/|$)' and avatar_url !~ '[[:cntrl:]]')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(avatar_path is null or avatar_path ~ ('^people/'||id::text||'/avatar/[a-f0-9-]+\.(png|jpg|webp)$')),
 check(avatar_path is null or avatar_url is null)
);
create index directory_people_name_idx on public.directory_people(lower(display_name));
create table public.directory_qrs (
 id uuid primary key default gen_random_uuid(), person_id uuid not null references public.directory_people(id) on delete cascade,
 label text not null check(label ~ '^[A-Za-z0-9][A-Za-z0-9 .&()''_-]{0,39}$'),
 label_key text generated always as (regexp_replace(lower(label),'[^a-z0-9]','','g')) stored,
 storage_path text not null unique,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(person_id,label_key),
 check(storage_path ~ ('^people/'||person_id::text||'/qr/'||id::text||'/[a-f0-9-]+\.(png|jpg|webp)$'))
);
create table private.directory_cleanup (path text primary key,queued_at timestamptz not null default now(),deleted_at timestamptz);
alter table private.directory_cleanup enable row level security;
alter table public.directory_people enable row level security;
alter table public.directory_qrs enable row level security;
-- The user explicitly chose: anyone with the link can view the directory.
create policy directory_people_read on public.directory_people for select to anon,authenticated using(true);
create policy directory_qrs_read on public.directory_qrs for select to anon,authenticated using(true);
revoke all on public.directory_people,public.directory_qrs from anon,authenticated;
grant select on public.directory_people,public.directory_qrs to anon,authenticated;
grant all on public.directory_people,public.directory_qrs to service_role;
create trigger directory_people_touch before update on public.directory_people for each row execute function private.touch_updated_at();
create trigger directory_qrs_touch before update on public.directory_qrs for each row execute function private.touch_updated_at();

create function private.queue_directory_asset() returns trigger language plpgsql security definer set search_path='' as $$
 declare old_path text; new_path text;
 begin
 if tg_table_name='directory_people' then old_path:=old.avatar_path; if tg_op='UPDATE' then new_path:=new.avatar_path; end if;
 else old_path:=old.storage_path; if tg_op='UPDATE' then new_path:=new.storage_path; end if; end if;
 if old_path is not null and (tg_op='DELETE' or old_path is distinct from new_path) then
 insert into private.directory_cleanup(path) values(old_path) on conflict do nothing;
 end if;
 if tg_op='DELETE' then return old; end if; return new;
 end;
$$;
create trigger directory_people_cleanup after update or delete on public.directory_people for each row execute function private.queue_directory_asset();
create trigger directory_qrs_cleanup after update or delete on public.directory_qrs for each row execute function private.queue_directory_asset();
revoke all on function private.queue_directory_asset() from public,anon,authenticated;

create function public.directory_mutate(actor uuid, action text, entity_id uuid, person uuid default null, name text default null, qr_label text default null, avatar_mode text default null, image_url text default null, asset_path text default null, expected_updated_at timestamptz default null)
 returns uuid language plpgsql security definer set search_path='' as $$
 declare p public.directory_people; q public.directory_qrs; found_record boolean; new_avatar text; new_url text;
 begin
 perform 1 from private.directory_admin where user_id=actor for share;
 if not found then raise exception 'forbidden' using errcode='42501'; end if;
 if asset_path is not null and (
 not exists(select 1 from storage.objects where bucket_id='directory-assets' and storage.objects.name=asset_path and created_at>now()-interval '1 hour') or
 exists(select 1 from private.directory_cleanup where path=asset_path)) then raise exception 'invalid_asset'; end if;
 if action in ('save_person','delete_person') then
 select * into p from public.directory_people where id=entity_id for update; found_record:=found;
 if (found_record and p.updated_at is distinct from expected_updated_at) or (not found_record and expected_updated_at is not null) then raise exception 'conflict' using errcode='23505'; end if;
 if action='delete_person' then delete from public.directory_people where id=entity_id; return entity_id; end if;
 if avatar_mode not in ('upload','link','none') or avatar_mode is null then raise exception 'invalid_avatar_mode'; end if;
 new_avatar:=case when avatar_mode='upload' then coalesce(asset_path,p.avatar_path) else null end;
 new_url:=case when avatar_mode='link' then btrim(image_url) else null end;
 if avatar_mode='upload' and new_avatar is null then raise exception 'invalid_asset'; end if;
 if avatar_mode='link' and (new_url is null or new_url='') then raise exception 'invalid_url'; end if;
 if found_record then update public.directory_people set display_name=btrim(name),avatar_path=new_avatar,avatar_url=new_url where id=entity_id;
 else insert into public.directory_people(id,display_name,avatar_path,avatar_url) values(entity_id,btrim(name),new_avatar,new_url); end if;
 elsif action in ('save_qr','delete_qr') then
 if action='save_qr' then perform 1 from public.directory_people where id=person for share; if not found then raise exception 'person_missing'; end if; end if;
 select * into q from public.directory_qrs where id=entity_id for update; found_record:=found;
 if (found_record and q.updated_at is distinct from expected_updated_at) or (not found_record and expected_updated_at is not null) then raise exception 'conflict' using errcode='23505'; end if;
 if action='delete_qr' then delete from public.directory_qrs where id=entity_id; return entity_id; end if;
 if asset_path is null or (found_record and q.person_id<>person) then raise exception 'invalid_asset'; end if;
 if found_record then update public.directory_qrs set label=btrim(qr_label),storage_path=asset_path where id=entity_id;
 else insert into public.directory_qrs(id,person_id,label,storage_path) values(entity_id,person,btrim(qr_label),asset_path); end if;
 else raise exception 'invalid_action'; end if;
 return entity_id;
 end;
$$;
revoke all on function public.directory_mutate(uuid,text,uuid,uuid,text,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.directory_mutate(uuid,text,uuid,uuid,text,text,text,text,text,timestamptz) to service_role;

create function public.directory_cleanup_candidates() returns table(path text) language plpgsql security definer set search_path='' as $$
 begin
 insert into private.directory_cleanup(path)
 select o.name from storage.objects o where o.bucket_id='directory-assets' and o.created_at<now()-interval '24 hours'
 and not exists(select 1 from public.directory_people p where p.avatar_path=o.name)
 and not exists(select 1 from public.directory_qrs q where q.storage_path=o.name) on conflict do nothing;
 return query select c.path from private.directory_cleanup c where c.deleted_at is null
 and not exists(select 1 from public.directory_people p where p.avatar_path=c.path)
 and not exists(select 1 from public.directory_qrs q where q.storage_path=c.path) order by c.queued_at limit 100;
 end;
$$;
create function public.directory_mark_cleaned(paths text[]) returns void language sql security definer set search_path='' as $$
 update private.directory_cleanup set deleted_at=now() where path=any(paths);
$$;
revoke all on function public.directory_cleanup_candidates(),public.directory_mark_cleaned(text[]) from public,anon,authenticated;
grant execute on function public.directory_cleanup_candidates(),public.directory_mark_cleaned(text[]) to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('directory-assets','directory-assets',false,5242880,array['image/png','image/jpeg','image/webp'])
 on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=excluded.allowed_mime_types;
create policy directory_asset_read on storage.objects for select to anon,authenticated using (
 bucket_id='directory-assets' and storage.allow_only_operation('object.get_authenticated') and (
 exists(select 1 from public.directory_people p where p.avatar_path=storage.objects.name) or
 exists(select 1 from public.directory_qrs q where q.storage_path=storage.objects.name))
);
commit;


begin;
alter table public.directory_qrs add column duitnow_account text check (duitnow_account is null or duitnow_account ~ '^[0-9]{1,34}$');
drop function public.directory_mutate(uuid,text,uuid,uuid,text,text,text,text,text,timestamptz);
create function public.directory_mutate(actor uuid, action text, entity_id uuid, person uuid default null, name text default null, qr_label text default null, avatar_mode text default null, image_url text default null, asset_path text default null, expected_updated_at timestamptz default null, duitnow_account text default null)
 returns uuid language plpgsql security definer set search_path='' as $$
 declare p public.directory_people; q public.directory_qrs; found_record boolean; new_avatar text; new_url text;
 begin
 perform 1 from private.directory_admin where user_id=actor for share;
 if not found then raise exception 'forbidden' using errcode='42501'; end if;
 if asset_path is not null and (
 not exists(select 1 from storage.objects where bucket_id='directory-assets' and storage.objects.name=asset_path and created_at>now()-interval '1 hour') or
 exists(select 1 from private.directory_cleanup where path=asset_path)) then raise exception 'invalid_asset'; end if;
 if action in ('save_person','delete_person') then
 select * into p from public.directory_people where id=entity_id for update; found_record:=found;
 if (found_record and p.updated_at is distinct from expected_updated_at) or (not found_record and expected_updated_at is not null) then raise exception 'conflict' using errcode='23505'; end if;
 if action='delete_person' then delete from public.directory_people where id=entity_id; return entity_id; end if;
 if avatar_mode not in ('upload','link','none') or avatar_mode is null then raise exception 'invalid_avatar_mode'; end if;
 new_avatar:=case when avatar_mode='upload' then coalesce(asset_path,p.avatar_path) else null end;
 new_url:=case when avatar_mode='link' then btrim(image_url) else null end;
 if avatar_mode='upload' and new_avatar is null then raise exception 'invalid_asset'; end if;
 if avatar_mode='link' and (new_url is null or new_url='') then raise exception 'invalid_url'; end if;
 if found_record then update public.directory_people set display_name=btrim(name),avatar_path=new_avatar,avatar_url=new_url where id=entity_id;
 else insert into public.directory_people(id,display_name,avatar_path,avatar_url) values(entity_id,btrim(name),new_avatar,new_url); end if;
 elsif action in ('save_qr','delete_qr') then
 if action='save_qr' then perform 1 from public.directory_people where id=person for share; if not found then raise exception 'person_missing'; end if; end if;
 select * into q from public.directory_qrs where id=entity_id for update; found_record:=found;
 if (found_record and q.updated_at is distinct from expected_updated_at) or (not found_record and expected_updated_at is not null) then raise exception 'conflict' using errcode='23505'; end if;
 if action='delete_qr' then delete from public.directory_qrs where id=entity_id; return entity_id; end if;
 if asset_path is null or (found_record and q.person_id<>person) then raise exception 'invalid_asset'; end if;
 if found_record then update public.directory_qrs set label=btrim(qr_label),storage_path=asset_path,duitnow_account=nullif(btrim(directory_mutate.duitnow_account),'') where id=entity_id;
 else insert into public.directory_qrs(id,person_id,label,storage_path,duitnow_account) values(entity_id,person,btrim(qr_label),asset_path,nullif(btrim(directory_mutate.duitnow_account),'')); end if;
 else raise exception 'invalid_action'; end if;
 return entity_id;
 end;
$$;
revoke all on function public.directory_mutate(uuid,text,uuid,uuid,text,text,text,text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.directory_mutate(uuid,text,uuid,uuid,text,text,text,text,text,timestamptz,text) to service_role;

commit;


begin;
create or replace function public.directory_mutate(actor uuid, action text, entity_id uuid, person uuid default null, name text default null, qr_label text default null, avatar_mode text default null, image_url text default null, asset_path text default null, expected_updated_at timestamptz default null, duitnow_account text default null)
 returns uuid language plpgsql security definer set search_path='' as $$
 declare p public.directory_people; q public.directory_qrs; found_record boolean; new_avatar text; new_url text;
 begin
 perform 1 from private.directory_admin where user_id=actor for share;
 if not found then raise exception 'forbidden' using errcode='42501'; end if;
 if asset_path is not null and (
 not exists(select 1 from storage.objects where bucket_id='directory-assets' and storage.objects.name=asset_path and created_at>now()-interval '1 hour') or
 exists(select 1 from private.directory_cleanup where path=asset_path)) then raise exception 'invalid_asset'; end if;
 if action in ('save_person','delete_person') then
 select * into p from public.directory_people where id=entity_id for update; found_record:=found;
 if (found_record and p.updated_at is distinct from expected_updated_at) or (not found_record and expected_updated_at is not null) then raise exception 'conflict' using errcode='23505'; end if;
 if action='delete_person' then delete from public.directory_people where id=entity_id; return entity_id; end if;
 if avatar_mode not in ('upload','link','none') or avatar_mode is null then raise exception 'invalid_avatar_mode'; end if;
 new_avatar:=case when avatar_mode='upload' then coalesce(asset_path,p.avatar_path) else null end;
 new_url:=case when avatar_mode='link' then btrim(image_url) else null end;
 if avatar_mode='upload' and new_avatar is null then raise exception 'invalid_asset'; end if;
 if avatar_mode='link' and (new_url is null or new_url='') then raise exception 'invalid_url'; end if;
 if found_record then update public.directory_people set display_name=btrim(name),avatar_path=new_avatar,avatar_url=new_url where id=entity_id;
 else insert into public.directory_people(id,display_name,avatar_path,avatar_url) values(entity_id,btrim(name),new_avatar,new_url); end if;
 elsif action in ('save_qr','delete_qr') then
 if action='save_qr' then perform 1 from public.directory_people where id=person for share; if not found then raise exception 'person_missing'; end if; end if;
 select * into q from public.directory_qrs where id=entity_id for update; found_record:=found;
 if (found_record and q.updated_at is distinct from expected_updated_at) or (not found_record and expected_updated_at is not null) then raise exception 'conflict' using errcode='23505'; end if;
 if action='delete_qr' then delete from public.directory_qrs where id=entity_id; return entity_id; end if;
 if (asset_path is null and not found_record) or (found_record and q.person_id<>person) then raise exception 'invalid_asset'; end if;
 if found_record then update public.directory_qrs set label=btrim(qr_label),storage_path=coalesce(asset_path,q.storage_path),duitnow_account=nullif(btrim(directory_mutate.duitnow_account),'') where id=entity_id;
 else insert into public.directory_qrs(id,person_id,label,storage_path,duitnow_account) values(entity_id,person,btrim(qr_label),asset_path,nullif(btrim(directory_mutate.duitnow_account),'')); end if;
 else raise exception 'invalid_action'; end if;
 return entity_id;
 end;
$$;
commit;


begin;
alter table public.directory_qrs add column qr_style jsonb;
alter table public.directory_qrs add constraint directory_qrs_style_valid check (
 qr_style is null or (
  jsonb_typeof(qr_style)='object'
  and qr_style ?& array['palette','shape','logo']
  and (qr_style-'palette'-'shape'-'logo')='{}'::jsonb
  and qr_style->>'palette' in ('classic','payindex','midnight','cyber')
  and qr_style->>'shape' in ('square','rounded','dots','classy')
  and jsonb_typeof(qr_style->'logo')='boolean'
  and jsonb_typeof(qr_style->'palette')='string'
  and jsonb_typeof(qr_style->'shape')='string'
 ) is true
);

create function public.directory_save_qr_style(actor uuid, entity_id uuid, design jsonb, expected_updated_at timestamptz)
 returns uuid language plpgsql security definer set search_path='' as $$
 declare q public.directory_qrs;
 begin
 perform 1 from private.directory_admin where user_id=actor for share;
 if not found then raise exception 'forbidden' using errcode='42501'; end if;
 select * into q from public.directory_qrs where id=entity_id for update;
 if not found or q.updated_at is distinct from expected_updated_at then
  raise exception 'conflict' using errcode='23505';
 end if;
 update public.directory_qrs set qr_style=design where id=entity_id;
 return entity_id;
 end;
$$;
revoke all on function public.directory_save_qr_style(uuid,uuid,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.directory_save_qr_style(uuid,uuid,jsonb,timestamptz) to service_role;
notify pgrst, 'reload schema';
commit;


begin;
revoke execute on function public.directory_mutate(uuid,text,uuid,uuid,text,text,text,text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.directory_mutate(uuid,text,uuid,uuid,text,text,text,text,text,timestamptz,text) to service_role;
commit;


begin;
alter table public.directory_qrs drop constraint directory_qrs_style_valid;
alter table public.directory_qrs add constraint directory_qrs_style_valid check (
 qr_style is null or (
  jsonb_typeof(qr_style)='object'
  and qr_style ?& array['palette','shape','logo']
  and (qr_style-'palette'-'shape'-'logo')='{}'::jsonb
  and qr_style->>'palette' in ('classic','payindex','midnight','cyber','pink','crimson','coral','amber','olive','forest','teal','ocean','indigo','violet','plum')
  and qr_style->>'shape' in ('square','rounded','dots','classy')
  and jsonb_typeof(qr_style->'logo')='boolean'
  and jsonb_typeof(qr_style->'palette')='string'
  and jsonb_typeof(qr_style->'shape')='string'
 ) is true
);

create function public.directory_bulk_qr_style(actor uuid, design jsonb, snapshot jsonb)
 returns integer language plpgsql security definer set search_path='' as $$
 declare changed integer;
 begin
 perform 1 from private.directory_admin where user_id=actor for share;
 if not found then raise exception 'forbidden' using errcode='42501'; end if;
 if jsonb_typeof(snapshot) is distinct from 'array' or jsonb_array_length(snapshot)>5000 then raise exception 'invalid_snapshot' using errcode='22023'; end if;
 if exists(select 1 from jsonb_to_recordset(snapshot) as s(id uuid,updated_at timestamptz) where s.id is null or s.updated_at is null)
 or (select count(distinct s.id) from jsonb_to_recordset(snapshot) as s(id uuid))<>jsonb_array_length(snapshot) then raise exception 'invalid_snapshot' using errcode='22023'; end if;
 -- Serialize directory writes so inserts, deletions and edits cannot evade the snapshot.
 lock table public.directory_qrs in share row exclusive mode;
 if (select count(*) from public.directory_qrs)<>jsonb_array_length(snapshot)
 or exists(select 1 from public.directory_qrs q left join jsonb_to_recordset(snapshot) as s(id uuid,updated_at timestamptz) on s.id=q.id where s.id is null or q.updated_at is distinct from s.updated_at)
 then raise exception 'conflict' using errcode='23505'; end if;
 update public.directory_qrs set qr_style=design;
 get diagnostics changed = row_count;
 return changed;
 end;
$$;
revoke all on function public.directory_bulk_qr_style(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.directory_bulk_qr_style(uuid,jsonb,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
