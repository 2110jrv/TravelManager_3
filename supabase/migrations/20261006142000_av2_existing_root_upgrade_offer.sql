-- ROOT may authorize the exact existing installation before the user's final confirmation.
create table public.av2_root_upgrade_offers(trip_id uuid primary key references public.av2_trips,source_device uuid not null references public.av2_devices,target_device uuid not null references public.av2_devices,installation_id uuid not null,user_id uuid not null references auth.users,target_key_hash bytea not null,expires_at timestamptz not null default now()+interval '10 minutes',consumed_at timestamptz);
alter table public.av2_root_upgrade_offers enable row level security;
revoke all on public.av2_root_upgrade_offers from public,anon,authenticated;
create function public.av2_offer_root_upgrade(p_trip uuid,p_device uuid,p_token text,p_target uuid,p_installation uuid) returns void
language plpgsql security definer set search_path=public as $$
declare key_hash bytea;
begin
 if p_installation is null or not av2_authenticate_device(p_trip,p_device,p_token) or not exists(select 1 from av2_devices where id=p_device and role='ROOT_DEVICE') then raise exception 'AV2_ROOT_REQUIRED';end if;
 select k.token_hash into key_hash from av2_devices d join av2_device_keys k on k.device_id=d.id where d.id=p_target and d.trip_id=p_trip and d.user_id=auth.uid() and d.role='DEVICE' and d.deleted_at is null;
 if not found then raise exception 'AV2_TRANSFER_TARGET_INVALID';end if;
 insert into av2_root_upgrade_offers(trip_id,source_device,target_device,installation_id,user_id,target_key_hash) values(p_trip,p_device,p_target,p_installation,auth.uid(),key_hash) on conflict(trip_id) do update set source_device=excluded.source_device,target_device=excluded.target_device,installation_id=excluded.installation_id,user_id=excluded.user_id,target_key_hash=excluded.target_key_hash,expires_at=now()+interval '10 minutes',consumed_at=null;
end $$;
revoke all on function public.av2_offer_root_upgrade(uuid,uuid,text,uuid,uuid) from public,anon;
grant execute on function public.av2_offer_root_upgrade(uuid,uuid,text,uuid,uuid) to authenticated;
create or replace function public.av2_request_root_transfer(p_trip uuid,p_target uuid,p_installation uuid,p_target_token text,p_ticket text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r av2_root_transfers;offer av2_root_upgrade_offers;
begin
 if auth.uid() is null or not exists(select 1 from av2_devices where trip_id=p_trip and role='ROOT_DEVICE' and user_id=auth.uid() and deleted_at is null) then raise exception 'AV2_ROOT_OWNER_REQUIRED';end if;
 if p_target is null or p_installation is null or p_target_token is null or p_ticket is null or p_target_token !~ '^[0-9a-f]{64}$' or p_ticket !~ '^[0-9a-f]{64}$' or p_ticket=p_target_token then raise exception 'AV2_INVALID_TRANSFER';end if;
 if exists(select 1 from av2_devices where id=p_target) and (not av2_authenticate_device(p_trip,p_target,p_target_token) or not exists(select 1 from av2_devices where id=p_target and user_id=auth.uid() and role='DEVICE' and deleted_at is null)) then raise exception 'AV2_TRANSFER_TARGET_INVALID';end if;
 select * into r from av2_root_transfers where trip_id=p_trip and user_id=auth.uid() and target_device=p_target and ticket_hash=sha256(convert_to(p_ticket,'UTF8')) and target_key_hash=sha256(convert_to(p_target_token,'UTF8')) and target_installation=p_installation and expires_at>now() and consumed_at is null;
 if not found then
  update av2_root_transfers set expires_at=now() where trip_id=p_trip and user_id=auth.uid() and target_device=p_target and consumed_at is null;
  insert into av2_root_transfers(trip_id,user_id,target_device,target_installation,target_key_hash,ticket_hash) values(p_trip,auth.uid(),p_target,p_installation,sha256(convert_to(p_target_token,'UTF8')),sha256(convert_to(p_ticket,'UTF8'))) returning * into r;
 end if;
 select * into offer from av2_root_upgrade_offers where trip_id=p_trip and target_device=p_target and installation_id=p_installation and user_id=auth.uid() and target_key_hash=sha256(convert_to(p_target_token,'UTF8')) and expires_at>now() and consumed_at is null for update;
 if found and exists(select 1 from av2_devices where id=offer.source_device and role='ROOT_DEVICE' and deleted_at is null) then
  update av2_root_upgrade_offers set consumed_at=now() where trip_id=p_trip;
  update av2_root_transfers set approved_at=now(),old_device=offer.source_device where id=r.id returning * into r;
 end if;
 return jsonb_build_object('id',r.id,'expires_at',r.expires_at,'approved',r.approved_at is not null);
end $$;

create or replace function public.av2_consume_root_transfer(p_trip uuid,p_target uuid,p_installation uuid,p_target_token text,p_ticket text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r av2_root_transfers;d av2_devices;
begin
 -- Serialize every transfer of this trip, including two different approved requests.
 perform 1 from av2_trips where id=p_trip for update;
 select * into r from av2_root_transfers where trip_id=p_trip and user_id=auth.uid() and target_device=p_target and target_installation=p_installation and target_key_hash=sha256(convert_to(p_target_token,'UTF8')) and ticket_hash=sha256(convert_to(p_ticket,'UTF8')) for update;
 if not found then raise exception 'AV2_TRANSFER_INVALID_OR_EXPIRED';end if;
 -- Lost acknowledgement may recover only the same active installation; ticket stays single use.
 if r.consumed_at is not null then
  if av2_authenticate_device(p_trip,p_target,p_target_token) then select * into d from av2_devices where id=p_target and role='ROOT_DEVICE';if found then return to_jsonb(d);end if;end if;
  raise exception 'AV2_TRANSFER_ALREADY_USED';
 end if;
 if r.expires_at<=now() or r.approved_at is null then raise exception 'AV2_TRANSFER_NOT_APPROVED_OR_EXPIRED';end if;
 if not exists(select 1 from av2_devices where id=r.old_device and trip_id=p_trip and role='ROOT_DEVICE' and user_id=auth.uid() and deleted_at is null) then raise exception 'AV2_TRANSFER_ISSUER_REVOKED';end if;
 -- Lock and verify an enrolled destination before touching the old ROOT.
 perform 1 from av2_devices where id=p_target for update;
 if exists(select 1 from av2_devices where id=p_target) and (not av2_authenticate_device(p_trip,p_target,p_target_token) or not exists(select 1 from av2_devices where id=p_target and user_id=auth.uid() and role='DEVICE' and deleted_at is null)) then raise exception 'AV2_TRANSFER_TARGET_INVALID';end if;
 if exists(select 1 from av2_devices where id=p_target) and r.target_data is null then raise exception 'AV2_PREFLIGHT_NOT_READY';end if;
 update av2_root_transfers set consumed_at=now(),consumed_tx=txid_current() where id=r.id;
 update av2_devices set role='DEVICE',name='Perfil anterior de PC Casa',deleted_at=now(),updated_at=now(),version=version+1,updated_by_device=p_target where id=r.old_device;
 delete from av2_device_keys where device_id=r.old_device;
 if exists(select 1 from av2_devices where id=p_target) then
  update av2_devices set role='ROOT_DEVICE',name='PC Casa',updated_at=now(),version=version+1,updated_by_device=p_target where id=p_target returning * into d;
 else
  insert into av2_devices(id,trip_id,user_id,name,role,updated_by_device) values(p_target,p_trip,auth.uid(),'PC Casa','ROOT_DEVICE',p_target) returning * into d;
  insert into av2_device_keys values(p_target,r.target_key_hash);
 end if;
 update av2_root_transfers set expires_at=now() where trip_id=p_trip and id<>r.id and consumed_at is null;
 if (select count(*) from av2_devices where trip_id=p_trip and role='ROOT_DEVICE')<>1 then raise exception 'AV2_SINGLE_ROOT_REQUIRED';end if;
 return to_jsonb(d);
end $$;
