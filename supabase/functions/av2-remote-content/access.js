import {ContentError} from './content.js';
const uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(s);
const deny=code=>{throw new ContentError(code,403);};
// claims must come from a token already validated with auth.getUser().
export async function remoteAccess({claims,userId,path,body,loadGrant,openGrant,rpc,now=Date.now()}){
 const delegated=Object.hasOwn(claims,'client_id');let grant=null,credentials;
 if(delegated){
  if(!uuid(claims.client_id)||path.endsWith('/authorize')||path.endsWith('/revoke')||Object.hasOwn(body,'credentials'))deny('OAUTH_SCOPE_PROTECTED');
  grant=await loadGrant(userId,claims.client_id);
  if(!grant||grant.auth_user_id!==userId||grant.client_id!==claims.client_id||grant.revoked_at||!Number.isFinite(Date.parse(grant.expires_at))||Date.parse(grant.expires_at)<=now)deny('OAUTH_GRANT_REVOKED');
  credentials=await openGrant(userId+':'+grant.client_id+':'+grant.trip_id,grant.cipher);
 }else{
  if(!['/api','/authorize','/revoke'].some(s=>path.endsWith(s)))deny('OAUTH_CLIENT_GRANT_REQUIRED');
  credentials=body.credentials;
 }
 if(!credentials||!uuid(credentials.p_trip)||!uuid(credentials.p_device)||typeof credentials.p_token!=='string'||!/^[a-f0-9]{64}$/i.test(credentials.p_token)||Object.keys(credentials).some(k=>!['p_trip','p_device','p_token'].includes(k)))deny('DEVICE_CREDENTIALS_REQUIRED');
 const access=await rpc('av2_schedule_access',credentials);
 if(grant&&(grant.actor_user!==access.user_id||grant.device_id!==credentials.p_device||grant.trip_id!==credentials.p_trip))deny('OAUTH_GRANT_REVOKED');
 return{credentials,grant,access,canWrite:access.can_edit===true&&(!grant||grant.can_write===true)};
}
