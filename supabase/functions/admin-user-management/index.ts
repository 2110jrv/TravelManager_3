import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
const encoder=new TextEncoder();
const b64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes));
const unb64=(value:string)=>Uint8Array.from(atob(value),char=>char.charCodeAt(0));
const genericError=()=>json({error:'ACCESS_VALIDATION_FAILED'},403);
async function hashPin(pin:string){const salt=crypto.getRandomValues(new Uint8Array(16)),iterations=120000;const key=await crypto.subtle.importKey('raw',encoder.encode(pin),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations,hash:'SHA-256'},key,256);return `pbkdf2$${iterations}$${b64(salt)}$${b64(new Uint8Array(bits))}`;}
async function verifyPin(pin:string,encoded:string){try{const [scheme,rawIterations,saltText,hashText]=String(encoded||'').split('$');if(scheme!=='pbkdf2'||!rawIterations||!saltText||!hashText)return false;const iterations=Number(rawIterations);if(!Number.isSafeInteger(iterations)||iterations<1)return false;const key=await crypto.subtle.importKey('raw',encoder.encode(pin),'PBKDF2',false,['deriveBits']);const bits=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:unb64(saltText),iterations,hash:'SHA-256'},key,256));const expected=unb64(hashText);if(bits.length!==expected.length)return false;let diff=0;for(let i=0;i<bits.length;i++)diff|=bits[i]^expected[i];return diff===0;}catch{return false;}}
const validPin=(pin:string)=>/^\d{4}$/.test(pin);
const validLoginPin=(pin:string)=>/^\d{4}$/.test(pin)||/^\d{6}$/.test(pin);
const b64encode=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes));
const b64decode=(value:string)=>Uint8Array.from(atob(value),char=>char.charCodeAt(0));
async function pinLookup(pin:string){
  const secret=Deno.env.get('PIN_LOOKUP_SECRET');
  if(!secret)throw Error('PIN_LOOKUP_SECRET_UNAVAILABLE');
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const digest=await crypto.subtle.sign('HMAC',key,encoder.encode(pin));
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}
async function pinCipherKey(){const secret=Deno.env.get('PIN_ENCRYPTION_KEY');if(!secret)throw Error('PIN_ENCRYPTION_KEY_UNAVAILABLE');const digest=await crypto.subtle.digest('SHA-256',encoder.encode(secret));return crypto.subtle.importKey('raw',digest,{name:'AES-GCM'},false,['encrypt','decrypt']);}
async function encryptPin(pin:string){const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},await pinCipherKey(),encoder.encode(pin));return {ciphertext:b64encode(new Uint8Array(encrypted)),iv:b64encode(iv),version:'v1'};}
async function decryptPin(ciphertext:string,iv:string){const decoded=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64decode(iv)},await pinCipherKey(),b64decode(ciphertext));return new TextDecoder().decode(decoded);}
const defaultRolePermissions=(role:string)=>{const permissions={viewHome:true,viewAgenda:true,editAgenda:role!=='VIEWER',deleteAgenda:role==='ADMIN',viewMap:true,viewPhotos:true,uploadPhotos:role!=='VIEWER',deletePhotos:role==='ADMIN',viewChat:true,writeChat:role!=='VIEWER',viewBudget:role!=='VIEWER',viewDocuments:true,manageDocuments:role==='ADMIN',editTrip:role!=='VIEWER'};return {...permissions,CanChat:permissions.viewChat&&permissions.writeChat,CanEditAgenda:permissions.editAgenda,CanViewDocuments:permissions.viewDocuments};};
const normalizeRolePermissions=(permissions:any)=>({...permissions,CanChat:permissions.viewChat!==false&&permissions.writeChat!==false,CanEditAgenda:permissions.editAgenda!==false,CanViewDocuments:permissions.viewDocuments!==false});
async function isInternalAdmin(admin:any,userId:string,tripId:string){
  const [{data:access},{data:membership}]=await Promise.all([
    admin.from('av_app_access').select('access_status,role').eq('user_id',userId).maybeSingle(),
    admin.from('av_trip_memberships').select('role,status').eq('user_id',userId).eq('trip_id',tripId).maybeSingle()
  ]);
  return access?.access_status==='ACTIVE'&&access?.role==='ADMIN'&&membership?.status==='ACTIVE'&&membership?.role==='ADMIN';
}
async function issueSession(admin:any,userId:string){
  const {data:user,error:userError}=await admin.auth.admin.getUserById(userId);if(userError||!user?.user?.email)throw Error('SESSION_BOOTSTRAP_FAILED');
  const generated=await admin.auth.admin.generateLink({type:'magiclink',email:user.user.email});
  const tokenHash=generated.data?.properties?.hashed_token||generated.data?.properties?.token_hash;
  if(generated.error||!tokenHash)throw Error('SESSION_BOOTSTRAP_FAILED');
  return {token_hash:tokenHash,type:'magiclink'};
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  try{
    const body=await req.json(),action=String(body.action||''),tripId=body.tripId;
    const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if(action==='verify_pin_login'){
      if(!service||!validLoginPin(String(body.pin||'')))return genericError();
      const admin=createClient(url,service);
      const lookup=await pinLookup(String(body.pin));
      const {data:activeRows,error}=await admin.from('av_app_access').select('user_id,pin_hash,pin_lookup_hmac,access_status,pin_locked_until').eq('access_status','ACTIVE');
      let matches=(activeRows||[]).filter(row=>row.pin_lookup_hmac===lookup);
      if(error||matches.length!==1){
        const legacy=await admin.from('av_app_access').select('user_id,pin_hash,pin_lookup_hmac,access_status,pin_locked_until').eq('access_status','ACTIVE').not('pin_hash','is',null);
        if(legacy.error)return genericError();
        matches=[];
        for(const candidate of legacy.data||[]){
          if(candidate.pin_locked_until&&new Date(candidate.pin_locked_until)>new Date())continue;
          if(await verifyPin(String(body.pin),candidate.pin_hash))matches.push(candidate);
        }
        if(matches.length!==1)return genericError();
        if(legacy.data?.find(row=>row.user_id===matches[0].user_id)?.pin_lookup_hmac==null){
          const backfilled=await admin.from('av_app_access').update({pin_lookup_hmac:lookup}).eq('user_id',matches[0].user_id).eq('access_status','ACTIVE').is('pin_lookup_hmac',null);
          if(backfilled.error)return genericError();
        }
      }
      if(matches.length!==1)return genericError();
      const access=matches[0];
      if(access.pin_locked_until&&new Date(access.pin_locked_until)>new Date())return genericError();
      const ok=await verifyPin(String(body.pin),access.pin_hash);await admin.rpc('av_record_pin_attempt_admin',{p_user_id:access.user_id,p_success:ok});
      if(!ok)return genericError();
      const session=await issueSession(admin,access.user_id);
      return json({ok:true,session});
    }
    const authHeader=req.headers.get('Authorization');if(!authHeader)return json({error:'AUTH_REQUIRED'},401);
    const callerClient=createClient(url,anon,{global:{headers:{Authorization:authHeader}}});
    const {data:{user:caller}}=await callerClient.auth.getUser();if(!caller)return json({error:'AUTH_REQUIRED'},401);
    const serverAdmin=service?createClient(url,service):null;
    const manager=Boolean(serverAdmin&&await isInternalAdmin(serverAdmin,caller.id,tripId));
    if(action==='invite'||action==='reset_email')return json({error:'EMAIL_INVITES_DISABLED'},410);
    if(action==='list_internal_users'){
      if(!manager)return json({error:'USER_MANAGER_REQUIRED'},403);
      const [{data:users,error:userError},{data:memberships,error:membershipError},{data:accessRows,error:accessError}]=await Promise.all([
        serverAdmin!.from('av_users').select('id,auth_user_id,display_name,created_at').order('display_name'),
        serverAdmin!.from('av_trip_memberships').select('id,user_id,trip_id,role,status,permissions,updated_at'),
        serverAdmin!.from('av_app_access').select('user_id,access_status,role,pin_encrypted,pin_iv')
      ]);
      if(userError||membershipError||accessError)throw userError||membershipError||accessError;
      const byInternal=new Map<string,any[]>(),byAuth=new Map((accessRows||[]).map(x=>[x.user_id,x]));
      for(const membership of memberships||[]){const rows=byInternal.get(membership.user_id)||[];rows.push(membership);byInternal.set(membership.user_id,rows);}
      const normalized=(users||[]).map(user=>{
        const authUserId=user.auth_user_id||user.id,access=byAuth.get(authUserId)||byAuth.get(user.id),rows=byInternal.get(user.id)||[],tripRows=rows.filter(row=>row.status==='ACTIVE');
        const membership=rows.find(row=>row.trip_id===tripId)||rows[0]||null;
        return {id:user.id,internal_user_id:user.id,display_name:user.display_name||'Sin nombre',role:membership?.role||access?.role||'VIEWER',access_status:access?.access_status||membership?.status||'DISABLED',trips:tripRows.map(row=>row.trip_id),pin_available:Boolean(access?.pin_encrypted&&access?.pin_iv),membership,access:{user_id:authUserId,access_status:access?.access_status||'DISABLED',role:access?.role||membership?.role||'VIEWER'}};
      });
      return json({ok:true,users:normalized});
    }
    if(manager&&action==='list_role_permissions'){
      const {data,error}=await serverAdmin!.from('av_role_permissions').select('role,permissions').order('role');if(error)throw error;return json({ok:true,permissions:Object.fromEntries((data||[]).map(row=>[row.role,row.permissions]))});
    }
    if(manager&&['create_internal_user','update_internal_user','delete_internal_user','set_role_permissions','get_user_pin','set_access_status','set_role','set_trip_access','set_pin'].includes(action)){
      if(action==='set_role_permissions'){
        const role=String(body.role||'');if(!['ADMIN','TRAVELER','VIEWER'].includes(role)||!body.permissions)return json({error:'INVALID_ROLE_PERMISSIONS'},400);
        const permissions=normalizeRolePermissions(body.permissions);const saved=await serverAdmin!.from('av_role_permissions').upsert({role,permissions,updated_at:new Date().toISOString()});if(saved.error)throw saved.error;
        const updated=await serverAdmin!.from('av_trip_memberships').update({permissions,updated_at:new Date().toISOString()}).eq('role',role);if(updated.error)throw updated.error;return json({ok:true,role,permissions});
      }
      if(action==='get_user_pin'){
        const row=await serverAdmin!.from('av_app_access').select('pin_encrypted,pin_iv').eq('user_id',String(body.userId||'')).maybeSingle();if(row.error)throw row.error;if(!row.data?.pin_encrypted||!row.data?.pin_iv)return json({error:'PIN_NOT_AVAILABLE'},404);const pin=await decryptPin(row.data.pin_encrypted,row.data.pin_iv);const response=json({ok:true,pin});response.headers.set('Cache-Control','no-store');return response;
      }
      if(action==='delete_internal_user'){
        const target=String(body.userId||'');if(!target)return json({error:'TARGET_REQUIRED'},400);const userRow=await serverAdmin!.from('av_users').select('display_name').eq('id',target).maybeSingle();if(userRow.error)throw userRow.error;const name=userRow.data?.display_name||'Usuario eliminado';
        const snapshot=await serverAdmin!.from('av_messages').update({sender_name:name}).eq('sender_user_id',target).is('sender_name',null);if(snapshot.error)throw snapshot.error;
        for(const table of ['av_devices','av_restore_requests']){const cleared=await serverAdmin!.from(table).update({user_id:null}).eq('user_id',target);if(cleared.error&&cleared.error.code!=='42703')throw cleared.error;}
        const revoked=await serverAdmin!.from('av_app_access').update({access_status:'REVOKED',updated_at:new Date().toISOString()}).eq('user_id',target);if(revoked.error)throw revoked.error;
        const memberships=await serverAdmin!.from('av_trip_memberships').delete().eq('user_id',target);if(memberships.error)throw memberships.error;
        const deleted=await serverAdmin!.from('av_users').delete().eq('id',target);if(deleted.error)throw deleted.error;
        await serverAdmin!.auth.admin.deleteUser(target);return json({ok:true,userId:target});
      }
      if(action==='create_internal_user'){
        const displayName=String(body.displayName||'').trim(),role=String(body.role||'VIEWER');if(!displayName||!validPin(String(body.pin||''))||!['ADMIN','TRAVELER','VIEWER'].includes(role))return json({error:'INVALID_INTERNAL_USER'},400);
        const pinValue=String(body.pin),lookup=await pinLookup(pinValue);const duplicate=await serverAdmin!.from('av_app_access').select('user_id').eq('pin_lookup_hmac',lookup).eq('access_status','ACTIVE').maybeSingle();if(duplicate.data)return json({error:'PIN_ALREADY_ASSIGNED'},409);
        const email=`internal-${crypto.randomUUID()}@agenda-viajera.invalid`,password=b64encode(crypto.getRandomValues(new Uint8Array(48))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');const created=await serverAdmin!.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{display_name:displayName}});if(created.error||!created.data.user)throw created.error||Error('USER_CREATE_FAILED');const userId=created.data.user.id;
        const profile=await serverAdmin!.from('av_users').upsert({id:userId,auth_user_id:userId,display_name:displayName,email:null});if(profile.error)throw profile.error;const perms=normalizeRolePermissions((await serverAdmin!.from('av_role_permissions').select('permissions').eq('role',role).maybeSingle()).data?.permissions||defaultRolePermissions(role));const membership=await serverAdmin!.from('av_trip_memberships').upsert({trip_id:tripId,user_id:userId,role,permissions:perms,status:body.accessStatus==='ACTIVE'?'ACTIVE':'INACTIVE'});if(membership.error)throw membership.error;const pinHash=await hashPin(pinValue),encrypted=await encryptPin(pinValue);const access=await serverAdmin!.from('av_app_access').upsert({user_id:userId,access_status:body.accessStatus||'ACTIVE',role,pin_hash:pinHash,pin_lookup_hmac:lookup,pin_encrypted:encrypted.ciphertext,pin_iv:encrypted.iv,pin_key_version:encrypted.version});if(access.error)throw access.error;return json({ok:true,userId});
      }
      const target=String(body.userId||'');if(!target)return json({error:'TARGET_REQUIRED'},400);
      if(action==='update_internal_user'){const displayName=String(body.displayName||'').trim();if(displayName){const updated=await serverAdmin!.from('av_users').update({display_name:displayName}).eq('id',target);if(updated.error)throw updated.error;}}
      if(action==='set_pin'||(action==='update_internal_user'&&body.pin)){const pinValue=String(body.pin||'');if(!validPin(pinValue))return json({error:'PIN_MUST_BE_FOUR_DIGITS'},400);const lookup=await pinLookup(pinValue),duplicate=await serverAdmin!.from('av_app_access').select('user_id').eq('pin_lookup_hmac',lookup).eq('access_status','ACTIVE').neq('user_id',target).maybeSingle();if(duplicate.data)return json({error:'PIN_ALREADY_ASSIGNED'},409);const encrypted=await encryptPin(pinValue),pinHash=await hashPin(pinValue);const updated=await serverAdmin!.from('av_app_access').update({pin_hash:pinHash,pin_lookup_hmac:lookup,pin_encrypted:encrypted.ciphertext,pin_iv:encrypted.iv,pin_key_version:encrypted.version,access_status:body.accessStatus||'ACTIVE',updated_at:new Date().toISOString()}).eq('user_id',target);if(updated.error)throw updated.error;}
      if(['set_role','set_trip_access','update_internal_user'].includes(action)){const role=String(body.role||'VIEWER');const perms=normalizeRolePermissions((await serverAdmin!.from('av_role_permissions').select('permissions').eq('role',role).maybeSingle()).data?.permissions||defaultRolePermissions(role));const updated=await serverAdmin!.from('av_trip_memberships').upsert({trip_id:body.tripAccess||tripId,user_id:target,role,permissions:normalizeRolePermissions(body.permissions||perms),status:body.accessStatus==='ACTIVE'?'ACTIVE':'INACTIVE'});if(updated.error)throw updated.error;await serverAdmin!.from('av_app_access').update({role,updated_at:new Date().toISOString()}).eq('user_id',target);}
      if(action==='set_access_status'||(action==='update_internal_user'&&body.accessStatus)){const status=String(body.accessStatus||'DISABLED');const updated=await serverAdmin!.from('av_app_access').update({access_status:status,updated_at:new Date().toISOString()}).eq('user_id',target);if(updated.error)throw updated.error;await serverAdmin!.from('av_trip_memberships').update({status:status==='ACTIVE'?'ACTIVE':'INACTIVE',updated_at:new Date().toISOString()}).eq('user_id',target).eq('trip_id',tripId);}
      return json({ok:true,userId:target});
    }
    if(['create_internal_user','update_internal_user','delete_internal_user','set_role_permissions','get_user_pin','set_access_status','set_role','set_trip_access','set_pin','reset_pin','invite','reset_email'].includes(action)&&!manager)return json({error:'USER_MANAGER_REQUIRED'},403);
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
      const ok=validLoginPin(String(body.pin||''))&&await verifyPin(String(body.pin),access.pin_hash);await callerClient.rpc('av_record_pin_attempt',{p_user_id:caller.id,p_success:ok});
      if(!ok)return genericError();return json({ok:true});
    }
    if(action==='set_pin'||action==='reset_pin'){
      if(!validPin(String(body.pin||'')))return json({error:'PIN_MUST_BE_FOUR_DIGITS'},400);
      const pinValue=String(body.pin),pinHash=await hashPin(pinValue),lookup=await pinLookup(pinValue),encrypted=await encryptPin(pinValue);const {data,error}=await callerClient.rpc('av_admin_private_access_action_v4',{p_trip_id:tripId,p_target_user_id:body.userId||caller.id,p_action:'set_pin',p_role:body.role||null,p_access_status:body.accessStatus||'ACTIVE',p_pin_hash:pinHash,p_pin_lookup_hmac:lookup,p_pin_encrypted:encrypted.ciphertext,p_pin_iv:encrypted.iv,p_pin_key_version:encrypted.version,p_permissions:body.permissions||null});
      if(error){if(String(error.message||'').includes('AV_PIN_ALREADY_ASSIGNED'))return json({error:'PIN_ALREADY_ASSIGNED'},409);throw error;}return json({ok:true,access:data});
    }
    if(action==='get_user_pin'){
      const target=String(body.userId||'');if(!target)return json({error:'TARGET_REQUIRED'},400);
      const {data:isAdmin,error:adminError}=await callerClient.rpc('av_is_admin',{p_trip_id:tripId});if(adminError||!isAdmin)return json({error:'ADMIN_REQUIRED'},403);if(!service)return json({error:'SERVER_ADMIN_SECRET_UNAVAILABLE'},503);const serverAdmin=createClient(url,service);
      const {data:access,error:accessError}=await serverAdmin.from('av_app_access').select('pin_encrypted,pin_iv,pin_key_version').eq('user_id',target).maybeSingle();if(accessError)throw accessError;if(!access?.pin_encrypted||!access?.pin_iv)return json({error:'PIN_NOT_AVAILABLE'},404);
      const pin=await decryptPin(access.pin_encrypted,access.pin_iv);const auditResult=await callerClient.rpc('av_admin_record_pin_view',{p_trip_id:tripId,p_target_user_id:target});if(auditResult.error)throw auditResult.error;
      const response=json({ok:true,pin});response.headers.set('Cache-Control','no-store');return response;
    }
    if(['set_access_status','set_role','set_trip_access'].includes(action)){
      const {data,error}=await callerClient.rpc('av_admin_private_access_action_v4',{p_trip_id:tripId,p_target_user_id:body.userId,p_action:action,p_role:body.role||null,p_access_status:body.accessStatus||null,p_permissions:body.permissions||null});
      if(error)throw error;return json({ok:true,access:data});
    }
    if(!service)return json({error:'SERVER_ADMIN_SECRET_UNAVAILABLE'},503);const admin=createClient(url,service);
    const {data:isAdmin,error:adminError}=await callerClient.rpc('av_is_admin',{p_trip_id:tripId});if(adminError||!isAdmin)return json({error:'ADMIN_REQUIRED'},403);
    if(action==='create_internal_user'){
      const displayName=String(body.displayName||'').trim();if(!displayName||!validPin(String(body.pin||'')))return json({error:'INVALID_INTERNAL_USER'},400);
      const internalEmail=`internal-${crypto.randomUUID()}@agenda-viajera.invalid`;const password=crypto.randomUUID().replaceAll('-','');
      const created=await admin.auth.admin.createUser({email:internalEmail,password,email_confirm:true,user_metadata:{display_name:displayName}});if(created.error||!created.data.user)throw created.error||Error('USER_CREATE_FAILED');
      const userId=created.data.user.id;const profile=await admin.from('av_users').upsert({id:userId,display_name:displayName,email:internalEmail});if(profile.error)throw profile.error;
      const membershipStatus=body.accessStatus==='ACTIVE'?'ACTIVE':'INACTIVE';const permissions=body.permissions||{CanChat:(body.role||'VIEWER')!=='VIEWER',CanEditAgenda:(body.role||'VIEWER')==='TRAVELER'||(body.role||'VIEWER')==='ADMIN'};const access=await callerClient.rpc('av_admin_private_access_action',{p_trip_id:tripId,p_target_user_id:userId,p_action:'set_trip_access',p_role:body.role||'VIEWER',p_access_status:membershipStatus,p_permissions:permissions});if(access.error)throw access.error;
      const pinValue=String(body.pin),pinHash=await hashPin(pinValue),lookup=await pinLookup(pinValue),encrypted=await encryptPin(pinValue);const pinResult=await callerClient.rpc('av_admin_private_access_action_v4',{p_trip_id:tripId,p_target_user_id:userId,p_action:'set_pin',p_role:body.role||'VIEWER',p_access_status:body.accessStatus||'ACTIVE',p_pin_hash:pinHash,p_pin_lookup_hmac:lookup,p_pin_encrypted:encrypted.ciphertext,p_pin_iv:encrypted.iv,p_pin_key_version:encrypted.version,p_permissions:{}});if(pinResult.error){if(String(pinResult.error.message||'').includes('AV_PIN_ALREADY_ASSIGNED'))return json({error:'PIN_ALREADY_ASSIGNED'},409);throw pinResult.error;}
      return json({ok:true,userId});
    }
    if(action==='update_internal_user'){
      const target=String(body.userId||'');if(!target)return json({error:'TARGET_REQUIRED'},400);const displayName=String(body.displayName||'').trim();
      if(displayName){const profile=await admin.from('av_users').update({display_name:displayName}).eq('id',target);if(profile.error)throw profile.error;}
      if(body.tripAccess){const membershipStatus=body.accessStatus==='ACTIVE'?'ACTIVE':'INACTIVE';const permissions=body.permissions||{CanChat:(body.role||'VIEWER')!=='VIEWER',CanEditAgenda:(body.role||'VIEWER')==='TRAVELER'||(body.role||'VIEWER')==='ADMIN'};const access=await callerClient.rpc('av_admin_private_access_action_v4',{p_trip_id:body.tripAccess,p_target_user_id:target,p_action:'set_trip_access',p_role:body.role||'VIEWER',p_access_status:membershipStatus,p_permissions:permissions});if(access.error)throw access.error;}
      if(body.accessStatus){const state=await callerClient.rpc('av_admin_private_access_action_v4',{p_trip_id:tripId,p_target_user_id:target,p_action:'set_access_status',p_role:body.role||'VIEWER',p_access_status:body.accessStatus,p_permissions:null});if(state.error)throw state.error;}
      if(body.pin){if(!validPin(String(body.pin)))return json({error:'PIN_MUST_BE_FOUR_DIGITS'},400);const pinValue=String(body.pin),pinHash=await hashPin(pinValue),lookup=await pinLookup(pinValue),encrypted=await encryptPin(pinValue);const pinResult=await callerClient.rpc('av_admin_private_access_action_v4',{p_trip_id:tripId,p_target_user_id:target,p_action:'set_pin',p_role:body.role||null,p_access_status:body.accessStatus||null,p_pin_hash:pinHash,p_pin_lookup_hmac:lookup,p_pin_encrypted:encrypted.ciphertext,p_pin_iv:encrypted.iv,p_pin_key_version:encrypted.version,p_permissions:body.permissions||null});if(pinResult.error){if(String(pinResult.error.message||'').includes('AV_PIN_ALREADY_ASSIGNED'))return json({error:'PIN_ALREADY_ASSIGNED'},409);throw pinResult.error;}}
      return json({ok:true,userId:target});
    }
    return json({error:'UNKNOWN_ACTION'},400);
  }catch(error){return json({error:String(error?.message||error)},500)}
});
