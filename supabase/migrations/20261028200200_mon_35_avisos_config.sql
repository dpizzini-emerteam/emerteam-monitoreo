-- Tablero de avisos por correo (decisión de Diego, 28/10/2026). Lo maneja solo EMERTEAM.
-- Las alertas y los avisos a corto plazo del SMN salen siempre. El resto se enciende por productora y cada evento
-- hereda esa configuración salvo que tenga una propia. Sin configuración, solo SMN y rayos detectados.
-- Los niveles mínimos deciden desde cuándo sale el correo; los umbrales operativos siguen siendo los de la guía.

create table public.mon_avisos_config (
  id uuid primary key default gen_random_uuid(),
  productora_id uuid unique references public.mon_productoras(id) on delete cascade,
  evento_id uuid unique references public.mon_eventos(id) on delete cascade,
  rayos boolean not null default true,
  viento boolean not null default false,
  viento_nivel smallint not null default 2 check (viento_nivel between 1 and 4),
  tormenta boolean not null default false,
  calor boolean not null default false,
  calor_nivel smallint not null default 2 check (calor_nivel between 1 and 4),
  lluvia boolean not null default false,
  probabilistico boolean not null default false,
  actualizado_por text,
  actualizado_en timestamptz not null default now(),
  check ((productora_id is null) <> (evento_id is null))
);
comment on table public.mon_avisos_config is 'Qué genera correo además del SMN. Una fila por productora (por defecto de sus eventos) o por evento (prevalece).';
comment on column public.mon_avisos_config.viento_nivel is '1 vigilancia · 2 reforzar · 3 retirar · 4 despejar. Por defecto reforzar, un escalón antes de tener que actuar.';
comment on column public.mon_avisos_config.calor_nivel is 'Nivel de la escala de calor de la disciplina (World Athletics: 2 advertencia). Personal: excede carga moderada.';

alter table public.mon_avisos_config enable row level security;

-- La ven EMERTEAM y quienes ven el evento o integran la productora (para saber qué van a recibir); la edita un editor
create policy mon_avisos_config_sel on public.mon_avisos_config for select to authenticated
  using (mon_priv.mon_es_admin()
    or (evento_id is not null and mon_priv.mon_puede_ver(evento_id))
    or (productora_id is not null and (mon_priv.mon_es_miembro(productora_id)
        or exists (select 1 from public.mon_eventos e where e.productora_id = mon_avisos_config.productora_id and mon_priv.mon_puede_ver(e.id)))));
create policy mon_avisos_config_editor on public.mon_avisos_config for all to authenticated
  using (mon_priv.mon_es_editor()) with check (mon_priv.mon_es_editor());

revoke truncate, trigger, references on public.mon_avisos_config from anon, authenticated;
revoke all on public.mon_avisos_config from anon;
