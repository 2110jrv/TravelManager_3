-- All changes are confined to the av2 namespace. Existing legacy auth and application objects are untouched.
create table public.av2_device_keys(device_id uuid primary key references public.av2_devices, token_hash bytea not null);
create table public.av2_invites(
 id uuid primary key default gen_random_uuid(), trip_id uuid not null references public.av2_trips,
 token_hash bytea unique not null, expires_at timestamptz not null, single_use boolean not null default true check(single_use),
 created_by_device uuid not null references public.av2_devices, consumed_at timestamptz, consumed_by_device uuid,
 version bigint not null default 1, created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 updated_by_device uuid,deleted_at timestamptz
);
create table public.av2_admin_security(trip_id uuid primary key references public.av2_trips, salt text not null, iterations integer not null check(iterations>=600000), verifier bytea not null check(octet_length(verifier)=32));
create table public.av2_admin_challenges(
 id uuid primary key default gen_random_uuid(),trip_id uuid not null references public.av2_trips,device_id uuid not null references public.av2_devices,
 action text not null check(action in ('invite','revoke')),target_id uuid,nonce text not null,expires_at timestamptz not null default now()+interval '2 minutes',
 consumed_at timestamptz,created_at timestamptz not null default now()
);
create table public.av2_root_claims(trip_id uuid primary key references public.av2_trips,user_id uuid not null references auth.users,token_hash bytea not null,expires_at timestamptz not null,consumed_at timestamptz);
do $$ declare tbl text;begin
 foreach tbl in array array['device_keys','invites','admin_security','admin_challenges','root_claims'] loop
 execute format('alter table public.av2_%I enable row level security',tbl);
 execute format('revoke all on public.av2_%I from public,anon,authenticated',tbl);
 end loop;
end $$;

create function public.av2_authenticate_device(p_trip uuid,p_device uuid,p_token text) returns boolean
language sql stable security definer set search_path=public as $$
 select av2_device_allowed(p_trip,p_device) and exists(select 1 from av2_device_keys where device_id=p_device and token_hash=sha256(convert_to(p_token,'UTF8')))
$$;
create function public.av2_claim_root(p_trip uuid,p_device uuid,p_device_token text,p_claim text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare claim av2_root_claims;d av2_devices;
begin
 select * into claim from av2_root_claims where trip_id=p_trip for update;
 if not found or auth.uid() is null or p_claim is null or claim.user_id<>auth.uid() or claim.consumed_at is not null or claim.expires_at<=now() or claim.token_hash<>sha256(convert_to(p_claim,'UTF8')) then raise exception 'AV2_ROOT_CLAIM_INVALID'; end if;
 if p_device_token !~ '^[0-9a-f]{64}$' then raise exception 'AV2_INVALID_DEVICE_TOKEN';end if;
 if exists(select 1 from av2_devices where trip_id=p_trip and role='ROOT_DEVICE') then raise exception 'AV2_ROOT_ALREADY_EXISTS';end if;
 insert into av2_devices(id,trip_id,user_id,name,role,updated_by_device) values(p_device,p_trip,auth.uid(),'PC Casa','ROOT_DEVICE',p_device) returning * into d;
 insert into av2_device_keys values(p_device,sha256(convert_to(p_device_token,'UTF8')));
 update av2_root_claims set consumed_at=now() where trip_id=p_trip;
 return to_jsonb(d);
end $$;
create function public.av2_enroll(p_trip uuid,p_device uuid,p_device_token text,p_invite text,p_name text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare invite av2_invites;d av2_devices;
begin
 if auth.uid() is null then raise exception 'AV2_AUTH_REQUIRED';end if;
 if p_device_token !~ '^[0-9a-f]{64}$' or length(trim(p_name)) not between 1 and 100 then raise exception 'AV2_INVALID_DEVICE';end if;
 select * into invite from av2_invites where trip_id=p_trip and token_hash=sha256(convert_to(p_invite,'UTF8')) for update;
 if not found or invite.deleted_at is not null or invite.expires_at<=now() then raise exception 'AV2_INVITE_INVALID_OR_EXPIRED';end if;
 -- Recover a lost acknowledgement only for exactly the installation that consumed this invitation.
 if invite.consumed_at is not null then
  if invite.consumed_by_device=p_device and av2_authenticate_device(p_trip,p_device,p_device_token) then select * into d from av2_devices where id=p_device;return to_jsonb(d);end if;
  raise exception 'AV2_INVITE_ALREADY_USED';
 end if;
 if not exists(select 1 from av2_devices where id=invite.created_by_device and deleted_at is null) then raise exception 'AV2_INVITE_ISSUER_REVOKED';end if;
 if exists(select 1 from av2_trip_users where trip_id=p_trip and user_id=auth.uid() and deleted_at is not null) then raise exception 'AV2_MEMBERSHIP_REVOKED';end if;
 insert into av2_trip_users(trip_id,user_id,role) values(p_trip,auth.uid(),'TRAVELER') on conflict(trip_id,user_id) do nothing;
 insert into av2_devices(id,trip_id,user_id,name,role,updated_by_device) values(p_device,p_trip,auth.uid(),trim(p_name),'DEVICE',p_device) returning * into d;
 insert into av2_device_keys values(p_device,sha256(convert_to(p_device_token,'UTF8')));
 update av2_invites set consumed_at=now(),consumed_by_device=p_device,updated_at=now(),version=version+1 where id=invite.id;
 return to_jsonb(d);
end $$;

-- HMAC-SHA256 uses PostgreSQL built-in SHA-256; no extension or plaintext administrative PIN is needed.
create function public.av2_hmac(p_key bytea,p_message text) returns bytea language plpgsql immutable set search_path=public as $$
declare key bytea:=p_key;inner_pad bytea:=decode(repeat('36',64),'hex');outer_pad bytea:=decode(repeat('5c',64),'hex');i integer;
begin
 if octet_length(key)>64 then key:=sha256(key);end if;
 for i in 0..octet_length(key)-1 loop
 inner_pad:=set_byte(inner_pad,i,get_byte(inner_pad,i)#get_byte(key,i));outer_pad:=set_byte(outer_pad,i,get_byte(outer_pad,i)#get_byte(key,i));
 end loop;
 return sha256(outer_pad||sha256(inner_pad||convert_to(p_message,'UTF8')));
end $$;
create function public.av2_set_admin_key(p_trip uuid,p_device uuid,p_token text,p_salt text,p_iterations integer,p_verifier text) returns void
language plpgsql security definer set search_path=public as $$
begin
 if not av2_authenticate_device(p_trip,p_device,p_token) or not exists(select 1 from av2_devices where id=p_device and role='ROOT_DEVICE') then raise exception 'AV2_ROOT_REQUIRED';end if;
 if p_salt !~ '^[0-9a-f]{32}$' or p_verifier !~ '^[0-9a-f]{64}$' or p_iterations<>600000 then raise exception 'AV2_INVALID_ADMIN_KEY';end if;
 insert into av2_admin_security values(p_trip,p_salt,p_iterations,decode(p_verifier,'hex')) on conflict(trip_id) do update set salt=excluded.salt,iterations=excluded.iterations,verifier=excluded.verifier;
 -- A password change invalidates all outstanding challenges.
 update av2_admin_challenges set consumed_at=now() where trip_id=p_trip and consumed_at is null;
end $$;
create function public.av2_admin_challenge(p_trip uuid,p_device uuid,p_token text,p_action text,p_target uuid default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c av2_admin_challenges;s av2_admin_security;
begin
 if not av2_authenticate_device(p_trip,p_device,p_token) then raise exception 'AV2_DEVICE_REVOKED';end if;
 select * into s from av2_admin_security where trip_id=p_trip;if not found then raise exception 'AV2_ADMIN_KEY_NOT_CONFIGURED';end if;
 if (select count(*) from av2_admin_challenges where device_id=p_device and created_at>now()-interval '10 minutes')>=5 then raise exception 'AV2_ADMIN_RATE_LIMIT';end if;
 insert into av2_admin_challenges(trip_id,device_id,action,target_id,nonce) values(p_trip,p_device,p_action,p_target,gen_random_uuid()::text) returning * into c;
 return jsonb_build_object('id',c.id,'salt',s.salt,'iterations',s.iterations,'message',c.id::text||':'||c.nonce||':'||p_action||':'||coalesce(p_target::text,''),'expires_at',c.expires_at);
end $$;
create function public.av2_admin_authorized(p_trip uuid,p_device uuid,p_action text,p_target uuid,p_challenge uuid,p_proof text) returns boolean
language plpgsql security definer set search_path=public as $$
declare c av2_admin_challenges;s av2_admin_security;
begin
 if exists(select 1 from av2_devices where id=p_device and trip_id=p_trip and role='ROOT_DEVICE' and deleted_at is null) then return true;end if;
 select * into c from av2_admin_challenges where id=p_challenge for update;
 if not found or c.trip_id<>p_trip or c.device_id<>p_device or c.action<>p_action or c.target_id is distinct from p_target or c.expires_at<=now() or c.consumed_at is not null then return false;end if;
 update av2_admin_challenges set consumed_at=now() where id=c.id;
 select * into s from av2_admin_security where trip_id=p_trip;
 if p_proof is null or p_proof !~ '^[0-9a-f]{64}$' or s.trip_id is null then return false;end if;
 return av2_hmac(s.verifier,c.id::text||':'||c.nonce||':'||p_action||':'||coalesce(p_target::text,''))=decode(p_proof,'hex');
end $$;
create function public.av2_create_invite(p_trip uuid,p_device uuid,p_token text,p_invite_token text,p_challenge uuid default null,p_proof text default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare invite av2_invites;
begin
 if not av2_authenticate_device(p_trip,p_device,p_token) then raise exception 'AV2_DEVICE_REVOKED';end if;
 if not av2_admin_authorized(p_trip,p_device,'invite',null,p_challenge,p_proof) then return jsonb_build_object('error','AV2_ADMIN_PROOF_INVALID');end if;
 if p_invite_token !~ '^[0-9a-f]{64}$' then raise exception 'AV2_INVALID_INVITE_TOKEN';end if;
 insert into av2_invites(trip_id,token_hash,expires_at,created_by_device,updated_by_device) values(p_trip,sha256(convert_to(p_invite_token,'UTF8')),now()+interval '15 minutes',p_device,p_device) returning * into invite;
 return jsonb_build_object('id',invite.id,'expires_at',invite.expires_at,'single_use',true);
end $$;
create function public.av2_revoke_device(p_trip uuid,p_device uuid,p_token text,p_target uuid,p_challenge uuid default null,p_proof text default null,p_self boolean default false) returns jsonb
language plpgsql security definer set search_path=public as $$
declare target av2_devices;
begin
 if not av2_authenticate_device(p_trip,p_device,p_token) then raise exception 'AV2_DEVICE_REVOKED';end if;
 if p_self is null then raise exception 'AV2_INVALID_SELF_REMOVAL';end if;
 select * into target from av2_devices where id=p_target and trip_id=p_trip for update;
 if not found then raise exception 'AV2_DEVICE_NOT_FOUND';end if;
 if target.role='ROOT_DEVICE' then raise exception 'AV2_ROOT_DEVICE_PROTECTED';end if;
 if p_target=p_device and not p_self then raise exception 'AV2_USE_SELF_REMOVAL';end if;
 if p_target<>p_device and p_self then raise exception 'AV2_INVALID_SELF_REMOVAL';end if;
 if not p_self and not av2_admin_authorized(p_trip,p_device,'revoke',p_target,p_challenge,p_proof) then return jsonb_build_object('error','AV2_ADMIN_PROOF_INVALID');end if;
 update av2_devices set deleted_at=coalesce(deleted_at,now()),updated_at=now(),updated_by_device=p_device,version=version+1 where id=p_target;
 update av2_invites set deleted_at=now(),updated_at=now(),version=version+1 where created_by_device=p_target and consumed_at is null;
 return jsonb_build_object('ok',true);
end $$;
create function public.av2_list_devices(p_trip uuid,p_device uuid,p_token text) returns setof public.av2_devices
language plpgsql security definer set search_path=public as $$
begin
 if not av2_authenticate_device(p_trip,p_device,p_token) then raise exception 'AV2_DEVICE_REVOKED';end if;
 return query select * from av2_devices where trip_id=p_trip order by created_at;
end $$;
create function public.av2_rename_device(p_trip uuid,p_device uuid,p_token text,p_name text) returns void
language plpgsql security definer set search_path=public as $$
begin
 if not av2_authenticate_device(p_trip,p_device,p_token) then raise exception 'AV2_DEVICE_REVOKED';end if;
 if length(trim(p_name)) not between 1 and 100 then raise exception 'AV2_INVALID_DEVICE_NAME';end if;
 update av2_devices set name=trim(p_name),updated_at=now(),updated_by_device=p_device,version=version+1 where id=p_device;
end $$;
-- Remove the UUID-only v1 entry points; only wrappers with an installation secret are exposed.
revoke execute on function public.av2_member(uuid),public.av2_device_allowed(uuid,uuid),public.av2_register_device(uuid,uuid,text),public.av2_apply(uuid,jsonb),public.av2_resolve(uuid,jsonb),public.av2_pull(uuid,uuid,uuid),public.av2_pull_conflicts(uuid,uuid) from authenticated;
revoke select on public.av2_trips,public.av2_trip_users,public.av2_devices from authenticated;
create function public.av2_sync_apply(p_trip uuid,p_device uuid,p_token text,p_operation jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
 if not av2_authenticate_device(p_trip,p_device,p_token) or p_operation->>'device_id'<>p_device::text then raise exception 'AV2_DEVICE_REVOKED';end if;
 if p_operation->>'action'='resolve' then return av2_resolve(p_trip,p_operation);end if;
 return av2_apply(p_trip,p_operation);
end $$;
create function public.av2_sync_pull(p_trip uuid,p_device uuid,p_token text,p_after uuid default null) returns setof public.av2_records
language plpgsql security definer set search_path=public as $$
begin
 if not av2_authenticate_device(p_trip,p_device,p_token) then raise exception 'AV2_DEVICE_REVOKED';end if;
 return query select * from av2_pull(p_trip,p_device,p_after);
end $$;
create function public.av2_sync_conflicts(p_trip uuid,p_device uuid,p_token text,p_after uuid default null) returns setof public.av2_conflicts
language plpgsql security definer set search_path=public as $$
begin
 if not av2_authenticate_device(p_trip,p_device,p_token) then raise exception 'AV2_DEVICE_REVOKED';end if;
 return query select * from av2_conflicts where trip_id=p_trip and (p_after is null or id>p_after) order by id limit 500;
end $$;
-- Administrative helpers and hashes are never callable/readable by a frontend.
revoke all on function public.av2_admin_authorized(uuid,uuid,text,uuid,uuid,text),public.av2_hmac(bytea,text) from public,anon,authenticated;
do $$ declare fn record;begin
 for fn in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('av2_authenticate_device','av2_claim_root','av2_enroll','av2_set_admin_key','av2_admin_challenge','av2_create_invite','av2_revoke_device','av2_list_devices','av2_rename_device','av2_sync_apply','av2_sync_pull','av2_sync_conflicts') loop
 execute format('revoke all on function %s from public,anon',fn.signature);
 execute format('grant execute on function %s to authenticated',fn.signature);
 end loop;
end $$;
