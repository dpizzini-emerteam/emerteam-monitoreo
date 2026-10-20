-- Avisos por correo cada 5 minutos (desfasado de SMN y rayos)
select cron.schedule('mon-avisos','4-59/5 * * * *',$$
  select net.http_post(
    url := 'https://timwhyxdrputxywsolck.supabase.co/functions/v1/mon-avisos',
    headers := jsonb_build_object('Content-Type','application/json','x-mon-cron',
      (select decrypted_secret from vault.decrypted_secrets where name='mon_cron_clave')),
    body := '{}'::jsonb,
    timeout_milliseconds := 140000);
$$);
