-- Expenses remain in the existing versioned ledger; no parallel budget store.
create table public.av2_expense_counters(trip_id uuid primary key references av2_trips,last_id bigint not null default 0);
alter table av2_expense_counters enable row level security;
revoke all on av2_expense_counters from public,anon,authenticated;
grant select,insert,update on av2_expense_counters to service_role;
alter table av2_records alter column updated_by_device drop not null;
alter table av2_records add constraint av2_record_device_required check(kind='expenses' or updated_by_device is not null);
create unique index av2_expense_codes on av2_records(trip_id,(data->>'expense_id')) where kind='expenses' and data ? 'expense_id';
create unique index av2_expense_sheet_keys on av2_records(trip_id,(data->>'sheet_row_key')) where kind='expenses' and data ? 'sheet_row_key';
create function public.av2_expense_identity() returns trigger language plpgsql security definer set search_path=public as $$
declare number bigint;actor uuid;begin
 if new.kind<>'expenses' or new.data='{}'::jsonb then return new;end if;
 if TG_OP='UPDATE' and old.data ? 'expense_id' then new.data=jsonb_set(new.data,'{expense_id}',old.data->'expense_id');
 else
  insert into av2_expense_counters(trip_id,last_id) values(new.trip_id,1) on conflict(trip_id) do update set last_id=av2_expense_counters.last_id+1 returning last_id into number;
  new.data=jsonb_set(new.data,'{expense_id}',to_jsonb('EXP_'||lpad(number::text,greatest(3,length(number::text)),'0')));
 end if;
 if new.updated_by_device is not null then
  select user_id into actor from av2_user_devices where device_id=new.updated_by_device;
  if actor is not null then
   new.data=new.data||jsonb_build_object('updated_by',actor,'updated_origin','Agenda','external_actor',null);
   if TG_OP='INSERT' or not old.data ? 'created_by' then new.data=new.data||jsonb_build_object('created_by',actor,'created_origin','Agenda');else new.data=jsonb_set(new.data,'{created_by}',old.data->'created_by');end if;
  end if;
 end if;
 return new;
end$$;
create trigger av2_expense_identity before insert or update on av2_records for each row execute function av2_expense_identity();
update av2_records set data=data where kind='expenses' and data<>'{}'::jsonb;
create function public.av2_sheet_expense_apply(p_trip uuid,p_code text,p_row_key uuid,p_changes jsonb,p_base jsonb,p_actor text,p_origin text,p_external_actor text default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare r av2_records;merged jsonb;f text;v jsonb;u av2_app_users;action text;deleted timestamptz;begin
 if p_origin not in ('Google Sheet','ChatGPT/Admin') or jsonb_typeof(p_changes)<>'object' then raise exception 'INVALID_EXPENSE_SOURCE';end if;
 select * into u from av2_app_users where trip_id=p_trip and name=p_actor and active;
 if not found then raise exception 'INVALID_EXPENSE_ACTOR';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_trip::text||':expenses',0));
 select * into r from av2_records where trip_id=p_trip and kind='expenses' and ((p_code is not null and data->>'expense_id'=p_code) or (p_row_key is not null and data->>'sheet_row_key'=p_row_key::text)) for update;
 if r.id is null and p_code is not null then raise exception 'UNKNOWN_EXPENSE_ID';end if;
 if r.id is null and p_row_key is null then raise exception 'EXPENSE_ROW_KEY_REQUIRED';end if;
 merged=coalesce(r.data,'{}'::jsonb);deleted=r.deleted_at;
 for f,v in select key,value from jsonb_each(p_changes) loop
  if f not in ('description','date','category','amount','currency','cost_status','payment_method','location','phase','calendar_event_id','purchase_id','receipt_drive_id','notes','amount_original','currency_original','fx_rate_to_base','amount_base','rate_date','rate_source','actual_base_amount','deleted_at') then raise exception 'INVALID_EXPENSE_FIELD';end if;
  if f='deleted_at' then
   if r.id is not null and coalesce((p_base->>'version')::bigint,0)<>r.version then return jsonb_build_object('record',to_jsonb(r),'conflict',true);end if;
   deleted=nullif(v#>>'{}','')::timestamptz;
  elsif r.id is not null and coalesce(r.data->f,'null'::jsonb) is distinct from coalesce(p_base->'data'->f,'null'::jsonb) and coalesce(r.data->f,'null'::jsonb) is distinct from v then
   return jsonb_build_object('record',to_jsonb(r),'conflict',true);
  else merged=jsonb_set(merged,array[f],v,true);end if;
 end loop;
 if jsonb_typeof(merged->'amount')<>'number' or (merged->>'amount')::numeric<0 or coalesce(merged->>'currency','') !~ '^[A-Z]{3}$' or merged->>'cost_status' not in ('PAID','ESTIMATED') then raise exception 'INVALID_EXPENSE';end if;
 if r.id is not null and merged=r.data and deleted is not distinct from r.deleted_at then return jsonb_build_object('record',to_jsonb(r),'conflict',false);end if;
 action=case when deleted is not null then 'delete' when r.id is null then 'create' when r.deleted_at is not null then 'restore' when r.data->>'cost_status'='ESTIMATED' and merged->>'cost_status'='PAID' then 'settle' else 'edit' end;
 merged=merged||jsonb_build_object('updated_by',u.id,'updated_origin',p_origin,'external_actor',p_external_actor);
 if r.id is null then
  merged=merged||jsonb_build_object('sheet_row_key',p_row_key,'created_by',u.id,'created_origin',p_origin);
  insert into av2_records(id,trip_id,kind,data,updated_by_device,deleted_at) values(gen_random_uuid(),p_trip,'expenses',merged,null,deleted) returning * into r;
 else update av2_records set data=merged,version=version+1,updated_at=clock_timestamp(),updated_by_device=null,deleted_at=deleted where id=r.id returning * into r;end if;
 insert into av2_audit_log(trip_id,actor_user,installation_id,device_name,action,entity,entity_id,summary,origin,external_actor) values(p_trip,u.id,'3a65c425-627c-4cb9-a10f-ec5c5c054fee','Google Sheet · GASTOS',action,'expenses',r.id::text,r.data->>'expense_id'||' · Calendar: '||coalesce(r.data->>'calendar_event_id','')||' · Purchase: '||coalesce(r.data->>'purchase_id',''),p_origin,p_external_actor);
 return jsonb_build_object('record',to_jsonb(r),'conflict',false);
end$$;
revoke all on function av2_sheet_expense_apply(uuid,text,uuid,jsonb,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function av2_sheet_expense_apply(uuid,text,uuid,jsonb,jsonb,text,text,text) to service_role;
grant select,insert,update on av2_records to service_role;

-- Restoration is explicit, credential checked, version checked and idempotent.
create function public.av2_expense_restore(p_trip uuid,p_device uuid,p_token text,p_operation jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare r av2_records;d av2_user_devices;result jsonb;op uuid=(p_operation->>'id')::uuid;begin
 result=av2_pin_validate(p_trip,p_device,p_token);if result ? 'error' then raise exception '%',result->>'error';end if;
 select * into d from av2_user_devices where device_id=p_device;
 if coalesce(p_operation->>'actor_user','')<>d.user_id::text or coalesce(p_operation->>'installation_id','')<>d.installation_id::text or coalesce(p_operation->>'device_id','')<>p_device::text then raise exception 'ACTOR_MISMATCH';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_operation->>'record_id',0));
 select m.result into result from av2_sync_metadata m where m.id=op and m.trip_id=p_trip;if found then return result;end if;
 select * into r from av2_records where id=(p_operation->>'record_id')::uuid and trip_id=p_trip and kind='expenses' for update;
 if not found or r.version<>coalesce((p_operation->>'base_version')::bigint,-1) then raise exception 'EXPENSE_RESTORE_CONFLICT';end if;
 if r.deleted_at is not null then update av2_records set deleted_at=null,version=version+1,updated_at=clock_timestamp(),updated_by_device=p_device where id=r.id returning * into r;end if;
 result=jsonb_build_object('record',to_jsonb(r),'conflicts','[]'::jsonb);
 insert into av2_sync_metadata(id,trip_id,device_id,result,updated_by_device) values(op,p_trip,p_device,result,p_device);
 return result;
end$$;
revoke all on function av2_expense_restore(uuid,uuid,text,jsonb) from public,anon;
grant execute on function av2_expense_restore(uuid,uuid,text,jsonb) to authenticated;

create or replace function public.av2_record_audit() returns trigger language plpgsql security definer set search_path=public as $$
declare d av2_user_devices;action text;begin
 if TG_OP='INSERT' and new.data='{}'::jsonb then return new;end if;
 select * into d from av2_user_devices where device_id=new.updated_by_device;
 if found then
 action=case when new.deleted_at is not null then 'delete' when TG_OP='INSERT' or (TG_OP='UPDATE' and old.data='{}'::jsonb and old.version=1) then 'create' when new.kind='expenses' and old.deleted_at is not null then 'restore' when new.kind='expenses' and old.data->>'cost_status'='ESTIMATED' and new.data->>'cost_status'='PAID' then 'settle' when new.kind='expenses' then 'edit' else 'update' end;
 insert into av2_audit_log(trip_id,actor_user,installation_id,device_name,action,entity,entity_id,summary) values(new.trip_id,d.user_id,d.installation_id,d.friendly_name,action,new.kind,new.id::text,case when new.kind='expenses' then coalesce(new.data->>'expense_id','')||' · Calendar: '||coalesce(new.data->>'calendar_event_id','')||' · Purchase: '||coalesce(new.data->>'purchase_id','') else 'Cambio guardado en el viaje' end);
 end if;return new;
end$$;
