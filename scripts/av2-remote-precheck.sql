select jsonb_build_object(
 'database',current_database(),'postgres',version(),
 'av2_tables',(select coalesce(jsonb_agg(jsonb_build_object('name',tablename,'rls',rowsecurity)),'[]'::jsonb) from pg_tables where schemaname='public' and tablename like 'av2_%'),
 'legacy_tables',(select count(*) from pg_tables where schemaname='public' and tablename not like 'av2_%'),
 'av2_migrations',(select coalesce(jsonb_agg(version),'[]'::jsonb) from supabase_migrations.schema_migrations where version like '20261005%'),
 'owner_auth_identity_exists',exists(select 1 from auth.users where lower(email)='2110jrv@gmail.com')
) as precheck;
