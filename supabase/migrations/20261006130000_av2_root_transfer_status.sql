alter table public.av2_root_transfers add column cancelled_at timestamptz;
create function public.av2_root_transfer_status(p_trip uuid,p_target uuid,p_installation uuid,p_target_token text,p_ticket text) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare r av2_root_transfers;
begin
 select * into r from av2_root_transfers where trip_id=p_trip and user_id=auth.uid() and target_device=p_target and target_installation=p_installation and target_key_hash=sha256(convert_to(p_target_token,'UTF8')) and ticket_hash=sha256(convert_to(p_ticket,'UTF8')) order by created_at desc limit 1;
 if not found then raise exception 'AV2_TRANSFER_INVALID_OR_EXPIRED';end if;
 return jsonb_build_object('id',r.id,'created_at',r.created_at,'expires_at',r.expires_at,'approved',r.approved_at is not null,'state',case when r.consumed_at is not null then 'CONSUMED' when r.cancelled_at is not null then 'CANCELLED' when r.expires_at<=now() then 'EXPIRED' when r.approved_at is not null then 'APPROVED' else 'PENDING' end);
end $$;
create function public.av2_cancel_root_transfer(p_trip uuid,p_device uuid,p_token text,p_request uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 if not av2_authenticate_device(p_trip,p_device,p_token) or not exists(select 1 from av2_devices where id=p_device and role='ROOT_DEVICE') then raise exception 'AV2_ROOT_REQUIRED';end if;
 update av2_root_transfers set cancelled_at=now(),expires_at=now() where id=p_request and trip_id=p_trip and user_id=auth.uid() and consumed_at is null;
 if not found then raise exception 'AV2_TRANSFER_INVALID_OR_EXPIRED';end if;
end $$;
revoke all on function public.av2_root_transfer_status(uuid,uuid,uuid,text,text),public.av2_cancel_root_transfer(uuid,uuid,text,uuid) from public,anon;
grant execute on function public.av2_root_transfer_status(uuid,uuid,uuid,text,text),public.av2_cancel_root_transfer(uuid,uuid,text,uuid) to authenticated;
