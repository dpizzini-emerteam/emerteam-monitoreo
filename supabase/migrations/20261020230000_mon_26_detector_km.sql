alter table public.mon_mediciones add column if not exists rayo_km numeric;
comment on column public.mon_mediciones.rayo_km is 'Distancia estimada al frente de tormenta según el detector portátil, en km (si se cargó en millas se convierte). Null = sin dato.';
comment on column public.mon_mediciones.rayo_conteo is 'Contador acumulado de rayos del detector (AcuRite: hasta 199, se reinicia al apagarlo).';
