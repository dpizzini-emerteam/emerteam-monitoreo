-- Copia fija del informe al aprobarlo: es lo que ve el organizador
alter table public.mon_informes add column if not exists contenido jsonb;
