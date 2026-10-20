-- Observaciones horarias del SMN cada 3 horas (el SMN publica el día completo al cerrar el día)
select cron.schedule('mon-observaciones-smn','37 */3 * * *',$$
  select net.http_post(
    url := 'https://timwhyxdrputxywsolck.supabase.co/functions/v1/mon-observaciones',
    headers := jsonb_build_object('Content-Type','application/json','x-mon-cron',
      (select decrypted_secret from vault.decrypted_secrets where name='mon_cron_clave')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000);
$$);
