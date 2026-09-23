-- The pre-auth Edge Function uses the server-only service_role client.
-- Keep anon/authenticated denied while granting only required table operations.
grant select, update on table public.av_app_access to service_role;
