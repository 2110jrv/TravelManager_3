import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';import {join} from 'node:path';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {query,quote,ROOT,PROJECT,privateJson} from '../scripts/av2-management.mjs';
import {TRIP} from '../public/v2/config.js';
test('real IndexedDB offline queue reconnects to Supabase, merges UI edits, shows conflict, respects tombstones and purges on revocation',async({page,context})=>{
 const env=Object.fromEntries(readFileSync(join(ROOT,'.env.test.local'),'utf8').split(/\r?\n/).filter(x=>/^[A-Z_]+=/.test(x)).map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1).replace(/^['"]|['"]$/g,'')];}));
 const url=`https://${PROJECT}.supabase.co`,key='sb_publishable_8k8xhMZtkay30ZB45aPjGw_4u69Dp0U';
 const aClient=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}),bClient=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const login=async(client,role)=>{const{data,error}=await client.auth.signInWithPassword({email:env[`SUPABASE_TEST_${role}_EMAIL`],password:env[`SUPABASE_TEST_${role}_PASSWORD`]});if(error)throw Error(`QA_${role}_AUTH_FAILED`);return data;};
 const trip=randomUUID(),a=randomUUID(),b=randomUUID(),aToken=randomBytes(32).toString('hex'),bToken=randomBytes(32).toString('hex');let setup=false;
 const evidence=[];
 try{
  const aAuth=await login(aClient,'ADMIN'),bAuth=await login(bClient,'TRAVELER');
  query(`begin;insert into public.av2_trips(id,name,start_date,end_date,currency,calendar_id,drive_folders) values(${quote(trip)},'AV2 browser QA','2026-10-20','2026-11-05','USD','qa-no-google','{}');
  insert into public.av2_trip_users(trip_id,user_id,role) values(${quote(trip)},${quote(aAuth.user.id)},'OWNER'),(${quote(trip)},${quote(bAuth.user.id)},'TRAVELER');
  insert into public.av2_devices(id,trip_id,user_id,name) values(${quote(a)},${quote(trip)},${quote(aAuth.user.id)},'Browser A'),(${quote(b)},${quote(trip)},${quote(bAuth.user.id)},'Remote B');
  insert into public.av2_device_keys values(${quote(a)},decode(${quote(createHash('sha256').update(aToken).digest('hex'))},'hex')),(${quote(b)},decode(${quote(createHash('sha256').update(bToken).digest('hex'))},'hex'));commit;`);setup=true;
  // A QA-only route binds this browser to its isolated trip. Runtime source stays unchanged in the repository.
  await page.route('**/v2/config.js',route=>route.fulfill({contentType:'application/javascript',body:readFileSync(join(ROOT,'public/v2/config.js'),'utf8').replace(TRIP.id,trip)}));
  await page.route('**/v2/app.js',route=>route.fulfill({contentType:'application/javascript',body:'await globalThis.__av2Ready;\n'+readFileSync(join(ROOT,'public/v2/app.js'),'utf8')}));
  await context.addInitScript(({device,token,session})=>{
   localStorage.setItem('av2.auth',JSON.stringify(session));
   // PWA shell/update behavior is tested separately; disable its registration to keep the isolated config route authoritative here.
   navigator.serviceWorker.register=async()=>({addEventListener(){}});
   globalThis.__av2Ready=new Promise((resolve,reject)=>{const request=indexedDB.open('agenda-viajera-v2',2);request.onupgradeneeded=()=>{for(const name of ['records','events','outbox','conflicts','meta','blobs'])request.result.createObjectStore(name,{keyPath:'id'});};request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('meta','readwrite'),s=tx.objectStore('meta');s.put({id:'device',value:device});s.put({id:'device-token',value:token});s.put({id:'authorized',value:true});tx.oncomplete=()=>{db.close();resolve();};};});
  },{device:a,token:aToken,session:aAuth.session});
  const rpc=async(name,args)=>{const{data,error}=await bClient.rpc(name,{p_trip:trip,p_device:b,p_token:bToken,...args});if(error)throw Error(error.message);return data;};
  const pull=()=>rpc('av2_sync_pull',{p_after:null});
  const op=(record,changes,deleted_at=null)=>({id:randomUUID(),record_id:record.id,kind:record.kind,device_id:b,base:record.data,base_version:record.version,changes,deleted_at});
  const local=()=>page.evaluate(async()=>{const{LocalStore}=await import('/v2/store.js');const s=await new LocalStore().open();return{records:await s.all('records'),outbox:await s.all('outbox'),conflicts:await s.all('conflicts')};});
  await page.goto('/v2/#expense/new');await expect(page.getByLabel('Descripción',{exact:true})).toBeVisible();
  await context.setOffline(true);await page.getByLabel('Descripción',{exact:true}).fill('Browser offline expense');await page.getByLabel('Monto',{exact:true}).fill('25');await page.getByRole('button',{name:'Guardar gasto'}).click();
  await expect(page.getByRole('heading',{name:'Browser offline expense'})).toBeVisible();expect((await local()).outbox.length).toBe(1);expect((await pull()).length).toBe(0);
  await context.setOffline(false);await expect.poll(async()=> (await pull()).length,{timeout:15000}).toBe(1);await expect.poll(async()=> (await local()).outbox.length,{timeout:15000}).toBe(0);
  evidence.push('offline create persisted in IndexedDB; reconnect delivered to B');
  let common=(await pull())[0];
  await page.locator(`a[href="#expense/${common.id}"]`).click();await expect(page.getByLabel('Descripción',{exact:true})).toBeVisible();await context.setOffline(true);
  await page.getByLabel('Descripción',{exact:true}).fill('A edited description');await page.getByRole('button',{name:'Guardar gasto'}).click();
  await rpc('av2_sync_apply',{p_operation:op(common,{notes:'B edited notes'})});await context.setOffline(false);
  await expect.poll(async()=> (await pull())[0].data.description,{timeout:15000}).toBe('A edited description');common=(await pull())[0];expect(common.data.notes).toBe('B edited notes');expect((await local()).conflicts.length).toBe(0);evidence.push('full-form edit only queues changed fields; different-field merge preserved');
  await page.locator(`a[href="#expense/${common.id}"]`).click();await expect(page.getByLabel('Descripción',{exact:true})).toBeVisible();await context.setOffline(true);await page.getByLabel('Descripción',{exact:true}).fill('A same field');await page.getByRole('button',{name:'Guardar gasto'}).click();
  await rpc('av2_sync_apply',{p_operation:op(common,{description:'B same field'})});await context.setOffline(false);
  await expect.poll(async()=> (await local()).conflicts.length,{timeout:15000}).toBe(1);await page.evaluate(()=>{location.hash='#conflicts';});await expect(page.getByText('Servidor: "B same field"',{exact:true})).toBeVisible();await expect(page.getByText('Este dispositivo: "A same field"',{exact:true})).toBeVisible();evidence.push('same-field conflict visible; both values preserved');
  common=(await pull())[0];await page.evaluate(()=>{location.hash='#expenses';});await page.locator(`a[href="#expense/${common.id}"]`).click();await expect(page.getByLabel('Monto',{exact:true})).toBeVisible();await context.setOffline(true);await page.getByLabel('Monto',{exact:true}).fill('99');await page.getByRole('button',{name:'Guardar gasto'}).click();
  await rpc('av2_sync_apply',{p_operation:op(common,{},new Date().toISOString())});await context.setOffline(false);
  await expect.poll(async()=> (await local()).outbox.length,{timeout:15000}).toBe(0);expect((await pull())[0].data.amount).toBe(25);expect((await pull())[0].deleted_at).toBeTruthy();expect((await local()).records[0].deleted_at).toBeTruthy();evidence.push('stale IndexedDB edit cannot resurrect tombstone');
  query(`update public.av2_devices set deleted_at=now(),version=version+1,updated_at=now() where id=${quote(a)} and trip_id=${quote(trip)};`);
  await context.setOffline(true);await expect.poll(()=>page.evaluate(()=>navigator.onLine)).toBe(false);await context.setOffline(false);await expect.poll(()=>page.evaluate(()=>navigator.onLine)).toBe(true);await expect.poll(async()=> (await local()).records.length,{timeout:15000}).toBe(0);expect((await local()).outbox.length).toBe(0);evidence.push('revocation detected on reconnect; sensitive IndexedDB cleared');
 }finally{
  if(setup)query(`begin;update public.av2_records set deleted_at=coalesce(deleted_at,now()),version=version+1,updated_at=now() where trip_id=${quote(trip)};update public.av2_trip_users set deleted_at=now(),version=version+1,updated_at=now() where trip_id=${quote(trip)};update public.av2_trips set deleted_at=now(),version=version+1,updated_at=now() where id=${quote(trip)};commit;`);
  await aClient.auth.signOut({scope:'local'});await bClient.auth.signOut({scope:'local'});privateJson('remote-browser-evidence.json',{at:new Date().toISOString(),project:PROJECT,qa_trip:trip,evidence,fixture_disabled:setup});
 }
});
