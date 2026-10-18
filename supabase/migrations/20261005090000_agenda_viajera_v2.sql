-- Additive v2 namespace. No legacy tables or data are read or changed.
create table public.av2_trips (
 id uuid primary key, name text not null, start_date date not null, end_date date not null,
 currency text not null, calendar_id text not null, drive_folders jsonb not null,
 version bigint not null default 1, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), updated_by_device uuid, deleted_at timestamptz
);
insert into public.av2_trips(id,name,start_date,end_date,currency,calendar_id,drive_folders) values
 ('7c0801ee-07b1-4d86-95d7-202610200001','Italia 2026','2026-10-20','2026-11-05','USD',
 'eee85f5d7c0e07fc9a8174d8a3bc640a9b0327901c9f09059d196c1058f5d346@group.calendar.google.com',
 '{"root":"1jY6BLvJDy4PqWQ6iRqztcT-vOmUvBkKI","trip":"1uoM3Fti_Cr8nvrPGs_pU7ojs6DJowL98","documents":"1B3k8rHiBy4DhVSU3f9Ik3e4sXbWWazXv","receipts":"1O2d0I_ynIFOMCgFCnJPU0zCpt1KEQyiT","app":"1gqsdkC5i7a_ytGvBwYwMOEDM5NJ_fMHz","exports":"1itHjXNdzdO3ap4AfP0WgJbxZIgQotyTb"}');
-- Provision approved Supabase auth identities server-side. No first-user-wins registration.
create table public.av2_trip_users (
 id uuid primary key default gen_random_uuid(), trip_id uuid not null references public.av2_trips,
 user_id uuid not null references auth.users, role text not null check(role in ('OWNER','TRAVELER')),
 version bigint not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 updated_by_device uuid, deleted_at timestamptz, unique(trip_id,user_id)
);
create table public.av2_devices (
 id uuid primary key, trip_id uuid not null references public.av2_trips, user_id uuid not null references auth.users,
 name text not null, role text not null default 'DEVICE' check(role in ('ROOT_DEVICE','DEVICE')),
 version bigint not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 updated_by_device uuid, deleted_at timestamptz
);
create unique index av2_one_root on public.av2_devices(trip_id) where role='ROOT_DEVICE';
create table public.av2_records (
 id uuid primary key, trip_id uuid not null references public.av2_trips,
 kind text not null check(kind in ('expenses','budgets','document_links','receipts','categories','exchange_rates','app_settings','notes','purchases')),
 data jsonb not null default '{}', version bigint not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 updated_by_device uuid not null references public.av2_devices, deleted_at timestamptz
);
create index av2_records_trip_order on public.av2_records(trip_id,updated_at,id);
create table public.av2_conflicts (
 id uuid primary key default gen_random_uuid(), trip_id uuid not null references public.av2_trips,
 record_id uuid not null, operation_id uuid not null, field text not null,
 base jsonb, current jsonb, incoming jsonb,
 version bigint not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 updated_by_device uuid not null references public.av2_devices, deleted_at timestamptz
);
create table public.av2_sync_metadata (
 id uuid primary key, trip_id uuid not null references public.av2_trips, device_id uuid not null references public.av2_devices,
 result jsonb not null, version bigint not null default 1, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), updated_by_device uuid not null references public.av2_devices, deleted_at timestamptz
);
-- Domain-specific, RLS-preserving projections over the versioned change store.
do $$ declare kind text; begin
 foreach kind in array array['expenses','budgets','document_links','receipts','categories','exchange_rates','app_settings'] loop
 execute format('create view public.av2_%I with (security_invoker=true) as select * from public.av2_records where kind=%L',kind,kind);
 execute format('grant select on public.av2_%I to authenticated',kind);
 end loop;
end $$;

create function public.av2_member(p_trip uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from av2_trip_users where trip_id=p_trip and user_id=auth.uid() and deleted_at is null)
$$;
create function public.av2_device_allowed(p_trip uuid,p_device uuid) returns boolean language sql stable security definer set search_path=public as $$
 select av2_member(p_trip) and exists(select 1 from av2_devices where id=p_device and trip_id=p_trip and user_id=auth.uid() and deleted_at is null)
$$;
do $$ declare tbl text; begin
 foreach tbl in array array['trips','trip_users','devices','records','conflicts','sync_metadata'] loop
 execute format('alter table public.av2_%I enable row level security',tbl);
 execute format('revoke all on public.av2_%I from anon, authenticated',tbl);
 execute format('grant select on public.av2_%I to authenticated',tbl);
 if tbl='trips' then
 execute 'create policy av2_read on public.av2_trips for select to authenticated using (av2_member(id))';
 else
 execute format('create policy av2_read on public.av2_%I for select to authenticated using (av2_member(trip_id))',tbl);
 end if;
 end loop;
end $$;
-- Avoid recursive policy evaluation for membership/device visibility.
drop policy av2_read on public.av2_devices;
create policy av2_read on public.av2_devices for select to authenticated using (av2_member(trip_id));
drop policy av2_read on public.av2_trip_users;
create policy av2_read on public.av2_trip_users for select to authenticated using (av2_member(trip_id));

create function public.av2_register_device(p_trip uuid,p_device uuid,p_name text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare d av2_devices;
begin
 if not av2_member(p_trip) then raise exception 'AV2_MEMBERSHIP_REQUIRED'; end if;
 select * into d from av2_devices where id=p_device;
 if found then
  if d.user_id<>auth.uid() or d.trip_id<>p_trip or d.deleted_at is not null then raise exception 'AV2_DEVICE_REVOKED'; end if;
  return to_jsonb(d);
 end if;
 -- Enrollment is provisioned server-side in this slice. A revoked installation cannot evade revocation by generating a new UUID.
 raise exception 'AV2_DEVICE_ENROLLMENT_REQUIRED';
end $$;
create function public.av2_root_guard() returns trigger language plpgsql as $$
begin
 if old.role='ROOT_DEVICE' and (TG_OP='DELETE' or new.deleted_at is not null or new.role<>old.role or new.user_id<>old.user_id or new.id<>old.id) then raise exception 'AV2_ROOT_DEVICE_PROTECTED'; end if;
 return new;
end $$;
create trigger av2_root_guard before update or delete on public.av2_devices for each row execute function public.av2_root_guard();

-- Transactional, idempotent per-operation sync; row locking protects two-device writes.
create function public.av2_apply(p_trip uuid,p_operation jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
 d uuid := (p_operation->>'device_id')::uuid; op uuid := (p_operation->>'id')::uuid;
 rid uuid := (p_operation->>'record_id')::uuid; r av2_records; previous jsonb;
 merged jsonb; conflicts jsonb := '[]'; f text; v jsonb; conflict av2_conflicts;
 tombstone timestamptz := nullif(p_operation->>'deleted_at','')::timestamptz; result jsonb;
begin
 if not av2_device_allowed(p_trip,d) then raise exception 'AV2_DEVICE_REVOKED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(rid::text,0));
 select m.result into previous from av2_sync_metadata m where m.id=op and m.trip_id=p_trip;
 if found then return previous; end if;
 select * into r from av2_records where id=rid for update;
 if found and (r.trip_id<>p_trip or r.kind<>p_operation->>'kind') then raise exception 'AV2_RECORD_SCOPE'; end if;
 if r.id is null then
  if (p_operation->>'base_version')::bigint<>0 then raise exception 'AV2_UNKNOWN_BASE'; end if;
  insert into av2_records(id,trip_id,kind,updated_by_device) values(rid,p_trip,p_operation->>'kind',d) returning * into r;
 end if;
 merged := r.data;
 if r.deleted_at is not null or (tombstone is not null and r.version > greatest(1,(p_operation->>'base_version')::bigint)) then
  if r.deleted_at is null or tombstone is null then
   insert into av2_conflicts(trip_id,record_id,operation_id,field,base,current,incoming,updated_by_device)
   values(p_trip,rid,op,'deleted_at',p_operation->'base',to_jsonb(r),p_operation,d) returning * into conflict;
   conflicts := conflicts || jsonb_build_array(to_jsonb(conflict));
  end if;
 else
  for f,v in select key,value from jsonb_each(p_operation->'changes') loop
   if coalesce(r.data->f,'null'::jsonb) is distinct from coalesce(p_operation->'base'->f,'null'::jsonb)
      and coalesce(r.data->f,'null'::jsonb) is distinct from v then
    insert into av2_conflicts(trip_id,record_id,operation_id,field,base,current,incoming,updated_by_device)
    values(p_trip,rid,op,f,p_operation->'base'->f,r.data->f,v,d) returning * into conflict;
    conflicts := conflicts || jsonb_build_array(to_jsonb(conflict));
   else merged := jsonb_set(merged,array[f],v,true); end if;
  end loop;
  if r.kind='expenses' and (coalesce(jsonb_typeof(merged->'amount'),'null')<>'number' or (merged->>'amount')::numeric<0 or coalesce(merged->>'currency','') !~ '^[A-Z]{3}$' or coalesce(merged->>'cost_status','') not in ('PAID','ESTIMATED')) then raise exception 'AV2_INVALID_EXPENSE'; end if;
  update av2_records set data=merged, version=version+1, updated_at=clock_timestamp(), updated_by_device=d, deleted_at=tombstone where id=rid returning * into r;
 end if;
 result := jsonb_build_object('record',to_jsonb(r),'conflicts',conflicts);
 insert into av2_sync_metadata(id,trip_id,device_id,result,updated_by_device) values(op,p_trip,d,result,d);
 return result;
end $$;
revoke all on function public.av2_member(uuid),public.av2_device_allowed(uuid,uuid),public.av2_register_device(uuid,uuid,text),public.av2_apply(uuid,jsonb) from public,anon;
grant execute on function public.av2_member(uuid),public.av2_device_allowed(uuid,uuid),public.av2_register_device(uuid,uuid,text),public.av2_apply(uuid,jsonb) to authenticated;

-- Private sync reads require the calling installation, not just an account shared by multiple devices.
revoke select on public.av2_records,public.av2_conflicts,public.av2_sync_metadata from authenticated;
revoke select on public.av2_expenses,public.av2_budgets,public.av2_document_links,public.av2_receipts,public.av2_categories,public.av2_exchange_rates,public.av2_app_settings from authenticated;
create function public.av2_pull(p_trip uuid,p_device uuid,p_after uuid default null) returns setof public.av2_records
language plpgsql security definer set search_path=public as $$
begin
 if not av2_device_allowed(p_trip,p_device) then raise exception 'AV2_DEVICE_REVOKED'; end if;
 return query select * from av2_records where trip_id=p_trip and (p_after is null or id>p_after) order by id limit 500;
end $$;
create function public.av2_pull_conflicts(p_trip uuid,p_device uuid) returns setof public.av2_conflicts
language plpgsql security definer set search_path=public as $$
begin
 if not av2_device_allowed(p_trip,p_device) then raise exception 'AV2_DEVICE_REVOKED'; end if;
 return query select * from av2_conflicts where trip_id=p_trip;
end $$;
create function public.av2_resolve(p_trip uuid,p_operation jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c av2_conflicts; r av2_records; result jsonb; previous jsonb;
 d uuid := (p_operation->>'device_id')::uuid; op uuid := (p_operation->>'id')::uuid;
begin
 if not av2_device_allowed(p_trip,d) then raise exception 'AV2_DEVICE_REVOKED'; end if;
 select * into c from av2_conflicts where id=(p_operation->>'conflict_id')::uuid and trip_id=p_trip for update;
 if not found then raise exception 'AV2_CONFLICT_NOT_FOUND'; end if;
 perform pg_advisory_xact_lock(hashtextextended(c.record_id::text,0));
 select m.result into previous from av2_sync_metadata m where m.id=op and m.trip_id=p_trip;
 if found then return previous; end if;
 select * into r from av2_records where id=c.record_id for update;
 if c.deleted_at is null and p_operation->>'choice'='incoming' then
  if r.deleted_at is not null or c.field='deleted_at' then raise exception 'AV2_TOMBSTONE_PROTECTED'; end if;
  if coalesce(r.data->c.field,'null'::jsonb) is distinct from coalesce(c.current,'null'::jsonb) then raise exception 'AV2_CONFLICT_CHANGED'; end if;
  update av2_records set data=jsonb_set(data,array[c.field],coalesce(c.incoming,'null'::jsonb),true),version=version+1,updated_at=clock_timestamp(),updated_by_device=d where id=r.id returning * into r;
 elsif p_operation->>'choice'<>'current' and p_operation->>'choice'<>'incoming' then raise exception 'AV2_INVALID_RESOLUTION'; end if;
 update av2_conflicts set deleted_at=now(),updated_at=now(),updated_by_device=d,version=version+1 where id=c.id;
 result := jsonb_build_object('record',to_jsonb(r),'conflicts','[]'::jsonb);
 insert into av2_sync_metadata(id,trip_id,device_id,result,updated_by_device) values(op,p_trip,d,result,d);
 return result;
end $$;
revoke all on function public.av2_pull(uuid,uuid,uuid),public.av2_pull_conflicts(uuid,uuid),public.av2_resolve(uuid,jsonb) from public,anon;
grant execute on function public.av2_pull(uuid,uuid,uuid),public.av2_pull_conflicts(uuid,uuid),public.av2_resolve(uuid,jsonb) to authenticated;
