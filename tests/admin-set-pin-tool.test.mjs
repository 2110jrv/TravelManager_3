import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const tool=await readFile('scripts/admin-set-pin.mjs','utf8');
const pkg=JSON.parse(await readFile('package.json','utf8'));

test('admin PIN tool remains hidden-input and backend-mediated',()=>{
  assert.equal(pkg.scripts['admin:set-pin'],'node scripts/admin-set-pin.mjs');
  assert.match(tool,/setRawMode/);assert.match(tool,/action:'set_pin'/);assert.match(tool,/verify_pin_login/);assert.match(tool,/auth\/v1\/verify/);assert.match(tool,/ADMIN_ID/);
  assert.doesNotMatch(tool,/SUPABASE_SERVICE_ROLE_KEY|service_role|pbkdf2\$/);
  assert.doesNotMatch(tool,/console\.log\(pin|console\.log\(confirmation/);
  assert.doesNotMatch(JSON.stringify(pkg),/admin:set-backdoor|qa:backdoor/);
});
