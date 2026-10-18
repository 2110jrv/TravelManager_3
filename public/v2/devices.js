export const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export const hex = bytes => Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
const bytes = text => Uint8Array.from(text.match(/../g)||[],x=>parseInt(x,16));
export async function deriveAdminKey(password,salt,iterations=600000) {
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:bytes(salt),iterations,hash:'SHA-256'},key,256));
}
export async function adminProof(password,challenge) {
  const derived=await deriveAdminKey(password,challenge.salt,challenge.iterations);
  const key=await crypto.subtle.importKey('raw',derived,{name:'HMAC',hash:'SHA-256'},false,['sign']);derived.fill(0);
  return hex(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(challenge.message)));
}
export class Devices {
  constructor(remote){this.remote=remote;}
  call(name,args={}){return this.remote.rpc(name,{...this.remote.credentials(),...args});}
  list(){return this.call('av2_list_devices');}
  async enroll(invite,name){return this.remote.rpc('av2_enroll',{p_trip:this.remote.credentials().p_trip,p_device:this.remote.device,p_device_token:this.remote.token,p_invite:invite,p_name:name});}
  claimRoot(claim){return this.remote.rpc('av2_claim_root',{p_trip:this.remote.credentials().p_trip,p_device:this.remote.device,p_device_token:this.remote.token,p_claim:claim});}
  rename(name){return this.call('av2_rename_device',{p_name:name});}
  requestTransfer(installation,ticket){return this.remote.rpc('av2_request_root_transfer',{p_trip:this.remote.credentials().p_trip,p_target:this.remote.device,p_installation:installation,p_target_token:this.remote.token,p_ticket:ticket});}
  pendingTransfers(){return this.call('av2_pending_root_transfers');}
  transferStatus(installation,ticket){return this.remote.rpc('av2_root_transfer_status',{p_trip:this.remote.credentials().p_trip,p_target:this.remote.device,p_installation:installation,p_target_token:this.remote.token,p_ticket:ticket});}
  cancelTransfer(id){return this.call('av2_cancel_root_transfer',{p_request:id});}
  approveTransfer(id){return this.call('av2_approve_root_transfer',{p_request:id});}
  consumeTransfer(installation,ticket){return this.remote.rpc('av2_consume_root_transfer',{p_trip:this.remote.credentials().p_trip,p_target:this.remote.device,p_installation:installation,p_target_token:this.remote.token,p_ticket:ticket});}
  adminConfigured(){return this.call('av2_admin_key_status');}
  async setAdmin(password,current=null){const salt=hex(crypto.getRandomValues(new Uint8Array(16))),key=await deriveAdminKey(password,salt);const verifier=hex(key);key.fill(0);const args={p_salt:salt,p_iterations:600000,p_verifier:verifier};if(current!==null){Object.assign(args,await this.proof('change-key',null,current));const result=await this.call('av2_change_admin_key',args);if(result.error)throw Error(result.error);return result;}return this.call('av2_set_admin_key',args);}
  async proof(action,target,password){const challenge=await this.call('av2_admin_challenge',{p_action:action,p_target:target});return{p_challenge:challenge.id,p_proof:await adminProof(password,challenge)};}
  async invite(password=null){const token=randomToken(),proof=password?await this.proof('invite',null,password):{};const result=await this.call('av2_create_invite',{p_invite_token:token,...proof});if(result.error)throw Error(result.error);return{...result,token};}
  async revoke(target,password=null,self=false){const proof=password?await this.proof('revoke',target,password):{};const result=await this.call('av2_revoke_device',{p_target:target,p_self:self,...proof});if(result.error)throw Error(result.error);return result;}
}
