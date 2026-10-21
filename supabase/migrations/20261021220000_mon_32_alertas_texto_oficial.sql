-- Texto oficial del SMN (descripción e instrucciones del CAP) para mostrarlo en la web y en los correos
alter table public.mon_alertas_smn
  add column if not exists descripcion text,
  add column if not exists instruccion text;
comment on column public.mon_alertas_smn.descripcion is 'Descripción oficial del SMN (CAP info/description), textual.';
comment on column public.mon_alertas_smn.instruccion is 'Instrucciones del SMN a la población (CAP info/instruction), textual.';
