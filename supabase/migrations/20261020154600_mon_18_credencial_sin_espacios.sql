-- Las claves de aplicación de Google se muestran en bloques con espacios: se descartan al leerlas
create or replace function public.mon_credencial_smtp() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'usuario', (select btrim(decrypted_secret) from vault.decrypted_secrets where name = 'mon_smtp_usuario'),
    'clave', (select regexp_replace(decrypted_secret, '\s', '', 'g') from vault.decrypted_secrets where name = 'mon_smtp_clave'),
    'remitente', coalesce((select btrim(decrypted_secret) from vault.decrypted_secrets where name = 'mon_smtp_remitente'), 'info@emerteam.com.ar')
  )
$$;
revoke all on function public.mon_credencial_smtp() from public, anon, authenticated;
grant execute on function public.mon_credencial_smtp() to service_role;
