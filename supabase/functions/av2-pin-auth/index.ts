import {createClient} from 'npm:@supabase/supabase-js@2.45.4';
import {hashPin,equalSecret,contextHash,randomSecret} from './crypto.js';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return json({});if(req.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
 try{
  if(Number(req.headers.get('content-length')||0)>8192)return json({error:'INVALID_REQUEST'},400);
  const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_ANON_KEY')!,pepper=Deno.env.get('AV2_PIN_PEPPER');if(!pepper)return json({error:'ACCESS_UNAVAILABLE'},503);
  
  const b=await req.json();if((b.action!=='restore'&&(typeof b.pin!=='string'||!/^\d{4,32}$/.test(b.pin)))||!/^[-0-9a-f]{36}$/i.test(b.installation_id)||!/^[0-9a-f]{64}$/.test(b.device_token))return json({error:'PIN_INVALID'},400);
  const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  const ip=req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||req.headers.get('cf-connecting-ip')||'unknown';
  const keys=['installation:'+b.installation_id,'ip:'+await contextHash(ip,pepper)].sort();
  const limit=await admin.rpc('av2_pin_attempt',{p_keys:keys});if(limit.error||!limit.data)return json({error:'PIN_RATE_LIMIT'},429);
  let matched:any=null,resumed:any=null;
  if(b.action==='restore'){const r=await admin.rpc('av2_pin_resume',{p_trip:b.trip_id,p_device:b.device_id,p_installation:b.installation_id,p_token:b.device_token});if(r.error)return json({error:'ACCESS_UNAVAILABLE'},503);if(r.data?.error)return json({error:r.data.error},403);resumed=r.data;}else{
  const{data:users,error}=await admin.from('av2_app_users').select('id,active,pin_salt,pin_hash').eq('trip_id',b.trip_id);if(error)return json({error:'ACCESS_UNAVAILABLE'},503);
  const matches=[];for(const candidate of users||[]){const salt=candidate.pin_salt||'unconfigured-user-salt';const computed=await hashPin(b.pin,salt,pepper);if(candidate.pin_hash&&equalSecret(computed,candidate.pin_hash))matches.push(candidate);}
  b.pin='';matched=matches.length===1?matches[0]:null;if(!matched||!matched.active)return json({error:'PIN_INVALID'},403);
  }
  const allowed=['mobile','platform','browser','browser_version','model','platform_version','architecture'];const detected=Object.fromEntries(allowed.filter(k=>typeof b.detected?.[k]==='string'||typeof b.detected?.[k]==='boolean').map(k=>[k,typeof b.detected[k]==='string'?b.detected[k].slice(0,100):b.detected[k]]));
  const password=randomSecret();let account=(await admin.from('av2_installation_auth').select('auth_user_id,email').eq('installation_id',b.installation_id).maybeSingle()).data;
  if(resumed&&(!account||account.auth_user_id!==resumed.auth_user_id))return json({error:'DEVICE_REVOKED'},403);
  if(!account){const email=crypto.randomUUID()+'@auth.av2.invalid';const created=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{av2_technical:true}});if(created.error||!created.data.user)return json({error:'ACCESS_UNAVAILABLE'},503);const stored=await admin.from('av2_installation_auth').insert({installation_id:b.installation_id,auth_user_id:created.data.user.id,email});if(stored.error){await admin.auth.admin.deleteUser(created.data.user.id);account=(await admin.from('av2_installation_auth').select('auth_user_id,email').eq('installation_id',b.installation_id).single()).data;}else account={auth_user_id:created.data.user.id,email};}
  if(!account)return json({error:'ACCESS_UNAVAILABLE'},503);
  const updated=await admin.auth.admin.updateUserById(account.auth_user_id,{password});if(updated.error)return json({error:'ACCESS_UNAVAILABLE'},503);
  const technical=createClient(url,key,{auth:{persistSession:false}});const login=await technical.auth.signInWithPassword({email:account.email,password});if(login.error||!login.data.session)return json({error:'ACCESS_UNAVAILABLE'},503);
  const result=resumed?{data:{user:resumed.user,device:resumed.device},error:null}:await admin.rpc('av2_pin_authorize',{p_trip:b.trip_id,p_user:matched.id,p_auth:account.auth_user_id,p_installation:b.installation_id,p_token:b.device_token,p_detected:detected,p_name:String(b.friendly_name||'Dispositivo').slice(0,100),p_version:String(b.app_version||'').slice(0,80)});
  if(result.error)return json({error:'ACCESS_UNAVAILABLE'},503);
  await admin.rpc('av2_pin_attempt',{p_keys:keys,p_success:true});return json({...result.data,session:{access_token:login.data.session.access_token,refresh_token:login.data.session.refresh_token}});
 }catch{return json({error:'ACCESS_UNAVAILABLE'},503);}
});
