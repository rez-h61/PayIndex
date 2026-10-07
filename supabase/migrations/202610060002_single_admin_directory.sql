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
