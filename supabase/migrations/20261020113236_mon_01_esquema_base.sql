-- EMERTEAM Monitoreo Ambiental: esquema base (prefijo mon_). No modifica objetos existentes.

create table public.mon_admins (
  email text primary key check (email = lower(email)),
  nombre text not null,
  creado_en timestamptz not null default now()
);

create table public.mon_eventos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  largada timestamptz not null,
  ubicacion text not null,
  lat numeric(8,4) not null check (lat between -90 and 90),
  lon numeric(8,4) not null check (lon between -180 and 180),
  organizador_email text not null check (organizador_email = lower(organizador_email)),
  participantes integer not null check (participantes >= 0),
  armado_dias integer not null default 3 check (armado_dias between 1 and 10),
  duracion_propia_min integer check (duracion_propia_min > 0),
  demora_largada_min integer check (demora_largada_min >= 0),
  portico text not null default 'estructural' check (portico in ('estructural','inflable')),
  estado text not null default 'activo' check (estado in ('activo','cerrado')),
  creado_por text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index mon_eventos_largada_idx on public.mon_eventos (largada);
create index mon_eventos_org_idx on public.mon_eventos (organizador_email);

create table public.mon_modalidades (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.mon_eventos(id) on delete cascade,
  nombre text not null,
  distancia_km numeric(5,2) not null check (distancia_km > 0),
  participantes integer check (participantes >= 0),
  largada timestamptz
);
create index mon_modalidades_evento_idx on public.mon_modalidades (evento_id);

create table public.mon_accesos (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.mon_eventos(id) on delete cascade,
  email text not null check (email = lower(email)),
  nombre text not null,
  apellido text not null,
  rol text,
  recibe_alertas boolean not null default true,
  habilitado_por text,
  creado_en timestamptz not null default now(),
  unique (evento_id, email)
);
create index mon_accesos_email_idx on public.mon_accesos (email);

create table public.mon_pronosticos (
  evento_id uuid not null references public.mon_eventos(id) on delete cascade,
  fuente text not null,
  corrida timestamptz not null,
  valido timestamptz not null,
  t2m numeric(5,2), td2m numeric(5,2), hr numeric(5,2),
  viento10 numeric(5,1), rafaga10 numeric(5,1), dir_viento numeric(5,1),
  precip numeric(6,2), prob_precip numeric(5,2), cape numeric(7,1),
  radiacion numeric(7,1), nubosidad numeric(5,2), presion numeric(7,2),
  wbgt_est numeric(5,2),
  procesado_en timestamptz not null default now(),
  primary key (evento_id, fuente, valido)
);

create table public.mon_niveles (
  id bigint generated always as identity primary key,
  evento_id uuid not null references public.mon_eventos(id) on delete cascade,
  fase text not null check (fase in ('armado','carrera','personal','desarme')),
  variable text not null,
  desde timestamptz not null,
  hasta timestamptz not null,
  nivel smallint not null check (nivel between 0 and 4),
  valor numeric,
  umbral numeric,
  regla text not null,
  confianza text check (confianza in ('baja','media','alta')),
  origen text not null default 'pronostico' check (origen in ('pronostico','smn','terreno','satelite')),
  calculado_en timestamptz not null default now()
);
create index mon_niveles_evento_idx on public.mon_niveles (evento_id, desde);

create table public.mon_alertas_smn (
  id text primary key,
  evento_id uuid references public.mon_eventos(id) on delete cascade,
  fenomeno text not null,
  color text not null check (color in ('amarillo','naranja','rojo','violeta')),
  desde timestamptz,
  hasta timestamptz,
  emitida timestamptz,
  estado text not null default 'vigente' check (estado in ('vigente','modificada','levantada')),
  zona text,
  detectada_en timestamptz not null default now()
);
create index mon_alertas_evento_idx on public.mon_alertas_smn (evento_id);

create table public.mon_mediciones (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.mon_eventos(id) on delete cascade,
  operador text not null,
  tomada_en timestamptz not null default now(),
  sector text not null,
  lat numeric(8,4), lon numeric(8,4),
  wbgt numeric(5,2) check (wbgt between -10 and 45),
  temp numeric(5,2) check (temp between -20 and 55),
  hr numeric(5,2) check (hr between 0 and 100),
  viento_medio numeric(5,1) check (viento_medio between 0 and 200),
  rafaga numeric(5,1) check (rafaga between 0 and 250),
  altura_viento_m numeric(4,1),
  rayo_detector text,
  rayo_rango text,
  rayo_conteo integer check (rayo_conteo >= 0),
  rayo_tendencia text check (rayo_tendencia in ('acercandose','estable','alejandose')),
  trueno boolean,
  relampago_trueno_s numeric(5,1),
  foto_path text,
  creado_en timestamptz not null default now()
);
create index mon_mediciones_evento_idx on public.mon_mediciones (evento_id, tomada_en);

create table public.mon_envios (
  id bigint generated always as identity primary key,
  evento_id uuid references public.mon_eventos(id) on delete cascade,
  tipo text not null,
  destinatario text not null,
  asunto text not null,
  estado text not null check (estado in ('enviado','fallido')),
  error text,
  enviado_en timestamptz not null default now()
);

create table public.mon_consultas (
  id bigint generated always as identity primary key,
  evento_id uuid not null references public.mon_eventos(id) on delete cascade,
  email text not null,
  consultado_en timestamptz not null default now()
);

-- Funciones de permiso (prefijo mon_)
create or replace function public.mon_email() returns text
language sql stable set search_path = '' as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create or replace function public.mon_es_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.mon_admins a where a.email = public.mon_email())
$$;

create or replace function public.mon_es_organizador(ev uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.mon_eventos e where e.id = ev and e.organizador_email = public.mon_email())
$$;

create or replace function public.mon_puede_ver(ev uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.mon_es_admin()
      or public.mon_es_organizador(ev)
      or exists (select 1 from public.mon_accesos a where a.evento_id = ev and a.email = public.mon_email())
$$;

-- RLS en todas las tablas nuevas
alter table public.mon_admins enable row level security;
alter table public.mon_eventos enable row level security;
alter table public.mon_modalidades enable row level security;
alter table public.mon_accesos enable row level security;
alter table public.mon_pronosticos enable row level security;
alter table public.mon_niveles enable row level security;
alter table public.mon_alertas_smn enable row level security;
alter table public.mon_mediciones enable row level security;
alter table public.mon_envios enable row level security;
alter table public.mon_consultas enable row level security;

create policy mon_admins_sel on public.mon_admins for select to authenticated using (public.mon_es_admin());

create policy mon_eventos_sel on public.mon_eventos for select to authenticated using (public.mon_puede_ver(id));
create policy mon_eventos_admin on public.mon_eventos for all to authenticated using (public.mon_es_admin()) with check (public.mon_es_admin());

create policy mon_modalidades_sel on public.mon_modalidades for select to authenticated using (public.mon_puede_ver(evento_id));
create policy mon_modalidades_admin on public.mon_modalidades for all to authenticated using (public.mon_es_admin()) with check (public.mon_es_admin());

create policy mon_accesos_sel on public.mon_accesos for select to authenticated using (public.mon_es_admin() or public.mon_es_organizador(evento_id) or email = public.mon_email());
create policy mon_accesos_gestion on public.mon_accesos for all to authenticated using (public.mon_es_admin() or public.mon_es_organizador(evento_id)) with check (public.mon_es_admin() or public.mon_es_organizador(evento_id));
create policy mon_accesos_propio on public.mon_accesos for update to authenticated using (email = public.mon_email()) with check (email = public.mon_email());

create policy mon_pronosticos_sel on public.mon_pronosticos for select to authenticated using (public.mon_puede_ver(evento_id));
create policy mon_niveles_sel on public.mon_niveles for select to authenticated using (public.mon_puede_ver(evento_id));
create policy mon_alertas_sel on public.mon_alertas_smn for select to authenticated using (evento_id is not null and public.mon_puede_ver(evento_id));

create policy mon_mediciones_sel on public.mon_mediciones for select to authenticated using (public.mon_puede_ver(evento_id));
create policy mon_mediciones_admin on public.mon_mediciones for insert to authenticated with check (public.mon_es_admin());

create policy mon_envios_sel on public.mon_envios for select to authenticated using (public.mon_es_admin());

create policy mon_consultas_ins on public.mon_consultas for insert to authenticated with check (email = public.mon_email() and public.mon_puede_ver(evento_id));
create policy mon_consultas_sel on public.mon_consultas for select to authenticated using (public.mon_es_admin());

revoke all on function public.mon_es_admin() from anon;
revoke all on function public.mon_es_organizador(uuid) from anon;
revoke all on function public.mon_puede_ver(uuid) from anon;

insert into public.mon_admins (email, nombre) values ('dpizzini@emerteam.com.ar', 'Diego A. Pizzini');
