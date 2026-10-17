-- Guides use the existing private records, outbox, pull and conflict contract.
create or replace function public.av2_guard_place_guide() returns trigger
language plpgsql security definer set search_path=public as $$
declare d jsonb;u av2_app_users;pin av2_places_of_interest;
begin
 if tg_op='DELETE' then d=old.data;else d=new.data;end if;
 if coalesce(d->>'type','')<>'place_guide' and (tg_op='INSERT' or coalesce(old.data->>'type','')<>'place_guide') then
  if tg_op='DELETE' then return old;else return new;end if;
 end if;
 if auth.uid() is not null then
  select a.* into u from av2_user_devices v join av2_app_users a on a.id=v.user_id
   where v.device_id=case when tg_op='DELETE' then old.updated_by_device else new.updated_by_device end
    and v.auth_user_id=auth.uid() and a.trip_id=case when tg_op='DELETE' then old.trip_id else new.trip_id end
    and a.active and v.state='Autorizado' and v.validated_pin_version=a.pin_version;
  if not found or u.agenda_role not in ('ADMIN','TRAVELER') then raise exception 'AV2_GUIDE_READ_ONLY';end if;
 end if;
 if tg_op='DELETE' then return old;end if;
 if new.kind<>'app_settings' or d->>'type' is distinct from 'place_guide'
  or jsonb_typeof(d->'guide') is distinct from 'object' or octet_length(d::text)>180000
  or coalesce(d->>'place_id','')!~'^[0-9a-fA-F-]{36}$'
  or exists(select 1 from jsonb_object_keys(d) k where k not in ('type','place_id','poi_code','name','guide')) then raise exception 'AV2_INVALID_GUIDE';end if;
 if tg_op='UPDATE' and old.data->>'type'='place_guide' and (new.trip_id<>old.trip_id or d->>'place_id' is distinct from old.data->>'place_id') then raise exception 'AV2_GUIDE_SCOPE';end if;
 select * into pin from av2_places_of_interest where id=(d->>'place_id')::uuid and trip_id=new.trip_id and deleted_at is null;
 if not found or d->>'poi_code' is distinct from pin.poi_code or d->>'name' is distinct from pin.name then raise exception 'AV2_GUIDE_PIN_MISMATCH';end if;
 return new;
end $$;
revoke all on function public.av2_guard_place_guide() from public,anon,authenticated;
create trigger av2_place_guide_guard before insert or update or delete on public.av2_records
 for each row execute function public.av2_guard_place_guide();
create unique index av2_one_place_guide on public.av2_records(trip_id,(data->>'place_id')) where kind='app_settings' and data->>'type'='place_guide';
