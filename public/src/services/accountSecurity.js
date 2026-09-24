import {getSupabaseClient} from '../supabaseClient.js';

export async function changeOwnPassword(password){
  const client=await getSupabaseClient();
  return client.auth.updateUser({password});
}

export async function sendPasswordReset(email){
  const client=await getSupabaseClient();
  return client.auth.resetPasswordForEmail(email,{redirectTo:`${location.origin}${location.pathname}#reset-password`});
}

export async function loadAdminUsers(tripId){
  const client=await getSupabaseClient();
  if(sessionStorage.getItem('agenda-viajera.scope')==='USER_MANAGER_ONLY'){
    const {data,error}=await client.functions.invoke('admin-user-management',{body:{action:'list_internal_users',tripId}});
    if(error)throw error;return data?.users||[];
  }
  const [{data:users,error:userError},{data:memberships,error:membershipError},{data:devices,error:deviceError}]=await Promise.all([
    client.from('av_users').select('id,display_name,created_at').order('display_name'),
    client.from('av_trip_memberships').select('id,user_id,trip_id,role,status,permissions,updated_at').eq('trip_id',tripId),
    client.from('av_devices').select('device_id,user_id,state,last_seen_at').not('user_id','is',null)
  ]);
  if(userError)throw userError;if(membershipError)throw membershipError;if(deviceError)throw deviceError;
  const byUser=new Map((memberships||[]).map(x=>[x.user_id,x]));
  return (users||[]).map(user=>({...user,membership:byUser.get(user.id)||null,devices:(devices||[]).filter(x=>x.user_id===user.id)}));
}

export async function adminUserAction(action,payload){
  const client=await getSupabaseClient();
  const {data,error}=await client.functions.invoke('admin-user-management',{body:{action,...payload}});
  if(error){if(error.context?.status===409)throw new Error('Ese PIN ya está asignado. Usa otro.');throw error;}
  return data;
}
export async function loadRolePermissions(){
  const client=await getSupabaseClient();const {data,error}=await client.functions.invoke('admin-user-management',{body:{action:'list_role_permissions'}});
  if(error)throw error;return data?.permissions||{};
}

export async function getUserPin(userId,tripId){
  const client=await getSupabaseClient();
  const {data,error}=await client.functions.invoke('admin-user-management',{body:{action:'get_user_pin',userId,tripId}});
  if(error)throw error;
  return data;
}

export async function signInWithPin(pin){
  const client=await getSupabaseClient();
  const backdoor=await client.functions.invoke('admin-user-management',{body:{action:'verify_backdoor_login',pin:String(pin||'')}});
  if(!backdoor.error&&backdoor.data?.session?.token_hash){
    const verified=await client.auth.verifyOtp({token_hash:backdoor.data.session.token_hash,type:backdoor.data.session.type||'magiclink'});
    if(verified.error)throw verified.error;return {...verified,scope:'USER_MANAGER_ONLY'};
  }
  const {data,error}=await client.functions.invoke('admin-user-management',{body:{action:'verify_pin_login',pin:String(pin||'')}});
  if(error||!data?.session?.token_hash)throw error||new Error('ACCESS_VALIDATION_FAILED');
  const verified=await client.auth.verifyOtp({token_hash:data.session.token_hash,type:data.session.type||'magiclink'});
  if(verified.error)throw verified.error;return {...verified,scope:'USER'};
}

export async function verifyAppPin(pin,userId){
  const client=await getSupabaseClient();
  const {data,error}=await client.functions.invoke('admin-user-management',{body:{action:'verify_pin',pin,userId}});
  if(error)throw error;
  return data;
}


export async function checkAppAccess(userId){
  const client=await getSupabaseClient();
  const {data,error}=await client.functions.invoke('admin-user-management',{body:{action:'check_access',userId}});
  if(error)throw error;
  return data;
}
