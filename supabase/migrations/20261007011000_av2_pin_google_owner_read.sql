-- PIN sessions use the trip owner's existing Google connection server-side.
-- Historical v2 tables deliberately lack default service_role privileges.
grant select on public.av2_trip_users to service_role;
