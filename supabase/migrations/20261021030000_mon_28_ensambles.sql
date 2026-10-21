-- Pronóstico probabilístico por umbral a partir de ensambles (ECMWF ENS open data CC BY 4.0; NOAA GEFS).
-- Cada emisión se guarda sin sobrescribir las anteriores: es la base de la evolución entre emisiones
-- (D-5, D-3, D-1) y de la verificación posterior (Brier, confiabilidad).

-- Probabilidad de alcanzar cada nivel con el máximo dentro de una ventana operativa
create table if not exists public.mon_ens_prob (
  evento_id uuid not null references public.mon_eventos(id) on delete cascade,
  corrida timestamptz not null,           -- corrida de referencia (ECMWF ENS; en la mezcla, la de ECMWF)
  modelo text not null check (modelo in ('ecmwf', 'gefs', 'mezcla')),
  variable text not null,                 -- wbgt | wbgt_wt | wbgt_uci | viento_A | viento_B | viento_C | tormenta | lluvia
  nivel int not null,
  ventana text not null,                  -- carrera | armado | desarme | ultimo_cuarto:<modalidad>
  ventana_desde timestamptz not null,
  ventana_hasta timestamptz not null,
  umbral numeric,
  prob numeric not null check (prob >= 0 and prob <= 1),
  p10 numeric, p50 numeric, p90 numeric,  -- percentiles del máximo de la variable en la ventana
  miembros int not null,
  anticipacion_h int not null,            -- horas entre la corrida y el inicio de la ventana
  corridas jsonb,                         -- corrida de cada modelo usado en la mezcla
  aproximacion text,                      -- nota de método cuando la probabilidad es un proxy
  emitido_en timestamptz not null default now(),
  primary key (evento_id, corrida, modelo, variable, nivel, ventana)
);
alter table public.mon_ens_prob enable row level security;
create policy mon_ens_prob_sel on public.mon_ens_prob for select to authenticated using (mon_priv.mon_puede_ver(evento_id));
create index if not exists mon_ens_prob_evento on public.mon_ens_prob (evento_id, ventana, variable, corrida);
comment on table public.mon_ens_prob is 'Probabilidad (fracción de miembros, mezcla 50 % por modelo) de alcanzar cada nivel con el máximo de la ventana. Sin calibración de dispersión todavía.';

-- Curva horaria: mediana y banda P10–P90 por hora, con la probabilidad horaria por nivel
create table if not exists public.mon_ens_horas (
  evento_id uuid not null references public.mon_eventos(id) on delete cascade,
  corrida timestamptz not null,
  modelo text not null check (modelo in ('ecmwf', 'gefs', 'mezcla')),
  variable text not null,                 -- variable de calor de la disciplina | rafaga
  valido timestamptz not null,
  p10 numeric, p50 numeric, p90 numeric,
  probs jsonb,                            -- {"1": 0.4, "2": 0.1, ...} probabilidad horaria por nivel
  miembros int not null,
  emitido_en timestamptz not null default now(),
  primary key (evento_id, corrida, modelo, variable, valido)
);
alter table public.mon_ens_horas enable row level security;
create policy mon_ens_horas_sel on public.mon_ens_horas for select to authenticated using (mon_priv.mon_puede_ver(evento_id));
comment on table public.mon_ens_horas is 'Serie horaria del ensamble por evento y emisión: P10, P50, P90 y probabilidad horaria por nivel. Hora en UTC.';
