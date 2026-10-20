-- Credenciales de envío de correo: viven en Vault (mon_smtp_usuario, mon_smtp_clave, mon_smtp_remitente).
-- Solo el servicio puede leerlas; si faltan, la función de avisos registra sin enviar.
create or replace function public.mon_credencial_smtp() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'usuario', (select decrypted_secret from vault.decrypted_secrets where name = 'mon_smtp_usuario'),
    'clave', (select decrypted_secret from vault.decrypted_secrets where name = 'mon_smtp_clave'),
    'remitente', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'mon_smtp_remitente'), 'info@emerteam.com.ar')
  )
$$;
revoke all on function public.mon_credencial_smtp() from public, anon, authenticated;
grant execute on function public.mon_credencial_smtp() to service_role;

alter table public.mon_envios add column if not exists detalle jsonb;
