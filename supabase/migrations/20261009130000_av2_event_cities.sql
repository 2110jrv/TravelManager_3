-- Private mirror of Sheet EVENT_CITIES. Calendar remains the event authority.
create table public.av2_event_cities (
 trip_id uuid not null references public.av2_trips(id),
 event_id text not null check(length(event_id) between 1 and 1024),
 cities jsonb not null default '[]' check(jsonb_typeof(cities)='array'),
 updated_at timestamptz not null default now(),
 primary key(trip_id,event_id)
);
alter table public.av2_event_cities enable row level security;
revoke all on public.av2_event_cities from anon,authenticated;
grant select,insert,update,delete on public.av2_event_cities to service_role;
create function public.av2_event_cities_snapshot(p_trip uuid,p_rows jsonb) returns void
language plpgsql security definer set search_path=public as $$
begin
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>500
 or exists(select 1 from jsonb_array_elements(p_rows) r where coalesce(r->>'event_id','')='' or jsonb_typeof(r->'cities') is distinct from 'array')
 or exists(select 1 from jsonb_array_elements(p_rows) r group by r->>'event_id' having count(*)>1)
 or exists(select 1 from jsonb_array_elements(p_rows) r cross join lateral jsonb_array_elements(r->'cities') c where jsonb_typeof(c)<>'string') then raise exception 'EVENT_CITIES_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_trip::text||':event-cities',0));
 insert into av2_event_cities(trip_id,event_id,cities)
 select p_trip,r->>'event_id',r->'cities' from jsonb_array_elements(p_rows) r
 on conflict(trip_id,event_id) do update set cities=excluded.cities,updated_at=clock_timestamp()
 where av2_event_cities.cities is distinct from excluded.cities;
 delete from av2_event_cities where trip_id=p_trip and event_id not in(select r->>'event_id' from jsonb_array_elements(p_rows) r);
end $$;
revoke all on function public.av2_event_cities_snapshot(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.av2_event_cities_snapshot(uuid,jsonb) to service_role;
