create table if not exists public.mon_rayos (
  id bigserial primary key,
  evento_id uuid not null references public.mon_eventos(id) on delete cascade,
  ocurrido_en timestamptz not null,
  lat numeric not null, lon numeric not null, distancia_km numeric not null,
  fuente text not null default 'glm', archivo text not null,
  unique (evento_id, archivo, lat, lon)
);
create index if not exists mon_rayos_evento_idx on public.mon_rayos (evento_id, ocurrido_en desc);
alter table public.mon_rayos enable row level security;
create policy mon_rayos_sel on public.mon_rayos for select to authenticated using (mon_priv.mon_puede_ver(evento_id));
revoke insert, update, delete, truncate on public.mon_rayos from anon, authenticated;
alter publication supabase_realtime add table public.mon_rayos;
create table if not exists public.mon_estado (clave text primary key, valor text, actualizado_en timestamptz not null default now());
alter table public.mon_estado enable row level security;
revoke all on public.mon_estado from anon, authenticated;
