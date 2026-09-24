-- av_devices.device_id is intentionally global because commands, records and
-- document caches reference it. Registration must therefore re-associate the
-- existing global device row instead of inserting a duplicate per user.
create or replace function public.av_register_device_for_session(
  p_device_id text,
  p_user_id uuid,
  p_app_installation_id text default null,
  p_name text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then raise exception 'AV_ACCESS_DENIED'; end if;
  if not exists(select 1 from public.av_trip_memberships m where m.user_id=p_user_id and m.status='ACTIVE') then raise exception 'AV_ACCESS_DENIED'; end if;
  if nullif(trim(coalesce(p_device_id,'')),'') is null then raise exception 'AV_DEVICE_ID_REQUIRED'; end if;

  insert into public.av_devices(device_id,app_installation_id,user_id,state,name,last_seen_at)
    values(p_device_id,p_app_installation_id,p_user_id,'TRUSTED',coalesce(p_name,'Agenda Viajera device'),now())
  on conflict(device_id) do update set
    app_installation_id=coalesce(excluded.app_installation_id,public.av_devices.app_installation_id),
    user_id=excluded.user_id,
    name=coalesce(excluded.name,public.av_devices.name),
    last_seen_at=now();

  select to_jsonb(d) into result from public.av_devices d where d.device_id=p_device_id;
  return coalesce(result,'{}'::jsonb);
end;
$$;

revoke all on function public.av_register_device_for_session(text,uuid,text,text) from public;
grant execute on function public.av_register_device_for_session(text,uuid,text,text) to authenticated;
