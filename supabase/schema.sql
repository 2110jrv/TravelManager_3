-- TravelManager 3 Supabase sync schema
-- Run this file in the Supabase SQL Editor for:
-- https://cslludzuejkhsydqiabx.supabase.co

create table if not exists public.tm3_trips (
  user_id uuid not null references auth.users(id) on delete cascade,
  trip_id text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  version integer not null default 1,
  device_id text null,
  constraint tm3_trips_pkey primary key (trip_id)
);

create table if not exists public.tm3_trip_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  day_id text not null,
  trip_id text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  version integer not null default 1,
  device_id text null,
  constraint tm3_trip_days_pkey primary key (day_id)
);

create table if not exists public.tm3_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null,
  trip_id text not null,
  source_item_id text null,
  day_date date null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  version integer not null default 1,
  device_id text null,
  constraint tm3_items_pkey primary key (item_id)
);

create table if not exists public.tm3_settings (
  user_id uuid not null references auth.users(id) on delete cascade,
  setting_key text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  version integer not null default 1,
  device_id text null,
  constraint tm3_settings_pkey primary key (user_id, setting_key)
);

create table if not exists public.tm3_deletion_queue (
  user_id uuid not null references auth.users(id) on delete cascade,
  deletion_id text not null,
  entity_type text not null,
  entity_id text not null,
  trip_id text null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  version integer not null default 1,
  device_id text null,
  constraint tm3_deletion_queue_pkey primary key (deletion_id)
);

create index if not exists tm3_trips_user_id_idx on public.tm3_trips (user_id);
create index if not exists tm3_trips_updated_at_idx on public.tm3_trips (updated_at);
create index if not exists tm3_trips_deleted_at_idx on public.tm3_trips (deleted_at);

create index if not exists tm3_trip_days_user_id_idx on public.tm3_trip_days (user_id);
create index if not exists tm3_trip_days_trip_id_idx on public.tm3_trip_days (trip_id);
create index if not exists tm3_trip_days_updated_at_idx on public.tm3_trip_days (updated_at);
create index if not exists tm3_trip_days_deleted_at_idx on public.tm3_trip_days (deleted_at);

create index if not exists tm3_items_user_id_idx on public.tm3_items (user_id);
create index if not exists tm3_items_trip_id_idx on public.tm3_items (trip_id);
create index if not exists tm3_items_source_item_id_idx on public.tm3_items (source_item_id);
create index if not exists tm3_items_day_date_idx on public.tm3_items (day_date);
create index if not exists tm3_items_updated_at_idx on public.tm3_items (updated_at);
create index if not exists tm3_items_deleted_at_idx on public.tm3_items (deleted_at);

create index if not exists tm3_settings_user_id_idx on public.tm3_settings (user_id);
create index if not exists tm3_settings_updated_at_idx on public.tm3_settings (updated_at);
create index if not exists tm3_settings_deleted_at_idx on public.tm3_settings (deleted_at);

create index if not exists tm3_deletion_queue_user_id_idx on public.tm3_deletion_queue (user_id);
create index if not exists tm3_deletion_queue_trip_id_idx on public.tm3_deletion_queue (trip_id);
create index if not exists tm3_deletion_queue_updated_at_idx on public.tm3_deletion_queue (updated_at);
create index if not exists tm3_deletion_queue_deleted_at_idx on public.tm3_deletion_queue (deleted_at);

grant usage on schema public to authenticated;

grant select, insert, update, delete on table public.tm3_trips to authenticated;
grant select, insert, update, delete on table public.tm3_trip_days to authenticated;
grant select, insert, update, delete on table public.tm3_items to authenticated;
grant select, insert, update, delete on table public.tm3_settings to authenticated;
grant select, insert, update, delete on table public.tm3_deletion_queue to authenticated;

alter table public.tm3_trips enable row level security;
alter table public.tm3_trip_days enable row level security;
alter table public.tm3_items enable row level security;
alter table public.tm3_settings enable row level security;
alter table public.tm3_deletion_queue enable row level security;

drop policy if exists "tm3_trips_select_own_rows" on public.tm3_trips;
create policy "tm3_trips_select_own_rows" on public.tm3_trips
  for select using (auth.uid() = user_id);

drop policy if exists "tm3_trips_insert_own_rows" on public.tm3_trips;
create policy "tm3_trips_insert_own_rows" on public.tm3_trips
  for insert with check (auth.uid() = user_id);

drop policy if exists "tm3_trips_update_own_rows" on public.tm3_trips;
create policy "tm3_trips_update_own_rows" on public.tm3_trips
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "tm3_trips_delete_own_rows" on public.tm3_trips;
create policy "tm3_trips_delete_own_rows" on public.tm3_trips
  for delete using (auth.uid() = user_id);

drop policy if exists "tm3_trip_days_select_own_rows" on public.tm3_trip_days;
create policy "tm3_trip_days_select_own_rows" on public.tm3_trip_days
  for select using (auth.uid() = user_id);

drop policy if exists "tm3_trip_days_insert_own_rows" on public.tm3_trip_days;
create policy "tm3_trip_days_insert_own_rows" on public.tm3_trip_days
  for insert with check (auth.uid() = user_id);

drop policy if exists "tm3_trip_days_update_own_rows" on public.tm3_trip_days;
create policy "tm3_trip_days_update_own_rows" on public.tm3_trip_days
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "tm3_trip_days_delete_own_rows" on public.tm3_trip_days;
create policy "tm3_trip_days_delete_own_rows" on public.tm3_trip_days
  for delete using (auth.uid() = user_id);

drop policy if exists "tm3_items_select_own_rows" on public.tm3_items;
create policy "tm3_items_select_own_rows" on public.tm3_items
  for select using (auth.uid() = user_id);

drop policy if exists "tm3_items_insert_own_rows" on public.tm3_items;
create policy "tm3_items_insert_own_rows" on public.tm3_items
  for insert with check (auth.uid() = user_id);

drop policy if exists "tm3_items_update_own_rows" on public.tm3_items;
create policy "tm3_items_update_own_rows" on public.tm3_items
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "tm3_items_delete_own_rows" on public.tm3_items;
create policy "tm3_items_delete_own_rows" on public.tm3_items
  for delete using (auth.uid() = user_id);

drop policy if exists "tm3_settings_select_own_rows" on public.tm3_settings;
create policy "tm3_settings_select_own_rows" on public.tm3_settings
  for select using (auth.uid() = user_id);

drop policy if exists "tm3_settings_insert_own_rows" on public.tm3_settings;
create policy "tm3_settings_insert_own_rows" on public.tm3_settings
  for insert with check (auth.uid() = user_id);

drop policy if exists "tm3_settings_update_own_rows" on public.tm3_settings;
create policy "tm3_settings_update_own_rows" on public.tm3_settings
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "tm3_settings_delete_own_rows" on public.tm3_settings;
create policy "tm3_settings_delete_own_rows" on public.tm3_settings
  for delete using (auth.uid() = user_id);

drop policy if exists "tm3_deletion_queue_select_own_rows" on public.tm3_deletion_queue;
create policy "tm3_deletion_queue_select_own_rows" on public.tm3_deletion_queue
  for select using (auth.uid() = user_id);

drop policy if exists "tm3_deletion_queue_insert_own_rows" on public.tm3_deletion_queue;
create policy "tm3_deletion_queue_insert_own_rows" on public.tm3_deletion_queue
  for insert with check (auth.uid() = user_id);

drop policy if exists "tm3_deletion_queue_update_own_rows" on public.tm3_deletion_queue;
create policy "tm3_deletion_queue_update_own_rows" on public.tm3_deletion_queue
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "tm3_deletion_queue_delete_own_rows" on public.tm3_deletion_queue;
create policy "tm3_deletion_queue_delete_own_rows" on public.tm3_deletion_queue
  for delete using (auth.uid() = user_id);

create or replace function public.tm3_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.version = old.version + 1;
  return new;
end;
$$;

drop trigger if exists tm3_trips_touch_updated_at on public.tm3_trips;
create trigger tm3_trips_touch_updated_at
  before update on public.tm3_trips
  for each row execute function public.tm3_touch_updated_at();

drop trigger if exists tm3_trip_days_touch_updated_at on public.tm3_trip_days;
create trigger tm3_trip_days_touch_updated_at
  before update on public.tm3_trip_days
  for each row execute function public.tm3_touch_updated_at();

drop trigger if exists tm3_items_touch_updated_at on public.tm3_items;
create trigger tm3_items_touch_updated_at
  before update on public.tm3_items
  for each row execute function public.tm3_touch_updated_at();

drop trigger if exists tm3_settings_touch_updated_at on public.tm3_settings;
create trigger tm3_settings_touch_updated_at
  before update on public.tm3_settings
  for each row execute function public.tm3_touch_updated_at();

drop trigger if exists tm3_deletion_queue_touch_updated_at on public.tm3_deletion_queue;
create trigger tm3_deletion_queue_touch_updated_at
  before update on public.tm3_deletion_queue
  for each row execute function public.tm3_touch_updated_at();

do $$
declare
  tm3_table regclass;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach tm3_table in array array[
      'public.tm3_trips'::regclass,
      'public.tm3_trip_days'::regclass,
      'public.tm3_items'::regclass,
      'public.tm3_settings'::regclass,
      'public.tm3_deletion_queue'::regclass
    ]
    loop
      begin
        execute format('alter publication supabase_realtime add table %s', tm3_table);
      exception
        when duplicate_object then null;
      end;
    end loop;
  end if;
end;
$$;
