create table if not exists public.mon_smn_cache (
  url text primary key,
  alerta jsonb,
  leido_en timestamptz not null default now()
);
alter table public.mon_smn_cache enable row level security;
revoke all on public.mon_smn_cache from anon, authenticated;
