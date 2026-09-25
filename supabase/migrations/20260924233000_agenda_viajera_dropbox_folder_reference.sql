alter table public.av_external_storage_connections
  add column if not exists provider_folder_id text,
  add column if not exists provider_path text,
  add column if not exists shared_url text,
  add column if not exists writable boolean not null default false;

revoke all on table public.av_external_storage_connections from anon, authenticated;
grant all on table public.av_external_storage_connections to service_role;
