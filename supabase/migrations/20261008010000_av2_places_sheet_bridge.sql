alter table av2_places_of_interest alter column created_device drop not null;
alter table av2_places_of_interest add column poi_code text,add column sheet_row_key uuid,add column priority text not null default 'normal' check(priority in ('normal','important','reference')),add column updated_by uuid references av2_app_users,add column created_source text not null default 'Agenda',add column updated_source text not null default 'Agenda',add column review_reason text,add column created_external_actor text,add column updated_external_actor text;
create unique index av2_poi_code on av2_places_of_interest(trip_id,poi_code);
create unique index av2_poi_sheet_key on av2_places_of_interest(trip_id,sheet_row_key) where sheet_row_key is not null;
alter table av2_audit_log add column origin text not null default 'Agenda',add column poi_code text,add column external_actor text;
alter table av2_map_locations add column resolved_address text,add column resolved_city text,add column details_checked boolean not null default false;
create function av2_poi_identity() returns trigger language plpgsql security definer set search_path=public as $$
declare n bigint;u uuid;begin
 perform pg_advisory_xact_lock(hashtextextended(new.trip_id::text||':places',0));
 if tg_op='INSERT' or old.poi_code is null then
  select coalesce(max(substring(poi_code from 5)::bigint),0)+1 into n from av2_places_of_interest where trip_id=new.trip_id;
  new.poi_code='POI_'||lpad(n::text,greatest(3,length(n::text)), '0');
 elsif new.poi_code is distinct from old.poi_code then raise exception 'AV2_POI_ID_IMMUTABLE';end if;
 if coalesce(current_setting('av2.poi_bridge',true),'')<>'sheet' then
  select user_id into u from av2_user_devices where auth_user_id=auth.uid() and device_id=new.created_device;
  if tg_op='UPDATE' then select active_user into u from av2_install_sessions where auth_user_id=auth.uid();end if;
  new.updated_by=coalesce(u,new.created_by);new.updated_source='Agenda';new.updated_external_actor=null;
 end if;
 return new;end$$;
create trigger av2_poi_identity before insert or update on av2_places_of_interest for each row execute function av2_poi_identity();
update av2_places_of_interest set poi_code=null where poi_code is null;
create function av2_poi_audit_fields() returns trigger language plpgsql security definer set search_path=public as $$begin
 if new.entity='places_of_interest' then select p.poi_code into new.poi_code from av2_places_of_interest p where p.id::text=new.entity_id;new.origin=coalesce(nullif(current_setting('av2.poi_origin',true),''),'Agenda');end if;return new;end$$;
create trigger av2_poi_audit_fields before insert on av2_audit_log for each row execute function av2_poi_audit_fields();
create function av2_sheet_place_apply(p_trip uuid,p_code text,p_row_key uuid,p_changes jsonb,p_base jsonb default '{}'::jsonb,p_actor text default 'Jonathan',p_origin text default 'Google Sheet',p_external_actor text default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare r av2_places_of_interest;c jsonb;actor uuid;k text;is_new boolean=false;begin
 if p_origin not in ('Google Sheet','ChatGPT/Admin') then raise exception 'AV2_ORIGIN_INVALID';end if;
 if jsonb_typeof(p_changes)<>'object' or exists(select 1 from jsonb_object_keys(p_changes) f where f<>all(array['name','description','label','importance','priority','google_maps_url','google_place_id','lat','lng','resolved_address','resolved_city','assignment_mode','assigned_dates','assigned_areas','review_reason','deleted_at'])) then raise exception 'AV2_INVALID_MUTATION';end if;
 select id into actor from av2_app_users where trip_id=p_trip and name=p_actor;if actor is null then raise exception 'AV2_ACTOR_MISMATCH';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_trip::text||':places',0));perform set_config('av2.poi_bridge','sheet',true);perform set_config('av2.poi_origin',p_origin,true);
 if p_code is not null then select * into r from av2_places_of_interest where trip_id=p_trip and poi_code=p_code;if not found then raise exception 'AV2_POI_CODE_UNKNOWN';end if;
 else
  select * into r from av2_places_of_interest where trip_id=p_trip and sheet_row_key=p_row_key;
  if not found then select * into r from av2_places_of_interest where trip_id=p_trip and deleted_at is null and ((p_changes->>'google_place_id' is not null and google_place_id=p_changes->>'google_place_id') or (lat is not null and round(lat::numeric,6)=round((p_changes->>'lat')::numeric,6) and round(lng::numeric,6)=round((p_changes->>'lng')::numeric,6) and lower(regexp_replace(trim(name),'\s+',' ','g'))=lower(regexp_replace(trim(p_changes->>'name'),'\s+',' ','g')))) limit 1;
   if found then return jsonb_build_object('record',av2_place_record(r),'deduplicated',true);end if;
  end if;
 end if;
 if r.id is not null then
  if r.deleted_at is not null then return jsonb_build_object('record',av2_place_record(r));end if;
  if p_changes ? 'deleted_at' and p_base ? 'version' and (p_base->>'version')::bigint<>r.version then return jsonb_build_object('record',av2_place_record(r),'conflict',true);end if;
  for k in select jsonb_object_keys(p_changes) loop
   if p_base ? k and coalesce(to_jsonb(r)->k,'null'::jsonb) is distinct from p_base->k and coalesce(to_jsonb(r)->k,'null'::jsonb) is distinct from p_changes->k then return jsonb_build_object('record',av2_place_record(r),'conflict',true);end if;
  end loop;
  if not exists(select 1 from jsonb_object_keys(p_changes) f where coalesce(to_jsonb(r)->f,'null'::jsonb) is distinct from p_changes->f) then return jsonb_build_object('record',av2_place_record(r));end if;
  r=jsonb_populate_record(r,p_changes);r.updated_at=clock_timestamp();r.version=r.version+1;r.updated_by=actor;r.updated_source=p_origin;r.updated_external_actor=p_external_actor;
  update av2_places_of_interest set(name,description,label,importance,priority,google_maps_url,google_place_id,lat,lng,resolved_address,resolved_city,assignment_mode,assigned_dates,assigned_areas,review_reason,deleted_at,updated_at,version,updated_by,updated_source,updated_external_actor)=(r.name,r.description,r.label,r.importance,r.priority,r.google_maps_url,r.google_place_id,r.lat,r.lng,r.resolved_address,r.resolved_city,r.assignment_mode,r.assigned_dates,r.assigned_areas,r.review_reason,r.deleted_at,r.updated_at,r.version,r.updated_by,r.updated_source,r.updated_external_actor) where id=r.id returning * into r;
 else
  if p_changes->>'deleted_at' is not null then raise exception 'AV2_POI_NOT_FOUND';end if;is_new=true;r=jsonb_populate_record(null::av2_places_of_interest,p_changes);
  insert into av2_places_of_interest(id,trip_id,sheet_row_key,name,description,label,importance,priority,google_maps_url,google_place_id,lat,lng,resolved_address,resolved_city,assignment_mode,assigned_dates,assigned_areas,review_reason,created_by,created_source,updated_by,updated_source,created_external_actor,updated_external_actor)
  values(gen_random_uuid(),p_trip,p_row_key,r.name,coalesce(r.description,''),coalesce(r.label,'Interés'),'optional',coalesce(r.priority,'normal'),r.google_maps_url,r.google_place_id,r.lat,r.lng,r.resolved_address,r.resolved_city,coalesce(r.assignment_mode,'auto'),coalesce(r.assigned_dates,'[]'),coalesce(r.assigned_areas,'[]'),r.review_reason,actor,p_origin,actor,p_origin,p_external_actor,p_external_actor) returning * into r;
 end if;
 insert into av2_audit_log(trip_id,actor_user,installation_id,device_name,action,entity,entity_id,summary,origin,external_actor) values(p_trip,actor,'3a65c425-627c-4cb9-a10f-ec5c5c054fee','Google Sheet · LUGARES',case when r.deleted_at is not null then 'delete' when is_new then 'create' else 'update' end,'places_of_interest',r.id::text,left(r.name,250),p_origin,p_external_actor);
 return jsonb_build_object('record',av2_place_record(r));end$$;
revoke all on function av2_sheet_place_apply(uuid,text,uuid,jsonb,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function av2_sheet_place_apply(uuid,text,uuid,jsonb,jsonb,text,text,text) to service_role;
do $$declare definition text;begin select pg_get_functiondef('av2_place_apply(uuid,uuid,text,jsonb)'::regprocedure) into definition;execute replace(definition,'''assigned_areas'',''visited'']','''assigned_areas'',''visited'',''priority'']');end$$;
