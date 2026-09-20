-- Agenda Viajera remote v1. Additive namespace only; legacy tm3_* objects are untouched.

create table if not exists public.av_trips (
  id uuid primary key default gen_random_uuid(), name text not null, start_date date, end_date date,
  status text not null default 'PLANNING' check (status in ('PLANNING','ACTIVE','COMPLETED','ARCHIVED')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references auth.users(id)
);
create table if not exists public.av_users (
  id uuid primary key default gen_random_uuid(), display_name text not null, email text,
  created_at timestamptz not null default now()
);
create table if not exists public.av_trip_memberships (
  id uuid primary key default gen_random_uuid(), trip_id uuid not null references public.av_trips(id) on delete cascade,
  user_id uuid not null references public.av_users(id) on delete cascade, role text not null check (role in ('VIEWER','TRAVELER','ADMIN')),
  permissions jsonb not null default '{}'::jsonb, status text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (trip_id,user_id)
);
create table if not exists public.av_devices (
  device_id text primary key, app_installation_id text, user_id uuid references public.av_users(id), state text not null default 'NEW'
    check (state in ('NEW','TEMPORARY','TRUSTED','BLOCKED','PURGE_PENDING','REVOKED')), name text, last_seen_at timestamptz,
  created_at timestamptz not null default now(), trusted_at timestamptz, revoked_at timestamptz, purge_requested_at timestamptz, metadata jsonb not null default '{}'
);
create table if not exists public.av_device_commands (
  id uuid primary key default gen_random_uuid(), device_id text not null references public.av_devices(device_id) on delete cascade,
  command_type text not null check (command_type in ('PURGE_DOCUMENTS','CLOSE_SESSION','BLOCK','REVOKE','REVOKE_AND_PURGE')),
  status text not null default 'PENDING' check (status in ('PENDING','COMPLETED','FAILED')), payload jsonb not null default '{}',
  created_at timestamptz not null default now(), completed_at timestamptz, result jsonb
);
create table if not exists public.av_restore_requests (
  id uuid primary key default gen_random_uuid(), device_id text not null references public.av_devices(device_id), user_id uuid references public.av_users(id),
  reason text not null, status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED')),
  created_at timestamptz not null default now(), resolved_by uuid, resolved_at timestamptz, resolution_note text
);
create table if not exists public.av_records (
  record_id uuid primary key, trip_id uuid not null references public.av_trips(id) on delete cascade, record_type text not null,
  version bigint not null default 1, data jsonb not null default '{}', deleted_at timestamptz, updated_at timestamptz not null default now(),
  updated_by_user uuid, updated_by_device text
);
create table if not exists public.av_record_versions (
  id uuid primary key default gen_random_uuid(), record_id uuid not null references public.av_records(record_id) on delete cascade,
  trip_id uuid not null references public.av_trips(id) on delete cascade, version bigint not null, snapshot jsonb not null,
  created_at timestamptz not null default now(), updated_by_user uuid, updated_by_device text, unique(record_id,version)
);
create table if not exists public.av_change_operations (
  operation_id uuid primary key, trip_id uuid not null references public.av_trips(id) on delete cascade, record_type text not null,
  record_id uuid not null, action text not null check (action in ('CREATE','UPDATE','DELETE')),
  base_version bigint not null default 0, changes jsonb not null default '{}', user_id uuid, device_id text,
  created_at timestamptz not null default now(), processed_at timestamptz, status text not null default 'PENDING'
    check (status in ('PENDING','APPLIED','CONFLICT','DUPLICATE','REJECTED')), result jsonb
);
create table if not exists public.av_conflicts (
  conflict_id uuid primary key default gen_random_uuid(), trip_id uuid not null references public.av_trips(id) on delete cascade,
  record_id uuid not null, record_type text not null, type text not null check (type in ('SAME_FIELD_CONFLICT','DELETE_VS_EDIT')),
  field text, base_value jsonb, current_value jsonb, incoming_value jsonb, current_user_id uuid, current_device_id text,
  incoming_user_id uuid, incoming_device_id text, status text not null default 'OPEN' check (status in ('OPEN','RESOLVED')),
  resolution_type text, resolved_value jsonb, resolved_by_user_id uuid, resolved_by_device_id text, created_at timestamptz not null default now(),
  resolved_at timestamptz, resolution_note text
);
create table if not exists public.av_messages (
  message_id uuid primary key, trip_id uuid not null references public.av_trips(id) on delete cascade, conversation_id text not null,
  conversation_type text not null check (conversation_type in ('GROUP','DIRECT')), sender_user_id uuid not null, recipient_user_id uuid,
  text text not null, local_created_at timestamptz, server_created_at timestamptz not null default now(), edited_at timestamptz, deleted_at timestamptz
);
create table if not exists public.av_documents (
  document_id uuid primary key default gen_random_uuid(), trip_id uuid not null references public.av_trips(id) on delete cascade,
  agenda_entry_id uuid, title text not null, category text, cloud_provider text, cloud_file_id text, mime_type text, size_bytes bigint,
  updated_at timestamptz not null default now(), created_by uuid
);
create table if not exists public.av_device_document_cache_metadata (
  device_id text not null references public.av_devices(device_id) on delete cascade, document_id uuid not null references public.av_documents(document_id) on delete cascade,
  state text not null, downloaded_at timestamptz, last_verified_at timestamptz, local_bytes bigint, updated_at timestamptz not null default now(),
  primary key(device_id,document_id)
);
create table if not exists public.av_audit_issues (
  id uuid primary key default gen_random_uuid(), trip_id uuid not null references public.av_trips(id) on delete cascade, code text not null,
  severity text not null, repair_class text not null, entry_ids jsonb not null default '[]', message text not null,
  created_at timestamptz not null default now(), resolved_at timestamptz
);

create index if not exists av_memberships_trip_idx on public.av_trip_memberships(trip_id,user_id,status);
create index if not exists av_records_trip_version_idx on public.av_records(trip_id,version);
create index if not exists av_operations_trip_created_idx on public.av_change_operations(trip_id,created_at);
create index if not exists av_conflicts_trip_status_idx on public.av_conflicts(trip_id,status);
create index if not exists av_messages_trip_conversation_idx on public.av_messages(trip_id,conversation_id,server_created_at);

create or replace function public.av_is_member(p_trip_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.av_trip_memberships m where m.trip_id=p_trip_id and m.user_id=auth.uid() and m.status='ACTIVE'); $$;
create or replace function public.av_can_write(p_trip_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.av_trip_memberships m where m.trip_id=p_trip_id and m.user_id=auth.uid() and m.status='ACTIVE' and m.role in ('TRAVELER','ADMIN')); $$;
create or replace function public.av_is_admin(p_trip_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.av_trip_memberships m where m.trip_id=p_trip_id and m.user_id=auth.uid() and m.status='ACTIVE' and m.role='ADMIN'); $$;

do $$ declare t text; begin
  foreach t in array array['av_trips','av_users','av_trip_memberships','av_devices','av_device_commands','av_restore_requests','av_records','av_record_versions','av_change_operations','av_conflicts','av_messages','av_documents','av_device_document_cache_metadata','av_audit_issues'] loop
    execute format('alter table public.%I enable row level security',t);
  end loop;
end $$;

create policy av_trips_member_read on public.av_trips for select using (av_is_member(id));
create policy av_trips_admin_write on public.av_trips for all using (created_by=auth.uid() or av_is_admin(id)) with check (created_by=auth.uid() or av_is_admin(id));
create policy av_users_self_read on public.av_users for select using (id=auth.uid() or exists(select 1 from av_trip_memberships m where m.user_id=auth.uid() and m.status='ACTIVE' and m.trip_id in (select trip_id from av_trip_memberships x where x.user_id=av_users.id)));
create policy av_users_self_write on public.av_users for insert with check (id=auth.uid());
create policy av_memberships_member_read on public.av_trip_memberships for select using (av_is_member(trip_id));
create policy av_memberships_admin_write on public.av_trip_memberships for all using (av_is_admin(trip_id)) with check (av_is_admin(trip_id));
create policy av_devices_owner_read on public.av_devices for select using (user_id=auth.uid() or exists(select 1 from av_trip_memberships m where m.user_id=auth.uid() and m.role='ADMIN' and m.status='ACTIVE'));
create policy av_devices_owner_write on public.av_devices for insert with check (user_id=auth.uid());
create policy av_devices_admin_write on public.av_devices for update using (exists(select 1 from av_trip_memberships m where m.user_id=auth.uid() and m.role='ADMIN' and m.status='ACTIVE'));
create policy av_commands_target_read on public.av_device_commands for select using (device_id in (select device_id from av_devices where user_id=auth.uid()) or exists(select 1 from av_trip_memberships m where m.user_id=auth.uid() and m.role='ADMIN' and m.status='ACTIVE'));
create policy av_commands_admin_write on public.av_device_commands for all using (exists(select 1 from av_trip_memberships m where m.user_id=auth.uid() and m.role='ADMIN' and m.status='ACTIVE')) with check (exists(select 1 from av_trip_memberships m where m.user_id=auth.uid() and m.role='ADMIN' and m.status='ACTIVE'));
create policy av_restore_owner_read on public.av_restore_requests for select using (user_id=auth.uid() or exists(select 1 from av_trip_memberships m where m.user_id=auth.uid() and m.role='ADMIN' and m.status='ACTIVE'));
create policy av_restore_owner_insert on public.av_restore_requests for insert with check (user_id=auth.uid());
create policy av_restore_admin_update on public.av_restore_requests for update using (exists(select 1 from av_trip_memberships m where m.user_id=auth.uid() and m.role='ADMIN' and m.status='ACTIVE'));

do $$ declare t text; begin
  foreach t in array array['av_records','av_record_versions','av_change_operations','av_conflicts','av_messages','av_documents','av_device_document_cache_metadata','av_audit_issues'] loop
    execute format('create policy %I on public.%I for select using (av_is_member(trip_id))',t||'_member_read',t);
  end loop;
end $$;
create policy av_records_member_write on public.av_records for all using (av_can_write(trip_id)) with check (av_can_write(trip_id));
create policy av_versions_member_write on public.av_record_versions for all using (av_can_write(trip_id)) with check (av_can_write(trip_id));
create policy av_operations_member_write on public.av_change_operations for insert with check (av_can_write(trip_id));
create policy av_conflicts_admin_write on public.av_conflicts for update using (av_is_admin(trip_id)) with check (av_is_admin(trip_id));
create policy av_messages_member_insert on public.av_messages for insert with check (av_is_member(trip_id) and sender_user_id=auth.uid());
create policy av_documents_write on public.av_documents for all using (av_can_write(trip_id)) with check (av_can_write(trip_id));
create policy av_cache_write on public.av_device_document_cache_metadata for all using (device_id in (select device_id from av_devices where user_id=auth.uid()));
create policy av_audit_admin_write on public.av_audit_issues for all using (av_is_admin(trip_id)) with check (av_is_admin(trip_id));

create or replace function public.av_apply_change_operation(p_operation_id uuid,p_trip_id uuid,p_record_type text,p_record_id uuid,p_action text,p_base_version bigint,p_changes jsonb,p_user_id uuid,p_device_id text,p_created_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path=public as $$
declare op public.av_change_operations%rowtype; current public.av_records%rowtype; conflict_id uuid; next_data jsonb; overlapping text; exists_record boolean;
begin
  if not av_can_write(p_trip_id) then raise exception 'AV_PERMISSION_DENIED'; end if;
  select * into op from av_change_operations where operation_id=p_operation_id;
  if found then return coalesce(op.result,jsonb_build_object('status','DUPLICATE','operationId',p_operation_id)); end if;
  insert into av_change_operations(operation_id,trip_id,record_type,record_id,action,base_version,changes,user_id,device_id,created_at,status) values(p_operation_id,p_trip_id,p_record_type,p_record_id,p_action,p_base_version,p_changes,p_user_id,p_device_id,p_created_at,'PENDING');
  select * into current from av_records where record_id=p_record_id for update; exists_record:=found;
  if not exists_record then
    if p_action='UPDATE' or p_action='DELETE' then update av_change_operations set status='REJECTED',processed_at=now(),result=jsonb_build_object('status','REJECTED','reason','MISSING_RECORD') where operation_id=p_operation_id; return jsonb_build_object('status','REJECTED','reason','MISSING_RECORD'); end if;
    insert into av_records(record_id,trip_id,record_type,version,data,updated_by_user,updated_by_device) values(p_record_id,p_trip_id,p_record_type,1,p_changes,p_user_id,p_device_id);
    insert into av_record_versions(record_id,trip_id,version,snapshot,updated_by_user,updated_by_device) values(p_record_id,p_trip_id,1,p_changes,p_user_id,p_device_id);
  elsif current.version<>p_base_version and p_action<>'CREATE' then
    select key into overlapping from jsonb_object_keys(p_changes) key where current.data ? key limit 1;
    if overlapping is not null or p_action='DELETE' then
      conflict_id:=gen_random_uuid(); insert into av_conflicts(conflict_id,trip_id,record_id,record_type,type,field,current_value,incoming_value,current_user_id,current_device_id,incoming_user_id,incoming_device_id) values(conflict_id,p_trip_id,p_record_id,p_record_type,case when p_action='DELETE' then 'DELETE_VS_EDIT' else 'SAME_FIELD_CONFLICT' end,overlapping,current.data,p_changes,current.updated_by_user,current.updated_by_device,p_user_id,p_device_id);
      update av_change_operations set status='CONFLICT',processed_at=now(),result=jsonb_build_object('status','CONFLICT','conflictId',conflict_id) where operation_id=p_operation_id; return jsonb_build_object('status','CONFLICT','conflictId',conflict_id);
    end if;
    next_data:=current.data||p_changes;
  else next_data:=case when p_action='DELETE' then current.data else coalesce(current.data,'{}')||p_changes end;
  end if;
  if exists_record then update av_records set version=current.version+1,data=next_data,deleted_at=case when p_action='DELETE' then now() else null end,updated_at=now(),updated_by_user=p_user_id,updated_by_device=p_device_id where record_id=p_record_id; insert into av_record_versions(record_id,trip_id,version,snapshot,updated_by_user,updated_by_device) values(p_record_id,p_trip_id,current.version+1,next_data,p_user_id,p_device_id); end if;
  update av_change_operations set status='APPLIED',processed_at=now(),result=jsonb_build_object('status','APPLIED','recordId',p_record_id) where operation_id=p_operation_id;
  return jsonb_build_object('status','APPLIED','recordId',p_record_id,'version',case when exists_record then current.version+1 else 1 end);
end $$;

create or replace function public.av_resolve_conflict(p_conflict_id uuid,p_resolution_type text,p_resolved_value jsonb,p_resolved_by_user_id uuid,p_resolved_by_device_id text,p_resolution_note text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.av_conflicts%rowtype; r public.av_records%rowtype; value jsonb;
begin
  select * into c from av_conflicts where conflict_id=p_conflict_id for update; if not found or c.status<>'OPEN' then raise exception 'AV_CONFLICT_NOT_OPEN'; end if;
  if not av_is_admin(c.trip_id) then raise exception 'AV_PERMISSION_DENIED'; end if;
  select * into r from av_records where record_id=c.record_id for update; value:=case when p_resolution_type='USE_CURRENT' then r.data when p_resolution_type='USE_INCOMING' then c.incoming_value when p_resolution_type='KEEP_DELETED' then r.data else coalesce(p_resolved_value,r.data) end;
  update av_records set version=version+1,data=value,deleted_at=case when p_resolution_type='KEEP_DELETED' then coalesce(deleted_at,now()) else null end,updated_at=now(),updated_by_user=p_resolved_by_user_id,updated_by_device=p_resolved_by_device_id where record_id=c.record_id;
  insert into av_record_versions(record_id,trip_id,version,snapshot,updated_by_user,updated_by_device) select record_id,trip_id,version,data,p_resolved_by_user_id,p_resolved_by_device_id from av_records where record_id=c.record_id;
  update av_conflicts set status='RESOLVED',resolution_type=p_resolution_type,resolved_value=value,resolved_by_user_id=p_resolved_by_user_id,resolved_by_device_id=p_resolved_by_device_id,resolved_at=now(),resolution_note=p_resolution_note where conflict_id=p_conflict_id;
  return jsonb_build_object('status','RESOLVED','conflictId',p_conflict_id);
end $$;
