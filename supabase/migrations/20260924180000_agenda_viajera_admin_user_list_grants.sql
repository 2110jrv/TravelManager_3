-- Explicit server-side read grants for the ADMIN user list. RLS remains enabled;
-- the service_role is used only inside the Edge Function.
grant usage on schema public to service_role;
grant select on table public.av_users, public.av_app_access, public.av_trip_memberships, public.av_role_permissions to service_role;
grant insert, update, delete on table public.av_users, public.av_app_access, public.av_trip_memberships, public.av_role_permissions to service_role;
