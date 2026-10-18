-- Additive split: legacy descriptions remain byte-for-byte intact; notes stays NULL
-- until explicitly edited. Readers can expose description as a legacy notes fallback.
alter table public.av2_places_of_interest add column notes text check(notes is null or length(notes)<=4000);
-- Only reviewed, explicitly approved public pins may be exposed to a remote OAuth client.
create table public.av2_remote_public_places (
 trip_id uuid not null references public.av2_trips,
 place_id uuid not null references public.av2_places_of_interest,
 approved_by uuid not null references public.av2_app_users,
 approved_at timestamptz not null default now(),
 primary key(trip_id,place_id)
);
alter table public.av2_remote_public_places enable row level security;
revoke all on public.av2_remote_public_places from public,anon,authenticated;
grant all on public.av2_remote_public_places to service_role;

create or replace function public.av2_remote_is_private(t uuid,p uuid,candidate jsonb default '{}') returns boolean
language sql stable security definer set search_path=public as $$
 select av2_remote_private_payload(candidate) or av2_remote_private_name(candidate->>'name')
 or exists(select 1 from av2_remote_private_places where trip_id=t and place_id=p)
 or exists(select 1 from av2_places_of_interest where trip_id=t and id=p and av2_remote_private_name(name))
 or exists(select 1 from av2_records where trip_id=t and data->>'place_id'=p::text
  and (av2_remote_private_payload(data) or av2_remote_private_payload(data->'guide')))
 or not exists(select 1 from av2_remote_public_places where trip_id=t and place_id=p)
$$;

create or replace function public.av2_remote_private_place_ids(p_trip uuid,p_device uuid,p_token text) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
 perform av2_schedule_access(p_trip,p_device,p_token);
 return coalesce((select jsonb_agg(id) from av2_places_of_interest where trip_id=p_trip and av2_remote_is_private(p_trip,id)),'[]'::jsonb);
end $$;
revoke all on function public.av2_remote_private_place_ids(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.av2_remote_private_place_ids(uuid,uuid,text) to authenticated;

create or replace function av2_place_apply(p_trip uuid,p_device uuid,p_token text,p_operation jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare d av2_user_devices;r av2_places_of_interest;c jsonb;target_id uuid;op uuid;result jsonb;previous jsonb;dedup boolean=false;begin
 if not av2_authenticate_device(p_trip,p_device,p_token) then raise exception 'AV2_DEVICE_REVOKED';end if;
 select * into d from av2_user_devices where device_id=p_device and auth_user_id=auth.uid();
 if not found or p_operation->>'actor_user' is distinct from d.user_id::text or p_operation->>'installation_id' is distinct from d.installation_id::text or p_operation->>'device_id' is distinct from p_device::text then raise exception 'AV2_ACTOR_MISMATCH';end if;
 c=p_operation->'changes';if jsonb_typeof(c)<>'object' or exists(select 1 from jsonb_object_keys(c) k where k<>all(array['name','description','notes','label','importance','priority','google_maps_url','google_place_id','lat','lng','resolved_address','resolved_city','assignment_mode','assigned_dates','assigned_areas','visited'])) then raise exception 'AV2_INVALID_MUTATION';end if;
 target_id=(p_operation->>'record_id')::uuid;op=(p_operation->>'id')::uuid;
 perform pg_advisory_xact_lock(hashtextextended(p_trip::text||':places',0));
 select m.result into previous from av2_sync_metadata m where m.id=op and m.trip_id=p_trip;if found then return previous;end if;
 select * into r from av2_places_of_interest where av2_places_of_interest.id=target_id and trip_id=p_trip;
 if not found and p_operation->>'deleted_at' is null then
 select * into r from av2_places_of_interest where trip_id=p_trip and deleted_at is null and ((c->>'google_place_id' is not null and google_place_id=c->>'google_place_id') or (lat is not null and round(lat::numeric,6)=round((c->>'lat')::numeric,6) and round(lng::numeric,6)=round((c->>'lng')::numeric,6) and lower(regexp_replace(trim(name),'\s+',' ','g'))=lower(regexp_replace(trim(c->>'name'),'\s+',' ','g')))) order by (google_place_id=c->>'google_place_id') desc nulls last limit 1;
 dedup=found;
 end if;
 if r.id is not null then
 if r.deleted_at is not null then raise exception 'AV2_TOMBSTONE_PROTECTED';end if;
 if not dedup and coalesce((p_operation->>'base_version')::bigint,0)<>r.version and (p_operation->>'deleted_at' is not null or exists(select 1 from jsonb_object_keys(c) k where coalesce(to_jsonb(r)->k,'null'::jsonb) is distinct from coalesce(p_operation->'base'->k,'null'::jsonb) and coalesce(to_jsonb(r)->k,'null'::jsonb) is distinct from c->k)) then raise exception 'AV2_POI_CHANGED';end if;
 if dedup then result=jsonb_build_object('record',av2_place_record(r),'conflicts','[]'::jsonb,'deduplicated_from',target_id);
 else
 r=jsonb_populate_record(r,c);r.updated_at=clock_timestamp();r.version=r.version+1;r.deleted_at=(p_operation->>'deleted_at')::timestamptz;
 update av2_places_of_interest set (name,description,notes,label,importance,priority,google_maps_url,google_place_id,lat,lng,resolved_address,resolved_city,assignment_mode,assigned_dates,assigned_areas,visited,updated_at,version,deleted_at)=(r.name,r.description,r.notes,r.label,r.importance,r.priority,r.google_maps_url,r.google_place_id,r.lat,r.lng,r.resolved_address,r.resolved_city,r.assignment_mode,r.assigned_dates,r.assigned_areas,r.visited,r.updated_at,r.version,r.deleted_at) where av2_places_of_interest.id=r.id;
 result=jsonb_build_object('record',av2_place_record(r),'conflicts','[]'::jsonb);
 end if;
 else
 if p_operation->>'deleted_at' is not null then raise exception 'AV2_POI_NOT_FOUND';end if;
 r=jsonb_populate_record(null::av2_places_of_interest,c);
 insert into av2_places_of_interest(id,trip_id,name,description,notes,label,importance,priority,google_maps_url,google_place_id,lat,lng,resolved_address,resolved_city,assignment_mode,assigned_dates,assigned_areas,created_by,created_device,visited)
 values(target_id,p_trip,r.name,coalesce(r.description,''),r.notes,coalesce(r.label,'Interés'),coalesce(r.importance,'optional'),coalesce(r.priority,'normal'),r.google_maps_url,r.google_place_id,r.lat,r.lng,r.resolved_address,r.resolved_city,coalesce(r.assignment_mode,'auto'),coalesce(r.assigned_dates,'[]'),coalesce(r.assigned_areas,'[]'),d.user_id,p_device,coalesce(r.visited,false)) returning * into r;
 result=jsonb_build_object('record',av2_place_record(r),'conflicts','[]'::jsonb);
 end if;
 insert into av2_sync_metadata(id,trip_id,device_id,result,updated_by_device) values(op,p_trip,p_device,result,p_device);
 if not dedup then insert into av2_audit_log(trip_id,actor_user,installation_id,device_name,action,entity,entity_id,summary) values(p_trip,d.user_id,d.installation_id,d.friendly_name,case when r.deleted_at is not null then 'delete' when r.version=1 then 'create' else 'update' end,'places_of_interest',r.id::text,left(r.name,250));end if;
 return result;end$$;
