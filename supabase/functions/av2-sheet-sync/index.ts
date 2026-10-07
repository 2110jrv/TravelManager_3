import {FrankfurterProvider} from '../../../public/v2/fx-reference.js';
import {syncExpenses,expenseValues} from './expenses.js';
import {createClient} from 'npm:@supabase/supabase-js@2.45.4';
import {hashPin,equalSecret,randomSecret} from '../av2-pin-auth/crypto.js';
import {syncPlaces,placeValues} from './places.js';
import {resolveMaps} from '../av2-google-token/locations.js';
import {ownerGoogleAccess} from './google-access.ts';
import {calendarPoints,assignFromCalendar} from './assignment.js';
const sheet='1ioksMcQa6iE_f792eKmgJw68f_6Hdaproie2xOlcv20';
const json=(b:unknown,status=200)=>new Response(JSON.stringify(b),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
Deno.serve(async req=>{
 if(req.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
 const secret=Deno.env.get('AV2_SHEET_SYNC_SECRET');if(!secret||!equalSecret(req.headers.get('x-av2-sheet-secret'),secret))return json({error:'FORBIDDEN'},403);
 try{
  const b=await req.json();if(b.spreadsheet_id!==sheet||!Array.isArray(b.pins)||b.pins.length>10||!Array.isArray(b.devices)||b.devices.length>200)return json({error:'INVALID_SNAPSHOT'},400);
  const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}}),trip='7c0801ee-07b1-4d86-95d7-202610200001',pepper=Deno.env.get('AV2_PIN_PEPPER');if(!pepper)return json({error:'CONFIGURATION_REQUIRED'},503);
  const checked=async(p:any)=>{const r=await p;if(r.error)throw Error('STORAGE');return r.data;};
  const users=await checked(admin.from('av2_app_users').select('*').eq('trip_id',trip));
  const supplied=new Set();for(const row of b.pins){const user=users.find((u:any)=>u.name===row.name);if(!['Activo','Inactivo'].includes(row.state)||!user||supplied.has(row.name))return json({error:'INVALID_USERS'},400);supplied.add(row.name);}
  // Reject duplicate PINs; comparing both existing and proposed credentials never returns PINs.
  const proposed=[];for(const row of b.pins){if(row.pin&&!/^\d{4,32}$/.test(row.pin))return json({error:'INVALID_PIN_FORMAT'},400);const u=users.find((v:any)=>v.name===row.name);proposed.push({u,row});}
  for(let i=0;i<proposed.length;i++)for(let j=i+1;j<proposed.length;j++){const a=proposed[i],c=proposed[j];if(a.row.pin&&c.row.pin&&equalSecret(a.row.pin,c.row.pin))return json({error:'PINS_MUST_DIFFER'},400);}
  for(const a of proposed)if(a.row.pin)for(const other of proposed)if(other.u.id!==a.u.id&&!other.row.pin&&other.u.pin_hash&&equalSecret(await hashPin(a.row.pin,other.u.pin_salt,pepper),other.u.pin_hash))return json({error:'PINS_MUST_DIFFER'},400);
  for(const{u,row}of proposed){let salt=u.pin_salt,hash=u.pin_hash,version=u.pin_version;
   if(row.pin&&(!hash||!equalSecret(await hashPin(row.pin,salt,pepper),hash))){salt=randomSecret();hash=await hashPin(row.pin,salt,pepper);version++;}
   const active=row.state==='Activo';if(active&&!u.active)version++;
   await checked(admin.from('av2_app_users').update({pin_salt:salt,pin_hash:hash,pin_version:version,active,updated_at:new Date().toISOString()}).eq('id',u.id));row.pin='';
  }
  const current=await checked(admin.from('av2_user_devices').select('*').in('user_id',users.map((u:any)=>u.id)));
  for(const row of b.devices){const u=users.find((v:any)=>v.name===row.user);const d=current.find((v:any)=>v.user_id===u?.id&&v.installation_id===row.installation_id);if(!d)continue;const name=String(row.name||d.friendly_name).slice(0,100),state=row.state==='Revocado'?'Revocado':d.state;
   if(name!==d.friendly_name||state!==d.state){await checked(admin.from('av2_user_devices').update({friendly_name:name,state}).eq('id',d.id));await checked(admin.from('av2_audit_log').insert({trip_id:trip,actor_user:d.user_id,installation_id:d.installation_id,device_name:name,action:state!==d.state?'device revoke':'device rename',entity:'device',entity_id:d.id,summary:'Cambio desde DISPOSITIVOS'}));}
  }
  for(const key of (b.deleted_keys||[]).slice(0,200)){const d=current.find((v:any)=>users.find((u:any)=>u.id===v.user_id)?.name+'|'+v.installation_id===key);if(!d||!d.sheet_exported||d.state==='Revocado')continue;await checked(admin.from('av2_user_devices').update({state:'Revocado'}).eq('id',d.id));await checked(admin.from('av2_audit_log').insert({trip_id:trip,actor_user:d.user_id,installation_id:d.installation_id,device_name:d.friendly_name,action:'device revoke',entity:'device',entity_id:d.id,summary:'Fila eliminada desde DISPOSITIVOS'}));}
  const devices=await checked(admin.from('av2_user_devices').select('id,user_id,installation_id,friendly_name,detected,first_authorized_at,last_used_at,state').in('user_id',users.map((u:any)=>u.id)).order('first_authorized_at'));
  await checked(admin.from('av2_user_devices').update({sheet_exported:true}).in('user_id',users.map((u:any)=>u.id)));
  const configured=await checked(admin.from('av2_app_users').select('name,pin_hash').eq('trip_id',trip));
  let placesResult:any=null;if(b.places!==undefined){
   let events:Promise<any>|null=null;const config=await checked(admin.from('av2_trips').select('start_date,end_date,calendar_id').eq('id',trip).single());
   const resolve=async(input:string,details=true)=>{const cached=await checked(admin.from('av2_map_locations').select('latitude,longitude,display_name,place_id,resolved_address,resolved_city,details_checked').eq('trip_id',trip).eq('source_url',input).maybeSingle());if(cached&&(!details||cached.details_checked))return{input,point:{lat:cached.latitude,lng:cached.longitude},name:cached.display_name,place_id:cached.place_id,address:cached.resolved_address,city:cached.resolved_city};const value=await resolveMaps(input,fetch,details);if(value.point)await checked(admin.from('av2_map_locations').upsert({trip_id:trip,source_url:input,latitude:value.point.lat,longitude:value.point.lng,display_name:value.name,place_id:value.place_id||null,...(details?{resolved_address:value.address||null,resolved_city:value.city||null,details_checked:true}:{})}));return value;};
   const repository={list:async()=>{const rows=await checked(admin.from('av2_places_of_interest').select('*').eq('trip_id',trip).order('created_at').limit(501));if(rows.length>500)throw Error('PLACES_LIMIT');return rows;},apply:async(v:any)=>checked(admin.rpc('av2_sheet_place_apply',{p_trip:trip,p_code:v.code,p_row_key:v.rowKey,p_changes:v.changes,p_base:v.base,p_actor:v.actor,p_origin:v.origin,p_external_actor:v.externalActor}))};
   const assign=async(place:any)=>{if(place.lat==null)return assignFromCalendar(place,[]);try{events ||= ownerGoogleAccess(admin,trip).then(token=>calendarPoints({trip:config,token,resolve:(input:string)=>resolve(input,false)}));const result=assignFromCalendar(place,await events);if(!place.resolved_city&&!result.review_reason)result.review_reason='Ciudad/zona sin confirmar';return result;}catch{return{assigned_dates:[],assigned_areas:[],review_reason:'Asignación pendiente; Calendar no disponible'};}};
   placesResult=await syncPlaces({rows:b.places,deleted:b.deleted_places||[],repository,resolve,assign,actor:b.places_actor==='Jenny'?'Jenny':'Jonathan',origin:b.places_origin==='Google Sheet'?'Google Sheet':'ChatGPT/Admin',externalActor:typeof b.places_external_actor==='string'?b.places_external_actor.slice(0,250):null});
   placesResult.places=placesResult.places.map((p:any)=>({code:p.poi_code,data:p,values:placeValues(p,users)}));
  }
  let expensesResult:any=null;if(b.expenses!==undefined){
   const repository={list:async()=>{const rows=await checked(admin.from('av2_records').select('*').eq('trip_id',trip).eq('kind','expenses').order('created_at').limit(501));if(rows.length>500)throw Error('EXPENSES_LIMIT');return rows;},apply:async(v:any)=>checked(admin.rpc('av2_sheet_expense_apply',{p_trip:trip,p_code:v.code,p_row_key:v.rowKey,p_changes:v.changes,p_base:v.base,p_actor:v.actor,p_origin:v.origin,p_external_actor:v.externalActor}))};
   const provider=new FrankfurterProvider(),rates=new Map();const snapshot=async(data:any,previous:any)=>{const amount=Number(data.amount),currency=data.currency,unchanged=previous.cost_status==='PAID'&&data.cost_status==='PAID'&&Number(previous.amount_original??previous.amount)===amount&&(previous.currency_original??previous.currency)===currency;if(unchanged)return{};let reference:any=currency==='USD'?{rate:1,rate_date:new Date().toISOString().slice(0,10),source:'identity'}:null;
    if(currency!=='USD')try{if(!rates.has(currency))rates.set(currency,await provider.get(currency,'USD'));reference=rates.get(currency);}catch{const known=(await repository.list()).map((r:any)=>r.data).filter((d:any)=>d.currency_original===currency&&d.fx_rate_to_base>0).sort((a:any,c:any)=>String(c.rate_date).localeCompare(String(a.rate_date)))[0];if(known)reference={rate:known.fx_rate_to_base,rate_date:known.rate_date,source:(known.rate_source||'Referencia')+' · guardada'};rates.set(currency,reference);}
    return{amount_original:amount,currency_original:currency,fx_rate_to_base:reference?.rate??null,amount_base:reference?amount*reference.rate:null,rate_date:reference?.rate_date??null,rate_source:reference?.source??null};};
   expensesResult=await syncExpenses({rows:b.expenses,deleted:b.deleted_expenses||[],repository,snapshot,actor:b.places_actor==='Jenny'?'Jenny':'Jonathan',origin:b.places_origin==='Google Sheet'?'Google Sheet':'ChatGPT/Admin',externalActor:b.places_external_actor||null});expensesResult.expenses=expensesResult.expenses.map((record:any)=>({code:record.data.expense_id,record,values:expenseValues(record,users)}));
  }
  const audit=await checked(admin.from('av2_audit_log').select('*').eq('trip_id',trip).gt('id',Number(b.audit_cursor)||0).order('id').limit(200));
  return json({devices:devices.map((d:any)=>({...d,user:users.find((u:any)=>u.id===d.user_id)?.name})),audit:audit.map((a:any)=>({...a,user:a.origin!=='Agenda'&&a.external_actor?a.external_actor:users.find((u:any)=>u.id===a.actor_user)?.name||'',entity_id:a.poi_code||a.entity_id,summary:a.entity==='places_of_interest'?'['+a.origin+'] '+a.summary:a.summary})),pin_configured:configured.map((u:any)=>({name:u.name,configured:!!u.pin_hash})),...(placesResult?{places_result:placesResult}:{}),...(expensesResult?{expenses_result:expensesResult}:{})});
 }catch{return json({error:'SHEET_SYNC_UNAVAILABLE'},503);}
});
