-- Corrección con hasta dos estaciones (ponderadas por la inversa de la distancia) y atenuación por distancia
alter table public.mon_sesgos
  add column if not exists atenuacion numeric,
  add column if not exists rmse_t_corr numeric,
  add column if not exists rmse_viento_corr numeric,
  add column if not exists estaciones jsonb;
comment on column public.mon_sesgos.atenuacion is 'Fracción del sesgo aplicada: 1 hasta 25 km, lineal hasta 0,5 a 60 km (criterio interno EMERTEAM).';
comment on column public.mon_sesgos.estaciones is 'Detalle por estación: nombre, km, pares y sesgos sin atenuar.';
comment on column public.mon_sesgos.rmse_t_corr is 'Error cuadrático medio de temperatura después de corregir (°C); se usa para calibrar el ensamble.';
