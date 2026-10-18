import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{PGlite}from'@electric-sql/pglite';
import{validateCall,contentCall,toolDefinitions,privatePlace}from'../supabase/functions/av2-remote-content/content.js';
import{remoteAccess}from'../supabase/functions/av2-remote-content/access.js';
import{createRemoteHandler}from'../supabase/functions/av2-remote-content/handler.js';
import{credentialCipher}from'../supabase/functions/av2-google-token/lifecycle.js';
import{SupabaseRemote,SyncEngine}from'../public/v2/sync.js';
const id=()=>crypto.randomUUID();
test('remote tools reject destructive, ambiguous, unversioned and unverified coordinate requests',()=>{
 assert.throws(()=>validateCall('delete_place',{}),/UNKNOWN_TOOL/);assert.throws(()=>validateCall('update_audio_guide',{place_id:id(),patch:{audio_guide:'text'}}),/VERSION/);
 const base={place_id:id(),request_id:id(),expected_version:1};assert.throws(()=>validateCall('update_place_notes',{...base,patch:{notes:'a',description:'wrong field'}}),/FIELD_NOT_ALLOWED/);assert.throws(()=>validateCall('update_place_description',{...base,patch:{description:'a',notes:'wrong field'}}),/FIELD_NOT_ALLOWED/);
 assert.throws(()=>validateCall('update_place_metadata',{...base,patch:{lat:18,lng:-66}}),/UNKNOWN_TOOL/);
 assert.throws(()=>validateCall('update_place_guide',{...base,patch:{audio_guide:'overwrite'}}),/FIELD_NOT_ALLOWED/);
 assert.throws(()=>validateCall('create_place',{...base,expected_version:0,patch:{name:'Casa',lat:18,lng:-66}}),/UNKNOWN_TOOL/);
 for(const tool of ['get_place','get_itinerary','get_sync_status','list_zones','list_routes','list_travel_records'])assert.throws(()=>validateCall(tool,tool==='get_place'?{place_id:id()}:{}),/UNKNOWN_TOOL/);
 assert.ok(privatePlace({id:'a',data:{name:' Ｃａｓａ '}}));assert.ok(toolDefinitions().every(t=>t.inputSchema.additionalProperties===false));
});
test('read-only requests cannot reach writes; pagination hides Casa and keeps notes literal',async()=>{
 const a=id(),b=id(),places=[{id:a,version:2,kind:'places_of_interest',data:{name:'Public place',description:' exact\nnotes '}},{id:b,kind:'places_of_interest',data:{name:'Casa',lat:null,lng:null}}];let writes=0;
 const context={credentials:{p_trip:id()},canWrite:false,rpc:async name=>{if(name.includes('write'))writes++;return name==='av2_sync_places'?places:[];}};
 const list=await contentCall('list_places',{},context);assert.equal(list.items.length,1);assert.deepEqual(Object.keys(list.items[0]).sort(),['id','name','poi_code','version']);assert.ok(!('lat'in list.items[0]));assert.deepEqual((({notes,legacy_description_fallback})=>({notes,legacy_description_fallback}))(await contentCall('get_place_notes',{place_id:a},context)),{notes:' exact\nnotes ',legacy_description_fallback:true});assert.equal((await contentCall('get_place_description',{place_id:a},context)).description,' exact\nnotes ');
 await assert.rejects(contentCall('get_audio_guide',{place_id:b},context),/PLACE_NOT_AVAILABLE/);
 await assert.rejects(contentCall('update_place_notes',{place_id:a,request_id:id(),expected_version:2,patch:{notes:'b'}},context),/READ_ONLY/);assert.equal(writes,0);
});
test('real SQL contracts: authenticated create/read/write/rollback, exact versions, immutable history and original content preservation',async(t)=>{
 const db=new PGlite(),trip='7c0801ee-07b1-4d86-95d7-202610200001',auth=id(),installation=id(),token='b'.repeat(64);
 try{
 await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated;grant execute on function auth.uid() to authenticated;");
 for(const file of['20261005090000_agenda_viajera_v2.sql','20261005100000_av2_device_authorization.sql','20261005110000_av2_sync_validation.sql','20261006030000_av2_map_locations.sql','20261007010000_av2_person_pin_auth.sql','20261007020000_av2_places_of_interest.sql','20261008010000_av2_places_sheet_bridge.sql','20261009012000_av2_sheet_api_place_import.sql','20261009140000_av2_day_pin_schedule.sql','20261017120000_av2_private_place_guides.sql'])await db.exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 await db.query('insert into auth.users values($1)',[auth]);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[auth]);await db.exec("update av2_app_users set pin_salt='fake',pin_hash='fake',pin_version=1");const actor=(await db.query("select id from av2_app_users where name='Jonathan'")).rows[0].id;
 const device=(await db.query('select av2_pin_authorize($1,$2,$3,$4,$5,$6,$7,$8) r',[trip,actor,auth,installation,token,{},'Remote test','qa'])).rows[0].r.device.id;
 const seeded=id();await db.query("insert into av2_places_of_interest(id,trip_id,name,description,created_by,created_device) values($1,$2,'Ordinary private location','literal original notes',$3,$4)",[seeded,trip,actor,device]);
 const unreviewed=id();await db.query("insert into av2_places_of_interest(id,trip_id,name,description,created_by,created_device) values($1,$2,'Unreviewed public-looking place','legacy description remains exact',$3,$4)",[unreviewed,trip,actor,device]);
 await db.query("insert into av2_records(id,trip_id,kind,data,updated_by_device) select $1,trip_id,'app_settings',jsonb_build_object('type','place_guide','place_id',id,'poi_code',poi_code,'name',name,'guide',jsonb_build_object('audio_guide','original guide','geo',jsonb_build_object('private',true))),$2 from av2_places_of_interest where id=$3",[id(),device,seeded]);
 const snapshot=async()=>({pins:(await db.query("select to_jsonb(p)-'notes' r from av2_places_of_interest p where id=$1",[seeded])).rows,records:(await db.query("select to_jsonb(r) r from av2_records r where data->>'place_id'=$1",[seeded])).rows});
 const originals=await snapshot();await db.exec(readFileSync(new URL('../supabase/migrations/20261018190000_av2_remote_content.sql',import.meta.url),'utf8'));assert.deepEqual(await snapshot(),originals);
 const historyBeforeSplit=await snapshot();await db.exec(readFileSync(new URL('../supabase/migrations/20261018200000_av2_remote_content_history.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../supabase/migrations/20261018210000_av2_split_pin_notes.sql',import.meta.url),'utf8'));assert.deepEqual((await snapshot()).records,historyBeforeSplit.records);assert.equal((await db.query('select description,notes from av2_places_of_interest where id=$1',[unreviewed])).rows[0].notes,null);assert.equal((await db.query('select description,notes from av2_places_of_interest where id=$1',[unreviewed])).rows[0].description,'legacy description remains exact');
 const place=id();await db.query("insert into av2_places_of_interest(id,trip_id,name,description,notes,created_by,created_device) values($1,$2,'REMOTE_TEST','Historical description','Independent original notes',$3,$4)",[place,trip,actor,device]);await db.query('insert into av2_remote_public_places(trip_id,place_id,approved_by) values($1,$2,$3)',[trip,place,actor]);
 await db.exec('set role authenticated');const credentials={p_trip:trip,p_device:device,p_token:token},rpc=async(name,args)=>{const call=name+'('+Object.keys(args).map((_,i)=>'$'+(i+1)).join(',')+')';if(['av2_sync_pull','av2_sync_conflicts'].includes(name))return(await db.query('select to_jsonb(x) result from '+call+' x',Object.values(args))).rows.map(r=>r.result);return(await db.query('select '+call+' result',Object.values(args))).rows[0].result;},context={credentials,rpc,canWrite:true};
 let r=await contentCall('get_place_description',{place_id:place},context);assert.equal(r.description,'Historical description');assert.equal(r.version,1);
 await assert.rejects(contentCall('get_audio_guide',{place_id:seeded},context),/NOT_AVAILABLE/);
 await assert.rejects(contentCall('get_audio_guide',{place_id:unreviewed},context),/NOT_AVAILABLE/);
 await assert.rejects(contentCall('get_place_notes',{place_id:unreviewed},context),/NOT_AVAILABLE/);
 assert.equal((await contentCall('list_places',{},context)).items.filter(p=>p.id===place).length,1);
 await assert.throws(()=>validateCall('create_place',{place_id:place,expected_version:0,request_id:id(),patch:{name:'unauthorized'}}),/UNKNOWN_TOOL/);
 await assert.throws(()=>validateCall('update_place_metadata',{place_id:place,expected_version:1,request_id:id(),patch:{lat:1,lng:1}}),/UNKNOWN_TOOL/);
 await assert.rejects(rpc('av2_remote_content_write',{...credentials,p_request:{tool:'create_place',place_id:id(),expected_version:0,request_id:id(),patch:{name:'forbidden'}}}),/INVALID_INPUT/);
 const initial=await contentCall('update_audio_guide',{place_id:place,expected_version:0,request_id:id(),patch:{audio_guide:'Narration A'}},context);
 const next={place_id:place,expected_version:initial.record.version,request_id:id(),patch:{audio_guide:'Narration B'}};
 const changed=await contentCall('update_audio_guide',next,context);assert.equal(changed.record.data.guide.audio_guide,'Narration B');
 await assert.rejects(contentCall('update_audio_guide',{...next,request_id:id()},context),/VERSION_CONFLICT/);
 const restored=await contentCall('rollback_content',{history_id:changed.history_id,expected_version:changed.record.version,request_id:id()},context);assert.equal(restored.record.data.guide.audio_guide,'Narration A');
 await assert.deepEqual(Object.keys(initial.record.data),['place_id','guide']);
 await assert.rejects(db.exec('select * from av2_remote_grants'),/permission denied/);await assert.rejects(db.exec('select * from av2_remote_history'),/permission denied/);await assert.rejects(db.exec('select * from av2_remote_public_places'),/permission denied/);
 assert.equal((await contentCall('get_place_notes',{place_id:place},context)).notes,'Independent original notes');assert.equal((await contentCall('get_place_description',{place_id:place},context)).description,'Historical description');
 await t.test('separate notes never overwrite legacy descriptions; unreviewed existing pins remain private by default',async()=>{
  const before=await contentCall('get_place_notes',{place_id:place},context);assert.equal(before.legacy_description_fallback,false);
  const first=await contentCall('update_place_notes',{place_id:place,expected_version:r.version,request_id:id(),patch:{notes:'new independent notes'}},context);
  assert.equal(first.record.data.notes,'new independent notes');assert.equal(Object.hasOwn(first.record.data,'description'),false);
  const readDescription=await contentCall('get_place_description',{place_id:place},context);assert.equal(readDescription.description,'Historical description');
  const second=await contentCall('update_place_description',{place_id:place,expected_version:first.record.version,request_id:id(),patch:{description:'separate description'}},context);
  assert.equal(Object.hasOwn(second.record.data,'notes'),false);assert.equal(second.record.data.description,'separate description');
  assert.equal((await contentCall('get_place_notes',{place_id:place},context)).notes,'new independent notes');
 });
 await t.test('rollback only changed fields, restores absence and rejects intervening changes for all four tools',async()=>{
  const getPin=async()=>{const notes=await contentCall('get_place_notes',{place_id:place},context),description=await contentCall('get_place_description',{place_id:place},context);return{version:notes.version,notes,description};},getGuide=()=>contentCall('get_place_guide',{place_id:place},context);
  for(const [tool,patch,guide]of[
   ['update_audio_guide',{audio_guide:'C'},true],['update_place_guide',{experience:'new research',limitations:'pending verification'},true],
   ['update_place_notes',{notes:'new notes'},false],['update_place_description',{description:'new description'},false]]){
   const before=guide?(tool==='update_audio_guide'?await contentCall('get_audio_guide',{place_id:place},context):await getGuide()):await getPin(),version=before.version;
   const written=await contentCall(tool,{place_id:place,expected_version:version,request_id:id(),patch},context);
   for(const [field,value]of Object.entries(patch))assert.deepEqual(guide?written.record.data.guide[field]:written.record.data[field],value);
   const back=await contentCall('rollback_content',{history_id:written.history_id,expected_version:written.record.version,request_id:id()},context);
   if(guide){for(const field of Object.keys(patch)){const expected=tool==='update_audio_guide'?before.audio_guide:before.guide[field];assert.deepEqual(back.record.data.guide[field],expected);}}else{const getter=tool==='update_place_notes'?'get_place_notes':'get_place_description',field=tool==='update_place_notes'?'notes':'description',restored=await contentCall(getter,{place_id:place},context);assert.equal(restored[field],before[field][field]);}
   const first=await contentCall(tool,{place_id:place,expected_version:back.record.version,request_id:id(),patch},context);
   const second=await contentCall(tool,{place_id:place,expected_version:first.record.version,request_id:id(),patch:guide?{[Object.keys(patch)[0]]:'later edit'}:tool==='update_place_notes'?{notes:'later edit'}:{description:'later edit'}},context);
   await assert.rejects(contentCall('rollback_content',{history_id:first.history_id,expected_version:second.record.version,request_id:id()},context),/VERSION_CONFLICT/);
   assert.equal((guide?await getGuide():await contentCall(tool==='update_place_notes'?'get_place_notes':'get_place_description',{place_id:place},context)).version,second.record.version);
  }
 });
 await t.test('history is paginated, read-only, scoped to the public pin and contains no snapshots or credentials',async()=>{
  const first=await contentCall('list_content_history',{place_id:place,limit:1},context);
  assert.equal(first.items.length,1);assert.ok(first.next_after);assert.ok(first.items[0].history_id);
  assert.deepEqual(Object.keys(first.items[0]).sort(),['history_id','place_id','tool','changed_fields','record_id','result_version','created_at'].sort());
  const second=await contentCall('list_content_history',{place_id:place,after:first.next_after,limit:1},{...context,canWrite:false});
  assert.equal(second.items.length,1);assert.notEqual(second.items[0].history_id,first.items[0].history_id);
  for(const row of [...first.items,...second.items])assert.equal(row.place_id,place);
  await assert.rejects(contentCall('list_content_history',{place_id:seeded},context),/NOT_FOUND/);
  await assert.rejects(contentCall('list_content_history',{place_id:id()},context),/NOT_FOUND/);
  await assert.rejects(rpc('av2_remote_content_history',{...credentials,p_place:place,p_after:null,p_limit:101}),/INVALID_LIMIT/);
  await assert.rejects(db.query('select av2_remote_content_history($1,$2,$3,$4)',[trip,device,'f'.repeat(64),place]));
 });
 await t.test('creation, delete, metadata and identity mutations are rejected server-side',async()=>{
  for(const tool of['create_place','update_place_metadata','delete_place'])await assert.rejects(rpc('av2_remote_content_write',{...credentials,p_request:{tool,place_id:place,expected_version:1,request_id:id(),patch:{lat:1,lng:1}}}),/INVALID_INPUT/);
  await assert.rejects(contentCall('get_place',{place_id:place},context),/UNKNOWN_TOOL/);
 });
 await t.test('rollback restores only an added audio field without deleting the guide',async()=>{
  const fresh=id();await db.exec('reset role');await db.query("insert into av2_places_of_interest(id,trip_id,name,created_by,created_device) values($1,$2,'SECOND_PUBLIC_TEST',$3,$4)",[fresh,trip,actor,device]);await db.query('insert into av2_remote_public_places(trip_id,place_id,approved_by) values($1,$2,$3)',[trip,fresh,actor]);await db.exec('set role authenticated');
  const a=await contentCall('update_audio_guide',{place_id:fresh,expected_version:0,request_id:id(),patch:{audio_guide:'first'}},context);
  const b=await contentCall('rollback_content',{history_id:a.history_id,expected_version:a.record.version,request_id:id()},context);assert.deepEqual(b.record.data.guide,{});assert.equal(b.record.kind,'app_settings');assert.equal((await contentCall('get_audio_guide',{place_id:fresh},context)).audio_guide,'');
 });
 await t.test('private markers survive rename/flag removal; reads, writes, rollback/replay and creation fail closed',async()=>{
  for(const name of ['Mi Casa','ＣＡＳＡ — Patillas','Cása de familia','HOME','MiCasa']){
   assert.ok(privatePlace({data:{name}}));assert.throws(()=>validateCall('create_place',{place_id:id(),expected_version:0,request_id:id(),patch:{name}}),/UNKNOWN_TOOL/);
   await assert.rejects(rpc('av2_remote_content_write',{...credentials,p_request:{tool:'create_place',place_id:id(),expected_version:0,request_id:id(),patch:{name}}}),/INVALID_INPUT/);
  }
  const p=id();await db.exec('reset role');await db.query("insert into av2_places_of_interest(id,trip_id,name,created_by,created_device) values($1,$2,'Ordinary display name',$3,$4)",[p,trip,actor,device]);await db.query('insert into av2_remote_public_places(trip_id,place_id,approved_by) values($1,$2,$3)',[trip,p,actor]);await db.exec('set role authenticated');const made=await contentCall('get_place_notes',{place_id:p},context);
  for(const indicator of[{private:true},{is_private:true},{visibility:'restricted'},{privacy:'private'},{permissions:{remote_access:false}}])assert.ok(privatePlace({data:{name:'Neutral name',...indicator}}));
  const a={place_id:p,expected_version:0,request_id:id(),patch:{audio_guide:'protected narration'}};
  const g=await contentCall('update_audio_guide',a,context);
  await db.exec('reset role');
  await db.query("update av2_records set data=jsonb_set(data,'{guide,privacy}',to_jsonb('private'::text)) where id=$1",[g.record.id]);
  await db.query("update av2_records set data=data #- '{guide,privacy}' where id=$1",[g.record.id]);
  await db.query("update av2_places_of_interest set name='Renamed public appearance' where id=$1",[p]);
  await db.exec('set role authenticated');
  await assert.rejects(contentCall('get_audio_guide',{place_id:p},context),/NOT_AVAILABLE/);
  await assert.rejects(contentCall('list_content_history',{place_id:p},context),/NOT_FOUND/);
  for(const [tool,patch]of[['update_place_notes',{notes:'leak'}],['update_place_description',{description:'leak'}],['update_place_guide',{experience:'leak'}]])await assert.rejects(contentCall(tool,{place_id:p,expected_version:tool==='update_place_guide'?g.record.version:made.version,request_id:id(),patch},context),/PRIVATE_PLACE/);
  await assert.rejects(contentCall('update_audio_guide',a,context),/PRIVATE_PLACE/);
  await assert.rejects(contentCall('rollback_content',{history_id:g.history_id,expected_version:g.record.version,request_id:id()},context),/PRIVATE_PLACE/);
  await assert.rejects(rpc('av2_remote_content_write',{...credentials,p_request:{tool:'update_place_metadata',place_id:p,expected_version:made.version,request_id:id(),patch:{name:'Bypass identity'}}}),/INVALID_INPUT/);
  await assert.rejects(db.exec('select * from av2_remote_private_places'),/permission denied/);
 });
 await t.test('SQL independently enforces OAuth write grants, expiry, revocation and device binding',async()=>{
  const client=id(),claims=JSON.stringify({client_id:client});await db.query("select set_config('request.jwt.claims',$1,false)",[claims]);
  const write=()=>contentCall('update_place_notes',{place_id:place,expected_version:1,request_id:id(),patch:{notes:'forbidden'}},context);
  await assert.rejects(write(),/OAUTH_READ_ONLY/);
  await assert.rejects(contentCall('list_content_history',{place_id:place},context),/GRANT_REVOKED/);
  await db.exec('reset role');await db.query("insert into av2_remote_grants(auth_user_id,client_id,trip_id,actor_user,device_id,cipher,can_write,expires_at) values($1,$2,$3,$4,$5,'{}',false,now()+interval '1 day')",[auth,client,trip,actor,device]);await db.exec('set role authenticated');await assert.rejects(write(),/OAUTH_READ_ONLY/);
  assert.ok((await contentCall('list_content_history',{place_id:place},context)).items.length);
  for(const sql of["can_write=true,expires_at=now()-interval '1 second'","can_write=true,expires_at=now()+interval '1 day',revoked_at=now()"]){await db.exec('reset role');await db.exec('update av2_remote_grants set '+sql);await db.exec('set role authenticated');await assert.rejects(write(),/OAUTH_READ_ONLY/);await assert.rejects(contentCall('list_content_history',{place_id:place},context),/GRANT_REVOKED/);}
  await db.query("select set_config('request.jwt.claims','{}',false)");
 });
 await t.test('existing mobile sync receives remote versions and retains cached text across offline failure/reconnect',async()=>{
  const cached=new Map(),meta=new Map();let online=true;
  const store={pinMode:true,device,deviceToken:token,activeUser:{id:actor},all:async table=>table==='records'?[...cached.values()]:[],put:async(table,row)=>{if(table==='meta')meta.set(row.id,row);},ingest:async rows=>{for(const row of rows)cached.set(row.id,structuredClone(row));},ingestConflicts:async()=>{}};
  const remote=new SupabaseRemote({rpc:async(name,args)=>{if(!online)return{error:{message:'OFFLINE'}};return{data:await rpc(name,args),error:null};}},device,token,trip);remote.pinAccess={store,validate:async()=>{if(!online)throw Error('OFFLINE');}};
  const sync=new SyncEngine(store,remote);await sync.run();assert.equal(cached.get(place).id,place);
  const before=await contentCall('get_place_notes',{place_id:place},context),edit=await contentCall('update_place_notes',{place_id:place,expected_version:before.version,request_id:id(),patch:{notes:'remote sync text'}},context);
  await sync.run();assert.equal(cached.get(place).data.notes,'remote sync text');assert.equal(cached.get(place).version,edit.record.version);
  online=false;await assert.rejects(sync.run(),/OFFLINE/);assert.equal(cached.get(place).data.notes,'remote sync text');
  online=true;await sync.run();assert.equal(cached.get(place).version,edit.record.version);assert.ok(meta.has('last-sync'));
 });
 await db.exec('reset role');assert.deepEqual(await snapshot(),originals);assert.ok(!(await db.query('select request from av2_remote_history')).rows.some(r=>JSON.stringify(r).includes(token)));await db.exec('set role authenticated');
 await db.exec('reset role');await assert.rejects(db.exec('delete from av2_remote_history'),/APPEND_ONLY/);
 await db.query("update av2_app_users set agenda_role='VIEWER' where id=$1",[actor]);await db.exec('set role authenticated');
 await assert.rejects(contentCall('update_place_notes',{place_id:place,expected_version:1,request_id:id(),patch:{notes:'blocked'}},context),/READ_ONLY/);
 await db.exec('reset role');await db.query("update av2_user_devices set state='Revocado' where device_id=$1",[device]);await db.exec('set role authenticated');
 await assert.rejects(contentCall('get_place_notes',{place_id:place},context),/REVOKED/);
 }finally{await db.close();}
});

test('HTTP MCP/API enforce delegated read-only permissions, expiry, revocation and cannot expose device credentials',async()=>{
 const user=id(),clientId=id(),actor=id(),credentials={p_trip:id(),p_device:id(),p_token:'f'.repeat(64)},url='https://example.supabase.co';
 let grant={auth_user_id:user,client_id:clientId,trip_id:credentials.p_trip,actor_user:actor,device_id:credentials.p_device,cipher:{sealed:true},can_write:false,revoked_at:null,expires_at:new Date(Date.now()+60000).toISOString()},writes=0,valid=true,canEdit=true,opened=0;
 const fakeClient={auth:{getUser:async()=>({data:{user:valid?{id:user}:null},error:valid?null:Error('invalid token')})},
  from:()=>{const chain={select:()=>chain,eq:()=>chain,is:()=>chain,gt:()=>Promise.resolve({data:grant?[grant]:[],error:null})};return chain;},
  rpc:async(name)=>{if(name==='av2_schedule_access')return{data:{user_id:actor,can_edit:canEdit},error:null};if(name==='av2_remote_content_write')writes++;return{data:[],error:null};}};
 const handler=createRemoteHandler({url,anon:'public',serviceRoleKey:'SERVER_KEY_TEST',createClient:()=>fakeClient,cipher:async()=>({open:async()=>{opened++;return credentials;}})});
 const token=claims=>'Bearer '+['e30',Buffer.from(JSON.stringify(claims)).toString('base64url'),'signature'].join('.');
 const call=(path,body,claims={client_id:clientId})=>handler(new Request(url+'/functions/v1/av2-remote-content'+path,{method:'POST',headers:{Authorization:token(claims),'Content-Type':'application/json'},body:JSON.stringify(body)}));
 const patch={place_id:id(),expected_version:1,request_id:id(),patch:{notes:'edit'}};
 const api={tool:'update_place_notes',arguments:patch},mcp={jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'update_place_notes',arguments:patch}};
 for(const [path,body]of[['/api',api],['',mcp]]){const r=await call(path,body);assert.equal(r.status,403);assert.doesNotMatch(await r.text(),/ffffffff|SERVER_KEY_TEST|sealed|p_token/);}
 assert.equal(writes,0);
 for(const path of['/api','/authorize','/revoke'])assert.equal((await call(path,{...api,credentials,can_write:true})).status,403);
 const tools=await(await call('',{jsonrpc:'2.0',id:2,method:'tools/list'})).json();assert.ok(tools.result.tools.every(t=>t.annotations.readOnlyHint));
 const allowed=['list_places','get_audio_guide','get_place_guide','get_place_notes','get_place_description','list_content_history'];
 assert.deepEqual(tools.result.tools.map(t=>t.name).sort(),allowed.sort());
 for(const tool of ['create_place','delete_place','update_place_metadata','get_place','get_itinerary','get_sync_status','list_zones','list_routes','list_travel_records']){
  assert.equal((await call('/api',{tool,arguments:{}})).status,404);
  assert.equal((await call('',{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:tool,arguments:{}}})).status,404);
 }
 for(const change of[{revoked_at:new Date().toISOString()},{expires_at:new Date(Date.now()-1).toISOString()},{actor_user:id()},{device_id:id()},{trip_id:id()},{auth_user_id:id()},{client_id:id()}]){
  const old=grant;grant={...grant,...change};assert.equal((await call('/api',api)).status,403);grant=old;
 }
 const good=grant;grant=null;assert.equal((await call('/api',api)).status,403);grant=good;
 grant={...grant,can_write:true};assert.equal((await call('/api',api)).status,200);assert.equal(writes,1);
 const writeTools=await(await call('',{jsonrpc:'2.0',id:4,method:'tools/list'})).json();assert.deepEqual(writeTools.result.tools.map(t=>t.name).sort(),[...allowed,'update_audio_guide','update_place_guide','update_place_notes','update_place_description','rollback_content'].sort());
 const deniedFields=await call('/api',{tool:'update_place_notes',arguments:{...patch,patch:{notes:'ok',lat:1,lng:2}}});assert.equal(deniedFields.status,400);assert.equal(writes,1);
 canEdit=false;assert.equal((await call('/api',api)).status,403);canEdit=true;
 canEdit=false;assert.equal((await call('/authorize',{credentials,authorization_id:'valid-request',can_write:true},{})).status,403);canEdit=true;
 assert.equal((await call('/authorize',{credentials,authorization_id:'valid-request',can_write:true})).status,403);
 valid=false;const before=opened;assert.equal((await call('/api',api)).status,401);assert.equal(opened,before);valid=true;
 assert.equal((await handler(new Request(url+'/functions/v1/av2-remote-content',{method:'POST',body:'{}'}))).status,401);
 assert.equal((await handler(new Request(url+'/functions/v1/av2-remote-content/.well-known/oauth-protected-resource'))).status,200);
 assert.equal((await call('/api',{...api,credentials},{})).status,200);assert.equal(writes,2);
});

test('grant encryption is server-only, bound to user/client/trip and fails on tampering',async()=>{
 const cipher=await credentialCipher(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'));
 const data={p_trip:id(),p_device:id(),p_token:'a'.repeat(64)},aad=id()+':'+id()+':'+data.p_trip,sealed=await cipher.seal(aad,data);
 assert.doesNotMatch(JSON.stringify(sealed),new RegExp(data.p_token));assert.deepEqual(await cipher.open(aad,sealed),data);
 await assert.rejects(cipher.open(aad+'other',sealed));await assert.rejects(cipher.open(aad,{...sealed,data:sealed.data.slice(2)}));
});

test('MCP schemas disclose exact field and version contracts without device secrets',()=>{
 const tools=toolDefinitions(),by=name=>tools.find(t=>t.name===name);
 assert.deepEqual(by('list_content_history').inputSchema.required,['place_id']);
 assert.equal(by('list_content_history').annotations.readOnlyHint,true);
 assert.deepEqual(Object.keys(by('update_place_notes').inputSchema.properties.patch.properties),['notes']);
 assert.deepEqual(Object.keys(by('update_audio_guide').inputSchema.properties.patch.properties),['audio_guide']);
 assert.deepEqual(Object.keys(by('update_place_description').inputSchema.properties.patch.properties),['description']);
 assert.equal(by('update_place_guide').inputSchema.properties.patch.additionalProperties,false);
 assert.deepEqual(by('rollback_content').inputSchema.required,['expected_version','request_id','history_id']);
 assert.doesNotMatch(JSON.stringify(tools),/p_token|p_device|service_role/);
 assert.throws(()=>validateCall('list_content_history',{}),/PLACE_ID_REQUIRED/);
});
