-- Server-side cleanup grants required by delete_internal_user.
grant select, update on table public.av_messages to service_role;
grant select, update on table public.av_devices, public.av_restore_requests to service_role;
