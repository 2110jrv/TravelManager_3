import {chromium} from '@playwright/test';import assert from 'node:assert/strict';
import {assertRoot,privateJson} from './av2-management.mjs';assertRoot();
const browser=await chromium.connectOverCDP('http://127.0.0.1:9224');
try{
 const context=browser.contexts()[0];let page=context.pages().find(p=>p.url().startsWith('http://127.0.0.1:5004/v2/'));if(!page)throw Error('PC_PREVIEW_NOT_OPEN');
 const snapshot=()=>page.evaluate(async()=>{const{LocalStore}=await import('/v2/store.js');const{finance}=await import('/v2/domain.js');const s=await new LocalStore().open(),events=(await s.all('events')).filter(e=>!e.deleted_at),records=await s.all('records'),f=finance(events,[]);return{events:events.length,unique_events:new Set(events.map(e=>e.id)).size,missing:f.missing_costs.length,original:f.by_currency,categories:f.by_category,ua_events:events.filter(e=>e.purchase_id==='UA_A4FM57').length,ua_paid:finance(events.filter(e=>e.purchase_id==='UA_A4FM57'),[]).paid,records:records.map(r=>r.id).sort(),blobs:(await s.all('blobs')).map(r=>r.id).sort(),device:s.device,queue:(await s.all('outbox')).length,refresh_in_storage:!!JSON.parse(localStorage.getItem('av2.auth')||'null')?.provider_refresh_token};});
 const before=await snapshot();
 const refresh=await page.evaluate(async()=>{
  const{createClient}=await import('/vendor/supabase-client.mjs'),{googleSafeStorage,GoogleProviderBackend}=await import('/v2/google-provider.js'),{GoogleAuthorization}=await import('/v2/google-auth.js'),{GoogleSource}=await import('/v2/google.js'),{LocalStore}=await import('/v2/store.js'),{SupabaseRemote}=await import('/v2/sync.js');
  const s=await new LocalStore().open(),client=createClient('https://cslludzuejkhsydqiabx.supabase.co','sb_publishable_8k8xhMZtkay30ZB45aPjGw_4u69Dp0U',{auth:{storageKey:'av2.auth',storage:googleSafeStorage(localStorage),detectSessionInUrl:false}}),remote=new SupabaseRemote(client,s.device,s.deviceToken),backend=new GoogleProviderBackend(client,()=>remote.credentials()),auth=new GoogleAuthorization(s,backend);
  if(!(await backend.call('status')).configured)throw Error('ONE_TIME_GOOGLE_OFFLINE_CONSENT_REQUIRED');
  const old=await s.get('meta','google-access');await s.put('meta',{...old,expires_at:1});await auth.renew({force:true,rejected_token:old.value});
  const google=new GoogleSource(()=>auth.token(),fetch,()=>remote.check(),token=>auth.recover(token));const changed=await google.syncCalendar(s),files=await google.listDocuments();
  return{changed,drive_files:files.length,expires_in_ms:(await s.get('meta','google-access')).expires_at-Date.now(),reauth:(await s.get('meta','google-reauth'))?.value};
 });
 await page.goto('http://127.0.0.1:5004/v2/#budget');await page.getByRole('heading',{name:'Presupuesto',exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('#connection').textContent.startsWith('Actualizado hace'));
 const after=await snapshot();assert.equal(after.events,54);assert.equal(after.unique_events,54);assert.equal(after.missing,0);assert.equal(after.ua_events,8);assert.equal(after.ua_paid,765.35);assert.equal(after.original.USD.paid,2826.36);assert.equal(after.original.EUR.paid,605.26);assert.equal(after.original.CHF.paid,104);assert.equal(after.original.EUR.estimated,284.40);assert.deepEqual(after.blobs,before.blobs);for(const id of before.records)assert.ok(after.records.includes(id));assert.equal(after.device,before.device);assert.equal(after.refresh_in_storage,false);
 const closed=page;page=await context.newPage();await closed.close();await page.goto('http://127.0.0.1:5004/v2/#sync');await page.waitForFunction(()=>document.querySelector('#connection').textContent.startsWith('Actualizado hace'));assert.equal(await page.locator('[data-action=google]').count(),0);
 await page.goto('http://127.0.0.1:5004/v2/#budget');await page.getByRole('heading',{name:'Presupuesto',exact:true}).waitFor();const totals=await page.locator('.stat strong').allTextContents();
 const evidence={at:new Date().toISOString(),refresh,calendar:after,ui_totals:totals,reopened:true};privateJson('google-provider-TM3-152.json',evidence);console.log(JSON.stringify(evidence));
}finally{await browser.close();}
