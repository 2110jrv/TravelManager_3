create function public.av2_device_status(p_trip uuid,p_device uuid,p_token text) returns text
language plpgsql stable security definer set search_path=public as $$
declare d av2_devices;
begin
 if auth.uid() is null then raise exception 'AV2_AUTH_REQUIRED';end if;
 select * into d from av2_devices where id=p_device;
 if not found then return 'UNENROLLED';end if;
 if av2_authenticate_device(p_trip,p_device,p_token) then return 'ACTIVE';end if;
 return 'REVOKED';
end $$;
create or replace function public.av2_sync_apply(p_trip uuid,p_device uuid,p_token text,p_operation jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare current_version bigint;
begin
 if not av2_authenticate_device(p_trip,p_device,p_token) or coalesce(p_operation->>'device_id','')<>p_device::text then raise exception 'AV2_DEVICE_REVOKED';end if;
 if p_operation->>'action'='resolve' then return av2_resolve(p_trip,p_operation);end if;
 if coalesce(p_operation->>'base_version','') !~ '^\d+$' or coalesce(jsonb_typeof(p_operation->'changes'),'null')<>'object' or coalesce(jsonb_typeof(p_operation->'base'),'null')<>'object' then raise exception 'AV2_INVALID_MUTATION';end if;
 select version into current_version from av2_records where id=(p_operation->>'record_id')::uuid;
 if (p_operation->>'base_version')::bigint>coalesce(current_version,0) then raise exception 'AV2_FUTURE_VERSION';end if;
 return av2_apply(p_trip,p_operation);
end $$;
revoke all on function public.av2_device_status(uuid,uuid,text) from public,anon;
grant execute on function public.av2_device_status(uuid,uuid,text) to authenticated;
