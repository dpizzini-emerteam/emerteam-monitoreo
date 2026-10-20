-- Punto de grilla usado y valores corregidos con observaciones del SMN
alter table public.mon_pronosticos
  add column if not exists punto_lat numeric,
  add column if not exists punto_lon numeric,
  add column if not exists punto_tierra boolean,
  add column if not exists t2m_corr numeric,
  add column if not exists td2m_corr numeric,
  add column if not exists hr_corr numeric,
  add column if not exists viento10_corr numeric,
  add column if not exists rafaga10_corr numeric,
  add column if not exists wbgt_corr numeric;

-- Observaciones horarias de estaciones del SMN (datos abiertos)
create table if not exists public.mon_observaciones (
  estacion text not null,
  valido timestamptz not null,
  temp numeric,
  hr numeric,
  presion numeric,
  dir_viento integer,
  viento numeric,
  cargado_en timestamptz not null default now(),
  primary key (estacion, valido)
);
alter table public.mon_observaciones enable row level security;
create policy mon_observaciones_sel on public.mon_observaciones for select to authenticated using (true);
comment on table public.mon_observaciones is 'Observaciones horarias SMN (datohorario, datos abiertos). Hora en UTC.';

-- Corrección aplicada y error medido por evento y modelo
create table if not exists public.mon_sesgos (
  evento_id uuid not null references public.mon_eventos(id) on delete cascade,
  fuente text not null,
  estacion text,
  estacion_lat numeric,
  estacion_lon numeric,
  distancia_km numeric,
  pares integer not null default 0,
  sesgo_t_dia numeric,
  sesgo_t_noche numeric,
  sesgo_td numeric,
  factor_viento numeric,
  error_t numeric,
  error_t_corr numeric,
  error_viento numeric,
  error_viento_corr numeric,
  aplicado boolean not null default false,
  calculado_en timestamptz not null default now(),
  primary key (evento_id, fuente)
);
alter table public.mon_sesgos enable row level security;
create policy mon_sesgos_sel on public.mon_sesgos for select to authenticated using (mon_priv.mon_puede_ver(evento_id));
