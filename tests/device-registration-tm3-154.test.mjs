import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const schema=await readFile('supabase/migrations/20260920090000_agenda_viajera_remote_v1.sql','utf8');
const migration=await readFile('supabase/migrations/20260924130000_agenda_viajera_multi_user_device_registration.sql','utf8');
const main=await readFile('public/src/app/main.js','utf8');
const adapter=await readFile('public/src/sync/SupabaseRemoteSyncAdapter.js','utf8');

test('device registration re-associates the global device row atomically',()=>{
  assert.match(schema,/device_id text primary key/);
  assert.match(schema,/user_id uuid references public\.av_users/);
  assert.match(migration,/av_register_device_for_session/);
  assert.match(migration,/on conflict\(device_id\) do update/);
  assert.doesNotMatch(migration,/state=excluded\.state/);
  assert.match(adapter,/av_register_device_for_session/);
});

test('post-login device errors are generic in the UI',()=>{
  assert.match(main,/av_register_device_for_session/);
  assert.match(main,/authError='No se pudo completar el acceso\.'/);
  assert.match(main,/REVOKED','BLOCKED','PURGE_PENDING/);
});
