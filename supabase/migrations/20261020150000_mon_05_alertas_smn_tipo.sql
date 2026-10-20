alter table public.mon_alertas_smn add column if not exists tipo text not null default 'alerta' check (tipo in ('alerta', 'aviso_corto_plazo'));
alter table public.mon_alertas_smn add column if not exists severidad text;
alter table public.mon_alertas_smn add column if not exists fuente_url text;
create index if not exists mon_alertas_smn_evento_idx on public.mon_alertas_smn (evento_id, estado, hasta);
