import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const edge=await readFile(new URL('../supabase/functions/admin-user-management/index.ts',import.meta.url),'utf8');
const security=await readFile(new URL('../public/src/services/accountSecurity.js',import.meta.url),'utf8');
const main=await readFile(new URL('../public/src/app/main.js',import.meta.url),'utf8');
const migration=await readFile(new URL('../supabase/migrations/20260924170000_agenda_viajera_hidden_auth_bridge.sql',import.meta.url),'utf8');

test('internal PIN boots the matching hidden technical Auth user',()=>{
  assert.match(security,/verify_pin_login/);
  assert.doesNotMatch(security,/verify_backdoor_login|USER_MANAGER_ONLY/);
  assert.match(edge,/issueSession\(admin,access\.user_id\)/);
  assert.match(edge,/auth\.admin\.generateLink/);
  assert.match(main,/data-pin-input/);
});

test('only active internal ADMIN users can manage users and permissions',()=>{
  assert.match(edge,/isInternalAdmin/);
  assert.match(edge,/access\?\.access_status==='ACTIVE'/);
  assert.match(edge,/membership\?\.role==='ADMIN'/);
  assert.match(main,/access\.role==='ADMIN'/);
});

test('ADMIN user listing is normalized and does not expose credential material',()=>{
  assert.match(edge,/internal_user_id/);
  assert.match(edge,/access_status/);
  assert.match(edge,/pin_available/);
  assert.doesNotMatch(edge,/return \{[^}]*pin_hash/);
  assert.doesNotMatch(edge,/return \{[^}]*pin_lookup_hmac/);
});

test('technical mapping is additive and preserves existing auth uid identity',()=>{
  assert.match(migration,/auth_user_id uuid references auth\.users/);
  assert.match(migration,/set auth_user_id=id/);
  assert.match(migration,/where auth_user_id is null/);
});

test('technical credentials remain absent from the UI contract',()=>{
  assert.doesNotMatch(main,/name="email"|name="password"|admin-invite/);
  assert.doesNotMatch(security,/signInWithEmailPassword|sendPasswordReset/);
});
