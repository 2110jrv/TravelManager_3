import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const main=await readFile('public/src/app/main.js','utf8');
const legacy=await readFile('public/src/app2.js','utf8');
const fn=await readFile('supabase/functions/admin-user-management/index.ts','utf8');
const migration=await readFile('supabase/migrations/20260922100000_agenda_viajera_private_access.sql','utf8');

test('private login requires managed PIN and exposes no signup',()=>{
  assert.match(main,/PIN de acceso/);assert.match(main,/verifyAppPin/);assert.doesNotMatch(main,/Crear cuenta/);assert.doesNotMatch(legacy,/Crear cuenta/);assert.match(legacy,/const ACCESS_PINS = Object\.freeze\(\{\}\);/);
});
test('PIN is hashed server-side and rate limited',()=>{
  assert.match(fn,/PBKDF2/);assert.match(fn,/120000/);assert.match(fn,/av_record_pin_attempt/);assert.match(migration,/failed_pin_attempts/);assert.match(migration,/pin_hash/);
});
test('privileged access stays server mediated',()=>{
  assert.match(fn,/av_admin_private_access_action/);assert.match(fn,/SUPABASE_SERVICE_ROLE_KEY/);assert.doesNotMatch(main,/SUPABASE_SERVICE_ROLE_KEY|service_role/);
});
