-- Create your one email/password user in Supabase Authentication > Users first.
-- Replace this email. Never put the password in SQL or frontend code.
do $$
declare chosen uuid;
begin
 select id into chosen from auth.users where lower(email)=lower('YOUR_ADMIN_EMAIL');
 if chosen is null then raise exception 'Create the admin user in Authentication first'; end if;
 insert into private.directory_admin(singleton,user_id) values(true,chosen)
 on conflict(singleton) do update set user_id=excluded.user_id;
end $$;
