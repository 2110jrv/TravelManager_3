alter table public.av2_admin_challenges drop constraint av2_admin_challenges_action_check;
alter table public.av2_admin_challenges add constraint av2_admin_challenges_action_check check(action in ('invite','revoke','change-key'));

create or replace function public.av2_set_admin_key(p_trip uuid,p_device uuid,p_token text,p_salt text,p_iterations integer,p_verifier text) returns void
language plpgsql security definer set search_path=public as $$
begin
 if not coalesce(av2_authenticate_device(p_trip,p_device,p_token),false) or not exists(select 1 from av2_devices where id=p_device and trip_id=p_trip and role='ROOT_DEVICE' and deleted_at is null) then raise exception 'AV2_ROOT_REQUIRED';end if;
 perform 1 from av2_trips where id=p_trip for update;
 if exists(select 1 from av2_admin_security where trip_id=p_trip) then raise exception 'AV2_ADMIN_CURRENT_KEY_REQUIRED';end if;
 if p_salt is null or p_verifier is null or p_iterations is distinct from 600000 or p_salt !~ '^[0-9a-f]{32}$' or p_verifier !~ '^[0-9a-f]{64}$' then raise exception 'AV2_INVALID_ADMIN_KEY';end if;
 insert into av2_admin_security values(p_trip,p_salt,p_iterations,decode(p_verifier,'hex'));
end $$;

create function public.av2_admin_key_status(p_trip uuid,p_device uuid,p_token text) returns boolean
language plpgsql stable security definer set search_path=public as $$
begin
 if not coalesce(av2_authenticate_device(p_trip,p_device,p_token),false) then raise exception 'AV2_DEVICE_REVOKED';end if;
 return exists(select 1 from av2_admin_security where trip_id=p_trip);
end $$;

create function public.av2_change_admin_key(p_trip uuid,p_device uuid,p_token text,p_salt text,p_iterations integer,p_verifier text,p_challenge uuid,p_proof text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c av2_admin_challenges;s av2_admin_security;
begin
 if not coalesce(av2_authenticate_device(p_trip,p_device,p_token),false) or not exists(select 1 from av2_devices where id=p_device and trip_id=p_trip and role='ROOT_DEVICE' and deleted_at is null) then raise exception 'AV2_ROOT_REQUIRED';end if;
 perform 1 from av2_trips where id=p_trip for update;
 select * into s from av2_admin_security where trip_id=p_trip for update;
 if not found then raise exception 'AV2_ADMIN_KEY_NOT_CONFIGURED';end if;
 select * into c from av2_admin_challenges where id=p_challenge for update;
 if not found or c.trip_id<>p_trip or c.device_id<>p_device or c.action<>'change-key' or c.target_id is not null or c.expires_at<=now() or c.consumed_at is not null then return jsonb_build_object('error','AV2_ADMIN_PROOF_INVALID');end if;
 update av2_admin_challenges set consumed_at=now() where id=c.id;
 if p_proof is null or p_proof !~ '^[0-9a-f]{64}$' or av2_hmac(s.verifier,c.id::text||':'||c.nonce||':change-key:')<>decode(p_proof,'hex') then return jsonb_build_object('error','AV2_ADMIN_PROOF_INVALID');end if;
 if p_salt is null or p_verifier is null or p_iterations is distinct from 600000 or p_salt !~ '^[0-9a-f]{32}$' or p_verifier !~ '^[0-9a-f]{64}$' then raise exception 'AV2_INVALID_ADMIN_KEY';end if;
 update av2_admin_security set salt=p_salt,iterations=p_iterations,verifier=decode(p_verifier,'hex') where trip_id=p_trip;
 update av2_admin_challenges set consumed_at=now() where trip_id=p_trip and consumed_at is null;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.av2_admin_key_status(uuid,uuid,text) from public,anon;
revoke all on function public.av2_change_admin_key(uuid,uuid,text,text,integer,text,uuid,text) from public,anon;
grant execute on function public.av2_admin_key_status(uuid,uuid,text),public.av2_change_admin_key(uuid,uuid,text,text,integer,text,uuid,text) to authenticated;
