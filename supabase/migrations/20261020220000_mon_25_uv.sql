-- Índice UV con cielo despejado por evento y hora (MET Norway, Locationforecast 2.0, CC BY 4.0)
create table if not exists public.mon_uv (
  evento_id uuid not null references public.mon_eventos(id) on delete cascade,
  valido timestamptz not null,
  uv numeric not null,
  interpolado boolean not null default false,
  fuente text not null default 'met_no',
  actualizado_en timestamptz,
  calculado_en timestamptz not null default now(),
  primary key (evento_id, valido)
);
alter table public.mon_uv enable row level security;
create policy mon_uv_sel on public.mon_uv for select to authenticated using (mon_priv.mon_puede_ver(evento_id));
comment on table public.mon_uv is 'Índice UV con cielo despejado (MET Norway). interpolado = hora entre pasos de 6 h, escalada por altura solar. Hora en UTC.';
