begin;
-- Supabase default privileges may grant writes on newly created public tables.
revoke all on public.directory_settings from anon,authenticated;
grant select on public.directory_settings to anon,authenticated;
notify pgrst, 'reload schema';
commit;
