-- VIEWER is always read-only, even if legacy/custom JSON contains edit flags.
create or replace function public.av_can_write(p_trip_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists(
    select 1 from public.av_trip_memberships m
    where m.trip_id=p_trip_id and m.user_id=auth.uid() and m.status='ACTIVE'
      and m.role <> 'VIEWER'
      and (m.role='ADMIN' or coalesce((m.permissions->>'CanEditAgenda')::boolean,false))
  );
$$;

grant execute on function public.av_can_write(uuid) to authenticated;
