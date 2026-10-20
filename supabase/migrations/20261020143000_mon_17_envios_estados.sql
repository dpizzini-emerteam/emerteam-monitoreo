-- Estados que usa la función de avisos
alter table public.mon_envios drop constraint mon_envios_estado_check;
alter table public.mon_envios add constraint mon_envios_estado_check
  check (estado in ('enviado','fallido','error','sin_credencial'));
