-- Disciplinas: running (actual), triatlón, aguas abiertas, ciclismo y carreras de montaña.
-- Los eventos existentes quedan como running, sin cambios.
alter table public.mon_eventos
  add column if not exists disciplina text not null default 'running'
    check (disciplina in ('running','triatlon','aguas_abiertas','ciclismo','montana')),
  add column if not exists agua_tipo text check (agua_tipo in ('mar','rio','lago','laguna')),
  add column if not exists natacion_m integer check (natacion_m > 0),
  add column if not exists natacion_min integer check (natacion_min > 0);
comment on column public.mon_eventos.disciplina is 'Define la escala de calor y las variables del monitoreo (ver config/umbrales.json).';
comment on column public.mon_eventos.natacion_m is 'Distancia de natación (triatlón y aguas abiertas), para las reglas de temperatura del agua.';
comment on column public.mon_eventos.natacion_min is 'Duración estimada del segmento de natación del triatlón (zona crítica).';

-- Mediciones del agua en terreno
alter table public.mon_mediciones
  add column if not exists agua_temp numeric,
  add column if not exists enterococos numeric,
  add column if not exists ecoli numeric,
  add column if not exists cianobacterias numeric;
comment on column public.mon_mediciones.agua_temp is 'Temperatura del agua (°C) según el protocolo de la federación (profundidad y puntos).';
comment on column public.mon_mediciones.enterococos is 'Enterococos intestinales, UFC/100 ml (resultado de laboratorio).';
comment on column public.mon_mediciones.ecoli is 'E. coli, UFC/100 ml (resultado de laboratorio).';
comment on column public.mon_mediciones.cianobacterias is 'Cianobacterias, células/ml (resultado de laboratorio).';

-- El cambio de disciplina o de duración también reprocesa los niveles
create or replace trigger mon_eventos_disparo_cambio
  after update of largada, lat, lon, armado_dias, estado, disciplina, duracion_propia_min, natacion_min on public.mon_eventos
  for each row
  when (old.largada is distinct from new.largada or old.lat is distinct from new.lat or old.lon is distinct from new.lon
        or old.armado_dias is distinct from new.armado_dias or old.estado is distinct from new.estado
        or old.disciplina is distinct from new.disciplina or old.duracion_propia_min is distinct from new.duracion_propia_min
        or old.natacion_min is distinct from new.natacion_min)
  execute function mon_priv.mon_disparar_procesamiento();
