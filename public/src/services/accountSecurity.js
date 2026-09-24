import {getSupabaseClient} from '../supabaseClient.js';

export async function loadAdminUsers(tripId){
  const client=await getSupabaseClient();
  const {data,error}=await client.functions.invoke('admin-user-management',{body:{action:'list_internal_users',tripId}});
  if(error)throw error;return data?.users||[];
}

export async function adminUserAction(action,payload){
  const client=await getSupabaseClient();
  const {data,error}=await client.functions.invoke('admin-user-management',{body:{action,...payload}});
  if(error){if(error.context?.status===409)throw new Error('Ese PIN ya está asignado. Usa otro.');throw error;}
  return data;
}
export async function loadRolePermissions(tripId){
  const client=await getSupabaseClient();const {data,error}=await client.functions.invoke('admin-user-management',{body:{action:'list_role_permissions',tripId}});
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
  const {data,error}=await client.functions.invoke('admin-user-management',{body:{action:'verify_pin_login',pin:String(pin||'')}});
  if(error||!data?.session?.token_hash)throw error||new Error('ACCESS_VALIDATION_FAILED');
  const verified=await client.auth.verifyOtp({token_hash:data.session.token_hash,type:data.session.type||'magiclink'});
  if(verified.error)throw verified.error;return verified;
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
