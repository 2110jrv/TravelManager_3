import {test,expect} from '@playwright/test';
import {pbkdf2Sync,createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';

test('ROOT security creates a salted key, requires current proof for rotation, and never persists plaintext',async({page,context})=>{
 const owner='10000000-0000-4000-8000-000000000001',expires=Math.floor(Date.now()/1000)+3600;
 const jwt=[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:owner,role:'authenticated',aud:'authenticated',exp:expires})).toString('base64url'),'qa-only'].join('.');
 await context.addInitScript(session=>localStorage.setItem('av2.auth',JSON.stringify(session)),{access_token:jwt,refresh_token:'qa-only',expires_at:expires,expires_in:3600,token_type:'bearer',user:{id:owner}});
 await context.addInitScript(()=>{globalThis.__av2Ready=new Promise(resolve=>{const request=indexedDB.open('agenda-viajera-v2',2);request.onupgradeneeded=()=>{for(const name of ['records','events','outbox','conflicts','meta','blobs'])request.result.createObjectStore(name,{keyPath:'id'});};request.onsuccess=()=>{const db=request.result,tx=db.transaction('meta','readwrite');tx.objectStore('meta').put({id:'authorized',value:true});tx.oncomplete=()=>{db.close();resolve();};};});});
 await page.route('**/v2/app.js',route=>route.fulfill({contentType:'application/javascript',body:'await globalThis.__av2Ready;\n'+readFileSync(new URL('../public/v2/app.js',import.meta.url),'utf8')}));
 let configured=false,role='ROOT_DEVICE',saved=null,challengeNumber=0;const payloads=[];
 await page.route('https://api.frankfurter.dev/**',route=>route.fulfill({status:503,body:''}));
 await page.route('https://cslludzuejkhsydqiabx.supabase.co/**',async route=>{
  const name=new URL(route.request().url()).pathname.split('/').at(-1),args=route.request().postDataJSON()||{};
  let result=null;
  if(name==='av2_device_status')result='ACTIVE';
  else if(name==='av2_list_devices')result=[{id:args.p_device,name:'QA PC Casa',role,deleted_at:null}];
  else if(name==='av2_admin_key_status')result=configured;
  else if(name==='av2_sync_pull'||name==='av2_sync_conflicts')result=[];
  else if(name==='av2_set_admin_key'){payloads.push(args);saved=args;configured=true;}
  else if(name==='av2_admin_challenge')result={id:`qa-challenge-${++challengeNumber}`,salt:saved.p_salt,iterations:600000,message:`qa:${challengeNumber}:${args.p_action}`};
  else if(name==='av2_change_admin_key'){
   payloads.push(args);const correct=createHmac('sha256',Buffer.from(saved.p_verifier,'hex')).update(`qa:${challengeNumber}:change-key`).digest('hex');
   result=args.p_proof===correct?{ok:true}:{error:'AV2_ADMIN_PROOF_INVALID'};if(result.ok)saved=args;
  }
  await route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
 });
 await page.goto('/v2/#security');await expect(page.getByRole('heading',{name:'Crear clave administrativa'})).toBeVisible();
 const initial='QA-secret-initial',next='QA-secret-next';
 await page.getByLabel('Nueva clave administrativa',{exact:true}).fill(initial);await page.getByLabel('Confirmar nueva clave').fill(initial);await page.getByRole('button',{name:'Crear clave administrativa'}).click();
 await expect(page.getByRole('heading',{name:'Cambiar clave administrativa'})).toBeVisible();
 expect(saved.p_verifier).toBe(pbkdf2Sync(initial,Buffer.from(saved.p_salt,'hex'),600000,32,'sha256').toString('hex'));
 await page.getByLabel('Clave actual',{exact:true}).fill('QA-incorrect');await page.getByLabel('Nueva clave administrativa',{exact:true}).fill(next);await page.getByLabel('Confirmar nueva clave').fill(next);await page.getByRole('button',{name:'Cambiar clave administrativa'}).click();
 await expect(page.getByText('La clave actual no es correcta.')).toBeVisible();await expect(page.getByLabel('Clave actual',{exact:true})).toHaveValue('');
 await page.getByLabel('Clave actual',{exact:true}).fill(initial);await page.getByLabel('Nueva clave administrativa',{exact:true}).fill(next);await page.getByLabel('Confirmar nueva clave').fill(next);await page.getByRole('button',{name:'Cambiar clave administrativa'}).click();
 await expect(page.getByLabel('Clave actual',{exact:true})).toHaveValue('');expect(saved.p_verifier).toBe(pbkdf2Sync(next,Buffer.from(saved.p_salt,'hex'),600000,32,'sha256').toString('hex'));
 const persisted=await page.evaluate(async()=>{const{LocalStore}=await import('/v2/store.js');const s=await new LocalStore().open();return JSON.stringify({meta:await s.all('meta'),records:await s.all('records'),storage:{...localStorage}});});
 for(const secret of [initial,next]){expect(persisted).not.toContain(secret);expect(JSON.stringify(payloads)).not.toContain(secret);}
 role='DEVICE';await page.goto('/v2/#devices');await expect(page.getByRole('heading',{name:'Dispositivos',exact:true})).toBeVisible();expect(await page.locator('input[type=password]').count()).toBe(0);
 await page.getByRole('button',{name:'Agregar dispositivo'}).click();await expect(page.getByLabel('Clave administrativa',{exact:true})).toBeVisible();
});

test('budget toggles original currencies, updates estimates, freezes payments, and uses cached FX offline',async({page,context})=>{
 let eur=1.1;let calls=0;const date=new Date().toISOString().slice(0,10);
 await page.route('https://api.frankfurter.dev/**',route=>{calls++;const currency=new URL(route.request().url()).pathname.split('/').at(-2);return route.fulfill({contentType:'application/json',body:JSON.stringify({base:currency,quote:'USD',date,rate:currency==='EUR'?eur:1.4})});});
 await page.goto('/v2/#budget');await expect(page.getByText(/1 EUR = 1.100000 USD/)).toBeVisible();
 const create=async(description,currency,amount,status)=>{await page.goto('/v2/#expense/new');await page.getByLabel('Descripción',{exact:true}).fill(description);await page.getByLabel('Importe original').fill(String(amount));await page.getByLabel('Moneda ISO').fill(currency);await page.getByLabel('Estado').selectOption(status);await page.getByRole('button',{name:'Guardar gasto'}).click();await expect(page.getByRole('heading',{name:description,exact:true})).toBeVisible();};
 await create('QA paid EUR','EUR',100,'PAID');await create('QA estimate EUR','EUR',50,'ESTIMATED');eur=1.2;
 await page.goto('/v2/#budget');await page.getByRole('button',{name:'Actualizar tasas'}).click();await expect(page.getByText(/1 EUR = 1.200000 USD/)).toBeVisible();
 await expect(page.locator('.stat strong').nth(0)).toHaveText(/110,00/);await expect(page.locator('.stat strong').nth(1)).toHaveText(/60,00/);
 await page.getByRole('button',{name:'Monedas originales'}).click();await expect(page.getByRole('row',{name:/EUR/})).toContainText('100,00');await expect(page.getByRole('row',{name:/EUR/})).toContainText('50,00');
 await page.getByRole('button',{name:'USD consolidado'}).click();await page.locator('a[href="#expenses"]').click();await page.locator('.list-row').filter({has:page.getByRole('heading',{name:'QA paid EUR',exact:true})}).getByRole('link').click();
 await page.getByLabel('Cargo real en USD').fill('120');await page.getByRole('button',{name:'Guardar gasto'}).click();await expect(page.getByRole('heading',{name:'QA paid EUR',exact:true})).toBeVisible();await page.goto('/v2/#budget');await expect(page.locator('.stat strong').nth(0)).toHaveText(/120,00/);
 await page.getByRole('button',{name:'Configurar presupuesto'}).click();await page.getByLabel('Presupuesto en USD').fill('300');await page.getByRole('button',{name:'Guardar presupuesto'}).click();await expect(page.getByText(/Disponible proyectado: 120,00/)).toBeVisible();
 await context.setOffline(true);await expect(page.getByText(/Caché/).first()).toBeVisible();const before=calls;await create('QA offline CHF','CHF',10,'ESTIMATED');expect(calls).toBe(before);
 await page.goto('/v2/#budget');await expect(page.locator('.stat strong').nth(1)).toHaveText(/74,00/);await page.getByRole('button',{name:'Monedas originales'}).click();await expect(page.getByRole('row',{name:/CHF/})).toContainText('10,00');
 const paid=await page.evaluate(async()=>{const{LocalStore}=await import('/v2/store.js');const s=await new LocalStore().open();return(await s.all('records')).find(r=>r.data.description==='QA paid EUR').data;});expect(paid.fx_rate_to_base).toBe(1.1);expect(paid.amount_original).toBe(100);expect(paid.actual_base_amount).toBe(120);expect(paid.rate_date).toBe(date);
 await context.setOffline(false);
});

test('expired Google UI preserves offline data and Calendar/Drive block until reauth before authorization navigation',async({page,context})=>{
 const expires=Math.floor(Date.now()/1000)+3600,user={id:'10000000-0000-4000-8000-000000000001'};
 const jwt=[Buffer.from('{"alg":"HS256"}').toString('base64url'),Buffer.from(JSON.stringify({sub:user.id,role:'authenticated',aud:'authenticated',exp:expires})).toString('base64url'),'qa'].join('.');
 await context.addInitScript(session=>{localStorage.setItem('av2.auth',JSON.stringify(session));globalThis.__av2Ready=new Promise(resolve=>{const r=indexedDB.open('agenda-viajera-v2',2);r.onupgradeneeded=()=>{for(const name of ['records','events','outbox','conflicts','meta','blobs'])r.result.createObjectStore(name,{keyPath:'id'});};r.onsuccess=()=>{const db=r.result,tx=db.transaction(['meta','records'],'readwrite');tx.objectStore('meta').put({id:'authorized',value:true});tx.objectStore('records').put({id:'offline-note',kind:'notes',data:{text:'preserve offline'},deleted_at:null});tx.oncomplete=()=>{db.close();resolve();};};});},{access_token:jwt,refresh_token:'qa',provider_token:'qa-google-token',expires_at:expires,user});
 await page.route('**/v2/app.js',route=>route.fulfill({contentType:'application/javascript',body:'await globalThis.__av2Ready;\n'+readFileSync(new URL('../public/v2/app.js',import.meta.url),'utf8')}));
 await page.route('https://api.frankfurter.dev/**',route=>route.fulfill({status:503,body:''}));
 await page.route('https://www.googleapis.com/**',route=>route.fulfill({status:401,body:''}));
 await page.route('https://cslludzuejkhsydqiabx.supabase.co/rest/v1/rpc/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(route.request().url().endsWith('av2_device_status')?'ACTIVE':[])}));
 let inspected=false;
 const inspect=async()=>{
  await page.evaluate(()=>document.querySelector('[data-action=sync]').click());await expect(page.locator('#notice')).toContainText('autorización Google expiró');
  const state=await page.evaluate(async()=>{const{LocalStore}=await import('/v2/store.js');const{GoogleAuthorization}=await import('/v2/google-auth.js');const{GoogleSource}=await import('/v2/google.js');const s=await new LocalStore().open(),auth=new GoogleAuthorization(s),google=new GoogleSource(()=>auth.token());const blocked=[];for(const path of ['calendar/v3/colors','drive/v3/files'])try{await google.api(path);blocked.push(false);}catch(e){blocked.push(e.message.includes('expiró'));}return{blocked,records:await s.all('records'),reauth:(await s.get('meta','google-reauth'))?.value};});
  expect(state.blocked).toEqual([true,true]);expect(state.reauth).toBe(true);expect(state.records[0].data.text).toBe('preserve offline');inspected=true;
 };
 await context.route('https://cslludzuejkhsydqiabx.supabase.co/auth/v1/authorize**',route=>route.fulfill({contentType:'text/html',body:'<h1>QA authorization reached</h1>'}));
 await page.goto('/v2/#settings');await expect(page.locator('#notice')).toContainText('autorización Google expiró');await inspect();await page.locator('[data-action=google]').click();await expect(page.getByRole('heading',{name:'QA authorization reached'})).toBeVisible();expect(inspected).toBe(true);
});
