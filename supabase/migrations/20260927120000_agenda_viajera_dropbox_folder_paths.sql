alter table public.av_external_storage_connections
  add column if not exists provider_folder_name text,
  add column if not exists provider_path_lower text,
  add column if not exists provider_path_display text;

revoke all on table public.av_external_storage_connections from anon, authenticated;
grant all on table public.av_external_storage_connections to service_role;
