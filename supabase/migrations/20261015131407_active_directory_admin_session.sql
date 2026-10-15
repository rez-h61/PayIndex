begin;
-- The server must reject revoked sessions even while their JWT has not expired.
-- No caller-supplied actor/session ID: identity comes from the verified JWT.
create or replace function public.is_active_directory_admin()
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from private.directory_admin a
    join auth.sessions s on s.user_id = a.user_id
    where a.user_id = auth.uid()
      and s.id::text = (auth.jwt()->>'session_id')
  );
$$;
revoke all on function public.is_active_directory_admin() from public, anon;
grant execute on function public.is_active_directory_admin() to authenticated;
commit;
