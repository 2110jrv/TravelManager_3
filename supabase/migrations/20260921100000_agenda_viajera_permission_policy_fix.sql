-- Permission-aware RLS follow-up for authenticated sandbox validation.
-- Additive only; legacy tm3_* objects are untouched.

create or replace function public.av_can_write(p_trip_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists(
    select 1 from public.av_trip_memberships m
    where m.trip_id=p_trip_id and m.user_id=auth.uid() and m.status='ACTIVE'
      and (m.role='ADMIN' or coalesce((m.permissions->>'CanEditAgenda')::boolean,false))
  );
$$;

drop policy if exists av_messages_member_read on public.av_messages;
create policy av_messages_member_read on public.av_messages for select using (
  exists(
    select 1 from public.av_trip_memberships m
    where m.trip_id=av_messages.trip_id and m.user_id=auth.uid() and m.status='ACTIVE'
      and coalesce((m.permissions->>'CanChat')::boolean,m.role='ADMIN')
  )
  and (conversation_type='GROUP' or sender_user_id=auth.uid() or recipient_user_id=auth.uid())
);
drop policy if exists av_messages_member_insert on public.av_messages;
create policy av_messages_member_insert on public.av_messages for insert with check (
  sender_user_id=auth.uid()
  and exists(
    select 1 from public.av_trip_memberships m
    where m.trip_id=av_messages.trip_id and m.user_id=auth.uid() and m.status='ACTIVE'
      and coalesce((m.permissions->>'CanChat')::boolean,m.role='ADMIN')
  )
);

drop policy if exists av_documents_member_read on public.av_documents;
create policy av_documents_member_read on public.av_documents for select using (
  exists(
    select 1 from public.av_trip_memberships m
    where m.trip_id=av_documents.trip_id and m.user_id=auth.uid() and m.status='ACTIVE'
      and coalesce((m.permissions->>'CanViewDocuments')::boolean,m.role='ADMIN')
  )
);
