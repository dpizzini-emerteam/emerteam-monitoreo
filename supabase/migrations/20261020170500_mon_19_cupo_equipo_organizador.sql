-- Cupo de personas que el organizador puede sumar a su equipo (ampliable solo por EMERTEAM)
alter table public.mon_eventos add column if not exists cupo_equipo integer not null default 3
  check (cupo_equipo between 0 and 200);
comment on column public.mon_eventos.cupo_equipo is 'Personas del equipo del organizador con acceso (mon_accesos). Solo un editor EMERTEAM lo modifica.';

create or replace function mon_priv.mon_controlar_cupo() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_cupo integer;
  v_usados integer;
begin
  -- Los editores EMERTEAM no tienen límite (son quienes amplían el cupo)
  if mon_priv.mon_es_editor() or auth.role() = 'service_role' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.evento_id = old.evento_id then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('mon_cupo:' || new.evento_id::text));
  select cupo_equipo into v_cupo from public.mon_eventos where id = new.evento_id;
  select count(*) into v_usados from public.mon_accesos where evento_id = new.evento_id;
  if v_usados >= coalesce(v_cupo, 3) then
    raise exception 'CUPO_EQUIPO: el evento tiene cubierto su cupo de % personas. Para sumar más, solicitalo a EMERTEAM.', coalesce(v_cupo, 3)
      using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function mon_priv.mon_controlar_cupo() from public, anon, authenticated;

create trigger mon_accesos_cupo before insert or update of evento_id on public.mon_accesos
  for each row execute function mon_priv.mon_controlar_cupo();
