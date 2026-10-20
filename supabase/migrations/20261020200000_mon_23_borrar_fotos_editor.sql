-- Al eliminar un evento, un editor EMERTEAM borra también las fotos de sus mediciones
create policy mon_mediciones_fotos_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'mon-mediciones' and mon_priv.mon_es_editor());
