insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mon-mediciones', 'mon-mediciones', false, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;
create policy mon_mediciones_fotos_ver on storage.objects for select to authenticated
  using (bucket_id = 'mon-mediciones' and mon_priv.mon_puede_ver(((storage.foldername(name))[1])::uuid));
create policy mon_mediciones_fotos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'mon-mediciones' and mon_priv.mon_es_admin());
alter publication supabase_realtime add table public.mon_mediciones;
create policy mon_mediciones_cambio on public.mon_mediciones for update to authenticated
  using (mon_priv.mon_es_editor() or operador = mon_priv.mon_email())
  with check (mon_priv.mon_es_editor() or operador = mon_priv.mon_email());
create policy mon_mediciones_baja on public.mon_mediciones for delete to authenticated
  using (mon_priv.mon_es_editor() or operador = mon_priv.mon_email());
