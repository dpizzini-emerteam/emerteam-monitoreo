-- Verificación fuera de muestra por plazo de anticipación (decisión de Diego, 29/10/2026: mejorar la precisión).
-- mon_pronosticos guarda solo la última corrida de cada fuente por hora válida. Para saber cuánto acierta cada
-- modelo a 1, 2 o 5 días hace falta conservar lo que se pronosticó en cada corrida y compararlo después con lo
-- observado en las estaciones del SMN. Se archiva cada 3 h de validez (00, 03, …, 21 UTC) para acotar el volumen,
-- incluido el consenso de la web (fuente «mezcla»), y se borra a los 60 días.

create table public.mon_pron_archivo (
  evento_id uuid not null references public.mon_eventos(id) on delete cascade,
  fuente text not null,
  corrida timestamptz not null,
  valido timestamptz not null,
  anticipacion_h int not null,
  t2m numeric(5,2), td2m numeric(5,2), viento10 numeric(5,1), rafaga10 numeric(5,1), precip numeric(6,2), wbgt_est numeric(5,2),
  guardado_en timestamptz not null default now(),
  primary key (evento_id, fuente, corrida, valido)
);
create index mon_pron_archivo_valido_idx on public.mon_pron_archivo (valido);
alter table public.mon_pron_archivo enable row level security;
create policy mon_pron_archivo_sel on public.mon_pron_archivo for select to authenticated using (mon_priv.mon_es_admin());
comment on table public.mon_pron_archivo is 'Pronóstico de cada corrida por fuente (y del consenso, fuente mezcla), cada 3 h de validez, para verificar por anticipación. Se conserva 60 días.';

create table public.mon_verif_modelos (
  fuente text not null,
  plazo text not null,          -- tramo de anticipación en horas: 0-24, 24-48, …
  variable text not null,       -- temp (°C) · viento (viento medio, km/h)
  n int not null,
  sesgo numeric,                -- pronóstico menos observado
  rmse numeric,
  desvio numeric,               -- desvío del error: lo que queda después de corregir el sesgo medio
  mae numeric,
  desde timestamptz,
  hasta timestamptz,
  actualizado_en timestamptz not null default now(),
  primary key (fuente, plazo, variable)
);
alter table public.mon_verif_modelos enable row level security;
-- Indicadores agregados de todas las sedes, sin datos de eventos: los ve cualquier usuario autenticado
create policy mon_verif_modelos_sel on public.mon_verif_modelos for select to authenticated using (true);
comment on table public.mon_verif_modelos is 'Error de cada fuente por plazo de anticipación contra las estaciones del SMN (últimos 45 días, todas las sedes).';

create or replace function mon_priv.mon_verificar_modelos() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  delete from public.mon_pron_archivo where valido < now() - interval '60 days';
  with est as (
    -- Estación más cercana con la que se corrige cada evento
    select distinct on (evento_id) evento_id, estacion
    from public.mon_sesgos where estacion is not null and distancia_km <= 60
    order by evento_id, distancia_km
  ), pares as (
    select a.fuente,
           case when a.anticipacion_h < 24 then '0-24' when a.anticipacion_h < 48 then '24-48'
                when a.anticipacion_h < 72 then '48-72' when a.anticipacion_h < 96 then '72-96'
                when a.anticipacion_h < 120 then '96-120' else '120-168' end as plazo,
           a.t2m - o.temp as e_t, a.viento10 - o.viento as e_v, a.valido
    from public.mon_pron_archivo a
    join est using (evento_id)
    join public.mon_observaciones o on o.estacion = est.estacion and o.valido = a.valido
    where a.valido > now() - interval '45 days' and a.valido <= now() and a.anticipacion_h between 0 and 168
  ), por_var as (
    select fuente, plazo, 'temp' as variable, e_t as e, valido from pares where e_t is not null
    union all
    select fuente, plazo, 'viento', e_v, valido from pares where e_v is not null
  )
  insert into public.mon_verif_modelos (fuente, plazo, variable, n, sesgo, rmse, desvio, mae, desde, hasta, actualizado_en)
  select fuente, plazo, variable, count(*)::int, round(avg(e), 2), round(sqrt(avg(e * e)), 2), round(stddev_pop(e), 2),
         round(avg(abs(e)), 2), min(valido), max(valido), now()
  from por_var group by 1, 2, 3
  on conflict (fuente, plazo, variable) do update
    set n = excluded.n, sesgo = excluded.sesgo, rmse = excluded.rmse, desvio = excluded.desvio, mae = excluded.mae,
        desde = excluded.desde, hasta = excluded.hasta, actualizado_en = now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function mon_priv.mon_verificar_modelos() from public, anon, authenticated;

-- Cada 6 h, a los 41 minutos (después de las observaciones horarias del SMN)
select cron.schedule('mon-verificar-modelos', '41 */6 * * *', $$select mon_priv.mon_verificar_modelos()$$);

revoke truncate, trigger, references on public.mon_pron_archivo, public.mon_verif_modelos from anon, authenticated;
revoke all on public.mon_pron_archivo, public.mon_verif_modelos from anon;
revoke insert, update, delete on public.mon_pron_archivo, public.mon_verif_modelos from authenticated;
