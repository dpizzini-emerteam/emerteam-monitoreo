-- Tiempo real solo para tablas del Monitoreo Ambiental (respeta RLS)
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
alter publication supabase_realtime add table public.mon_niveles, public.mon_alertas_smn;
