-- Observaciones casi en tiempo real: el archivo «tiempo presente» del SMN se renueva cada hora.
-- origen: 'tiepre' (parte horario en el momento) o 'datohorario' (registro oficial del día, publicado al día siguiente;
-- reemplaza al anterior).
alter table public.mon_observaciones add column if not exists origen text not null default 'datohorario';
comment on table public.mon_observaciones is 'Observaciones horarias SMN (datos abiertos): tiempo presente cada hora y datohorario oficial del día anterior. Hora en UTC.';

select cron.unschedule('mon-observaciones-smn');
select cron.schedule('mon-observaciones-smn', '25 * * * *', $$
  select net.http_post(
    url := 'https://timwhyxdrputxywsolck.supabase.co/functions/v1/mon-observaciones',
    headers := jsonb_build_object('Content-Type','application/json','x-mon-cron',
      (select decrypted_secret from vault.decrypted_secrets where name='mon_cron_clave')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000);
$$);
