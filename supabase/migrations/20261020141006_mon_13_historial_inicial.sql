-- Carga inicial del historial con los niveles vigentes al crearlo
insert into public.mon_niveles_historial (evento_id, fase, variable, desde, hasta, nivel, valor, umbral, regla, confianza, emitido_en)
select evento_id, fase, variable, desde, hasta, nivel, valor, umbral, regla, confianza, calculado_en
from public.mon_niveles where nivel > 0;
