-- Canonical internal-user soft delete. Additive; preserves chat and audit history.
alter table public.av_users
  add column if not exists deleted_at timestamptz,
  add column if not exists auth_cleanup_pending boolean not null default false;

create index if not exists av_users_deleted_at_idx on public.av_users(deleted_at);
grant select, update on table public.av_users to service_role;
