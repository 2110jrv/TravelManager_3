import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const tool=await readFile('scripts/admin-set-pin.mjs','utf8');
const backdoorTool=await readFile('scripts/admin-set-backdoor.mjs','utf8');
const pkg=JSON.parse(await readFile('package.json','utf8'));

test('admin PIN tool is one-command, hidden-input and backend-mediated',()=>{
  assert.equal(pkg.scripts['admin:set-pin'],'node scripts/admin-set-pin.mjs');
  assert.match(tool,/setRawMode/);assert.match(tool,/action:'set_pin'/);assert.match(tool,/verify_pin_login/);assert.match(tool,/auth\/v1\/verify/);assert.match(tool,/ADMIN_ID/);
  assert.doesNotMatch(tool,/SUPABASE_SERVICE_ROLE_KEY|service_role/);assert.doesNotMatch(tool,/pbkdf2\$/);assert.doesNotMatch(tool,/console\.log\(pin|console\.log\(confirmation/);
});

test('backdoor tool is hidden-input and Windows-safe',()=>{
  assert.equal(pkg.scripts['admin:set-backdoor'],'node scripts/admin-set-backdoor.mjs');
  assert.match(backdoorTool,/BACKDOOR_PIN_HASH/);assert.match(backdoorTool,/npx\.cmd/);assert.match(backdoorTool,/shell:process\.platform==='win32'/);assert.match(backdoorTool,/stdio:\['inherit','pipe','pipe'\]/);
  assert.doesNotMatch(backdoorTool,/stdio:'ignore'|stdio:"ignore"/);assert.doesNotMatch(backdoorTool,/console\.log\(pin|console\.log\(confirmation/);assert.match(backdoorTool,/setRawMode/);
});
