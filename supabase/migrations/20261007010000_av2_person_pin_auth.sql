-- PIN authorizations are independent of Google and historical ROOT claims.
create table public.av2_app_users (
 id uuid primary key default gen_random_uuid(),trip_id uuid not null references av2_trips,
 name text not null,active boolean not null default true,pin_salt text,pin_hash text,
 pin_version bigint not null default 0,updated_at timestamptz not null default now(),unique(trip_id,name)
);
insert into av2_app_users(trip_id,name) select id,n from av2_trips cross join (values ('Jonathan'),('Jenny')) names(n) where id='7c0801ee-07b1-4d86-95d7-202610200001';
create table public.av2_user_devices (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references av2_app_users,
 installation_id uuid not null,device_id uuid not null unique references av2_devices,
 auth_user_id uuid not null references auth.users,token_hash bytea not null,
 friendly_name text not null,detected jsonb not null default '{}',app_version text,
 validated_pin_version bigint not null,state text not null check(state in ('Autorizado','Revocado')),
 first_authorized_at timestamptz not null default now(),last_used_at timestamptz not null default now(),
 sheet_exported boolean not null default false,unique(user_id,installation_id)
);
create table public.av2_install_sessions(auth_user_id uuid primary key references auth.users,installation_id uuid not null,active_user uuid references av2_app_users);
create table public.av2_installation_auth(installation_id uuid primary key,auth_user_id uuid not null unique references auth.users,email text not null unique);
create table public.av2_pin_attempts(key text primary key,attempts integer not null default 0,blocked_until timestamptz,updated_at timestamptz not null default now());
create table public.av2_audit_log (
 id bigint generated always as identity primary key,trip_id uuid not null references av2_trips,
 actor_user uuid references av2_app_users,installation_id uuid,device_name text not null,
 timestamp timestamptz not null default now(),action text not null,entity text not null,
 entity_id text,summary text not null
);
create function public.av2_audit_immutable() returns trigger language plpgsql as $$begin raise exception 'AV2_AUDIT_APPEND_ONLY';end$$;
create trigger av2_audit_immutable before update or delete on av2_audit_log for each row execute function av2_audit_immutable();
do $$declare t text;begin foreach t in array array['app_users','user_devices','install_sessions','installation_auth','pin_attempts','audit_log'] loop
 execute format('alter table public.av2_%I enable row level security',t);
 execute format('revoke all on public.av2_%I from public,anon,authenticated',t);
 execute format('grant all on public.av2_%I to service_role',t);
end loop;end$$;
grant usage,select on sequence av2_audit_log_id_seq to service_role;

create function public.av2_pin_attempt(p_keys text[],p_success boolean default false) returns boolean language plpgsql security definer set search_path=public as $$
declare k text;r av2_pin_attempts;begin
 foreach k in array p_keys loop
  insert into av2_pin_attempts(key) values(k) on conflict do nothing;
  select * into r from av2_pin_attempts where key=k for update;
  if p_success then update av2_pin_attempts set attempts=greatest(attempts-1,0),blocked_until=null,updated_at=now() where key=k;
  else
   if r.blocked_until>now() then return false;end if;
   if r.updated_at<now()-interval '30 minutes' then r.attempts=0;end if;
   update av2_pin_attempts set attempts=r.attempts+1,updated_at=now(),blocked_until=case when r.attempts+1>=5 then now()+least(3600,power(2,least(r.attempts-3,10))::integer*30)*interval '1 second' else null end where key=k;
  end if;
 end loop;return true;end$$;

create function public.av2_pin_authorize(p_trip uuid,p_user uuid,p_auth uuid,p_installation uuid,p_token text,p_detected jsonb,p_name text,p_version text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare u av2_app_users;d av2_user_devices;existing uuid;was_known boolean;begin
 if p_token !~ '^[0-9a-f]{64}$' or length(p_name) not between 1 and 100 then raise exception 'AV2_INVALID_DEVICE';end if;
 select * into u from av2_app_users where id=p_user and trip_id=p_trip and active and pin_hash is not null for update;
 if not found then raise exception 'USER_INACTIVE';end if;
 select * into d from av2_user_devices where user_id=p_user and installation_id=p_installation for update;was_known=found;
 if not was_known then
  -- Reuse an existing installation only with its original credential proof.
  select x.id into existing from av2_devices x join av2_device_keys k on k.device_id=x.id where x.trip_id=p_trip and x.user_id=p_auth and x.deleted_at is null and k.token_hash=sha256(convert_to(p_token,'UTF8')) and not exists(select 1 from av2_user_devices where device_id=x.id) limit 1;
  if existing is null then existing=gen_random_uuid();insert into av2_devices(id,trip_id,user_id,name,role) values(existing,p_trip,p_auth,p_name,'DEVICE');insert into av2_device_keys values(existing,sha256(convert_to(p_token,'UTF8')));end if;
  insert into av2_user_devices(user_id,installation_id,device_id,auth_user_id,token_hash,friendly_name,detected,app_version,validated_pin_version,state)
   values(p_user,p_installation,existing,p_auth,sha256(convert_to(p_token,'UTF8')),p_name,p_detected,p_version,u.pin_version,'Autorizado') returning * into d;
 else
  update av2_user_devices set auth_user_id=p_auth,token_hash=sha256(convert_to(p_token,'UTF8')),detected=p_detected,app_version=p_version,validated_pin_version=u.pin_version,state='Autorizado',last_used_at=now() where id=d.id returning * into d;
  update av2_device_keys set token_hash=d.token_hash where device_id=d.device_id;
 end if;
 insert into av2_install_sessions values(p_auth,p_installation,p_user) on conflict(auth_user_id) do update set installation_id=excluded.installation_id,active_user=excluded.active_user;
 insert into av2_audit_log(trip_id,actor_user,installation_id,device_name,action,entity,entity_id,summary) values(p_trip,u.id,p_installation,d.friendly_name,case when was_known then 'device reauthorize' else 'device authorize' end,'device',d.id::text,'Acceso autorizado mediante PIN');
 return jsonb_build_object('user',jsonb_build_object('id',u.id,'name',u.name,'pin_version',u.pin_version),'device',jsonb_build_object('id',d.device_id,'trip_id',p_trip,'name',d.friendly_name,'installation_id',d.installation_id,'state',d.state),'legacy_owner_user_id',(select id from av2_app_users where trip_id=p_trip and name='Jonathan'));
end$$;

create or replace function public.av2_member(p_trip uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from av2_user_devices d join av2_app_users u on u.id=d.user_id join av2_install_sessions s on s.auth_user_id=d.auth_user_id and s.installation_id=d.installation_id and s.active_user=u.id where d.auth_user_id=auth.uid() and u.trip_id=p_trip and u.active and d.state='Autorizado' and d.validated_pin_version=u.pin_version)
 -- Historical owner access is retained solely for migration/provider maintenance.
 or (not exists(select 1 from av2_app_users where trip_id=p_trip and pin_hash is not null) and exists(select 1 from av2_trip_users where trip_id=p_trip and user_id=auth.uid() and deleted_at is null and not exists(select 1 from av2_install_sessions where auth_user_id=auth.uid())))
$$;
create or replace function public.av2_authenticate_device(p_trip uuid,p_device uuid,p_token text) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from av2_user_devices d join av2_app_users u on u.id=d.user_id join av2_install_sessions s on s.auth_user_id=d.auth_user_id and s.active_user=u.id and s.installation_id=d.installation_id where d.device_id=p_device and d.auth_user_id=auth.uid() and u.trip_id=p_trip and u.active and d.state='Autorizado' and d.validated_pin_version=u.pin_version and d.token_hash=sha256(convert_to(p_token,'UTF8')))
 or (not exists(select 1 from av2_user_devices where device_id=p_device) and not exists(select 1 from av2_install_sessions where auth_user_id=auth.uid()) and av2_device_allowed(p_trip,p_device) and exists(select 1 from av2_device_keys where device_id=p_device and token_hash=sha256(convert_to(p_token,'UTF8'))))
$$;
create function public.av2_pin_validate(p_trip uuid,p_device uuid,p_token text) returns jsonb language plpgsql security definer set search_path=public as $$
declare d av2_user_devices;u av2_app_users;begin
 select * into d from av2_user_devices where device_id=p_device and auth_user_id=auth.uid() and token_hash=sha256(convert_to(p_token,'UTF8'));
 if not found then return jsonb_build_object('error','DEVICE_REVOKED');end if;
 select * into u from av2_app_users where id=d.user_id and trip_id=p_trip;
 if not found or not u.active then return jsonb_build_object('error','USER_INACTIVE');end if;
 if d.validated_pin_version<>u.pin_version then return jsonb_build_object('error','PIN_CHANGED');end if;
 if not av2_authenticate_device(p_trip,p_device,p_token) then return jsonb_build_object('error','DEVICE_REVOKED');end if;
 update av2_user_devices set last_used_at=now() where id=d.id and last_used_at<now()-interval '5 minutes';
 return jsonb_build_object('user',jsonb_build_object('id',u.id,'name',u.name,'pin_version',u.pin_version),'device',jsonb_build_object('id',d.device_id,'trip_id',p_trip,'name',d.friendly_name,'installation_id',d.installation_id,'state',d.state));
end$$;
create function public.av2_pin_lock(p_trip uuid,p_device uuid,p_token text) returns void language plpgsql security definer set search_path=public as $$
declare d av2_user_devices;begin
 if not av2_authenticate_device(p_trip,p_device,p_token) then raise exception 'DEVICE_REVOKED';end if;
 select * into d from av2_user_devices where device_id=p_device;
 insert into av2_audit_log(trip_id,actor_user,installation_id,device_name,action,entity,summary) values(p_trip,d.user_id,d.installation_id,d.friendly_name,'user switch','session','Cambio de usuario');
 update av2_install_sessions set active_user=null where auth_user_id=auth.uid();
end$$;
create function public.av2_record_audit() returns trigger language plpgsql security definer set search_path=public as $$
declare d av2_user_devices;begin
 if TG_OP='INSERT' and new.data='{}'::jsonb then return new;end if;
 select * into d from av2_user_devices where device_id=new.updated_by_device;
 if found then insert into av2_audit_log(trip_id,actor_user,installation_id,device_name,action,entity,entity_id,summary) values(new.trip_id,d.user_id,d.installation_id,d.friendly_name,case when new.deleted_at is not null then 'delete' when TG_OP='INSERT' or (TG_OP='UPDATE' and old.data='{}'::jsonb and old.version=1) then 'create' else 'update' end,new.kind,new.id::text,'Cambio guardado en el viaje');end if;
 return new;end$$;
create trigger av2_record_audit after insert or update on av2_records for each row execute function av2_record_audit();
revoke all on function av2_pin_attempt(text[],boolean),av2_pin_authorize(uuid,uuid,uuid,uuid,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function av2_pin_attempt(text[],boolean),av2_pin_authorize(uuid,uuid,uuid,uuid,text,jsonb,text,text) to service_role;
revoke all on function av2_pin_validate(uuid,uuid,text),av2_pin_lock(uuid,uuid,text) from public,anon;
grant execute on function av2_pin_validate(uuid,uuid,text),av2_pin_lock(uuid,uuid,text) to authenticated;

-- Prevent queued work by a previous user from being attributed to the next user.
alter function public.av2_sync_apply(uuid,uuid,text,jsonb) rename to av2_sync_apply_impl;
revoke all on function public.av2_sync_apply_impl(uuid,uuid,text,jsonb) from public,anon,authenticated;
create function public.av2_sync_apply(p_trip uuid,p_device uuid,p_token text,p_operation jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare d av2_user_devices;checked jsonb;begin
 select * into d from av2_user_devices where device_id=p_device;
 if found then
  checked=av2_pin_validate(p_trip,p_device,p_token);if checked ? 'error' then raise exception '%',checked->>'error';end if;
  if coalesce(p_operation->>'actor_user','')<>d.user_id::text or coalesce(p_operation->>'installation_id','')<>d.installation_id::text then raise exception 'ACTOR_MISMATCH';end if;
 end if;
 return av2_sync_apply_impl(p_trip,p_device,p_token,p_operation);
end$$;
revoke all on function public.av2_sync_apply(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.av2_sync_apply(uuid,uuid,text,jsonb) to authenticated;

-- Old clients must fail non-destructively during migration instead of purging offline data.
create or replace function public.av2_device_status(p_trip uuid,p_device uuid,p_token text) returns text language plpgsql stable security definer set search_path=public as $$
begin
 if auth.uid() is null then raise exception 'AV2_AUTH_REQUIRED';end if;
 if not exists(select 1 from av2_user_devices where device_id=p_device) and exists(select 1 from av2_app_users where trip_id=p_trip and pin_hash is not null) then raise exception 'PIN_REQUIRED';end if;
 if not exists(select 1 from av2_devices where id=p_device) then return 'UNENROLLED';end if;
 if av2_authenticate_device(p_trip,p_device,p_token) then return 'ACTIVE';end if;
 return 'REVOKED';
end$$;
create function public.av2_pin_resume(p_trip uuid,p_device uuid,p_installation uuid,p_token text) returns jsonb language plpgsql security definer set search_path=public as $$
declare d av2_user_devices;u av2_app_users;begin
 select * into d from av2_user_devices where device_id=p_device and installation_id=p_installation and token_hash=sha256(convert_to(p_token,'UTF8'));
 if not found then return jsonb_build_object('error','DEVICE_REVOKED');end if;
 select * into u from av2_app_users where id=d.user_id and trip_id=p_trip;
 if not found or not u.active then return jsonb_build_object('error','USER_INACTIVE');end if;
 if d.validated_pin_version<>u.pin_version then return jsonb_build_object('error','PIN_CHANGED');end if;
 if d.state<>'Autorizado' or not exists(select 1 from av2_install_sessions where auth_user_id=d.auth_user_id and installation_id=p_installation and active_user=u.id) then return jsonb_build_object('error','DEVICE_REVOKED');end if;
 return jsonb_build_object('auth_user_id',d.auth_user_id,'user',jsonb_build_object('id',u.id,'name',u.name,'pin_version',u.pin_version),'device',jsonb_build_object('id',d.device_id,'trip_id',p_trip,'name',d.friendly_name,'installation_id',d.installation_id,'state',d.state));
end$$;
revoke all on function av2_pin_resume(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function av2_pin_resume(uuid,uuid,uuid,text) to service_role;
-- All client writes pass the credential/version/actor-checked sync boundary.
revoke all on function public.av2_apply(uuid,jsonb),public.av2_resolve(uuid,jsonb) from public,anon,authenticated;
create or replace function public.av2_device_allowed(p_trip uuid,p_device uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from av2_user_devices d join av2_app_users u on u.id=d.user_id join av2_install_sessions s on s.auth_user_id=d.auth_user_id and s.installation_id=d.installation_id and s.active_user=u.id where d.device_id=p_device and d.auth_user_id=auth.uid() and u.trip_id=p_trip and u.active and d.state='Autorizado' and d.validated_pin_version=u.pin_version)
 or (not exists(select 1 from av2_user_devices where device_id=p_device) and av2_member(p_trip) and exists(select 1 from av2_devices where id=p_device and trip_id=p_trip and user_id=auth.uid() and deleted_at is null))
$$;
