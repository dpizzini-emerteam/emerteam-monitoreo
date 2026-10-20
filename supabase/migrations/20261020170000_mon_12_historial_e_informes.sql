create table if not exists public.mon_niveles_historial (
  id bigserial primary key,
  evento_id uuid not null references public.mon_eventos(id) on delete cascade,
  fase text not null, variable text not null, desde timestamptz not null, hasta timestamptz not null,
  nivel smallint not null, valor numeric, umbral numeric, regla text, confianza text,
  emitido_en timestamptz not null default now()
);
create index if not exists mon_niveles_historial_evento_idx on public.mon_niveles_historial (evento_id, emitido_en);
alter table public.mon_niveles_historial enable row level security;
create policy mon_niveles_historial_sel on public.mon_niveles_historial for select to authenticated using (mon_priv.mon_es_admin());
revoke insert, update, delete, truncate on public.mon_niveles_historial from anon, authenticated;
create or replace function mon_priv.mon_registrar_nivel() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.nivel > 0 and not exists (
    select 1 from public.mon_niveles_historial h
    where h.evento_id = new.evento_id and h.fase = new.fase and h.variable = new.variable
      and h.desde = new.desde and h.hasta = new.hasta and h.nivel = new.nivel
  ) then
    insert into public.mon_niveles_historial (evento_id, fase, variable, desde, hasta, nivel, valor, umbral, regla, confianza)
    values (new.evento_id, new.fase, new.variable, new.desde, new.hasta, new.nivel, new.valor, new.umbral, new.regla, new.confianza);
  end if;
  return new;
end $$;
revoke all on function mon_priv.mon_registrar_nivel() from public, anon, authenticated;
create trigger mon_niveles_historial_trg after insert on public.mon_niveles for each row execute function mon_priv.mon_registrar_nivel();
create table if not exists public.mon_informes (
  evento_id uuid primary key references public.mon_eventos(id) on delete cascade,
  estado text not null default 'borrador' check (estado in ('borrador', 'aprobado')),
  notas_corredores text, notas_trabajadores text, actualizado_por text,
  actualizado_en timestamptz not null default now(), aprobado_por text, aprobado_en timestamptz, contenido jsonb
);
alter table public.mon_informes enable row level security;
create policy mon_informes_sel on public.mon_informes for select to authenticated
  using (mon_priv.mon_es_admin() or (estado = 'aprobado' and mon_priv.mon_puede_ver(evento_id)));
create policy mon_informes_edicion on public.mon_informes for all to authenticated
  using (mon_priv.mon_es_editor()) with check (mon_priv.mon_es_editor());
revoke truncate, trigger, references on public.mon_informes from anon, authenticated;
revoke insert, update, delete on public.mon_informes from anon;
