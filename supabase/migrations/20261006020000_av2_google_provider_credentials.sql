-- Provider credentials are encrypted by the server with a key held only in
-- Edge Function secrets. Browser roles have no grants or RLS policies.
create table if not exists public.av2_google_credentials (
 user_id uuid primary key references auth.users(id) on delete cascade,
 ciphertext jsonb not null,
 revoked_at timestamptz,
 updated_at timestamptz not null default now(),
 lease_id uuid,
 lease_until timestamptz
);
alter table public.av2_google_credentials enable row level security;
revoke all on public.av2_google_credentials from public,anon,authenticated;
grant select,insert,update,delete on public.av2_google_credentials to service_role;
create or replace function public.av2_google_refresh_lock(p_user uuid,p_lease uuid)
returns boolean language sql security invoker set search_path=public as $$
 with claimed as (
  update public.av2_google_credentials set lease_id=p_lease,lease_until=now()+interval '45 seconds'
  where user_id=p_user and (lease_until is null or lease_until<now()) returning user_id
 ) select exists(select 1 from claimed);
$$;
revoke all on function public.av2_google_refresh_lock(uuid,uuid) from public,anon,authenticated;
grant execute on function public.av2_google_refresh_lock(uuid,uuid) to service_role;
