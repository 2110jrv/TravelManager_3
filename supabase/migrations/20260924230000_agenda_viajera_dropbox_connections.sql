create table if not exists public.av_external_storage_connections (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid not null references public.av_trips(id) on delete cascade,
  provider text not null check (provider in ('dropbox')),
  provider_account_id text not null,
  display_name text,
  encrypted_refresh_token text not null,
  scopes text[] not null default '{}',
  default_folder_path text,
  status text not null default 'CONNECTED' check (status in ('CONNECTED','DISCONNECTED','ERROR')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (auth_user_id, trip_id, provider)
);

alter table public.av_external_storage_connections enable row level security;
revoke all on table public.av_external_storage_connections from anon, authenticated;
grant all on table public.av_external_storage_connections to service_role;
create index if not exists av_external_storage_connections_lookup
  on public.av_external_storage_connections(auth_user_id, trip_id, provider, status);

