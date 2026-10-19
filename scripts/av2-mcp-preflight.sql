-- Read-only inventory. Run only through an approved administrative SQL session.
-- No credentials or application row contents are returned. This is not a backup.
-- Prerequisite: the existing V2 baseline is installed; a missing table is a blocker.
begin read only;
set local statement_timeout = '30s';
select current_database() as database_name, current_setting('server_version') as server_version;
select to_regclass('supabase_migrations.schema_migrations') as migration_ledger;
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' and c.relname like 'av2_%'
order by c.relname;
select table_name,column_name,data_type,is_nullable
from information_schema.columns
where table_schema='public' and table_name in
 ('av2_places_of_interest','av2_records','av2_remote_grants','av2_remote_history','av2_remote_private_places','av2_remote_public_places')
order by table_name,ordinal_position;
select p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
 p.prosecdef as security_definer,md5(pg_get_functiondef(p.oid)) as definition_fingerprint
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname like 'av2_remote_%'
order by p.proname,arguments;
select tablename,policyname,roles,cmd,qual,with_check
from pg_policies where schemaname='public' and tablename like 'av2_remote_%'
order by tablename,policyname;
select c.relname as table_name,t.tgname,pg_get_triggerdef(t.oid) as definition
from pg_trigger t join pg_class c on c.oid=t.tgrelid
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and not t.tgisinternal
and (t.tgname like 'av2_remote_%' or c.relname like 'av2_remote_%')
order by c.relname,t.tgname;
select grantee,table_name,privilege_type from information_schema.role_table_grants
where table_schema='public' and table_name like 'av2_remote_%'
order by table_name,grantee,privilege_type;
-- Compare these counts/fingerprints before/after a separately approved migration.
-- Exclude the new nullable notes column so original row data is comparable.
select 'av2_places_of_interest' as relation,count(*) as row_count,
 md5(coalesce(string_agg(md5((to_jsonb(p)-'notes')::text),'' order by p.id),'')) as original_content_fingerprint
from public.av2_places_of_interest p
union all
select 'av2_records',count(*),
 md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' order by r.id),''))
from public.av2_records r;
rollback;
