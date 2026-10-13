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
