-- Remote content uses the existing authenticated device and sync boundaries.
create table public.av2_remote_history (
 id uuid primary key, trip_id uuid not null references public.av2_trips,
 actor_user uuid not null references public.av2_app_users, device_id uuid not null references public.av2_devices,
 request jsonb not null, before_record jsonb, result jsonb not null,
 created_at timestamptz not null default now()
);
alter table public.av2_remote_history enable row level security;
revoke all on public.av2_remote_history from public,anon,authenticated;
create trigger av2_remote_history_immutable before update or delete on public.av2_remote_history
 for each row execute function public.av2_audit_immutable();

create table public.av2_remote_grants (
 auth_user_id uuid not null references auth.users, client_id uuid not null,
 trip_id uuid not null references public.av2_trips, actor_user uuid not null references public.av2_app_users,
 device_id uuid not null references public.av2_devices, cipher jsonb not null,
 can_write boolean not null default false, expires_at timestamptz not null,
 revoked_at timestamptz, primary key(auth_user_id,client_id,trip_id)
);
alter table public.av2_remote_grants enable row level security;
revoke all on public.av2_remote_grants from public,anon,authenticated;
grant all on public.av2_remote_grants to service_role;

create function public.av2_remote_content_write(p_trip uuid,p_device uuid,p_token text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare d av2_user_devices; access jsonb; old av2_remote_history; undo av2_remote_history;
 pin av2_places_of_interest; r av2_records; before_value jsonb; result jsonb; operation jsonb;
 changes jsonb; current_version bigint; target uuid; request_id uuid; tool text; record_kind text;
begin
 access=av2_schedule_access(p_trip,p_device,p_token);
 if not coalesce((access->>'can_edit')::boolean,false) then raise exception 'REMOTE_READ_ONLY';end if;
 select * into strict d from av2_user_devices where device_id=p_device and auth_user_id=auth.uid();
 if jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>160000
  or exists(select 1 from jsonb_object_keys(p_request) k where k<>all(array['tool','request_id','place_id','record_id','expected_version','patch','history_id'])) then raise exception 'REMOTE_INVALID_INPUT';end if;
 request_id=(p_request->>'request_id')::uuid;tool=p_request->>'tool';
 if request_id is null or tool not in ('create_place','update_place_notes','update_place_metadata','update_audio_guide','update_place_guide','rollback_content')
  or coalesce(p_request->>'expected_version','')!~'^\d+$' then raise exception 'REMOTE_INVALID_INPUT';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_trip::text||':places',0));
 perform pg_advisory_xact_lock(hashtextextended(p_trip::text||':remote-content',0));
 select * into old from av2_remote_history where id=request_id;
 if found then
  if old.trip_id<>p_trip or old.actor_user<>d.user_id or old.request<>p_request then raise exception 'REMOTE_REQUEST_ID_REUSED';end if;
  return old.result||jsonb_build_object('history_id',request_id,'persisted',true);
 end if;
 if tool='rollback_content' then
  select * into undo from av2_remote_history where id=(p_request->>'history_id')::uuid and trip_id=p_trip;
  if not found or undo.before_record is null then raise exception 'REMOTE_NO_NONDESTRUCTIVE_ROLLBACK';end if;
  target=(undo.result->'record'->>'id')::uuid;record_kind=undo.result->'record'->>'kind';
 else
  target=(p_request->>'place_id')::uuid;
  record_kind=case when tool in ('update_audio_guide','update_place_guide') then 'app_settings' else 'places_of_interest' end;
 end if;
 if record_kind='places_of_interest' then
  select * into pin from av2_places_of_interest where id=target and trip_id=p_trip for update;
  if tool<>'create_place' and (not found or pin.deleted_at is not null) then raise exception 'REMOTE_NOT_FOUND';end if;
  if pin.id is not null then before_value=av2_place_record(pin);current_version=pin.version;else current_version=0;end if;
 else
  if tool='rollback_content' then
   select * into r from av2_records where id=target and trip_id=p_trip and kind='app_settings' for update;
   if not found or r.data->>'type'<>'place_guide' then raise exception 'REMOTE_NOT_FOUND';end if;
   target=(r.data->>'place_id')::uuid;
  end if;
  select * into pin from av2_places_of_interest where id=target and trip_id=p_trip and deleted_at is null;
  if not found then raise exception 'REMOTE_NOT_FOUND';end if;
  if r.id is null then select * into r from av2_records where trip_id=p_trip and kind='app_settings' and data->>'type'='place_guide' and data->>'place_id'=target::text for update;end if;
  if r.id is not null then
   if r.deleted_at is not null then raise exception 'REMOTE_NOT_FOUND';end if;
   before_value=to_jsonb(r);current_version=r.version;
  else current_version=0;end if;
 end if;
 if lower(trim(coalesce(pin.name,p_request->'patch'->>'name','')))='casa'
  or exists(select 1 from av2_records g where g.trip_id=p_trip and g.data->>'place_id'=pin.id::text and g.data->'guide'->'geo'->>'private'='true') then raise exception 'REMOTE_PRIVATE_PLACE';end if;
 if current_version<>(p_request->>'expected_version')::bigint then raise exception 'REMOTE_VERSION_CONFLICT';end if;
 changes=p_request->'patch';
 if tool='rollback_content' then
  if (undo.result->'record'->>'version')::bigint<>current_version then raise exception 'REMOTE_VERSION_CONFLICT';end if;
  if record_kind='app_settings' then changes=jsonb_build_object('guide',undo.before_record->'data'->'guide');
  else select jsonb_object_agg(k,undo.before_record->'data'->k) into changes from jsonb_object_keys(undo.request->'patch') k;end if;
 end if;
 if jsonb_typeof(changes)<>'object' then raise exception 'REMOTE_INVALID_INPUT';end if;
 if record_kind='places_of_interest' then
  if tool='update_place_notes' and (select array_agg(k) from jsonb_object_keys(changes) k) is distinct from array['description'] then raise exception 'REMOTE_INVALID_INPUT';end if;
  if exists(select 1 from jsonb_object_keys(changes) k where k<>all(array['name','description','label','priority','importance','lat','lng','google_maps_url','google_place_id','resolved_address','resolved_city'])) then raise exception 'REMOTE_INVALID_INPUT';end if;
  if tool<>'create_place' and changes ? 'name' then raise exception 'REMOTE_IDENTITY_PROTECTED';end if;
  if tool='create_place' and current_version<>0 then raise exception 'REMOTE_VERSION_CONFLICT';end if;
  operation=jsonb_build_object('id',request_id,'record_id',target,'kind',record_kind,'device_id',p_device,'actor_user',d.user_id,'installation_id',d.installation_id,'base_version',current_version,'base',coalesce(before_value->'data','{}'),'changes',changes);
  result=av2_place_apply(p_trip,p_device,p_token,operation);
 else
  if tool='update_audio_guide' then
   if (select array_agg(k) from jsonb_object_keys(changes) k) is distinct from array['audio_guide'] or jsonb_typeof(changes->'audio_guide')<>'string' then raise exception 'REMOTE_INVALID_INPUT';end if;
  elsif tool='update_place_guide' then
   if exists(select 1 from jsonb_object_keys(changes) k where k<>all(array['experience','affinity','prices','sources_say','safety','questions','dairy','limitations','sources','reviewed_at'])) then raise exception 'REMOTE_INVALID_INPUT';end if;
  end if;
  if tool<>'rollback_content' then changes=jsonb_build_object('guide',coalesce(r.data->'guide','{}')||changes);end if;
  if r.id is null then
   target=(p_request->>'record_id')::uuid;
   if target is null then raise exception 'REMOTE_INVALID_INPUT';end if;
   changes=jsonb_build_object('type','place_guide','place_id',pin.id,'poi_code',pin.poi_code,'name',pin.name)||changes;
  else target=r.id;end if;
  operation=jsonb_build_object('id',request_id,'record_id',target,'kind','app_settings','device_id',p_device,'actor_user',d.user_id,'installation_id',d.installation_id,'base_version',current_version,'base',coalesce(r.data,'{}'),'changes',changes);
  result=av2_sync_apply(p_trip,p_device,p_token,operation);
 end if;
 if jsonb_array_length(coalesce(result->'conflicts','[]'))<>0 then raise exception 'REMOTE_VERSION_CONFLICT';end if;
 insert into av2_remote_history(id,trip_id,actor_user,device_id,request,before_record,result)
 values(request_id,p_trip,d.user_id,p_device,p_request,before_value,result);
 return result||jsonb_build_object('history_id',request_id,'persisted',true);
end $$;
revoke all on function public.av2_remote_content_write(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.av2_remote_content_write(uuid,uuid,text,jsonb) to authenticated;
