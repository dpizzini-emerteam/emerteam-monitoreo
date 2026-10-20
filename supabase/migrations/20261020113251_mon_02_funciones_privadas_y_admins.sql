create schema if not exists mon_priv;
grant usage on schema mon_priv to authenticated;
alter function public.mon_email() set schema mon_priv;
alter function public.mon_es_admin() set schema mon_priv;
alter function public.mon_es_organizador(uuid) set schema mon_priv;
alter function public.mon_puede_ver(uuid) set schema mon_priv;

create or replace function mon_priv.mon_es_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.mon_admins a where a.email = mon_priv.mon_email())
$$;
create or replace function mon_priv.mon_es_organizador(ev uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.mon_eventos e where e.id = ev and e.organizador_email = mon_priv.mon_email())
$$;
create or replace function mon_priv.mon_puede_ver(ev uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select mon_priv.mon_es_admin()
      or mon_priv.mon_es_organizador(ev)
      or exists (select 1 from public.mon_accesos a where a.evento_id = ev and a.email = mon_priv.mon_email())
$$;

revoke all on all functions in schema mon_priv from public, anon;
grant execute on all functions in schema mon_priv to authenticated;

insert into public.mon_admins (email, nombre) values ('aastorga@emerteam.com.ar', 'Agustín Astorga');
