begin;
create table public.directory_settings (
 id boolean primary key default true check (id),
 share_url text not null check (length(share_url)<=2048 and share_url ~ '^https://[^[:space:]/?#@]+([/?#][^[:space:]]*)?$'),
 updated_at timestamptz not null default now()
);
insert into public.directory_settings(share_url) values ('https://payindex-kokoro.vercel.app/');
alter table public.directory_settings enable row level security;
create policy directory_settings_read on public.directory_settings for select to anon,authenticated using (true);
grant select on public.directory_settings to anon,authenticated;
grant all on public.directory_settings to service_role;
create trigger directory_settings_touch before update on public.directory_settings for each row execute function private.touch_updated_at();
create function public.directory_save_share_url(actor uuid, link text, expected_updated_at timestamptz)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from private.directory_admin where user_id=actor for share;
 if not found then raise exception 'forbidden' using errcode='42501'; end if;
 update public.directory_settings set share_url=link where id=true and updated_at=expected_updated_at;
 if not found then raise exception 'conflict' using errcode='23505'; end if;
end;
$$;
revoke all on function public.directory_save_share_url(uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.directory_save_share_url(uuid,text,timestamptz) to service_role;
notify pgrst, 'reload schema';
commit;
