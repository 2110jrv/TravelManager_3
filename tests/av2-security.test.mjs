import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHmac,pbkdf2Sync,createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {TRIP} from '../public/v2/config.js';
const db=new PGlite();
const a='10000000-0000-4000-8000-000000000001',b='10000000-0000-4000-8000-000000000002';
const root='20000000-0000-4000-8000-000000000001',phone='20000000-0000-4000-8000-000000000002',other='20000000-0000-4000-8000-000000000003';
const rootToken='a'.repeat(64),phoneToken='b'.repeat(64),otherToken='c'.repeat(64),claim='d'.repeat(64),invite='e'.repeat(64),salt='12'.repeat(16);
const verifier=pbkdf2Sync('Only-a-test-password',Buffer.from(salt,'hex'),600000,32,'sha256');
const hash=text=>createHash('sha256').update(text).digest();
const rpc=async(name,args)=> (await db.query(`select ${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) as result`,args)).rows[0].result;
async function user(id){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');}
before(async()=>{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated;grant execute on function auth.uid() to authenticated;`);
 for(const name of ['20261005090000_agenda_viajera_v2.sql','20261005100000_av2_device_authorization.sql','20261005110000_av2_sync_validation.sql','20261005200000_av2_admin_key_rotation.sql','20261006040000_av2_device_persistence.sql','20261006050000_av2_staging_configuration.sql'])await db.exec(readFileSync(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8'));
 await db.query('insert into auth.users values($1),($2)',[a,b]);await db.query("insert into av2_trip_users(trip_id,user_id,role) values($1,$2,'OWNER')",[TRIP.id,a]);
 await db.query("insert into av2_root_claims values($1,$2,$3,now()+interval '1 hour',null)",[TRIP.id,a,hash(claim)]);await user(a);
});
after(async()=>db.close());
test('root claim rejects missing proof and only consumes its token once',async()=>{
 await assert.rejects(rpc('av2_claim_root',[TRIP.id,root,rootToken,null]),/AV2_ROOT_CLAIM_INVALID/);
 const result=await rpc('av2_claim_root',[TRIP.id,root,rootToken,claim]);assert.equal(result.role,'ROOT_DEVICE');
 await assert.rejects(rpc('av2_claim_root',[TRIP.id,crypto.randomUUID(),rootToken,claim]),/AV2_ROOT_CLAIM_INVALID/);
});
test('root configures only a salted PBKDF2 verifier; PostgreSQL HMAC matches Node',async()=>{
 await rpc('av2_set_admin_key',[TRIP.id,root,rootToken,salt,600000,verifier.toString('hex')]);
 await db.exec('reset role');const actual=await rpc('av2_hmac',[verifier,'test message']);assert.equal(Buffer.from(actual).toString('hex'),createHmac('sha256',verifier).update('test message').digest('hex'));await user(a);
});
test('invitation enrolls another authenticated user with a unique secret and DEVICE role',async()=>{
 const result=await rpc('av2_create_invite',[TRIP.id,root,rootToken,invite,null,null]);assert.equal(result.single_use,true);
 await user(b);const enrolled=await rpc('av2_enroll',[TRIP.id,phone,phoneToken,invite,'Jenny Motorola Edge']);assert.equal(enrolled.role,'DEVICE');assert.equal(enrolled.user_id,b);
 assert.equal(await rpc('av2_authenticate_device',[TRIP.id,phone,phoneToken]),true);assert.equal(await rpc('av2_authenticate_device',[TRIP.id,phone,rootToken]),false);
 assert.equal((await rpc('av2_enroll',[TRIP.id,phone,phoneToken,invite,'Retry'])).id,phone);
 await assert.rejects(rpc('av2_enroll',[TRIP.id,other,otherToken,invite,'Second phone']),/AV2_INVITE_ALREADY_USED/);
 await assert.rejects(rpc('av2_claim_root',[TRIP.id,other,otherToken,claim]),/AV2_ROOT_CLAIM_INVALID/);
});
test('UUID-only entry points and secret tables are inaccessible',async()=>{
 await assert.rejects(rpc('av2_apply',[TRIP.id,JSON.stringify({})]),/permission denied/);
 for(const table of ['av2_device_keys','av2_invites','av2_admin_security','av2_root_claims'])await assert.rejects(db.query(`select * from ${table}`),/permission denied/);
 await assert.rejects(rpc('av2_sync_pull',[TRIP.id,phone,rootToken,null]),/AV2_DEVICE_REVOKED/);
});
test('unknown installation is distinguished from revocation and forged future versions fail',async()=>{
 assert.equal(await rpc('av2_device_status',[TRIP.id,crypto.randomUUID(),phoneToken]),'UNENROLLED');
 const operation={id:crypto.randomUUID(),record_id:crypto.randomUUID(),kind:'notes',device_id:phone,base_version:99,base:{},changes:{text:'future'}};
 await assert.rejects(rpc('av2_sync_apply',[TRIP.id,phone,phoneToken,JSON.stringify(operation)]),/AV2_FUTURE_VERSION/);
});
test('phone cannot manage devices without valid, target-bound, single-use proof',async()=>{
 const noProof=await rpc('av2_create_invite',[TRIP.id,phone,phoneToken,'f'.repeat(64),null,null]);assert.equal(noProof.error,'AV2_ADMIN_PROOF_INVALID');
 await assert.rejects(rpc('av2_revoke_device',[TRIP.id,phone,phoneToken,root,null,null,false]),/AV2_ROOT_DEVICE_PROTECTED/);
 await assert.rejects(rpc('av2_revoke_device',[TRIP.id,phone,phoneToken,phone,null,null,false]),/AV2_USE_SELF_REMOVAL/);
 await assert.rejects(rpc('av2_revoke_device',[TRIP.id,phone,phoneToken,phone,null,null,null]),/AV2_INVALID_SELF_REMOVAL/);
 const challenge=await rpc('av2_admin_challenge',[TRIP.id,phone,phoneToken,'invite',null]);
 const proof=createHmac('sha256',verifier).update(challenge.message).digest('hex');
 const invited=await rpc('av2_create_invite',[TRIP.id,phone,phoneToken,'f'.repeat(64),challenge.id,proof]);assert.equal(invited.single_use,true);
 assert.equal((await rpc('av2_create_invite',[TRIP.id,phone,phoneToken,'1'.repeat(64),challenge.id,proof])).error,'AV2_ADMIN_PROOF_INVALID');
 await rpc('av2_enroll',[TRIP.id,other,otherToken,'f'.repeat(64),'Jenny Motorola Viaje']);
 const revoke=await rpc('av2_admin_challenge',[TRIP.id,phone,phoneToken,'revoke',other]);
 const signed=createHmac('sha256',verifier).update(revoke.message).digest('hex');
 assert.equal((await rpc('av2_revoke_device',[TRIP.id,phone,phoneToken,other,revoke.id,signed,false])).ok,true);
 await assert.rejects(rpc('av2_sync_pull',[TRIP.id,other,otherToken,null]),/AV2_DEVICE_REVOKED/);
});
test('expired invitation and revoked issuer cannot enroll a new installation',async()=>{
 await user(a);const expired='2'.repeat(64);await rpc('av2_create_invite',[TRIP.id,root,rootToken,expired,null,null]);
 await db.exec('reset role');await db.query("update av2_invites set expires_at=now()-interval '1 second' where token_hash=$1",[hash(expired)]);await user(b);
 await assert.rejects(rpc('av2_enroll',[TRIP.id,crypto.randomUUID(),'3'.repeat(64),expired,'Expired']),/AV2_INVITE_INVALID_OR_EXPIRED/);
});
test('revoked device cannot impersonate the active root using its UUID',async()=>{
 await user(a);await rpc('av2_revoke_device',[TRIP.id,root,rootToken,phone,null,null,false]);await user(b);
 assert.equal(await rpc('av2_authenticate_device',[TRIP.id,phone,phoneToken]),false);assert.equal(await rpc('av2_authenticate_device',[TRIP.id,root,phoneToken]),false);
 await assert.rejects(rpc('av2_list_devices',[TRIP.id,phone,phoneToken]),/AV2_DEVICE_REVOKED/);
 await assert.rejects(rpc('av2_sync_apply',[TRIP.id,phone,phoneToken,JSON.stringify({device_id:phone})]),/AV2_DEVICE_REVOKED/);
});
test('existing administrative key cannot be replaced without its current single-use proof',async()=>{
 await user(a);assert.equal(await rpc('av2_admin_key_status',[TRIP.id,root,rootToken]),true);
 const nextSalt='34'.repeat(16),next=pbkdf2Sync('QA replacement key',Buffer.from(nextSalt,'hex'),600000,32,'sha256').toString('hex');
 await assert.rejects(rpc('av2_set_admin_key',[TRIP.id,root,rootToken,nextSalt,600000,next]),/AV2_ADMIN_CURRENT_KEY_REQUIRED/);
 assert.equal((await rpc('av2_change_admin_key',[TRIP.id,root,rootToken,nextSalt,600000,next,null,null])).error,'AV2_ADMIN_PROOF_INVALID');
 const wrong=await rpc('av2_admin_challenge',[TRIP.id,root,rootToken,'change-key',null]);
 assert.equal((await rpc('av2_change_admin_key',[TRIP.id,root,rootToken,nextSalt,600000,next,wrong.id,'0'.repeat(64)])).error,'AV2_ADMIN_PROOF_INVALID');
 const challenge=await rpc('av2_admin_challenge',[TRIP.id,root,rootToken,'change-key',null]);const proof=createHmac('sha256',verifier).update(challenge.message).digest('hex');
 assert.equal((await rpc('av2_change_admin_key',[TRIP.id,root,rootToken,nextSalt,600000,next,challenge.id,proof])).ok,true);
 assert.equal((await rpc('av2_change_admin_key',[TRIP.id,root,rootToken,nextSalt,600000,next,challenge.id,proof])).error,'AV2_ADMIN_PROOF_INVALID');
 await db.exec('reset role');const row=(await db.query('select salt,encode(verifier,\'hex\') verifier from av2_admin_security where trip_id=$1',[TRIP.id])).rows[0];assert.equal(row.salt,nextSalt);assert.equal(row.verifier,next);
 await user(b);await assert.rejects(rpc('av2_set_admin_key',[TRIP.id,phone,phoneToken,nextSalt,600000,next]),/AV2_ROOT_REQUIRED/);
});

test('ROOT retry and recovery retain the existing device and reject account-only impersonation',async()=>{
 await user(a);
 assert.equal((await rpc('av2_claim_root',[TRIP.id,root,rootToken,null])).id,root);
 assert.equal((await rpc('av2_recover_device',[TRIP.id,rootToken])).id,root);
 assert.equal(await rpc('av2_recover_device',[TRIP.id,'1'.repeat(64)]),null);
 await user(b);assert.equal(await rpc('av2_recover_device',[TRIP.id,rootToken]),null);
 await assert.rejects(rpc('av2_claim_root',[TRIP.id,root,phoneToken,claim]),/AV2_ROOT_CLAIM_INVALID/);
 await db.exec('reset role');assert.equal((await db.query("select count(*)::int as n from av2_devices where role='ROOT_DEVICE'")).rows[0].n,1);
 await user(a);
});

test('staging trip configuration requires authenticated installation proof',async()=>{await user(a);const configuration=await rpc('av2_trip_configuration',[TRIP.id,root,rootToken]);assert.deepEqual(configuration,TRIP);await assert.rejects(rpc('av2_trip_configuration',[TRIP.id,root,phoneToken]),/AV2_DEVICE_NOT_AUTHORIZED/);await db.exec('reset role;set role anon');await assert.rejects(rpc('av2_trip_configuration',[TRIP.id,root,rootToken]),/permission denied/);await user(a);});
