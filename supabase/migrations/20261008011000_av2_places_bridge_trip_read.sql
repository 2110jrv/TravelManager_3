-- Only the server bridge may read trip dates/calendar ID for automatic assignment.
grant select on public.av2_trips to service_role;
