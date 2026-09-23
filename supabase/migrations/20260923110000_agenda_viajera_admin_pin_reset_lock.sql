-- Ensure every admin-managed PIN reset clears lockout state.
create or replace function public.av_admin_private_access_action_v3(
  p_trip_id uuid, p_target_user_id uuid, p_action text,
  p_role text default null, p_access_status text default null,
  p_pin_hash text default null, p_pin_lookup_hmac text default null,
  p_permissions jsonb default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.av_trip_memberships m where m.trip_id=p_trip_id and m.user_id=auth.uid() and m.role='ADMIN' and m.status='ACTIVE') then raise exception 'AV_ADMIN_REQUIRED'; end if;
  if p_action not in ('set_pin','set_access_status','set_role','set_trip_access') then raise exception 'AV_ACTION_NOT_ALLOWED'; end if;
  if p_action='set_pin' then
    if coalesce(p_access_status,'ACTIVE')='ACTIVE' and p_pin_lookup_hmac is not null and exists(select 1 from public.av_app_access a where a.pin_lookup_hmac=p_pin_lookup_hmac and a.access_status='ACTIVE' and a.user_id<>p_target_user_id) then raise exception 'AV_PIN_ALREADY_ASSIGNED'; end if;
    insert into public.av_app_access(user_id,access_status,role,pin_hash,pin_lookup_hmac,pin_changed_at,created_by_admin,failed_pin_attempts,pin_locked_until) values(p_target_user_id,coalesce(p_access_status,'ACTIVE'),coalesce(p_role,'VIEWER'),p_pin_hash,p_pin_lookup_hmac,now(),auth.uid(),0,null)
    on conflict(user_id) do update set pin_hash=excluded.pin_hash,pin_lookup_hmac=excluded.pin_lookup_hmac,pin_changed_at=now(),access_status=coalesce(p_access_status,public.av_app_access.access_status),role=coalesce(p_role,public.av_app_access.role),failed_pin_attempts=0,pin_locked_until=null,updated_at=now();
  elsif p_action='set_access_status' then
    insert into public.av_app_access(user_id,access_status,role,created_by_admin) values(p_target_user_id,coalesce(p_access_status,'INVITED'),coalesce(p_role,'VIEWER'),auth.uid()) on conflict(user_id) do update set access_status=coalesce(p_access_status,public.av_app_access.access_status),updated_at=now();
  elsif p_action='set_role' then
    insert into public.av_app_access(user_id,access_status,role,created_by_admin) values(p_target_user_id,'ACTIVE',coalesce(p_role,'VIEWER'),auth.uid()) on conflict(user_id) do update set role=coalesce(p_role,public.av_app_access.role),updated_at=now();
    update public.av_trip_memberships set role=coalesce(p_role,role),permissions=coalesce(p_permissions,permissions),updated_at=now() where trip_id=p_trip_id and user_id=p_target_user_id;
  elsif p_action='set_trip_access' then
    insert into public.av_trip_memberships(trip_id,user_id,role,permissions,status) values(p_trip_id,p_target_user_id,coalesce(p_role,'VIEWER'),coalesce(p_permissions,'{}'::jsonb),coalesce(p_access_status,'ACTIVE')) on conflict(trip_id,user_id) do update set role=coalesce(p_role,public.av_trip_memberships.role),permissions=coalesce(p_permissions,public.av_trip_memberships.permissions),status=coalesce(p_access_status,public.av_trip_memberships.status);
  end if;
  if p_trip_id is not null then insert into public.av_audit_issues(trip_id,code,severity,repair_class,entry_ids,message) values(p_trip_id,'APP_ACCESS_CHANGED','INFO','MANUAL',jsonb_build_array(p_target_user_id),format('Private app access action %s applied by administrator.',p_action)); end if;
  select to_jsonb(a) into result from public.av_app_access a where a.user_id=p_target_user_id; return coalesce(result,'{}'::jsonb);
end;
$$;
