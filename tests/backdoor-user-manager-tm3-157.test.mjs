import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const migration=await readFile(new URL('../supabase/migrations/20260924150000_agenda_viajera_backdoor_manager.sql',import.meta.url),'utf8');
const grantMigration=await readFile(new URL('../supabase/migrations/20260924160000_agenda_viajera_backdoor_service_grant.sql',import.meta.url),'utf8');
const edge=await readFile(new URL('../supabase/functions/admin-user-management/index.ts',import.meta.url),'utf8');
const security=await readFile(new URL('../public/src/services/accountSecurity.js',import.meta.url),'utf8');
const users=await readFile(new URL('../public/src/app/render/renderAdminUsers.js',import.meta.url),'utf8');
const permissions=await readFile(new URL('../public/src/auth/permissions.js',import.meta.url),'utf8');
const qa=await readFile(new URL('../scripts/qa-backdoor.mjs',import.meta.url),'utf8');
const main=await readFile(new URL('../public/src/app/main.js',import.meta.url),'utf8');

test('backdoor is server-side and scoped to USER_MANAGER_ONLY',()=>{
  assert.match(edge,/BACKDOOR_PIN_HASH/);assert.match(edge,/USER_MANAGER_ONLY/);assert.match(edge,/ensureBackdoorUser/);assert.match(security,/verify_backdoor_login/);
  assert.match(users,/data-user-manager-root/);assert.match(users,/data-admin-user-form/);assert.match(users,/data-role-permission/);assert.match(users,/data-user-row/);assert.match(users,/data-add-user/);assert.match(users,/data-user-name/);assert.match(users,/data-user-pin/);assert.match(users,/data-user-role/);assert.match(users,/data-user-status/);assert.match(users,/data-user-trips/);assert.match(users,/data-user-save/);assert.match(users,/data-user-delete/);assert.match(users,/data-role-permission-save/);assert.match(users,/data-user-pin-confirm/);assert.doesNotMatch(users,/name="email"|name="password"|invite/i);
  for(const stage of ['manager_loaded','add_user_opened','user_created','user_login','permission_changed','admin_created','user_deleted'])assert.match(qa,new RegExp(`'${stage}'`));assert.match(qa,/requests_4xx_5xx/);assert.match(qa,/data-user-manager-root/);assert.doesNotMatch(qa,/getByRole|getByText|hasText/);
  assert.match(main,/data-user-logout/);assert.match(main,/data-pin-input/);assert.match(main,/data-pin-submit/);
});
test('backdoor config keeps RLS and is writable only by service_role',()=>{
  assert.match(migration,/enable row level security/);assert.match(migration,/revoke all on public\.av_backdoor_config from anon, authenticated/);
  assert.match(grantMigration,/grant select, insert, update, delete on table public\.av_backdoor_config to service_role/);
  assert.match(edge,/createClient\(url,service\)/);assert.doesNotMatch(security,/SUPABASE_SERVICE_ROLE_KEY|service_role/);
});
test('role matrix is persisted and backend-compatible',()=>{
  assert.match(migration,/av_role_permissions/);assert.match(migration,/av_messages.*sender_name/s);assert.match(edge,/CanChat/);assert.match(edge,/CanEditAgenda/);assert.match(permissions,/chatWrite/);
});
test('manager supports delete and technical bridge remains invisible',()=>{
  assert.match(edge,/delete_internal_user/);assert.match(edge,/sender_name:name/);assert.match(edge,/auth\.admin\.deleteUser/);assert.match(users,/admin-delete-user/);
});
