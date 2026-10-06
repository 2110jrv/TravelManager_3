-- Sanitized readiness evidence is private and bound to the existing device proof.
alter table public.av2_root_transfers add column target_data jsonb;
create function public.av2_root_upgrade_preflight(p_trip uuid,p_device uuid,p_token text,p_request uuid,p_data jsonb) returns void
language plpgsql security definer set search_path=public as $$
begin
 if not av2_authenticate_device(p_trip,p_device,p_token) then raise exception 'AV2_DEVICE_REVOKED';end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or exists(select 1 from jsonb_object_keys(p_data) k where k not in ('events','pins','documents','records','google_connected','google_backend','budget_ready','session_valid')) then raise exception 'AV2_INVALID_PREFLIGHT';end if;
 if (p_data->>'session_valid') is distinct from 'true' or (p_data->>'google_connected') is distinct from 'true' or (p_data->>'budget_ready') is distinct from 'true' or not ((p_data->>'events')::integer>0 and (p_data->>'pins')::integer>0 and (p_data->>'documents')::integer>0) then raise exception 'AV2_PREFLIGHT_NOT_READY';end if;
 update av2_root_transfers set target_data=p_data where id=p_request and trip_id=p_trip and user_id=auth.uid() and target_device=p_device and expires_at>now() and consumed_at is null;
 if not found then raise exception 'AV2_TRANSFER_INVALID_OR_EXPIRED';end if;
end $$;
revoke all on function public.av2_root_upgrade_preflight(uuid,uuid,text,uuid,jsonb) from public,anon;
grant execute on function public.av2_root_upgrade_preflight(uuid,uuid,text,uuid,jsonb) to authenticated;
