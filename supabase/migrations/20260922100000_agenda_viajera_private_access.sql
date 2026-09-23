-- Private app access and server-mediated PIN operations. Legacy tm3_* objects untouched.
create table if not exists public.av_app_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_status text not null default 'INVITED' check (access_status in ('ACTIVE','DISABLED','REVOKED','INVITED')),
  role text not null default 'VIEWER' check (role in ('VIEWER','TRAVELER','ADMIN')),
  pin_hash text,
  pin_changed_at timestamptz,
  failed_pin_attempts integer not null default 0,
  pin_locked_until timestamptz,
  created_by_admin uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.av_app_access enable row level security;
revoke all on table public.av_app_access from anon, authenticated;

create or replace function public.av_get_private_access(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then raise exception 'AV_ACCESS_DENIED'; end if;
  select to_jsonb(a) into result from public.av_app_access a where a.user_id=p_user_id;
  return result;
end;
$$;

create or replace function public.av_record_pin_attempt(p_user_id uuid, p_success boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then raise exception 'AV_ACCESS_DENIED'; end if;
  if p_success then
    update public.av_app_access set failed_pin_attempts=0,pin_locked_until=null,updated_at=now() where user_id=p_user_id;
  else
    update public.av_app_access set failed_pin_attempts=failed_pin_attempts+1,pin_locked_until=case when failed_pin_attempts+1 >= 5 then now()+interval '15 minutes' else pin_locked_until end,updated_at=now() where user_id=p_user_id;
  end if;
  select jsonb_build_object('access_status',access_status,'failed_pin_attempts',failed_pin_attempts,'pin_locked_until',pin_locked_until) into result from public.av_app_access where user_id=p_user_id;
  return coalesce(result,'{}'::jsonb);
end;
$$;

create or replace function public.av_admin_private_access_action(
  p_trip_id uuid,
  p_target_user_id uuid,
  p_action text,
  p_role text default null,
  p_access_status text default null,
  p_pin_hash text default null,
  p_permissions jsonb default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.av_trip_memberships m where m.trip_id=p_trip_id and m.user_id=auth.uid() and m.role='ADMIN' and m.status='ACTIVE') then raise exception 'AV_ADMIN_REQUIRED'; end if;
  if p_action not in ('set_pin','set_access_status','set_role','set_trip_access') then raise exception 'AV_ACTION_NOT_ALLOWED'; end if;
  if p_action='set_pin' then
    insert into public.av_app_access(user_id,access_status,role,pin_hash,pin_changed_at,created_by_admin) values(p_target_user_id,coalesce(p_access_status,'ACTIVE'),coalesce(p_role,'VIEWER'),p_pin_hash,now(),auth.uid())
    on conflict(user_id) do update set pin_hash=excluded.pin_hash,pin_changed_at=now(),access_status=coalesce(p_access_status,public.av_app_access.access_status),role=coalesce(p_role,public.av_app_access.role),updated_at=now();
  elsif p_action='set_access_status' then
    insert into public.av_app_access(user_id,access_status,role,created_by_admin) values(p_target_user_id,coalesce(p_access_status,'INVITED'),coalesce(p_role,'VIEWER'),auth.uid())
    on conflict(user_id) do update set access_status=coalesce(p_access_status,public.av_app_access.access_status),updated_at=now();
  elsif p_action='set_role' then
    insert into public.av_app_access(user_id,access_status,role,created_by_admin) values(p_target_user_id,'ACTIVE',coalesce(p_role,'VIEWER'),auth.uid())
    on conflict(user_id) do update set role=coalesce(p_role,public.av_app_access.role),updated_at=now();
    update public.av_trip_memberships set role=coalesce(p_role,role),permissions=coalesce(p_permissions,permissions),updated_at=now() where trip_id=p_trip_id and user_id=p_target_user_id;
  elsif p_action='set_trip_access' then
    insert into public.av_trip_memberships(trip_id,user_id,role,permissions,status) values(p_trip_id,p_target_user_id,coalesce(p_role,'VIEWER'),coalesce(p_permissions,'{}'::jsonb),coalesce(p_access_status,'ACTIVE'))
    on conflict(trip_id,user_id) do update set role=coalesce(p_role,public.av_trip_memberships.role),permissions=coalesce(p_permissions,public.av_trip_memberships.permissions),status=coalesce(p_access_status,public.av_trip_memberships.status),updated_at=now();
  end if;
  if p_trip_id is not null then insert into public.av_audit_issues(trip_id,code,severity,repair_class,entry_ids,message) values(p_trip_id,'APP_ACCESS_CHANGED','INFO','MANUAL',jsonb_build_array(p_target_user_id),format('Private app access action %s applied by administrator.',p_action)); end if;
  select to_jsonb(a) into result from public.av_app_access a where a.user_id=p_target_user_id;
  return coalesce(result,'{}'::jsonb);
end;
$$;

revoke all on function public.av_get_private_access(uuid), public.av_record_pin_attempt(uuid,boolean), public.av_admin_private_access_action(uuid,uuid,text,text,text,text,jsonb) from public;
grant execute on function public.av_get_private_access(uuid), public.av_record_pin_attempt(uuid,boolean), public.av_admin_private_access_action(uuid,uuid,text,text,text,text,jsonb) to authenticated;
