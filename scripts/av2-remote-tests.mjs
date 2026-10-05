import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes,randomUUID,createHash,pbkdf2Sync,createHmac} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {query,quote,ROOT,PROJECT,privateJson} from './av2-management.mjs';
import {join} from 'node:path';
const env=Object.fromEntries(readFileSync(join(ROOT,'.env.test.local'),'utf8').split(/\r?\n/).filter(x=>/^[A-Z_]+=/.test(x)).map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1).replace(/^['"]|['"]$/g,'')];}));
const url=`https://${PROJECT}.supabase.co`,key='sb_publishable_8k8xhMZtkay30ZB45aPjGw_4u69Dp0U';
const sessions=[],evidence=[];const trip=randomUUID(),root=randomUUID(),a=randomUUID(),b=randomUUID();
const rootToken=randomBytes(32).toString('hex'),aToken=randomBytes(32).toString('hex'),bToken=randomBytes(32).toString('hex');
const hash=text=>createHash('sha256').update(text).digest('hex');
let setup=false;
async function login(role){const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});const{data,error}=await client.auth.signInWithPassword({email:env[`SUPABASE_TEST_${role}_EMAIL`],password:env[`SUPABASE_TEST_${role}_PASSWORD`]});if(error)throw Error(`QA_${role}_AUTH_FAILED`);sessions.push(client);return{client,user:data.user};}
async function rpc(client,name,args){const{data,error}=await client.rpc(name,args);if(error)throw Error(error.message);return data;}
function credentials(device,token){return{p_trip:trip,p_device:device,p_token:token};}
const initial={description:'QA remote expense',amount:10,amount_original:10,currency:'USD',currency_original:'USD',fx_rate_to_base:1,amount_base:10,rate_source:'identity',cost_status:'PAID'};
const recordId=randomUUID();
const operation=(device,changes,base={},version=0,extra={})=>({id:randomUUID(),record_id:recordId,kind:'expenses',device_id:device,base,base_version:version,changes,deleted_at:null,...extra});
try{
 const owner=await login('ADMIN'),traveler=await login('TRAVELER'),outsider=await login('OUTSIDER');
 query(`begin;insert into public.av2_trips(id,name,start_date,end_date,currency,calendar_id,drive_folders) values(${quote(trip)},${quote('AV2 QA '+new Date().toISOString())},'2026-10-20','2026-11-05','USD','qa-no-google-writes','{}');
 insert into public.av2_trip_users(trip_id,user_id,role) values(${quote(trip)},${quote(owner.user.id)},'OWNER');
 insert into public.av2_devices(id,trip_id,user_id,name,role) values(${quote(root)},${quote(trip)},${quote(owner.user.id)},'QA protected root','ROOT_DEVICE');
 insert into public.av2_device_keys values(${quote(root)},decode(${quote(hash(rootToken))},'hex'));commit;`);setup=true;
 const rootCred=credentials(root,rootToken);
 const invite=randomBytes(32).toString('hex');await rpc(owner.client,'av2_create_invite',{...rootCred,p_invite_token:invite});
 await rpc(owner.client,'av2_enroll',{p_trip:trip,p_device:a,p_device_token:aToken,p_invite:invite,p_name:'QA Device A'});
 const inviteB=randomBytes(32).toString('hex');await rpc(owner.client,'av2_create_invite',{...rootCred,p_invite_token:inviteB});
 await rpc(traveler.client,'av2_enroll',{p_trip:trip,p_device:b,p_device_token:bToken,p_invite:inviteB,p_name:'QA Device B'});
 await assert.rejects(rpc(traveler.client,'av2_enroll',{p_trip:trip,p_device:randomUUID(),p_device_token:bToken,p_invite:inviteB,p_name:'Replay'}),/AV2_INVITE_ALREADY_USED/);evidence.push({case:'single-use enrollment',status:'PASS'});
 const ac=credentials(a,aToken),bc=credentials(b,bToken),applyA=op=>rpc(owner.client,'av2_sync_apply',{...ac,p_operation:op}),applyB=op=>rpc(traveler.client,'av2_sync_apply',{...bc,p_operation:op});
 await assert.rejects(rpc(outsider.client,'av2_sync_pull',{...ac,p_after:null}),/AV2_DEVICE_REVOKED/);
 const direct=await outsider.client.from('av2_records').select('*').eq('trip_id',trip);assert.ok(direct.error);evidence.push({case:'remote outsider RLS/private reads',status:'PASS'});
 const create=operation(a,initial),first=await applyA(create),retry=await applyA(create);assert.deepEqual(retry,first);
 const received=await rpc(traveler.client,'av2_sync_pull',{...bc,p_after:null});assert.equal(received.find(x=>x.id===recordId).data.amount,10);
 evidence.push({case:'A creates expense; B receives; mutation retry idempotent',status:'PASS'});
 const base=first.record;await applyB(operation(b,{notes:'B online'},base.data,base.version));
 const reconnect=await applyA(operation(a,{description:'A offline'},base.data,base.version));assert.equal(reconnect.conflicts.length,0);assert.equal(reconnect.record.data.notes,'B online');assert.equal(reconnect.record.data.description,'A offline');evidence.push({case:'offline different-field merge',status:'PASS'});
 const common=reconnect.record;await applyA(operation(a,{description:'A concurrent'},common.data,common.version));
 const conflicting=await applyB(operation(b,{description:'B concurrent'},common.data,common.version));assert.equal(conflicting.conflicts[0].current,'A concurrent');assert.equal(conflicting.conflicts[0].incoming,'B concurrent');
 const conflictRows=await rpc(owner.client,'av2_sync_conflicts',{...ac,p_after:null});assert.ok(conflictRows.some(x=>x.id===conflicting.conflicts[0].id));evidence.push({case:'same-field conflict preserves both values and is shared',status:'PASS'});
 await assert.rejects(applyA(operation(a,{description:'Forged future'},{},999999)),/AV2_FUTURE_VERSION/);evidence.push({case:'future version rejected',status:'PASS'});
 const current=conflicting.record;const deleted=await applyB(operation(b,{},current.data,current.version,{deleted_at:new Date().toISOString()}));
 const stale=await applyA(operation(a,{amount:999},common.data,common.version));assert.equal(stale.record.deleted_at,deleted.record.deleted_at);assert.equal(stale.record.data.amount,10);assert.equal(stale.conflicts[0].field,'deleted_at');evidence.push({case:'stale device does not resurrect or overwrite tombstone',status:'PASS'});
 const linkId=randomUUID(),link=await applyA(operation(a,{calendar_event_id:'qa-event',drive_file_id:'qa-file'},{},0,{record_id:linkId,kind:'document_links'}));
 assert.deepEqual((await rpc(traveler.client,'av2_sync_pull',{...bc,p_after:null})).find(x=>x.id===linkId).data,link.record.data);evidence.push({case:'Drive relation survives remote sync (no external writes)',status:'PASS'});
 await assert.rejects(rpc(traveler.client,'av2_revoke_device',{...bc,p_target:root}),/AV2_ROOT_DEVICE_PROTECTED/);evidence.push({case:'phone cannot revoke ROOT_DEVICE',status:'PASS'});
 assert.equal((await rpc(traveler.client,'av2_revoke_device',{...bc,p_target:a})).error,'AV2_ADMIN_PROOF_INVALID');
 const salt=randomBytes(16).toString('hex'),adminPassword=randomBytes(32).toString('hex');let verifier=pbkdf2Sync(adminPassword,Buffer.from(salt,'hex'),600000,32,'sha256');
 await rpc(owner.client,'av2_set_admin_key',{...rootCred,p_salt:salt,p_iterations:600000,p_verifier:verifier.toString('hex')});
 assert.equal(await rpc(traveler.client,'av2_admin_key_status',bc),true);
 assert.ok((await rpc(traveler.client,'av2_list_devices',bc)).some(d=>d.id===root));
 const nextSalt=randomBytes(16).toString('hex'),nextVerifier=pbkdf2Sync(randomBytes(32).toString('hex'),Buffer.from(nextSalt,'hex'),600000,32,'sha256');
 const replacement={...rootCred,p_salt:nextSalt,p_iterations:600000,p_verifier:nextVerifier.toString('hex')};
 await assert.rejects(rpc(owner.client,'av2_set_admin_key',replacement),/AV2_ADMIN_CURRENT_KEY_REQUIRED/);
 assert.equal((await rpc(owner.client,'av2_change_admin_key',{...replacement,p_challenge:null,p_proof:null})).error,'AV2_ADMIN_PROOF_INVALID');
 await assert.rejects(rpc(traveler.client,'av2_change_admin_key',{...replacement,...bc,p_challenge:null,p_proof:null}),/AV2_ROOT_REQUIRED/);
 const rotation=await rpc(owner.client,'av2_admin_challenge',{...rootCred,p_action:'change-key',p_target:null});
 const rotationArgs={...replacement,p_challenge:rotation.id,p_proof:createHmac('sha256',verifier).update(rotation.message).digest('hex')};
 assert.equal((await rpc(owner.client,'av2_change_admin_key',rotationArgs)).ok,true);assert.equal((await rpc(owner.client,'av2_change_admin_key',rotationArgs)).error,'AV2_ADMIN_PROOF_INVALID');verifier=nextVerifier;
 evidence.push({case:'ROOT key rotation requires current single-use proof; device cannot replace key; device listing needs no PIN',status:'PASS'});
 const challenge=await rpc(traveler.client,'av2_admin_challenge',{...bc,p_action:'revoke',p_target:a});
 const proof=createHmac('sha256',verifier).update(challenge.message).digest('hex');
 assert.equal((await rpc(traveler.client,'av2_revoke_device',{...bc,p_target:a,p_challenge:challenge.id,p_proof:proof})).ok,true);
 await assert.rejects(applyA(operation(a,initial)),/AV2_DEVICE_REVOKED/);await assert.rejects(rpc(owner.client,'av2_sync_pull',{...ac,p_after:null}),/AV2_DEVICE_REVOKED/);
 await assert.rejects(rpc(owner.client,'av2_sync_pull',{...credentials(root,aToken),p_after:null}),/AV2_DEVICE_REVOKED/);evidence.push({case:'PIN proof required; revoked device cannot read/write or impersonate root',status:'PASS'});
 const inventory=query(`select tablename,rowsecurity from pg_tables where schemaname='public' and tablename like 'av2_%'`);assert.ok(inventory.every(x=>x.rowsecurity));
 const rootTriggers=query("select tgname from pg_trigger where tgrelid='public.av2_devices'::regclass and not tgisinternal");assert.ok(rootTriggers.some(x=>x.tgname==='av2_root_guard'));evidence.push({case:'remote av2 RLS and root trigger inventory',status:'PASS'});
 console.log(JSON.stringify({project:PROJECT,qa_trip:trip,tests:evidence.length,evidence},null,2));
}catch(error){evidence.push({case:'remote suite',status:'FAIL',error:error.message});console.error(error.message);process.exitCode=1;}
finally{
 if(setup)query(`begin;update public.av2_records set deleted_at=coalesce(deleted_at,now()),updated_at=now(),version=version+1 where trip_id=${quote(trip)};update public.av2_trip_users set deleted_at=now(),updated_at=now(),version=version+1 where trip_id=${quote(trip)};update public.av2_trips set deleted_at=now(),updated_at=now(),version=version+1 where id=${quote(trip)};commit;`);
 for(const client of sessions)await client.auth.signOut({scope:'local'});
 privateJson('remote-test-evidence.json',{at:new Date().toISOString(),project:PROJECT,qa_trip:trip,evidence,fixture_disabled:setup});
}
