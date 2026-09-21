-- Additive repair for authenticated canonical-trip membership bootstrap.
-- Legacy tm3_* objects are intentionally untouched.
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname='public'
      and tablename='av_trip_memberships'
      and policyname='av_memberships_authenticated_bootstrap_v2'
  ) then
    create policy av_memberships_authenticated_bootstrap_v2
      on public.av_trip_memberships
      for insert
      to authenticated
      with check (
        user_id=auth.uid()
        and role='ADMIN'
        and status='ACTIVE'
        and exists (
          select 1
          from public.av_trips t
          where t.id=trip_id
            and t.created_by=auth.uid()
        )
      );
  end if;
end $$;
