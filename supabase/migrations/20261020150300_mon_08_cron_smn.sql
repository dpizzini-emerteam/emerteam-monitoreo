-- Alertas del SMN cada 5 minutos (función mon-smn). La clave se toma del Vault en cada ejecución.
select cron.schedule('mon-alertas-smn', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://timwhyxdrputxywsolck.supabase.co/functions/v1/mon-smn',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-mon-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'mon_cron_clave')),
    body := '{}'::jsonb, timeout_milliseconds := 140000);
$$);
