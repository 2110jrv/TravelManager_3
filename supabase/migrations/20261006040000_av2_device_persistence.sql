-- Keep the existing ROOT and enforce uniqueness without issuing a new claim.
create unique index av2_one_root_per_trip on public.av2_devices(trip_id) where role='ROOT_DEVICE';
create or replace function public.av2_claim_root(p_trip uuid,p_device uuid,p_device_token text,p_claim text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare claim av2_root_claims;d av2_devices;
begin
 -- Idempotency requires the existing installation secret and its owner.
 select * into d from av2_devices where id=p_device and trip_id=p_trip and user_id=auth.uid() and role='ROOT_DEVICE' and deleted_at is null;
 if found and av2_authenticate_device(p_trip,p_device,p_device_token) then return to_jsonb(d);end if;
 select * into claim from av2_root_claims where trip_id=p_trip for update;
 if not found or auth.uid() is null or p_claim is null or claim.user_id<>auth.uid() or claim.consumed_at is not null or claim.expires_at<=now() or claim.token_hash<>sha256(convert_to(p_claim,'UTF8')) then raise exception 'AV2_ROOT_CLAIM_INVALID'; end if;
 if p_device_token !~ '^[0-9a-f]{64}$' then raise exception 'AV2_INVALID_DEVICE_TOKEN';end if;
 if exists(select 1 from av2_devices where trip_id=p_trip and role='ROOT_DEVICE') then raise exception 'AV2_ROOT_ALREADY_EXISTS';end if;
 insert into av2_devices(id,trip_id,user_id,name,role,updated_by_device) values(p_device,p_trip,auth.uid(),'PC Casa','ROOT_DEVICE',p_device) returning * into d;
 insert into av2_device_keys values(p_device,sha256(convert_to(p_device_token,'UTF8')));
 update av2_root_claims set consumed_at=now() where trip_id=p_trip;
 return to_jsonb(d);
end $$;

create function public.av2_recover_device(p_trip uuid,p_token text) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare d av2_devices;
begin
 if auth.uid() is null then raise exception 'AV2_AUTH_REQUIRED';end if;
 if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'AV2_INVALID_DEVICE_TOKEN';end if;
 select device.* into strict d from av2_devices device join av2_device_keys k on k.device_id=device.id
 where device.trip_id=p_trip and device.user_id=auth.uid() and device.deleted_at is null
 and k.token_hash=sha256(convert_to(p_token,'UTF8'));
 if not av2_authenticate_device(p_trip,d.id,p_token) then raise exception 'AV2_DEVICE_RECOVERY_DENIED';end if;
 return to_jsonb(d);
 exception when no_data_found then return null;
 when too_many_rows then raise exception 'AV2_DEVICE_RECOVERY_AMBIGUOUS';
end $$;
revoke all on function public.av2_recover_device(uuid,text) from public,anon;
grant execute on function public.av2_recover_device(uuid,text) to authenticated;
