import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const main=await readFile(new URL('../public/src/app/main.js',import.meta.url),'utf8');
const runtime=await readFile(new URL('../public/src/services/remoteRuntime.js',import.meta.url),'utf8');

test('production boot is auth-gated and uses real Supabase password login',()=>{
  assert.match(main,/signInWithEmailPassword/);
  assert.match(main,/data-login-form/);
  assert.match(main,/if\(!authReady\)\{renderLogin\(\);return\}/);
  assert.match(main,/av_trip_memberships/);
  assert.match(main,/Italy October\/November 2026/);
});

test('production boot does not auto-start remote sync before authentication',()=>{
  assert.doesNotMatch(runtime,/setTimeout\(initRemoteRuntime/);
  assert.match(main,/initRemoteRuntime\(\)/);
  assert.match(main,/await getCurrentSession\(\)/);
});

test('login surface contains no test labels or credential hints',()=>{
  for(const label of ['Admin Test','Traveler Test','Viewer Test','Outsider Test','.env.test.local','PIN legacy'])assert.doesNotMatch(main,new RegExp(label.replace('.', '\\.'),'i'));
});
