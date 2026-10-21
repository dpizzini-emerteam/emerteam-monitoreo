-- Verificación del pronóstico probabilístico: qué umbrales se alcanzaron en cada ventana ya cerrada.
-- Referencia: mediciones en campo (WBGT y ráfaga). Las observaciones del SMN guardadas (temperatura,
-- humedad y viento medio) no permiten verificar WBGT ni ráfaga; tormenta (CAPE con precipitación) y
-- lluvia intensa no tienen hoy una observación equivalente: esas variables quedan sin verificar.
-- La ráfaga medida a mano suele tomarse a 2 m y el modelo la da a 10 m: la ráfaga observada tiende a ser menor y el viento puede verse sobrepronosticado.

create table if not exists public.mon_ens_verif (
  evento_id uuid not null references public.mon_eventos(id) on delete cascade,
  ventana text not null,
  variable text not null,
  nivel int not null,
  ventana_desde timestamptz not null,
  ventana_hasta timestamptz not null,
  umbral numeric,
  alcanzado boolean not null,
  valor_obs numeric,             -- máximo observado en la ventana
  n_obs int not null,
  fuente_obs text not null default 'medicion',
  registrado_en timestamptz not null default now(),
  primary key (evento_id, ventana, variable, nivel)
);
alter table public.mon_ens_verif enable row level security;
create policy mon_ens_verif_sel on public.mon_ens_verif for select to authenticated using (mon_priv.mon_puede_ver(evento_id));
comment on table public.mon_ens_verif is 'Resultado observado de cada umbral en ventanas cerradas (mediciones en campo). Base del puntaje de Brier y del diagrama de confiabilidad.';

create or replace function mon_priv.mon_ens_verificar() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  insert into public.mon_ens_verif (evento_id, ventana, variable, nivel, ventana_desde, ventana_hasta, umbral, alcanzado, valor_obs, n_obs)
  select v.evento_id, v.ventana, v.variable, v.nivel, v.ventana_desde, v.ventana_hasta, v.umbral,
         case when v.variable = 'wbgt_wt' and v.nivel = 4 then o.maximo > v.umbral else o.maximo >= v.umbral end,
         o.maximo, o.n
  from (
    select distinct on (p.evento_id, p.ventana, p.variable, p.nivel)
           p.evento_id, p.ventana, p.variable, p.nivel, p.ventana_desde, p.ventana_hasta, p.umbral
    from public.mon_ens_prob p
    where p.modelo = 'mezcla' and p.umbral is not null
      and p.ventana_hasta < now() - interval '3 hours'
      and (p.variable in ('wbgt', 'wbgt_wt', 'wbgt_uci') or p.variable like 'viento\_%')
    order by p.evento_id, p.ventana, p.variable, p.nivel, p.corrida desc
  ) v
  cross join lateral (
    select max(case when v.variable like 'viento\_%' then m.rafaga else m.wbgt end) as maximo,
           count(case when v.variable like 'viento\_%' then m.rafaga else m.wbgt end)::int as n
    from public.mon_mediciones m
    where m.evento_id = v.evento_id and m.tomada_en >= v.ventana_desde and m.tomada_en < v.ventana_hasta
  ) o
  where o.n > 0
  on conflict (evento_id, ventana, variable, nivel) do update
    set alcanzado = excluded.alcanzado, valor_obs = excluded.valor_obs, n_obs = excluded.n_obs, registrado_en = now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function mon_priv.mon_ens_verificar() from public, anon, authenticated;

-- Puntaje de Brier por modelo, variable, tipo de ventana y anticipación (días), sobre cada emisión verificada
create or replace view public.mon_ens_brier with (security_invoker = true) as
select p.modelo, p.variable, split_part(p.ventana, ':', 1) as ventana, p.nivel,
       greatest(0, floor(p.anticipacion_h / 24.0))::int as anticipacion_d,
       count(*) as casos,
       round(avg(power(p.prob - case when v.alcanzado then 1 else 0 end, 2)), 4) as brier,
       round(avg(p.prob), 3) as prob_media,
       round(avg(case when v.alcanzado then 1.0 else 0.0 end), 3) as frecuencia_obs
from public.mon_ens_prob p
join public.mon_ens_verif v using (evento_id, ventana, variable, nivel)
group by 1, 2, 3, 4, 5;
comment on view public.mon_ens_brier is 'Puntaje de Brier (0 = perfecto) por modelo, variable, ventana, nivel y anticipación en días.';

-- Diagrama de confiabilidad: frecuencia observada por tramo de probabilidad pronosticada
create or replace view public.mon_ens_confiabilidad with (security_invoker = true) as
select p.modelo, p.variable, least(9, floor(p.prob * 10))::int * 10 as tramo_desde,
       count(*) as casos,
       round(avg(p.prob), 3) as prob_media,
       round(avg(case when v.alcanzado then 1.0 else 0.0 end), 3) as frecuencia_obs
from public.mon_ens_prob p
join public.mon_ens_verif v using (evento_id, ventana, variable, nivel)
group by 1, 2, 3;
comment on view public.mon_ens_confiabilidad is 'Frecuencia observada contra probabilidad media por tramos de 10 %: la diagonal es un pronóstico confiable.';

-- Una vez por día, después de los eventos de la noche
select cron.schedule('mon-ens-verificar', '17 9 * * *', 'select mon_priv.mon_ens_verificar()');
