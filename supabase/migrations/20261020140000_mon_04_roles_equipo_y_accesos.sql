-- Equipo EMERTEAM con roles: editor (ve y edita todo, administra el equipo) y lector (ve todo, no edita)
alter table public.mon_admins add column if not exists rol text not null default 'editor'
  check (rol in ('editor', 'lector'));

create or replace function mon_priv.mon_es_editor() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.mon_admins a where a.email = mon_priv.mon_email() and a.rol = 'editor')
$$;
revoke all on function mon_priv.mon_es_editor() from public, anon;
grant execute on function mon_priv.mon_es_editor() to authenticated;

alter policy mon_eventos_admin on public.mon_eventos using (mon_priv.mon_es_editor()) with check (mon_priv.mon_es_editor());
alter policy mon_modalidades_admin on public.mon_modalidades using (mon_priv.mon_es_editor()) with check (mon_priv.mon_es_editor());
alter policy mon_accesos_gestion on public.mon_accesos
  using (mon_priv.mon_es_editor() or mon_priv.mon_es_organizador(evento_id))
  with check (mon_priv.mon_es_editor() or mon_priv.mon_es_organizador(evento_id));

create policy mon_admins_alta on public.mon_admins for insert to authenticated
  with check (mon_priv.mon_es_editor() and email = lower(email));
create policy mon_admins_cambio on public.mon_admins for update to authenticated
  using (mon_priv.mon_es_editor() and email <> mon_priv.mon_email())
  with check (mon_priv.mon_es_editor() and email <> mon_priv.mon_email());
create policy mon_admins_baja on public.mon_admins for delete to authenticated
  using (mon_priv.mon_es_editor() and email <> mon_priv.mon_email());
revoke update on public.mon_admins from authenticated;
grant update (nombre, rol) on public.mon_admins to authenticated;

-- En mon_accesos solo se puede modificar "recibe_alertas" (no mover la fila a otro evento)
revoke update on public.mon_accesos from authenticated, anon;
grant update (recibe_alertas) on public.mon_accesos to authenticated;

do $$
declare t text;
begin
  foreach t in array array['mon_admins','mon_eventos','mon_modalidades','mon_accesos','mon_pronosticos','mon_niveles','mon_alertas_smn','mon_mediciones','mon_envios','mon_consultas'] loop
    execute format('revoke truncate, trigger, references on public.%I from anon, authenticated', t);
    execute format('revoke insert, update, delete on public.%I from anon', t);
  end loop;
end $$;
