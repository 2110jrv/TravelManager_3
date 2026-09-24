import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {renderSettings} from '../public/src/app/render/renderSettings.js';
import {renderAdminUsers} from '../public/src/app/render/renderAdminUsers.js';

test('TM3-120 visual/admin surfaces expose secure controls',()=>{
  const settings=renderSettings({profile:{display_name:'Jonathan'},authUser:{email:'admin@example.com'},access:{role:'ADMIN',deviceState:'TRUSTED'},trip:{name:'Italy October/November 2026'}});
  assert.doesNotMatch(settings,/Cambiar mi contraseña|Enviar enlace de recuperación/);assert.match(settings,/Recuperación WhatsApp/);assert.match(settings,/Usuarios/);assert.match(settings,/solo puede asignarlo o restablecerlo un administrador/);assert.doesNotMatch(settings,/password.*value=/i);
  const users=renderAdminUsers([{id:'u',display_name:'Traveler',email:'t@example.com',membership:{role:'TRAVELER',status:'ACTIVE'},devices:[]}]);
  assert.match(users,/Buscar por nombre/);assert.match(users,/Asignar PIN/);assert.match(users,/Ver PIN/);assert.match(users,/4 dígitos/);assert.doesNotMatch(users,/contraseña actual/i);
});

test('TM3-120 never ships service_role in browser assets',()=>{
  const files=['public/src/app/main.js','public/src/services/accountSecurity.js','public/src/app/render/renderSettings.js','public/src/app/render/renderAdminUsers.js'];
  for(const file of files)assert.doesNotMatch(fs.readFileSync(file,'utf8'),/service_role|SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(fs.readFileSync('supabase/functions/admin-user-management/index.ts','utf8'),/SUPABASE_SERVICE_ROLE_KEY/);
});
