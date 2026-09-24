import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const main=await readFile('public/src/app/main.js','utf8');
const legacy=await readFile('public/src/app2.js','utf8');
const fn=await readFile('supabase/functions/admin-user-management/index.ts','utf8');
const migration=await readFile('supabase/migrations/20260922100000_agenda_viajera_private_access.sql','utf8');

test('private login requires managed PIN and exposes no signup',()=>{
  assert.match(main,/name="pin"/);assert.match(main,/signInWithPin/);assert.match(main,/PIN nuevo de 4 dígitos/);assert.doesNotMatch(main,/name="email"|name="password"|forgot-password|send-own-reset|data-reset-request|data-recovery-password/);assert.doesNotMatch(main,/Crear cuenta/);assert.doesNotMatch(legacy,/Crear cuenta/);assert.match(legacy,/const ACCESS_PINS = Object\.freeze\(\{\}\);/);
});
test('PIN is hashed server-side and rate limited',()=>{
  assert.match(fn,/PBKDF2/);assert.match(fn,/120000/);assert.match(fn,/av_record_pin_attempt/);assert.match(migration,/failed_pin_attempts/);assert.match(migration,/pin_hash/);
});
test('privileged access stays server mediated',()=>{
  assert.match(fn,/av_admin_private_access_action_v4/);assert.match(fn,/get_user_pin/);assert.match(fn,/pin_lookup_hmac/);assert.match(fn,/pin_encrypted/);assert.match(fn,/PIN_ENCRYPTION_KEY/);assert.match(fn,/SUPABASE_SERVICE_ROLE_KEY/);assert.match(fn,/hashed_token/);assert.doesNotMatch(main,/SUPABASE_SERVICE_ROLE_KEY|service_role/);
});
test('new PINs are four digits while legacy login remains supported',()=>{
  assert.match(main,/pattern="\[0-9\]\{4,6\}"/);assert.match(fn,/validPin/);assert.match(fn,/validLoginPin/);assert.ok(fn.includes("/^\\d{4}$/.test(pin)||/^\\d{6}$/.test(pin)"));assert.doesNotMatch(fn,/PIN_MUST_BE_SIX_DIGITS/);
});
