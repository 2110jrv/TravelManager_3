import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { TRIP } from '../public/v2/config.js';
const db = new PGlite();
const user='10000000-0000-4000-8000-000000000001', outsider='10000000-0000-4000-8000-000000000002';
const deviceA='20000000-0000-4000-8000-000000000001',deviceB='20000000-0000-4000-8000-000000000002';
const record='30000000-0000-4000-8000-000000000001';
const op = (changes, base={}, version=0, device=deviceA, extra={}) => ({id:crypto.randomUUID(),record_id:record,kind:'expenses',base_version:version,base,changes,device_id:device,deleted_at:null,...extra});
async function call(operation) { return (await db.query('select av2_apply($1,$2::jsonb) as result',[TRIP.id,JSON.stringify(operation)])).rows[0].result; }
async function identity(id=user) { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]); await db.exec('set role authenticated'); }
before(async()=>{
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated;grant execute on function auth.uid() to authenticated;create table public.legacy_sentinel(id int primary key, value text);insert into legacy_sentinel values(1,'untouched');`);
  await db.exec(readFileSync(new URL('../supabase/migrations/20261005090000_agenda_viajera_v2.sql',import.meta.url),'utf8'));
  await db.query('insert into auth.users values($1),($2)',[user,outsider]);
  await db.query("insert into av2_trip_users(trip_id,user_id,role) values($1,$2,'OWNER')",[TRIP.id,user]);
  await db.query("insert into av2_devices(id,trip_id,user_id,name,role) values($1,$3,$4,'PC Casa','ROOT_DEVICE'),($2,$3,$4,'Celular','DEVICE')",[deviceA,deviceB,TRIP.id,user]);
  await identity();
});
after(async()=>{await db.close();});
test('migration executes in PostgreSQL and legacy sentinel is unchanged',async()=>{
  await db.exec('reset role');assert.equal((await db.query('select value from legacy_sentinel')).rows[0].value,'untouched');
  const tables=(await db.query("select tablename,rowsecurity from pg_tables where schemaname='public' and tablename like 'av2_%'")).rows;
  assert.equal(tables.length,6);assert.ok(tables.every(x=>x.rowsecurity));await identity();
});
test('authenticated RLS denies outsider and direct record mutation',async()=>{
  await identity(outsider);assert.equal((await db.query('select * from av2_trips')).rows.length,0);
  await assert.rejects(call(op({amount:1})),/AV2_DEVICE_REVOKED/);
  await assert.rejects(db.query('insert into av2_records(id) values($1)',[record]),/permission denied/);await identity();
});
test('actual SQL idempotence and two-device different-field merge',async()=>{
  const initial=op({description:'Initial',amount:10,currency:'USD',cost_status:'PAID'});
  const first=await call(initial);assert.deepEqual(await call(initial),first);
  const a=await call(op({description:'Device A'},first.record.data,first.record.version));
  const b=await call(op({amount:20},first.record.data,first.record.version,deviceB));
  assert.equal(b.conflicts.length,0);assert.equal(b.record.data.description,'Device A');assert.equal(b.record.data.amount,20);
  assert.equal(b.record.version,a.record.version+1);
});
let conflict;
test('same-field conflict keeps both values and unrelated fields merge',async()=>{
  const current=(await db.query('select * from av2_pull($1,$2,null)',[TRIP.id,deviceA])).rows[0];
  await call(op({description:'A offline'},current.data,current.version));
  const result=await call(op({description:'B offline',amount:30},current.data,current.version,deviceB));
  conflict=result.conflicts[0];assert.equal(conflict.current,'A offline');assert.equal(conflict.incoming,'B offline');assert.equal(result.record.data.description,'A offline');assert.equal(result.record.data.amount,30);
});
test('explicit resolution is durable, idempotent, and leaves audit alternatives',async()=>{
  const operation={id:crypto.randomUUID(),conflict_id:conflict.id,device_id:deviceA,choice:'incoming'};
  const resolve=async()=> (await db.query('select av2_resolve($1,$2::jsonb) as result',[TRIP.id,JSON.stringify(operation)])).rows[0].result;
  const result=await resolve();assert.equal(result.record.data.description,'B offline');assert.deepEqual(await resolve(),result);
  const conflicts=(await db.query('select * from av2_pull_conflicts($1,$2)',[TRIP.id,deviceA])).rows;
  assert.ok(conflicts[0].deleted_at);assert.equal(conflicts[0].current,'A offline');assert.equal(conflicts[0].incoming,'B offline');
});
test('stale device cannot resurrect a tombstone',async()=>{
  const current=(await db.query('select * from av2_pull($1,$2,null)',[TRIP.id,deviceA])).rows[0];
  const deleted=await call(op({},current.data,current.version,deviceA,{deleted_at:new Date().toISOString()}));
  const stale=await call(op({amount:999},current.data,current.version,deviceB));
  assert.equal(stale.record.deleted_at,deleted.record.deleted_at);assert.equal(stale.record.data.amount,30);assert.equal(stale.conflicts[0].field,'deleted_at');
});
test('document relationship survives server sync without Calendar/Drive writes',async()=>{
  const id='30000000-0000-4000-8000-000000000002';
  const result=await call(op({calendar_event_id:'calendar-event',drive_file_id:'drive-file'},{},0,deviceA,{record_id:id,kind:'document_links'}));
  const records=(await db.query('select * from av2_pull($1,$2,null)',[TRIP.id,deviceB])).rows;
  assert.deepEqual(records.find(x=>x.id===id).data,result.record.data);
});
test('ROOT_DEVICE cannot be revoked and revoked installation cannot sync, read, or self-enroll',async()=>{
  await db.exec('reset role');await assert.rejects(db.query('update av2_devices set deleted_at=now() where id=$1',[deviceA]),/AV2_ROOT_DEVICE_PROTECTED/);
  await db.query('update av2_devices set deleted_at=now() where id=$1',[deviceB]);await identity();
  await assert.rejects(call(op({}, {},0,deviceB)),/AV2_DEVICE_REVOKED/);
  await assert.rejects(db.query('select * from av2_pull($1,$2,null)',[TRIP.id,deviceB]),/AV2_DEVICE_REVOKED/);
  await assert.rejects(db.query("select av2_register_device($1,$2,'new phone')",[TRIP.id,crypto.randomUUID()]),/AV2_DEVICE_ENROLLMENT_REQUIRED/);
});
