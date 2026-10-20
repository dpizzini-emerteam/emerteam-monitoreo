-- Valida la clave de pg_cron (guardada en Vault como mon_cron_clave, creada fuera del repositorio)
create or replace function public.mon_validar_cron(clave text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'mon_cron_clave' and decrypted_secret = clave)
$$;
revoke all on function public.mon_validar_cron(text) from public, anon, authenticated;
grant execute on function public.mon_validar_cron(text) to service_role;
