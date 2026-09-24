-- Technical bridge for the PIN-only UX. Supabase Auth remains an invisible
-- transport identity for RLS; the backdoor credential itself is never stored
-- in the browser or in plaintext.
create table if not exists public.av_backdoor_config (
  id boolean primary key default true check (id),
  bridge_user_id uuid references auth.users(id) on delete set null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.av_backdoor_config enable row level security;
revoke all on public.av_backdoor_config from anon, authenticated;

create table if not exists public.av_role_permissions (
  role text primary key check (role in ('ADMIN','TRAVELER','VIEWER')),
  permissions jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.av_role_permissions enable row level security;
revoke all on public.av_role_permissions from anon, authenticated;
insert into public.av_role_permissions(role,permissions) values
 ('ADMIN','{"viewHome":true,"viewAgenda":true,"editAgenda":true,"deleteAgenda":true,"viewMap":true,"viewPhotos":true,"uploadPhotos":true,"deletePhotos":true,"viewChat":true,"writeChat":true,"viewBudget":true,"viewDocuments":true,"manageDocuments":true,"editTrip":true}'::jsonb),
 ('TRAVELER','{"viewHome":true,"viewAgenda":true,"editAgenda":true,"deleteAgenda":false,"viewMap":true,"viewPhotos":true,"uploadPhotos":true,"deletePhotos":false,"viewChat":true,"writeChat":true,"viewBudget":true,"viewDocuments":true,"manageDocuments":false,"editTrip":true}'::jsonb),
 ('VIEWER','{"viewHome":true,"viewAgenda":true,"editAgenda":false,"deleteAgenda":false,"viewMap":true,"viewPhotos":true,"uploadPhotos":false,"deletePhotos":false,"viewChat":true,"writeChat":false,"viewBudget":false,"viewDocuments":true,"manageDocuments":false,"editTrip":false}'::jsonb)
on conflict(role) do nothing;

alter table public.av_messages add column if not exists sender_name text;

create or replace function public.av_get_role_permissions(p_role text)
returns jsonb language sql stable security definer set search_path=public
as $$ select coalesce((select permissions from public.av_role_permissions where role=p_role),'{}'::jsonb); $$;
revoke all on function public.av_get_role_permissions(text) from public;
grant execute on function public.av_get_role_permissions(text) to authenticated;
