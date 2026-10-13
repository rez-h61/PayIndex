begin;
revoke execute on function public.directory_mutate(uuid,text,uuid,uuid,text,text,text,text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.directory_mutate(uuid,text,uuid,uuid,text,text,text,text,text,timestamptz,text) to service_role;
commit;
