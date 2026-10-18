import {test} from 'node:test';import assert from 'node:assert/strict';
import {GoogleAuthorization} from '../public/v2/google-auth.js';
import {googleSafeStorage} from '../public/v2/google-provider.js';
import {GoogleSource} from '../public/v2/google.js';
import {ProviderLifecycle,credentialCipher} from '../supabase/functions/av2-google-token/lifecycle.js';
import {readFileSync} from 'node:fs';import {PGlite} from '@electric-sql/pglite';
const local=()=>{const rows=new Map([['offline-expense',{id:'offline-expense',value:9}],['offline-document',{id:'offline-document',value:'PDF'}]]);return{rows,get:async(_,id)=>rows.get(id),transaction:async(_,fn)=>fn({objectStore:()=>({put:v=>rows.set(v.id,v),delete:id=>rows.delete(id)})})};};
test('Supabase storage strips provider refresh token before writing and sanitizes existing sessions',()=>{
 const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},safe=googleSafeStorage(storage);
 const session={access_token:'supabase-access',refresh_token:'supabase-refresh',provider_token:'google-access',provider_refresh_token:'google-secret'};
 safe.setItem('av2.auth',JSON.stringify(session));assert.equal(values.get('av2.auth').includes('google-secret'),false);assert.equal(JSON.parse(safe.getItem('av2.auth')).refresh_token,'supabase-refresh');
 storage.setItem('av2.auth',JSON.stringify(session));safe.getItem('av2.auth');assert.equal(values.get('av2.auth').includes('provider_refresh_token'),false);
});
test('expired provider automatically renews once across Calendar and Drive, reopens, and preserves offline records',async()=>{
 const store=local();store.rows.set('google-access',{value:'expired',expires_at:0});let refreshes=0;
 const backend={call:async(action,options)=>{assert.equal(action,'access');assert.equal(options.force,true);assert.equal(options.rejected_token,'expired');refreshes++;return{configured:true,access_token:'renewed',expires_at:Date.now()+3600000};}};
 const auth=new GoogleAuthorization(store,backend),headers=[];const google=new GoogleSource(()=>auth.token(),async(_,options)=>{headers.push(options.headers.Authorization);return Response.json({ok:true});},async()=>{},token=>auth.recover(token));
 await Promise.all([google.api('calendar/v3/colors'),google.api('drive/v3/files')]);assert.equal(refreshes,1);assert.deepEqual(headers,['Bearer renewed','Bearer renewed']);
 const reopened=new GoogleAuthorization(store,backend);await reopened.capture('INITIAL_SESSION',{provider_token:'expired'});assert.equal(await reopened.token(),'renewed');assert.equal(refreshes,1);assert.equal(store.rows.get('offline-expense').value,9);assert.equal(store.rows.get('offline-document').value,'PDF');
});
test('Google 401 renews and retries the same API once without duplicate writes',async()=>{
 const store=local();await new GoogleAuthorization(store).capture('SIGNED_IN',{provider_token:'expired'});let renewals=0,requests=0;
 const auth=new GoogleAuthorization(store,{call:async(action,options)=>{assert.equal(options.rejected_token,'expired');assert.equal(options.force,true);renewals++;return{access_token:'new-access',expires_at:Date.now()+3600000};}});
 const google=new GoogleSource(()=>auth.token(),async(_,options)=>{requests++;return options.headers.Authorization==='Bearer expired'?new Response('',{status:401}):Response.json({files:[]});},async()=>{},token=>auth.recover(token));
 await google.api('drive/v3/files');assert.equal(requests,2);assert.equal(renewals,1);assert.equal(store.rows.get('offline-expense').value,9);
});
test('revoked refresh requires reauth; temporary provider outage never invalidates consent or data',async()=>{
 const store=local();store.rows.set('google-access',{value:'expired',expires_at:0});let revoked=false;
 const backend={call:async()=>{const e=Error(revoked?'GOOGLE_REAUTH_REQUIRED':'GOOGLE_REFRESH_UNAVAILABLE');e.code=e.message;throw e;}};const auth=new GoogleAuthorization(store,backend);
 await assert.rejects(auth.token(),/recuperar conexión/);assert.equal(store.rows.has('google-reauth'),false);assert.equal(store.rows.get('google-access').value,'expired');
 revoked=true;await assert.rejects(auth.token(),/autorización Google expiró/);assert.equal(store.rows.get('google-reauth').value,true);assert.equal(store.rows.has('google-access'),false);assert.equal(store.rows.get('offline-document').value,'PDF');
});
test('refresh credential moves only through memory to backend; consent requested only when missing',async()=>{
 const store=local(),calls=[];let configured=false;
 const auth=new GoogleAuthorization(store,{call:async(action,options)=>{calls.push({action,options});if(action==='status')return{configured};configured=true;return{access_token:'new-access',expires_at:Date.now()+3600000};}});
 assert.deepEqual(await auth.oauthQuery(),{access_type:'offline',prompt:'consent'});
 const session={provider_token:'old',provider_refresh_token:'secret-provider-refresh'};await auth.capture('SIGNED_IN',session);
 assert.equal(session.provider_refresh_token,undefined);assert.equal(JSON.stringify([...store.rows.values()]).includes('secret-provider-refresh'),false);assert.equal(calls.find(c=>c.action==='import').options.refresh_token,'secret-provider-refresh');
 assert.deepEqual(await auth.oauthQuery(),{access_type:'offline'});
 const unavailable=new GoogleAuthorization(store,{call:async()=>{throw Error('GOOGLE_BACKEND_UNAVAILABLE');}});assert.deepEqual(await unavailable.oauthQuery(),{access_type:'offline'});
});
async function serverFixture(){
 const cipher=await credentialCipher(Buffer.alloc(32,7).toString('base64'));let row=null,lease=null,exchanges=0,revoked=false;
 const repository={get:async()=>row,save:async(_,ciphertext)=>row={ciphertext,revoked_at:null},lock:async(_,id)=>{if(lease)return false;lease=id;return true;},unlock:async()=>{lease=null;},revoke:async()=>{row.revoked_at='now';}};
 let clock=100000;const scopes=['calendar.events','calendar.calendars.readonly','drive.file','drive.readonly'].map(s=>'https://www.googleapis.com/auth/'+s).join(' ');
 const request=async(url,options)=>{if(url.includes('/token')){exchanges++;assert.equal(options.body.get('grant_type'),'refresh_token');assert.equal(options.body.get('refresh_token'),'server-refresh-secret');return revoked?Response.json({error:'invalid_grant'},{status:400}):Response.json({access_token:'google-access-'+exchanges,expires_in:3600,scope:scopes});}return Response.json({sub:'google-sub'});};
 return{cipher,repository,service:new ProviderLifecycle({repository,cipher,clientId:'client',clientSecret:'server-client-secret',request,now:()=>clock}),get row(){return row;},get exchanges(){return exchanges;},expire(){clock+=3600000;},revoke(){revoked=true;}};
}
test('server encrypts refresh/access, refreshes expired provider, caches access and protects owner binding',async()=>{
 const f=await serverFixture(),owner='owner',subject='google-sub';const initial=await f.service.run(owner,subject,{action:'import',refresh_token:'server-refresh-secret'});
 assert.equal(JSON.stringify(initial).includes('server-refresh-secret'),false);assert.equal(JSON.stringify(f.row).includes('server-refresh-secret'),false);await assert.rejects(f.cipher.open('another-owner',f.row.ciphertext));
 await f.service.run(owner,subject,{action:'access'});assert.equal(f.exchanges,1);f.expire();const next=await f.service.run(owner,subject,{action:'access'});assert.equal(next.access_token,'google-access-2');assert.equal(f.exchanges,2);
 const simultaneousRetry=await f.service.run(owner,subject,{action:'access',force:true,rejected_token:'google-access-1'});assert.equal(simultaneousRetry.access_token,'google-access-2');assert.equal(f.exchanges,2);
});
test('server invalid_grant marks only provider revoked, whereas refresh outage keeps encrypted credential',async()=>{
 const f=await serverFixture();await f.service.run('owner','google-sub',{action:'import',refresh_token:'server-refresh-secret'});f.expire();
 const original=f.service.request,encrypted=f.row.ciphertext;
 for(const error of ['invalid_client','invalid_request','unauthorized_client']){f.service.request=async()=>Response.json({error},{status:400});await assert.rejects(f.service.run('owner','google-sub',{action:'access'}),/GOOGLE_CLIENT_CONFIGURATION_INVALID/);assert.equal(f.row.revoked_at,null);assert.deepEqual(f.row.ciphertext,encrypted);}
 f.service.request=async()=>Response.json({error:'temporarily_unavailable'},{status:503});await assert.rejects(f.service.run('owner','google-sub',{action:'access'}),/GOOGLE_REFRESH_UNAVAILABLE/);assert.equal(f.row.revoked_at,null);
 f.service.request=original;f.revoke();await assert.rejects(f.service.run('owner','google-sub',{action:'access'}),/GOOGLE_REAUTH_REQUIRED/);assert.equal(f.row.revoked_at,'now');assert.deepEqual(await f.service.run('owner','google-sub',{action:'status'}),{configured:false});
});
test('credential migration denies browser roles, allows only server access and serializes refresh leases',async()=>{
 const db=new PGlite();try{
  await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);grant usage on schema public to service_role,authenticated,anon;insert into auth.users values('10000000-0000-4000-8000-000000000001');");
  await db.exec(readFileSync(new URL('../supabase/migrations/20261006020000_av2_google_provider_credentials.sql',import.meta.url),'utf8'));
  await db.exec('set role authenticated');await assert.rejects(db.query('select * from av2_google_credentials'),/permission denied/);await assert.rejects(db.query("select av2_google_refresh_lock('10000000-0000-4000-8000-000000000001',gen_random_uuid())"),/permission denied/);
  await db.exec('reset role;set role service_role');await db.exec("insert into av2_google_credentials(user_id,ciphertext) values('10000000-0000-4000-8000-000000000001','{\"encrypted\":true}');");
  const lock=()=>db.query("select av2_google_refresh_lock('10000000-0000-4000-8000-000000000001',gen_random_uuid()) as locked");assert.equal((await lock()).rows[0].locked,true);assert.equal((await lock()).rows[0].locked,false);
 }finally{await db.close();}
});
