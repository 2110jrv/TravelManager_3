-- The av_* policies require the authenticated role to reach the tables first.
-- RLS remains the authorization boundary; legacy tm3_* objects are untouched.

grant usage on schema public to authenticated;
grant select, insert on table public.av_users to authenticated;
grant select, insert, update on table public.av_trips, public.av_trip_memberships to authenticated;
grant select, insert, update on table public.av_devices, public.av_device_commands, public.av_restore_requests to authenticated;
grant select, insert, update, delete on table public.av_records, public.av_documents, public.av_device_document_cache_metadata to authenticated;
grant select, insert, update on table public.av_record_versions, public.av_change_operations, public.av_conflicts, public.av_messages, public.av_audit_issues to authenticated;
grant execute on function public.av_is_member(uuid), public.av_can_write(uuid), public.av_is_admin(uuid) to authenticated;
grant execute on function public.av_apply_change_operation(uuid,uuid,text,uuid,text,bigint,jsonb,uuid,text,timestamptz) to authenticated;
grant execute on function public.av_resolve_conflict(uuid,text,jsonb,uuid,text,text) to authenticated;
