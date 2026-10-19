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
 await page.goto('/v2/#budget');if(!await page.locator('.fx-details').evaluate(e=>e.open))await page.locator('.fx-details summary').click();await expect(page.getByText(/€1\.00 EUR = \$1\.100000 USD/)).toBeVisible();
 const create=async(description,currency,amount,status)=>{await page.goto('/v2/#expense/new');await page.getByLabel('Descripción',{exact:true}).fill(description);await page.getByLabel('Monto',{exact:true}).fill(String(amount));await page.getByLabel('Moneda',{exact:true}).fill(currency);await page.getByLabel('Estado').selectOption(status);await page.getByRole('button',{name:'Guardar gasto'}).click();await expect(page.getByRole('heading',{name:description,exact:true})).toBeVisible();};
 await create('QA paid EUR','EUR',100,'PAID');await create('QA estimate EUR','EUR',50,'ESTIMATED');eur=1.2;
 await page.goto('/v2/#budget');if(!await page.locator('.fx-details').evaluate(e=>e.open))await page.locator('.fx-details summary').click();await page.getByRole('button',{name:'Actualizar tasas'}).click();await expect(page.getByText(/€1\.00 EUR = \$1\.200000 USD/)).toBeVisible();
 await expect(page.locator('.stat strong').nth(0)).toHaveText(/110.00/);await expect(page.locator('.stat strong').nth(1)).toHaveText(/60.00/);
 await page.getByRole('button',{name:'Monedas originales'}).click();await expect(page.getByRole('row',{name:/EUR/})).toContainText('100.00');await expect(page.getByRole('row',{name:/EUR/})).toContainText('50.00');
 await page.getByRole('button',{name:'USD consolidado'}).click();await page.locator('a[href="#expenses"]').click();await page.locator('.expense-row').filter({has:page.getByRole('heading',{name:'QA paid EUR',exact:true})}).click();
 await page.getByText('Más detalles',{exact:true}).click();await page.getByLabel('Cargo real en USD').fill('120');await page.getByRole('button',{name:'Guardar gasto'}).click();await expect(page.getByRole('heading',{name:'QA paid EUR',exact:true})).toBeVisible();await page.goto('/v2/#budget');if(!await page.locator('.fx-details').evaluate(e=>e.open))await page.locator('.fx-details summary').click();await expect(page.locator('.stat strong').nth(0)).toHaveText(/120.00/);
 await page.getByRole('button',{name:'Configurar presupuesto'}).click();await page.getByLabel('Presupuesto en USD').fill('300');await page.getByRole('button',{name:'Guardar presupuesto'}).click();await expect(page.getByText(/Disponible libre: \$120\.00/)).toBeVisible();
 await context.setOffline(true);await expect(page.getByText(/Caché/).first()).toBeVisible();const before=calls;await create('QA offline CHF','CHF',10,'ESTIMATED');expect(calls).toBe(before);
 await page.goto('/v2/#budget');if(!await page.locator('.fx-details').evaluate(e=>e.open))await page.locator('.fx-details summary').click();await expect(page.locator('.stat strong').nth(1)).toHaveText(/74.00/);await page.getByRole('button',{name:'Monedas originales'}).click();await expect(page.getByRole('row',{name:/CHF/})).toContainText('10.00');
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
 await page.route('**/functions/v1/av2-google-token',route=>{const action=route.request().postDataJSON().action;return route.fulfill({status:action==='status'?200:409,contentType:'application/json',body:JSON.stringify(action==='status'?{configured:false}:{error:'GOOGLE_REAUTH_REQUIRED'})});});
 await page.route('https://cslludzuejkhsydqiabx.supabase.co/rest/v1/rpc/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(route.request().url().endsWith('av2_device_status')?'ACTIVE':[])}));
 let inspected=false;
 const inspect=async()=>{
  await page.evaluate(()=>document.querySelector('[data-action=sync]').click());await expect(page.locator('#notice')).toContainText('autorización Google expiró');
  const state=await page.evaluate(async()=>{const{LocalStore}=await import('/v2/store.js');const{GoogleAuthorization}=await import('/v2/google-auth.js');const{GoogleSource}=await import('/v2/google.js');const s=await new LocalStore().open(),auth=new GoogleAuthorization(s),google=new GoogleSource(()=>auth.token());const blocked=[];for(const path of ['calendar/v3/colors','drive/v3/files'])try{await google.api(path);blocked.push(false);}catch(e){blocked.push(e.message.includes('expiró'));}return{blocked,records:await s.all('records'),reauth:(await s.get('meta','google-reauth'))?.value};});
  expect(state.blocked).toEqual([true,true]);expect(state.reauth).toBe(true);expect(state.records[0].data.text).toBe('preserve offline');inspected=true;
 };
 await context.route('https://cslludzuejkhsydqiabx.supabase.co/auth/v1/authorize**',route=>route.fulfill({contentType:'text/html',body:'<h1>QA authorization reached</h1>'}));
 await page.goto('/v2/#sync');await expect(page.locator('#notice')).toContainText('autorización Google expiró');await inspect();await page.locator('[data-action=google]').click();await expect(page.getByRole('heading',{name:'QA authorization reached'})).toBeVisible();expect(inspected).toBe(true);
});

test('financial missing-cost review and PURCHASE_ID remain clear offline with local imagery',async({page,context})=>{
 await page.goto('/v2/#home');await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
 await page.evaluate(async()=>{const{LocalStore}=await import('/v2/store.js');const{normalizeEvent}=await import('/v2/domain.js');const s=await new LocalStore().open(),base={summary:'✅ UA combined',start:{date:'2026-10-20'},end:{date:'2026-10-21'},description:'[AGENDA_VIAJERA] PURCHASE_ID=UA_QA COST=200 CURRENCY=USD COST_STATUS=PAID [/AGENDA_VIAJERA]'};for(const raw of [{...base,id:'departure'},{...base,id:'arrival'},{...base,id:'missing',summary:'☐ Train',description:''}])await s.put('events',normalizeEvent(raw));});
 await page.goto('/v2/#budget');await expect(page.locator('.stat strong').first()).toHaveText('$200.00');await expect(page.getByText('Presupuesto incompleto',{exact:true})).toBeVisible();await expect(page.getByText(/Hay 1 eventos/)).toBeVisible();await page.getByRole('link',{name:/Revisar/}).click();await expect(page.getByRole('heading',{name:'Costos por completar'})).toBeVisible();await expect(page.getByRole('heading',{name:'☐ Train'})).toBeVisible();
 await page.goto('/v2/#event/departure');await expect(page.getByText(/Parte de una compra conjunta/)).toBeVisible();await expect(page.getByText('Todo el día',{exact:true}).first()).toBeVisible();
 expect(await page.locator('nav a').allTextContents()).toEqual(['Inicio','Itinerario','Mapa','Documentos','Más']);await context.setOffline(true);try{await page.goto('/v2/#home');await expect(page.getByRole('heading',{name:'Italia 2026',exact:true})).toBeVisible();await expect.poll(()=>page.locator('.travel-hero img').evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);await page.goto('/v2/#financial-audit');await expect(page.getByRole('cell',{name:'UA_QA',exact:true})).toHaveCount(2);await expect(page.getByRole('cell',{name:/DUPLICATE_PURCHASE/})).toHaveCount(2);}finally{await context.setOffline(false);}
});

test('foreground and reconnect refresh external Calendar COST in-place and immediately recalculate budget',async({page,context})=>{
 const expires=Math.floor(Date.now()/1000)+3600,user={id:'10000000-0000-4000-8000-000000000001'},jwt=[Buffer.from('{"alg":"HS256"}').toString('base64url'),Buffer.from(JSON.stringify({sub:user.id,role:'authenticated',aud:'authenticated',exp:expires})).toString('base64url'),'qa'].join('.');
 await context.addInitScript(session=>{localStorage.setItem('av2.auth',JSON.stringify(session));globalThis.__av2Ready=new Promise(resolve=>{const r=indexedDB.open('agenda-viajera-v2',2);r.onupgradeneeded=()=>{for(const name of ['records','events','outbox','conflicts','meta','blobs'])r.result.createObjectStore(name,{keyPath:'id'});};r.onsuccess=()=>{const db=r.result,tx=db.transaction(['meta','records','blobs'],'readwrite');tx.objectStore('meta').put({id:'authorized',value:true});tx.objectStore('records').put({id:'offline-expense',kind:'expenses',data:{amount:9,currency:'USD',cost_status:'PAID',description:'Preserved expense'},deleted_at:null});tx.objectStore('blobs').put({id:'offline-document',blob:new Blob(['preserved'])});tx.oncomplete=()=>{db.close();resolve();};};});},{access_token:jwt,refresh_token:'qa',provider_token:'qa-token',expires_at:expires,user});
 await page.route('**/v2/app.js',r=>r.fulfill({contentType:'application/javascript',body:'await globalThis.__av2Ready;\n'+readFileSync(new URL('../public/v2/app.js',import.meta.url),'utf8')}));
 await page.route('https://api.frankfurter.dev/**',r=>r.fulfill({status:503,body:''}));await page.route('https://cslludzuejkhsydqiabx.supabase.co/rest/v1/rpc/**',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(r.request().url().endsWith('av2_device_status')?'ACTIVE':[])}));
 await page.route('**/functions/v1/av2-google-token',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({rows:[]})}));
 let cost=100,reads=0;const urls=[];await page.route('https://www.googleapis.com/**',r=>{const url=r.request().url();urls.push(url);let data;if(url.includes('/colors'))data={event:{}};else if(url.includes('/events?')){reads++;data={items:['departure','arrival'].map(id=>({id,summary:'✅ United',description:`[AGENDA_VIAJERA] COST=${cost} CURRENCY=USD COST_STATUS=PAID PURCHASE_ID=UA_A4FM57 [/AGENDA_VIAJERA]`,start:{date:'2026-10-20'},end:{date:'2026-10-21'}})),nextSyncToken:'qa-token-'+reads};}else if(url.includes('drive/v3/files'))data={files:[]};else data={timeZone:'Europe/Rome',labelProperties:{eventLabels:[]}};return r.fulfill({contentType:'application/json',body:JSON.stringify(data)});});
  await page.goto('/v2/#budget');await expect(page.locator('.stat strong').first()).toHaveText('$109.00');await expect(page.locator('#connection')).toContainText('Conectado y sincronizado');cost=765.35;
 await page.evaluate(async()=>{const{LocalStore}=await import('/v2/store.js');const s=await new LocalStore().open(),last=await s.get('meta','calendar-sync');await s.put('meta',{...last,synced_at:new Date(0).toISOString()});document.dispatchEvent(new Event('visibilitychange'));});await expect(page.locator('.stat strong').first()).toHaveText('$774.35');expect(urls.some(u=>u.includes('syncToken=qa-token-'))).toBe(true);
 const before=reads;await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await page.waitForTimeout(100);expect(reads).toBe(before);
 cost=800;await context.setOffline(true);await expect(page.locator('#connection')).toContainText('datos locales disponibles');await context.setOffline(false);await expect(page.locator('.stat strong').first()).toHaveText('$809.00');await expect(page.locator('#connection')).toContainText('Conectado y sincronizado');
 const local=await page.evaluate(async()=>{const{LocalStore}=await import('/v2/store.js');const s=await new LocalStore().open();return{events:(await s.all('events')).length,expense:(await s.get('records','offline-expense')).data.amount,document:!!await s.get('blobs','offline-document')};});expect(local).toEqual({events:2,expense:9,document:true});
});

test('mobile unified budget chart drills into category/status and phase without negative free balance',async({page,context})=>{
 await page.setViewportSize({width:390,height:844});await context.route('https://api.frankfurter.dev/**',r=>r.abort());await page.goto('/v2/?fixture=1');
 await page.evaluate(async()=>{const{LocalStore}=await import('/v2/store.js');const s=await new LocalStore().open();await s.mutate('expenses',crypto.randomUUID(),{description:'Equipo antes del viaje',category:'Equipo de viaje',amount:30,currency:'USD',cost_status:'PAID',date:'2026-10-19'});await s.mutate('expenses',crypto.randomUUID(),{description:'Equipo pendiente',category:'Equipo de viaje',amount:20,currency:'USD',cost_status:'ESTIMATED',date:'2026-10-20'});const rows=await s.all('records');await s.mutate('budgets',rows.find(r=>r.kind==='budgets')?.id||crypto.randomUUID(),{amount:40,currency:'USD'});});
 await page.goto('/v2/#budget');await expect(page.locator('.budget-donut')).toBeVisible();await expect(page.getByText('Sobre presupuesto $10.00',{exact:true})).toBeVisible();await expect(page.getByText('Disponible libre:',{exact:false})).toContainText('$0.00');
 await page.getByRole('button',{name:'Equipo de viaje $30.00',exact:true}).click();await expect(page.locator('#budget-slice-detail')).toContainText('75.0%');await page.getByRole('button',{name:'Ver gastos',exact:true}).click();await expect(page.getByRole('heading',{name:'Equipo antes del viaje'})).toBeVisible();await expect(page.getByRole('heading',{name:'Equipo pendiente'})).toHaveCount(0);
 await page.goto('/v2/#budget');await page.getByRole('button',{name:'Pre-viaje',exact:true}).click();await expect(page.locator('.estimated-stat strong')).toHaveText('$0.00');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
