-- Normalized pin cache is shared only through the authenticated/device-guarded Edge function.
create table if not exists public.av2_map_locations(
 trip_id uuid not null references public.av2_trips,
 source_url text not null check(length(source_url)<=4096),
 latitude double precision not null check(latitude between -90 and 90),
 longitude double precision not null check(longitude between -180 and 180),
 display_name text,
 resolved_at timestamptz not null default now(),
 primary key(trip_id,source_url)
);
alter table public.av2_map_locations enable row level security;
revoke all on public.av2_map_locations from public,anon,authenticated;
grant select,insert,update on public.av2_map_locations to service_role;
