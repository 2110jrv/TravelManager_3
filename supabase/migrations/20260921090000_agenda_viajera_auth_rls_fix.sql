-- Auth/RLS follow-up for the already-applied Agenda Viajera namespace.
-- Additive only; legacy tm3_* objects are untouched.

create policy av_memberships_creator_bootstrap on public.av_trip_memberships
  for insert
  with check (
    (user_id=auth.uid() and role='ADMIN' and exists (
      select 1 from public.av_trips t where t.id=trip_id and t.created_by=auth.uid()
    ))
    or av_is_admin(trip_id)
  );

drop policy if exists av_messages_member_read on public.av_messages;
create policy av_messages_member_read on public.av_messages
  for select using (
    av_is_member(trip_id)
    and (
      conversation_type='GROUP'
      or sender_user_id=auth.uid()
      or recipient_user_id=auth.uid()
    )
  );
