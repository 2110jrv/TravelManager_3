-- Additive, narrowly-scoped bootstrap RPC for the canonical av_* trip.
-- This is used only when authenticated INSERT policy evaluation cannot bootstrap
-- the creator's first ADMIN membership. Legacy tm3_* objects are untouched.
create or replace function public.av_bootstrap_admin_membership(
  p_trip_id uuid,
  p_permissions jsonb default '{"CanChat":true,"CanEditAgenda":true,"CanViewDocuments":true,"CanResolveConflicts":true}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare membership_id uuid;
begin
  if auth.uid() is null then
    raise exception 'AV_AUTH_REQUIRED';
  end if;
  if not exists (
    select 1 from public.av_trips
    where id=p_trip_id and created_by=auth.uid()
  ) then
    raise exception 'AV_BOOTSTRAP_NOT_TRIP_CREATOR';
  end if;
  insert into public.av_trip_memberships(trip_id,user_id,role,permissions,status)
  values(p_trip_id,auth.uid(),'ADMIN',coalesce(p_permissions,'{}'::jsonb),'ACTIVE')
  on conflict (trip_id,user_id) do update
    set role='ADMIN',permissions=excluded.permissions,status='ACTIVE',updated_at=now()
  returning id into membership_id;
  return membership_id;
end;
$$;

revoke all on function public.av_bootstrap_admin_membership(uuid,jsonb) from public;
grant execute on function public.av_bootstrap_admin_membership(uuid,jsonb) to authenticated;
