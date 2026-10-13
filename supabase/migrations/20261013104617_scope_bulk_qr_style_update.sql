begin;
create or replace function public.directory_bulk_qr_style(actor uuid, design jsonb, snapshot jsonb)
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
 -- Explicit scope also satisfies the API connection's safe-update guard.
 update public.directory_qrs q set qr_style=design
 where q.id in (select s.id from jsonb_to_recordset(snapshot) as s(id uuid));
 get diagnostics changed = row_count;
 return changed;
 end;
$$;
revoke all on function public.directory_bulk_qr_style(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.directory_bulk_qr_style(uuid,jsonb,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
