-- Productoras (clientes) con su grupo de acceso. Decisión de Diego (28/10/2026):
-- · Cada evento se asocia a una productora y todo su grupo lo ve, incluidos los eventos que se carguen después.
-- · El grupo lo arma el responsable de la productora (lo designa EMERTEAM), con cupo de 3 personas; para sumar más
--   lo solicita y EMERTEAM amplía el cupo. EMERTEAM puede agregar o quitar a cualquiera del grupo, sin cupo.
-- · Los accesos por evento (mon_accesos) quedan solo para EMERTEAM, sin cupo: personas ajenas a la productora
--   (Defensa Civil, seguridad, cliente final de una carrera).
-- · Cada alta, baja o cambio queda registrado; cada alta recibe un correo de acceso (función mon-avisos).

create table public.mon_productoras (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique check (btrim(nombre) <> ''),
  cupo integer not null default 3 check (cupo between 0 and 200),
  creado_por text,
  creado_en timestamptz not null default now()
);
comment on table public.mon_productoras is 'Productoras u organizadores cliente. El grupo (mon_productora_miembros) ve todos sus eventos.';
comment on column public.mon_productoras.cupo is 'Personas que el responsable puede sumar al grupo (sin contar responsables). Solo un editor EMERTEAM lo modifica.';

create table public.mon_productora_miembros (
  id uuid primary key default gen_random_uuid(),
  productora_id uuid not null references public.mon_productoras(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and email like '%_@_%'),
  nombre text not null,
  apellido text not null,
  rol text,
  responsable boolean not null default false,
  recibe_alertas boolean not null default true,
  habilitado_por text,
  creado_en timestamptz not null default now(),
  aviso_alta_en timestamptz,
  unique (productora_id, email)
);
create index mon_productora_miembros_email_idx on public.mon_productora_miembros (email);
comment on column public.mon_productora_miembros.responsable is 'Administra el grupo dentro del cupo. Lo designa solo un editor EMERTEAM.';
comment on column public.mon_productora_miembros.aviso_alta_en is 'Envío del correo de acceso; nulo mientras está pendiente.';

alter table public.mon_eventos add column if not exists productora_id uuid references public.mon_productoras(id) on delete set null;
create index if not exists mon_eventos_productora_idx on public.mon_eventos (productora_id);

-- Accesos por evento: correo de acceso al alta (los existentes se dan por avisados)
alter table public.mon_accesos add column if not exists aviso_alta_en timestamptz;
update public.mon_accesos set aviso_alta_en = creado_en where aviso_alta_en is null;

create table public.mon_accesos_registro (
  id bigint generated always as identity primary key,
  productora_id uuid references public.mon_productoras(id) on delete cascade,
  evento_id uuid references public.mon_eventos(id) on delete cascade,
  accion text not null check (accion in ('alta', 'baja', 'responsable', 'deja_responsable', 'alertas_si', 'alertas_no', 'cupo')),
  email text,
  detalle text,
  por text,
  en timestamptz not null default now()
);
create index mon_accesos_registro_prod_idx on public.mon_accesos_registro (productora_id, en desc);
create index mon_accesos_registro_ev_idx on public.mon_accesos_registro (evento_id, en desc);

alter table public.mon_productoras enable row level security;
alter table public.mon_productora_miembros enable row level security;
alter table public.mon_accesos_registro enable row level security;

-- Funciones de permiso
create or replace function mon_priv.mon_es_miembro(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.mon_productora_miembros m where m.productora_id = p and m.email = mon_priv.mon_email())
$$;
create or replace function mon_priv.mon_es_responsable(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.mon_productora_miembros m where m.productora_id = p and m.email = mon_priv.mon_email() and m.responsable)
$$;
create or replace function mon_priv.mon_puede_ver(ev uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select mon_priv.mon_es_admin()
      or mon_priv.mon_es_organizador(ev)
      or exists (select 1 from public.mon_accesos a where a.evento_id = ev and a.email = mon_priv.mon_email())
      or exists (select 1 from public.mon_eventos e
                 join public.mon_productora_miembros m on m.productora_id = e.productora_id
                 where e.id = ev and m.email = mon_priv.mon_email())
$$;

-- Productoras: las ve EMERTEAM y quien integra el grupo; las crea y edita un editor
create policy mon_productoras_sel on public.mon_productoras for select to authenticated
  using (mon_priv.mon_es_admin() or mon_priv.mon_es_miembro(id));
create policy mon_productoras_editor on public.mon_productoras for all to authenticated
  using (mon_priv.mon_es_editor()) with check (mon_priv.mon_es_editor());

-- Grupo: lo ve el propio grupo; lo administran el responsable (sin designar responsables) y un editor
create policy mon_miembros_sel on public.mon_productora_miembros for select to authenticated
  using (mon_priv.mon_es_admin() or mon_priv.mon_es_miembro(productora_id));
create policy mon_miembros_alta on public.mon_productora_miembros for insert to authenticated
  with check (mon_priv.mon_es_editor() or (mon_priv.mon_es_responsable(productora_id) and not responsable));
create policy mon_miembros_baja on public.mon_productora_miembros for delete to authenticated
  using (mon_priv.mon_es_editor() or (mon_priv.mon_es_responsable(productora_id) and not responsable));
create policy mon_miembros_cambio on public.mon_productora_miembros for update to authenticated
  using (mon_priv.mon_es_editor() or mon_priv.mon_es_responsable(productora_id) or email = mon_priv.mon_email())
  with check (mon_priv.mon_es_editor() or mon_priv.mon_es_responsable(productora_id) or email = mon_priv.mon_email());
revoke update on public.mon_productora_miembros from authenticated, anon;
grant update (nombre, apellido, rol, recibe_alertas, responsable) on public.mon_productora_miembros to authenticated;

-- Controles que RLS no expresa: cupo, designación de responsables y qué puede cambiar cada uno
create or replace function mon_priv.mon_controlar_miembro() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_cupo integer;
  v_usados integer;
begin
  if mon_priv.mon_es_editor() or auth.role() = 'service_role' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('mon_cupo_prod:' || new.productora_id::text));
    select cupo into v_cupo from public.mon_productoras where id = new.productora_id;
    select count(*) into v_usados from public.mon_productora_miembros where productora_id = new.productora_id and not responsable;
    if v_usados >= coalesce(v_cupo, 3) then
      raise exception 'CUPO_PRODUCTORA: el grupo tiene cubierto su cupo de % personas. Para sumar más, solicitalo a EMERTEAM.', coalesce(v_cupo, 3)
        using errcode = 'P0001';
    end if;
    new.habilitado_por := nullif(mon_priv.mon_email(), '');
    return new;
  end if;
  -- UPDATE
  if new.responsable is distinct from old.responsable then
    raise exception 'RESPONSABLE: solo EMERTEAM designa o quita responsables.' using errcode = 'P0001';
  end if;
  if not mon_priv.mon_es_responsable(old.productora_id)
     and (new.nombre, new.apellido, new.rol) is distinct from (old.nombre, old.apellido, old.rol) then
    raise exception 'MIEMBRO: solo podés cambiar si recibís alertas.' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function mon_priv.mon_controlar_miembro() from public, anon, authenticated;
create trigger mon_miembros_control before insert or update on public.mon_productora_miembros
  for each row execute function mon_priv.mon_controlar_miembro();

-- Registro de altas, bajas y cambios (grupo, cupo y accesos por evento)
create or replace function mon_priv.mon_registrar_acceso() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_por text := coalesce(nullif(mon_priv.mon_email(), ''), case when auth.role() = 'service_role' then 'sistema' end);
  v_prod uuid;
  v_ev uuid;
begin
  if tg_table_name = 'mon_productoras' then
    if new.cupo is distinct from old.cupo then
      insert into public.mon_accesos_registro (productora_id, accion, detalle, por)
      values (new.id, 'cupo', old.cupo || ' → ' || new.cupo, v_por);
    end if;
    return new;
  end if;
  if tg_table_name = 'mon_productora_miembros' then
    v_prod := coalesce(new.productora_id, old.productora_id);
  else
    v_ev := coalesce(new.evento_id, old.evento_id);
  end if;
  if tg_op = 'INSERT' then
    insert into public.mon_accesos_registro (productora_id, evento_id, accion, email, detalle, por)
    values (v_prod, v_ev, 'alta', new.email, trim(new.nombre || ' ' || new.apellido), v_por);
  elsif tg_op = 'DELETE' then
    -- La baja en cascada de una productora o un evento borrados no se registra
    if (v_prod is not null and exists (select 1 from public.mon_productoras where id = v_prod))
       or (v_ev is not null and exists (select 1 from public.mon_eventos where id = v_ev)) then
      insert into public.mon_accesos_registro (productora_id, evento_id, accion, email, detalle, por)
      values (v_prod, v_ev, 'baja', old.email, trim(old.nombre || ' ' || old.apellido), v_por);
    end if;
  else
    -- Anidado: en mon_accesos el registro NEW no tiene la columna responsable
    if tg_table_name = 'mon_productora_miembros' then
      if new.responsable is distinct from old.responsable then
        insert into public.mon_accesos_registro (productora_id, accion, email, por)
        values (v_prod, case when new.responsable then 'responsable' else 'deja_responsable' end, new.email, v_por);
      end if;
    end if;
    if new.recibe_alertas is distinct from old.recibe_alertas then
      insert into public.mon_accesos_registro (productora_id, evento_id, accion, email, por)
      values (v_prod, v_ev, case when new.recibe_alertas then 'alertas_si' else 'alertas_no' end, new.email, v_por);
    end if;
  end if;
  return coalesce(new, old);
end $$;
revoke all on function mon_priv.mon_registrar_acceso() from public, anon, authenticated;
create trigger mon_miembros_registro after insert or update or delete on public.mon_productora_miembros
  for each row execute function mon_priv.mon_registrar_acceso();
create trigger mon_accesos_registro_t after insert or update or delete on public.mon_accesos
  for each row execute function mon_priv.mon_registrar_acceso();
create trigger mon_productoras_registro after update of cupo on public.mon_productoras
  for each row execute function mon_priv.mon_registrar_acceso();

create policy mon_registro_sel on public.mon_accesos_registro for select to authenticated
  using (mon_priv.mon_es_admin() or (productora_id is not null and mon_priv.mon_es_responsable(productora_id)));

-- Accesos por evento: solo EMERTEAM, sin cupo
alter policy mon_accesos_gestion on public.mon_accesos
  using (mon_priv.mon_es_editor()) with check (mon_priv.mon_es_editor());
alter policy mon_accesos_sel on public.mon_accesos
  using (mon_priv.mon_es_admin() or email = mon_priv.mon_email());
drop trigger if exists mon_accesos_cupo on public.mon_accesos;
comment on column public.mon_eventos.cupo_equipo is 'Sin uso desde mon_33: el cupo pasó a la productora (mon_productoras.cupo).';

revoke all on all functions in schema mon_priv from public, anon;
grant execute on function mon_priv.mon_es_miembro(uuid), mon_priv.mon_es_responsable(uuid), mon_priv.mon_puede_ver(uuid) to authenticated;
revoke truncate, trigger, references on public.mon_productoras, public.mon_productora_miembros, public.mon_accesos_registro from anon, authenticated;
revoke all on public.mon_productoras, public.mon_productora_miembros, public.mon_accesos_registro from anon;
revoke insert, update, delete on public.mon_accesos_registro from authenticated;
