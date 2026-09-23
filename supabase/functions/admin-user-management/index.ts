import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
const encoder=new TextEncoder();
const b64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes));
const unb64=(value:string)=>Uint8Array.from(atob(value),char=>char.charCodeAt(0));
const genericError=()=>json({error:'ACCESS_VALIDATION_FAILED'},403);
async function hashPin(pin:string){const salt=crypto.getRandomValues(new Uint8Array(16)),iterations=120000;const key=await crypto.subtle.importKey('raw',encoder.encode(pin),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations,hash:'SHA-256'},key,256);return `pbkdf2$${iterations}$${b64(salt)}$${b64(new Uint8Array(bits))}`;}
async function verifyPin(pin:string,encoded:string){const [scheme,rawIterations,saltText,hashText]=String(encoded||'').split('$');if(scheme!=='pbkdf2'||!rawIterations||!saltText||!hashText)return false;const key=await crypto.subtle.importKey('raw',encoder.encode(pin),'PBKDF2',false,['deriveBits']);const bits=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:unb64(saltText),iterations:Number(rawIterations),hash:'SHA-256'},key,256));const expected=unb64(hashText);if(bits.length!==expected.length)return false;let diff=0;for(let i=0;i<bits.length;i++)diff|=bits[i]^expected[i];return diff===0;}
const validPin=(pin:string)=>/^\d{6}$/.test(pin);

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  try{
    const authHeader=req.headers.get('Authorization');if(!authHeader)return json({error:'AUTH_REQUIRED'},401);
    const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!;
    const callerClient=createClient(url,anon,{global:{headers:{Authorization:authHeader}}});
    const {data:{user:caller}}=await callerClient.auth.getUser();if(!caller)return json({error:'AUTH_REQUIRED'},401);
    const body=await req.json(),action=String(body.action||''),tripId=body.tripId;
    if(action==='check_access'){
      const target=body.userId||caller.id;if(target!==caller.id)return genericError();
      const {data:access,error}=await callerClient.rpc('av_get_private_access',{p_user_id:caller.id});
      if(error||!access||access.access_status!=='ACTIVE')return genericError();
      return json({ok:true});
    }
    if(action==='verify_pin'){
      const target=body.userId||caller.id;if(target!==caller.id)return genericError();
      const {data:access,error}=await callerClient.rpc('av_get_private_access',{p_user_id:caller.id});
      if(error||!access||access.access_status!=='ACTIVE'||!access.pin_hash)return genericError();
      if(access.pin_locked_until&&new Date(access.pin_locked_until)>new Date())return genericError();
      const ok=validPin(String(body.pin||''))&&await verifyPin(String(body.pin),access.pin_hash);await callerClient.rpc('av_record_pin_attempt',{p_user_id:caller.id,p_success:ok});
      if(!ok)return genericError();return json({ok:true});
    }
    if(action==='set_pin'||action==='reset_pin'){
      if(!validPin(String(body.pin||'')))return json({error:'PIN_MUST_BE_SIX_DIGITS'},400);
      const pinHash=await hashPin(String(body.pin));const {data,error}=await callerClient.rpc('av_admin_private_access_action',{p_trip_id:tripId,p_target_user_id:body.userId||caller.id,p_action:'set_pin',p_role:body.role||null,p_access_status:body.accessStatus||'ACTIVE',p_pin_hash:pinHash,p_permissions:body.permissions||null});
      if(error)throw error;return json({ok:true,access:data});
    }
    if(['set_access_status','set_role','set_trip_access'].includes(action)){
      const {data,error}=await callerClient.rpc('av_admin_private_access_action',{p_trip_id:tripId,p_target_user_id:body.userId,p_action:action,p_role:body.role||null,p_access_status:body.accessStatus||null,p_permissions:body.permissions||null});
      if(error)throw error;return json({ok:true,access:data});
    }
    const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(!service)return json({error:'SERVER_ADMIN_SECRET_UNAVAILABLE'},503);const admin=createClient(url,service);
    const {data:isAdmin,error:adminError}=await callerClient.rpc('av_is_admin',{p_trip_id:tripId});if(adminError||!isAdmin)return json({error:'ADMIN_REQUIRED'},403);
    if(action==='invite'){
      const invited=await admin.auth.admin.inviteUserByEmail(body.email,{data:{display_name:body.displayName||''},redirectTo:body.redirectTo});if(invited.error)throw invited.error;const userId=invited.data.user.id;const profile=await admin.from('av_users').upsert({id:userId,display_name:body.displayName||body.email,email:body.email});if(profile.error)throw profile.error;const access=await callerClient.rpc('av_admin_private_access_action',{p_trip_id:tripId,p_target_user_id:userId,p_action:'set_trip_access',p_role:body.role||'VIEWER',p_access_status:'INVITED',p_permissions:body.permissions||{}});if(access.error)throw access.error;return json({ok:true,userId});
    }
    if(action==='reset_email'){const result=await admin.auth.admin.generateLink({type:'recovery',email:body.email,options:{redirectTo:body.redirectTo}});if(result.error)throw result.error;return json({ok:true});}
    return json({error:'UNKNOWN_ACTION'},400);
  }catch(error){return json({error:String(error?.message||error)},500)}
});
