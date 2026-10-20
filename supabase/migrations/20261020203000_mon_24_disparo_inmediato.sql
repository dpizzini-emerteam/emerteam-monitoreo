-- Procesamiento inmediato al crear un evento o cambiar su fecha, lugar, días de armado o estado
create or replace function mon_priv.mon_disparar_procesamiento() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.estado = 'activo' then
    perform net.http_post(
      url := 'https://timwhyxdrputxywsolck.supabase.co/functions/v1/mon-disparar',
      headers := jsonb_build_object('Content-Type','application/json','x-mon-cron',
        (select decrypted_secret from vault.decrypted_secrets where name = 'mon_cron_clave')),
      body := jsonb_build_object('evento', new.id),
      timeout_milliseconds := 30000);
  end if;
  return new;
end $$;
revoke all on function mon_priv.mon_disparar_procesamiento() from public, anon, authenticated;

create trigger mon_eventos_disparo_alta after insert on public.mon_eventos
  for each row execute function mon_priv.mon_disparar_procesamiento();

create trigger mon_eventos_disparo_cambio after update of largada, lat, lon, armado_dias, estado on public.mon_eventos
  for each row
  when (old.largada is distinct from new.largada or old.lat is distinct from new.lat or old.lon is distinct from new.lon
        or old.armado_dias is distinct from new.armado_dias or old.estado is distinct from new.estado)
  execute function mon_priv.mon_disparar_procesamiento();
