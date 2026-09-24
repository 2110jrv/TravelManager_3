import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const main=await readFile(new URL('../public/src/app/main.js',import.meta.url),'utf8');
const access=await readFile(new URL('../public/src/auth/permissions.js',import.meta.url),'utf8');
const agenda=await readFile(new URL('../public/src/controllers/agendaController.js',import.meta.url),'utf8');
const renderAgenda=await readFile(new URL('../public/src/app/render/renderAgenda.js',import.meta.url),'utf8');
const viewerMigration=await readFile(new URL('../supabase/migrations/20260924200000_agenda_viajera_viewer_readonly.sql',import.meta.url),'utf8');
const edge=await readFile(new URL('../supabase/functions/admin-user-management/index.ts',import.meta.url),'utf8');

test('VIEWER is read-only in UI and agenda controller',()=>{
  assert.match(access,/viewer\?false/);
  assert.match(main,/viewerReadOnlyObserver/);
  assert.match(renderAgenda,/data-action="duplicate"|data-action="cancel"/);
  assert.match(agenda,/if\(!access\.permissions\.edit\)/);
});

test('VIEWER writes are denied server-side regardless of custom permission JSON',()=>{
  assert.match(viewerMigration,/m\.role <> 'VIEWER'/);
  assert.match(viewerMigration,/CanEditAgenda/);
});

test('user deletion preserves chat snapshot and revokes access before Auth deletion',()=>{
  assert.match(main,/admin-delete-user/);
  assert.match(main,/confirm\(/);
  assert.match(main,/stopImmediatePropagation\(\)/);
  assert.match(main,/adminUserAction\('delete_internal_user'.*userId:button\.dataset\.userId/);
  assert.match(edge,/sender_name:name/);
  assert.match(edge,/access_status:'REVOKED'/);
  assert.match(edge,/status:'INACTIVE'/);
  assert.match(edge,/auth_user_id/);
  assert.match(edge,/byInternal/);
  assert.match(edge,/byAuth/);
  assert.match(edge,/internalTarget/);
  assert.match(edge,/eq\('user_id',authTarget\)/);
  assert.match(edge,/auth\.admin\.deleteUser/);
});
