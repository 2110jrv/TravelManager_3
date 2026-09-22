-- Allow authenticated owners to refresh their own device row during upsert.
-- Additive av_* fix only; legacy tables and global RLS remain unchanged.
grant select, insert, update on table public.av_devices to authenticated;

drop policy if exists av_devices_owner_update on public.av_devices;
create policy av_devices_owner_update
  on public.av_devices
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
