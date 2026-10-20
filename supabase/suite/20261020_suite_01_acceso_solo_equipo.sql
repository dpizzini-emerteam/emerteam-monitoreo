-- EMERTEAM SUITE · acceso solo para el equipo EMERTEAM
-- Proyecto Supabase: emerteam-historico-carreras (timwhyxdrputxywsolck)
-- Motivo: 17 tablas y el bucket documentos-plan admiten lectura y escritura de CUALQUIER usuario
-- autenticado, y el alta pública está abierta. La autenticación es compartida con Monitoreo Ambiental.
-- Efecto: solo los correos de suite_priv.equipo acceden a SUITE. Lo público (botón SOS, anon) no cambia.
-- Ejecutar completo en Supabase → SQL Editor.

begin;

create schema if not exists suite_priv;
revoke all on schema suite_priv from public, anon;
grant usage on schema suite_priv to authenticated;

create table if not exists suite_priv.equipo (
  email text primary key check (email = lower(email)),
  nombre text not null,
  creado_en timestamptz not null default now()
);
alter table suite_priv.equipo enable row level security;
revoke all on suite_priv.equipo from public, anon, authenticated;

insert into suite_priv.equipo (email, nombre) values
  ('dpizzini@emerteam.com.ar', 'Diego A. Pizzini'),
  ('aastorga@emerteam.com.ar', 'Agustín Astorga')
on conflict (email) do nothing;

create or replace function suite_priv.es_equipo() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from suite_priv.equipo e
    where e.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function suite_priv.es_equipo() from public, anon;
grant execute on function suite_priv.es_equipo() to authenticated;

alter policy equipo_autenticado_acceso_total on public.alertas_campo_pendientes using (suite_priv.es_equipo()) with check (suite_priv.es_equipo());
alter policy equipo_autenticado_acceso_total_anexo_ficha_contacto on public.anexo_ficha_contacto using (suite_priv.es_equipo()) with check (suite_priv.es_equipo());
alter policy equipo_autenticado_acceso_total_anexos on public.anexos_medico_sanitarios using (suite_priv.es_equipo()) with check (suite_priv.es_equipo());
alter policy equipo_autenticado_acceso_total on public.calibraciones_motor using (suite_priv.es_equipo()) with check (suite_priv.es_equipo());
alter policy equipo_autenticado_acceso_total on public.clasificaciones_historicas using (suite_priv.es_equipo()) with check (suite_priv.es_equipo());
alter policy equipo_autenticado_acceso_total on public.clima_evento using (suite_priv.es_equipo()) with check (suite_priv.es_equipo());
alter policy equipo_autenticado_acceso_total on public.corrales_plantilla using (suite_priv.es_equipo()) with check (suite_priv.es_equipo());
alter policy equipo_autenticado_acceso_total on public.cronogramas using (suite_priv.es_equipo()) with check (suite_priv.es_equipo());
alter policy equipo_autenticado_acceso_total on public.documentos using (suite_priv.es_equipo()) with check (suite_priv.es_equipo());
alter policy equipo_autenticado_acceso_total on public.ediciones using (suite_priv.es_equipo()) with check (suite_priv.es_equipo());
alter policy equipo_autenticado_acceso_total on public.evento using (suite_priv.es_equipo()) with check (suite_priv.es_equipo());
alter policy equipo_autenticado_acceso_total on public.fichas_evento using (suite_priv.es_equipo()) with check (suite_priv.es_equipo());
alter policy equipo_autenticado_acceso_total_hospitales on public.hospitales_derivacion using (suite_priv.es_equipo()) with check (suite_priv.es_equipo());
alter policy equipo_autenticado_acceso_total on public.mapeos_formato_inscriptos using (suite_priv.es_equipo()) with check (suite_priv.es_equipo());
alter policy modelos_estilo_lectura on public.modelos_estilo using (suite_priv.es_equipo());
alter policy planes_evento_equipo on public.planes_evento using (suite_priv.es_equipo()) with check (suite_priv.es_equipo());
alter policy textos_aprobados_equipo on public.textos_aprobados using (suite_priv.es_equipo()) with check (suite_priv.es_equipo());

alter policy equipo_autenticado_storage_documentos_select on storage.objects using (bucket_id = 'documentos-plan' and suite_priv.es_equipo());
alter policy equipo_autenticado_storage_documentos_insert on storage.objects with check (bucket_id = 'documentos-plan' and suite_priv.es_equipo());
alter policy equipo_autenticado_storage_documentos_update on storage.objects using (bucket_id = 'documentos-plan' and suite_priv.es_equipo()) with check (bucket_id = 'documentos-plan' and suite_priv.es_equipo());
alter policy equipo_autenticado_storage_documentos_delete on storage.objects using (bucket_id = 'documentos-plan' and suite_priv.es_equipo());

commit;

-- Sumar a alguien al equipo SUITE:
--   insert into suite_priv.equipo (email, nombre) values ('correo@emerteam.com.ar', 'Nombre Apellido');

-- Reversión: reemplazar suite_priv.es_equipo() por true en cada política de public,
-- y dejar solo bucket_id = 'documentos-plan' en las de storage.objects.
