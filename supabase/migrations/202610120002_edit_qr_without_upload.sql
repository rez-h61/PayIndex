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
