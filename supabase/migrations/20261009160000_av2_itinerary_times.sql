alter table public.av2_day_pin_schedule alter column scheduled_time drop not null;
alter table public.av2_day_pin_schedule add column end_time time,add column completed boolean not null default false,add column completed_at timestamptz,add column added_order timestamptz not null default now();
update public.av2_day_pin_schedule set added_order=created_at;
create unique index av2_day_pin_global_reservation on public.av2_day_pin_schedule(trip_id,pin_id) where active;
create or replace function public.av2_schedule_record(r public.av2_day_pin_schedule) returns jsonb
language sql immutable set search_path=public as $$
 select jsonb_build_object('id',r.id,'trip_id',r.trip_id,'kind','day_pin_schedule','version',r.version,
 'created_at',r.created_at,'updated_at',r.updated_at,'updated_by_device',r.updated_by_device,'deleted_at',null,
 'data',jsonb_build_object('date',r.date,'pin_id',r.pin_id,'scheduled_time',to_char(r.scheduled_time,'HH24:MI'),
 'start_time',to_char(r.scheduled_time,'HH24:MI'),'end_time',to_char(r.end_time,'HH24:MI'),'completed',r.completed,'completed_at',r.completed_at,'added_order',r.added_order,'active',r.active,'created_by',r.created_by,'created_at',r.created_at,'updated_at',r.updated_at))
$$;
create or replace function public.av2_sync_day_pins(p_trip uuid,p_device uuid,p_token text,p_after uuid default null) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
 perform av2_schedule_access(p_trip,p_device,p_token);
 return coalesce((select jsonb_agg(av2_schedule_record(s)) from
 (select * from av2_day_pin_schedule where trip_id=p_trip and (p_after is null or id>p_after) order by id limit 500) s),'[]'::jsonb);
end $$;
create or replace function public.av2_day_pin_apply(p_trip uuid,p_device uuid,p_token text,p_operation jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare access jsonb;d av2_user_devices;r av2_day_pin_schedule;c jsonb;op uuid;rid uuid;day date;pin uuid;tm time;et time;done boolean;ca timestamptz;enabled boolean;result jsonb;begin
 access=av2_schedule_access(p_trip,p_device,p_token);
 if not (access->>'can_edit')::boolean then raise exception 'AV2_AGENDA_READ_ONLY';end if;
 select * into d from av2_user_devices where device_id=p_device;
 if coalesce(p_operation->>'actor_user','')<>d.user_id::text or coalesce(p_operation->>'installation_id','')<>d.installation_id::text
 or coalesce(p_operation->>'device_id','')<>p_device::text then raise exception 'ACTOR_MISMATCH';end if;
 c=p_operation->'changes';op=(p_operation->>'id')::uuid;rid=(p_operation->>'record_id')::uuid;
 if jsonb_typeof(c) is distinct from 'object' or coalesce(p_operation->>'kind','')<>'day_pin_schedule'
 or coalesce(p_operation->>'base_version','')!~ '^\d+$' or p_operation->>'deleted_at' is not null
 or exists(select 1 from jsonb_object_keys(c) k where k not in ('date','pin_id','scheduled_time','start_time','end_time','completed','completed_at','added_order','active','created_by','created_at','updated_at')) then raise exception 'AV2_INVALID_MUTATION';end if;
 perform pg_advisory_xact_lock(hashtextextended(rid::text,0));
 select m.result into result from av2_sync_metadata m where m.id=op and m.trip_id=p_trip and m.device_id=p_device;
 if found then return result;end if;
 select * into r from av2_day_pin_schedule where id=rid for update;
 if found and r.trip_id<>p_trip then raise exception 'AV2_INVALID_MUTATION';end if;
 day=coalesce((c->>'date')::date,r.date);pin=coalesce((c->>'pin_id')::uuid,r.pin_id);
 if day is null or pin is null or not exists(select 1 from av2_trips where id=p_trip and start_date<=day and day<=end_date)
 or rid<>substr(encode(sha256(convert_to(p_trip::text||':'||day::text||':'||pin::text,'UTF8')),'hex'),1,32)::uuid
 or (r.id is not null and (r.date<>day or r.pin_id<>pin)) then raise exception 'AV2_INVALID_MUTATION';end if;
 if not exists(select 1 from av2_places_of_interest where id=pin and trip_id=p_trip and deleted_at is null) then raise exception 'AV2_PIN_UNAVAILABLE';end if;
 if c ? 'scheduled_time' and c->>'scheduled_time' is not null and c->>'scheduled_time'!~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'AV2_TIME_INVALID';end if;
 if c ? 'active' and jsonb_typeof(c->'active')<>'boolean' then raise exception 'AV2_INVALID_MUTATION';end if;
 if c ? 'end_time' and c->>'end_time' is not null and c->>'end_time'!~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'AV2_TIME_INVALID';end if;
 if c ? 'completed' and jsonb_typeof(c->'completed')<>'boolean' then raise exception 'AV2_INVALID_MUTATION';end if;
 tm=case when c ? 'scheduled_time' then (c->>'scheduled_time')::time else r.scheduled_time end;et=case when c ? 'end_time' then (c->>'end_time')::time else r.end_time end;done=coalesce((c->>'completed')::boolean,r.completed,false);ca=case when c ? 'completed_at' then (c->>'completed_at')::timestamptz else r.completed_at end;enabled=coalesce((c->>'active')::boolean,r.active,true);
 if c ? 'start_time' and c->>'start_time' is distinct from c->>'scheduled_time' then raise exception 'AV2_TIME_INVALID';end if;
 if done and (et is null or ca is null) then raise exception 'AV2_TIME_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_trip::text||':'||pin::text,0));
 if enabled and exists(select 1 from av2_day_pin_schedule where trip_id=p_trip and pin_id=pin and active and id<>rid) then raise exception 'AV2_PIN_ALREADY_SCHEDULED';end if;
 if (p_operation->>'base_version')::bigint>coalesce(r.version,0) then raise exception 'AV2_FUTURE_VERSION';end if;
 insert into av2_day_pin_schedule(id,trip_id,date,pin_id,scheduled_time,end_time,completed,completed_at,active,created_by,updated_by_device)
 values(rid,p_trip,day,pin,tm,et,done,ca,enabled,d.user_id,p_device)
 on conflict(id) do update set scheduled_time=excluded.scheduled_time,end_time=excluded.end_time,completed=excluded.completed,completed_at=excluded.completed_at,active=excluded.active,
 updated_at=clock_timestamp(),updated_by_device=p_device,version=av2_day_pin_schedule.version+1 returning * into r;
 result=jsonb_build_object('record',av2_schedule_record(r),'conflicts','[]'::jsonb);
 insert into av2_sync_metadata(id,trip_id,device_id,result,updated_by_device) values(op,p_trip,p_device,result,p_device);
 insert into av2_audit_log(trip_id,actor_user,installation_id,device_name,action,entity,entity_id,summary)
 values(p_trip,d.user_id,d.installation_id,d.friendly_name,case when enabled then 'schedule' else 'unschedule' end,'day_pin_schedule',rid::text,day::text||' · '||to_char(tm,'HH24:MI'));
 return result;
end $$;
