-- Run once in the Supabase SQL editor after deploying directory-cleanup.
-- Enable pg_cron and pg_net in Database > Extensions first.
-- Store the same random CLEANUP_SECRET configured for the function in Vault:
select vault.create_secret('REPLACE_WITH_RANDOM_CLEANUP_SECRET', 'payindex_directory_cleanup_secret');
select vault.create_secret('https://kdrjgkvwhaqougbcrwxf.supabase.co', 'payindex_directory_project_url');
select cron.schedule('payindex-directory-cleanup', '*/15 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='payindex_directory_project_url') || '/functions/v1/directory-cleanup',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' ||
      (select decrypted_secret from vault.decrypted_secrets where name='payindex_directory_cleanup_secret')),
    body := '{}'::jsonb
  );
$$);
-- Inspect cron.job_run_details and net._http_response; alert on non-2xx responses.
-- Unschedule before recreating: select cron.unschedule('payindex-directory-cleanup');
