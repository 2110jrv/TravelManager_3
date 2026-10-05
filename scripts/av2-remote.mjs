import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes,createHash } from 'node:crypto';
import { query,quote,ROOT,PROJECT,privateJson,assertRoot } from './av2-management.mjs';
import { TRIP } from '../public/v2/config.js';
assertRoot();
const migrations=['20261005090000_agenda_viajera_v2.sql','20261005100000_av2_device_authorization.sql','20261005110000_av2_sync_validation.sql','20261005200000_av2_admin_key_rotation.sql'];
const command=process.argv[2]||'inspect';
const inventory=()=>query(readFileSync(join(ROOT,'scripts/av2-remote-precheck.sql'),'utf8'))[0].precheck;
function pending(){const applied=new Set(query('select version from supabase_migrations.schema_migrations').map(x=>x.version));return migrations.filter(name=>!applied.has(name.split('_')[0]));}
function migrationSql(names,record){return names.map(name=>{
  const sql=readFileSync(join(ROOT,'supabase/migrations',name),'utf8');
  if(/\b(?:drop\s+(?:table|schema)|truncate|delete\s+from|alter\s+table\s+(?!public\.av2_))/i.test(sql))throw Error('NON_ADDITIVE_MIGRATION');
  const version=name.split('_')[0];return sql+(record?`\ninsert into supabase_migrations.schema_migrations(version,name,statements) values(${quote(version)},${quote(name.slice(15,-4))},array[${quote(sql)}]);`:'');
}).join('\n');}
if(command==='inspect'){
  const state=inventory();privateJson('remote-precheck.json',state);console.log(JSON.stringify({project:PROJECT,...state,pending_av2:pending()}));
}else if(command==='dry-run'||command==='apply'){
  const names=pending();if(!names.length){console.log('No pending av2 migrations.');process.exit(0);}
  const before=inventory();if(command==='apply'&&names.includes(migrations[0])&&before.av2_tables.length)throw Error('UNTRACKED_AV2_SCHEMA_REQUIRES_REVIEW');
  query(`begin;set local lock_timeout='5s';${migrationSql(names,command==='apply')}\n${command==='apply'?'commit':'rollback'};`);
  const after=inventory();if(before.legacy_tables!==after.legacy_tables)throw Error('LEGACY_TABLE_INVENTORY_CHANGED');
  privateJson(`remote-${command}.json`,{at:new Date().toISOString(),project:PROJECT,migrations:names,before,after});
  console.log(JSON.stringify({command,migrations:names,legacy_tables_before:before.legacy_tables,legacy_tables_after:after.legacy_tables,av2_tables:after.av2_tables.length}));
}else if(command==='provision-root'){
  const ownerEmail=process.env.AV2_OWNER_EMAIL;if(!ownerEmail)throw Error('AV2_OWNER_EMAIL_REQUIRED');
  const owners=query(`select id from auth.users where lower(email)=lower(${quote(ownerEmail)})`);if(owners.length!==1)throw Error('OWNER_AUTH_IDENTITY_NOT_UNIQUE');
  if(query(`select id from public.av2_devices where trip_id=${quote(TRIP.id)} and role='ROOT_DEVICE'`).length)throw Error('ROOT_ALREADY_PROVISIONED');
  const token=randomBytes(32).toString('hex'),hash=createHash('sha256').update(token).digest('hex');
  query(`begin;insert into public.av2_trip_users(trip_id,user_id,role) values(${quote(TRIP.id)},${quote(owners[0].id)},'OWNER') on conflict(trip_id,user_id) do nothing;
    insert into public.av2_root_claims(trip_id,user_id,token_hash,expires_at) values(${quote(TRIP.id)},${quote(owners[0].id)},decode(${quote(hash)},'hex'),now()+interval '24 hours') on conflict(trip_id) do update set token_hash=excluded.token_hash,expires_at=excluded.expires_at where av2_root_claims.consumed_at is null;commit;`);
  privateJson('root-claim.json',{trip_id:TRIP.id,token,expires_at:new Date(Date.now()+86400000).toISOString()});console.log('Owner provisioned; one-use PC Casa claim saved privately (24-hour expiration).');
}else throw Error('UNKNOWN_REMOTE_COMMAND');
