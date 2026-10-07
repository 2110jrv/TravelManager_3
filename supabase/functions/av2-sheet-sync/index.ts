import {createClient} from 'npm:@supabase/supabase-js@2.45.4';
import {hashPin,equalSecret,randomSecret} from '../av2-pin-auth/crypto.js';
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
  const audit=await checked(admin.from('av2_audit_log').select('*').eq('trip_id',trip).gt('id',Number(b.audit_cursor)||0).order('id').limit(200));
  return json({devices:devices.map((d:any)=>({...d,user:users.find((u:any)=>u.id===d.user_id)?.name})),audit:audit.map((a:any)=>({...a,user:users.find((u:any)=>u.id===a.actor_user)?.name||''})),pin_configured:configured.map((u:any)=>({name:u.name,configured:!!u.pin_hash}))});
 }catch{return json({error:'SHEET_SYNC_UNAVAILABLE'},503);}
});
