-- Hidden per-user Auth bridge metadata. Existing av_users.id values remain
-- unchanged because current RLS/RPCs use them as the technical auth uid.
alter table public.av_users
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null;

update public.av_users
set auth_user_id=id
where auth_user_id is null;

create unique index if not exists av_users_auth_user_id_uidx
  on public.av_users(auth_user_id)
  where auth_user_id is not null;

grant select, insert, update on table public.av_users to service_role;
