import {chromium} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {assertRoot,privateJson} from './av2-management.mjs';
assertRoot();const browser=await chromium.connectOverCDP('http://127.0.0.1:9224');
try{
 const context=browser.contexts()[0];let page=context.pages().find(p=>p.url().startsWith('http://127.0.0.1:5004/v2/'));
 if(!page)throw Error('PC_PREVIEW_NOT_OPEN');
 if(process.argv.includes('--fresh-login')){
  if(!JSON.parse(readFileSync('.av2-private/google-lifecycle-evidence.json','utf8')).natural_expiration_observed)throw Error('WAIT_FOR_NATURAL_EXPIRY_FIRST');
  const old=await page.evaluate(()=>JSON.parse(localStorage.getItem('av2.auth')||'null')?.provider_token);
  await page.evaluate(async()=>{const{createClient}=await import('/vendor/supabase-client.mjs');const client=createClient('https://cslludzuejkhsydqiabx.supabase.co','sb_publishable_8k8xhMZtkay30ZB45aPjGw_4u69Dp0U',{auth:{storageKey:'av2.auth',flowType:'pkce',detectSessionInUrl:false}});const{error}=await client.auth.signOut({scope:'local'});if(error)throw error;if((await client.auth.getSession()).data.session)throw Error('SIGNOUT_FAILED');});
  const closed=page;page=await context.newPage();await closed.close();await page.bringToFront();
  await page.goto('http://127.0.0.1:5004/v2/#sync');await page.locator('[data-action=google]').click();
  try{await page.waitForURL('http://127.0.0.1:5004/v2/**',{timeout:180000});await page.waitForFunction(old=>{if(location.origin!=='http://127.0.0.1:5004')return false;const s=JSON.parse(localStorage.getItem('av2.auth')||'null');return!!s?.provider_token&&s.provider_token!==old;},old,{timeout:180000});}catch{throw Error('GOOGLE_FRESH_LOGIN_REQUIRED');}
 }
 await page.evaluate(async()=>{await(await navigator.serviceWorker.getRegistration()).update();});
 await page.waitForTimeout(600);
 if(await page.locator('#update').isVisible()){await page.locator('#update').click();await page.waitForTimeout(1200);}
 await page.reload();await page.getByRole('heading',{name:'Italia 2026',exact:true}).waitFor();
 const evidence={at:new Date().toISOString(),fresh_login:process.argv.includes('--fresh-login')};
 const check=async(route,title)=>{await page.goto(`http://127.0.0.1:5004/v2/#${route}`);await page.getByRole('heading',{name:title,exact:true}).waitFor();};
 await check('home','Italia 2026');evidence.pre_trip=await page.getByText(/La aventura todavía no comienza/).isVisible();
 await check('itinerary','Un día a la vez.');evidence.calendar_links=await page.locator('a[href^="#event/"]').count();
 await page.locator('a[href^="#event/"]').first().click();await page.locator('.detail').waitFor();evidence.event_detail=true;
 await check('budget','Presupuesto');if(!await page.locator('.fx-details').evaluate(e=>e.open))await page.locator('.fx-details summary').click();await page.getByRole('button',{name:'Actualizar tasas'}).click();
 await page.getByText(/€1\.00 EUR = .*USD/).waitFor();evidence.budget_usd=await page.locator('.stat strong').allTextContents();
 await page.getByRole('button',{name:'Monedas originales'}).click();evidence.budget_original=await page.locator('table').innerText();
 await page.getByRole('button',{name:'USD consolidado'}).click();
 await check('expenses','Gastos');await page.goto('http://127.0.0.1:5004/v2/#expense/new');await page.getByLabel('Cargo real en USD').waitFor();evidence.expense_form=true;
 await check('documents','Documentos');await page.locator('[data-action=load-documents]').click();await page.waitForTimeout(1000);evidence.documents=true;
 await check('devices','Dispositivos');await page.getByRole('link',{name:'Seguridad',exact:true}).click();await page.getByRole('heading',{name:'Seguridad',exact:true}).waitFor();evidence.admin_creation=await page.getByRole('button',{name:'Crear clave administrativa',exact:true}).isVisible();evidence.pc_root=await page.getByText('PC Casa · ROOT protegido',{exact:true}).isVisible();
 const before=await page.evaluate(async()=>{const{LocalStore}=await import('/v2/store.js');const s=await new LocalStore().open();return{device:s.device,events:(await s.all('events')).length,records:(await s.all('records')).length,snapshots:(await s.all('records')).filter(r=>!r.deleted_at&&r.data.type==='calendar_fx').length,outbox:(await s.all('outbox')).length};});
 await page.goto('http://127.0.0.1:5004/v2/#home');await context.setOffline(true);
 try{await page.reload();await page.getByRole('heading',{name:'Italia 2026',exact:true}).waitFor();await page.goto('http://127.0.0.1:5004/v2/#budget');await page.getByRole('heading',{name:'Presupuesto',exact:true}).waitFor();if(!await page.locator('.fx-details').evaluate(e=>e.open))await page.locator('.fx-details summary').click();await page.getByText(/Caché/).first().waitFor({state:'visible'});evidence.offline_cache_visible=true;}
 finally{await context.setOffline(false);}
 await page.goto('http://127.0.0.1:5004/v2/#sync');await page.locator('[data-action=sync]').click();await page.waitForTimeout(2500);
 const after=await page.evaluate(async()=>{const{LocalStore}=await import('/v2/store.js');const s=await new LocalStore().open();return{device:s.device,events:(await s.all('events')).length,records:(await s.all('records')).length,snapshots:(await s.all('records')).filter(r=>!r.deleted_at&&r.data.type==='calendar_fx').length,outbox:(await s.all('outbox')).length};});
 if(before.device!==after.device||before.events!==after.events||before.snapshots!==after.snapshots)throw Error('RECONNECT_CHANGED_IDENTITIES_OR_DUPLICATED_SNAPSHOTS');
 evidence.persistence={before,after};const cdp=await context.newCDPSession(page);evidence.installability=await cdp.send('Page.getInstallabilityErrors');
 privateJson('preuser-evidence.json',evidence);if(evidence.fresh_login)privateJson('fresh-login-evidence.json',evidence);console.log(JSON.stringify(evidence));await page.goto('http://127.0.0.1:5004/v2/#home');
}finally{await browser.close();}
