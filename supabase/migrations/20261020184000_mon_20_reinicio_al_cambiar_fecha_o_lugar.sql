-- Si cambian la fecha, el lugar o los días de armado de un evento, los datos calculados para la fecha o el
-- punto anterior dejan de valer: se descartan y el procesamiento siguiente los vuelve a calcular.
-- Se conservan accesos, modalidades, consultas, envíos y mediciones en terreno.
create or replace function mon_priv.mon_limpiar_calculados(ev uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.mon_pronosticos where evento_id = ev;
  delete from public.mon_niveles where evento_id = ev;
  delete from public.mon_niveles_historial where evento_id = ev;
  delete from public.mon_alertas_smn where evento_id = ev;
  delete from public.mon_rayos where evento_id = ev;
  delete from public.mon_informes where evento_id = ev and estado <> 'aprobado';
  delete from public.mon_estado where clave = 'avisos:' || ev::text;
end $$;
revoke all on function mon_priv.mon_limpiar_calculados(uuid) from public, anon, authenticated;

create or replace function mon_priv.mon_reiniciar_datos() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform mon_priv.mon_limpiar_calculados(new.id);
  return new;
end $$;
revoke all on function mon_priv.mon_reiniciar_datos() from public, anon, authenticated;

create trigger mon_eventos_reinicio after update of largada, lat, lon, armado_dias on public.mon_eventos
  for each row
  when (old.largada is distinct from new.largada or old.lat is distinct from new.lat
        or old.lon is distinct from new.lon or old.armado_dias is distinct from new.armado_dias)
  execute function mon_priv.mon_reiniciar_datos();

-- Limpieza del evento editado antes de existir esta regla (Media Maratón de Mar del Plata, ex prueba técnica)
select mon_priv.mon_limpiar_calculados('83f26ee2-813d-4daa-b3fa-205de431c78a');
