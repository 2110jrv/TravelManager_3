import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{PGlite}from'@electric-sql/pglite';
import{validateCall,contentCall,toolDefinitions,privatePlace}from'../supabase/functions/av2-remote-content/content.js';
const id=()=>crypto.randomUUID();
test('remote tools reject destructive, ambiguous, unversioned and unverified coordinate requests',()=>{
 assert.throws(()=>validateCall('delete_place',{}),/UNKNOWN_TOOL/);assert.throws(()=>validateCall('update_audio_guide',{place_id:id(),patch:{audio_guide:'text'}}),/VERSION/);
 const base={place_id:id(),request_id:id(),expected_version:1};assert.throws(()=>validateCall('update_place_notes',{...base,patch:{description:'a',lat:10}}),/FIELD_NOT_ALLOWED/);
 assert.throws(()=>validateCall('update_place_metadata',{...base,patch:{lat:18,lng:-66}}),/VERIFIED/);
 assert.throws(()=>validateCall('update_place_guide',{...base,patch:{audio_guide:'overwrite'}}),/FIELD_NOT_ALLOWED/);
 assert.throws(()=>validateCall('create_place',{...base,expected_version:0,patch:{name:'Casa',lat:18,lng:-66}}),/PUBLIC_PLACE/);
 assert.ok(privatePlace({id:'a',data:{name:' Ｃａｓａ '}}));assert.ok(toolDefinitions().every(t=>t.inputSchema.additionalProperties===false));
});
test('read-only requests cannot reach writes; pagination hides Casa and keeps notes literal',async()=>{
 const a=id(),b=id(),places=[{id:a,version:2,kind:'places_of_interest',data:{name:'Public place',description:' exact\nnotes '}},{id:b,kind:'places_of_interest',data:{name:'Casa',lat:null,lng:null}}];let writes=0;
 const context={credentials:{p_trip:id()},canWrite:false,rpc:async name=>{if(name.includes('write'))writes++;return name==='av2_sync_places'?places:[];}};
 const list=await contentCall('list_places',{},context);assert.equal(list.items.length,1);assert.equal((await contentCall('get_place_notes',{place_id:a},context)).description,' exact\nnotes ');
 await assert.rejects(contentCall('get_place',{place_id:b},context),/PLACE_NOT_AVAILABLE/);
 await assert.rejects(contentCall('update_place_notes',{place_id:a,request_id:id(),expected_version:2,patch:{description:'b'}},context),/READ_ONLY/);assert.equal(writes,0);
});
test('real SQL contracts: authenticated create/read/write/rollback, exact versions, immutable history and original content preservation',async()=>{
 const db=new PGlite(),trip='7c0801ee-07b1-4d86-95d7-202610200001',auth=id(),installation=id(),token='b'.repeat(64);
 try{
 await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated;grant execute on function auth.uid() to authenticated;");
 for(const file of['20261005090000_agenda_viajera_v2.sql','20261005100000_av2_device_authorization.sql','20261005110000_av2_sync_validation.sql','20261006030000_av2_map_locations.sql','20261007010000_av2_person_pin_auth.sql','20261007020000_av2_places_of_interest.sql','20261008010000_av2_places_sheet_bridge.sql','20261009012000_av2_sheet_api_place_import.sql','20261009140000_av2_day_pin_schedule.sql','20261017120000_av2_private_place_guides.sql','20261018190000_av2_remote_content.sql'])await db.exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 await db.query('insert into auth.users values($1)',[auth]);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[auth]);await db.exec("update av2_app_users set pin_salt='fake',pin_hash='fake',pin_version=1");const actor=(await db.query("select id from av2_app_users where name='Jonathan'")).rows[0].id;
 const device=(await db.query('select av2_pin_authorize($1,$2,$3,$4,$5,$6,$7,$8) r',[trip,actor,auth,installation,token,{},'Remote test','qa'])).rows[0].r.device.id;
 await db.exec('set role authenticated');const credentials={p_trip:trip,p_device:device,p_token:token},rpc=async(name,args)=>(await db.query('select '+name+'('+Object.keys(args).map((_,i)=>'$'+(i+1)).join(',')+') result',Object.values(args))).rows[0].result,context={credentials,rpc,canWrite:true};
 const place=id(),create={place_id:place,expected_version:0,request_id:id(),patch:{name:'REMOTE_TEST',description:'EXACT original notes',lat:null,lng:null}};
 let r=await contentCall('create_place',create,context);assert.equal(r.record.id,place);assert.deepEqual(await contentCall('create_place',create,context),r);
 await assert.rejects(contentCall('create_place',{...create,patch:{...create.patch,name:'different'}},context),/REUSED/);
 const initial=await contentCall('update_audio_guide',{place_id:place,expected_version:0,request_id:id(),patch:{audio_guide:'Narration A'}},context);
 const next={place_id:place,expected_version:initial.record.version,request_id:id(),patch:{audio_guide:'Narration B'}};
 const changed=await contentCall('update_audio_guide',next,context);assert.equal(changed.record.data.guide.audio_guide,'Narration B');
 await assert.rejects(contentCall('update_audio_guide',{...next,request_id:id()},context),/VERSION_CONFLICT/);
 const restored=await contentCall('rollback_content',{history_id:changed.history_id,expected_version:changed.record.version,request_id:id()},context);assert.equal(restored.record.data.guide.audio_guide,'Narration A');
 await assert.rejects(contentCall('rollback_content',{history_id:r.history_id,expected_version:r.record.version,request_id:id()},context),/NONDESTRUCTIVE/);
 await assert.rejects(db.exec('select * from av2_remote_grants'),/permission denied/);await assert.rejects(db.exec('select * from av2_remote_history'),/permission denied/);
 assert.equal((await contentCall('get_place_notes',{place_id:place},context)).description,'EXACT original notes');
 await db.exec('reset role');await assert.rejects(db.exec('delete from av2_remote_history'),/APPEND_ONLY/);
 await db.query("update av2_app_users set agenda_role='VIEWER' where id=$1",[actor]);await db.exec('set role authenticated');
 await assert.rejects(contentCall('update_place_notes',{place_id:place,expected_version:1,request_id:id(),patch:{description:'blocked'}},context),/READ_ONLY/);
 await db.exec('reset role');await db.query("update av2_user_devices set state='Revocado' where device_id=$1",[device]);await db.exec('set role authenticated');
 await assert.rejects(contentCall('get_place',{place_id:place},context),/REVOKED/);
 }finally{await db.close();}
});
