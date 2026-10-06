// Server-only provider lifecycle. Neither refresh credentials nor OAuth secrets
// are returned to the caller. Encryption binds credentials to their owner.
export class ProviderError extends Error {
 constructor(code,status=503){super(code);this.status=status;}
}
const encode=new TextEncoder(),decode=new TextDecoder();
const b64=bytes=>btoa(String.fromCharCode(...bytes));
const bytes=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
export async function credentialCipher(secret){
 if(!secret||bytes(secret).length!==32)throw new ProviderError('GOOGLE_BACKEND_NOT_CONFIGURED');
 const key=await crypto.subtle.importKey('raw',bytes(secret),'AES-GCM',false,['encrypt','decrypt']);
 return {
  async seal(owner,value){const iv=crypto.getRandomValues(new Uint8Array(12));return{iv:b64(iv),data:b64(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encode.encode(owner)},key,encode.encode(JSON.stringify(value)))))};},
  async open(owner,value){return JSON.parse(decode.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(value.iv),additionalData:encode.encode(owner)},key,bytes(value.data))));}
 };
}
export class ProviderLifecycle {
 constructor({repository,cipher,clientId,clientSecret,request=(...args)=>fetch(...args),now=()=>Date.now()}){Object.assign(this,{repository,cipher,clientId,clientSecret,request,now});}
 async exchange(refreshToken,subject){
  if(!this.clientId||!this.clientSecret)throw new ProviderError('GOOGLE_BACKEND_NOT_CONFIGURED');
  let response;try{response=await this.request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:this.clientId,client_secret:this.clientSecret,grant_type:'refresh_token',refresh_token:refreshToken}),signal:AbortSignal.timeout(15000)});}catch{throw new ProviderError('GOOGLE_REFRESH_UNAVAILABLE');}
  let data;try{data=await response.json();}catch{throw new ProviderError('GOOGLE_REFRESH_UNAVAILABLE');}
  if(!response.ok){if(data.error==='invalid_grant')throw new ProviderError('GOOGLE_REAUTH_REQUIRED',409);throw new ProviderError('GOOGLE_REFRESH_UNAVAILABLE');}
  if(!data.access_token||!Number.isFinite(Number(data.expires_in))||Number(data.expires_in)<=0)throw new ProviderError('GOOGLE_REFRESH_UNAVAILABLE');
  const identity=await this.request('https://www.googleapis.com/oauth2/v3/userinfo',{headers:{Authorization:`Bearer ${data.access_token}`},signal:AbortSignal.timeout(15000)});
  if(!identity.ok)throw new ProviderError('GOOGLE_IDENTITY_UNAVAILABLE');
  if((await identity.json()).sub!==subject)throw new ProviderError('GOOGLE_IDENTITY_MISMATCH',403);
  const scopes=new Set(String(data.scope||'').split(' '));
  if(!['calendar.events','calendar.calendars.readonly','drive.file','drive.readonly'].every(s=>scopes.has('https://www.googleapis.com/auth/'+s)))throw new ProviderError('GOOGLE_REAUTH_REQUIRED',409);
  return{refresh_token:data.refresh_token||refreshToken,access_token:data.access_token,expires_at:this.now()+Number(data.expires_in)*1000,subject};
 }
 async run(owner,subject,{action,refresh_token,force=false,rejected_token}={}){
  if(!['status','import','access'].includes(action))throw new ProviderError('GOOGLE_ACTION_INVALID',400);
  const row=await this.repository.get(owner);
  if(action==='status')return{configured:!!row&&!row.revoked_at};
  if(action==='import'){
   if(typeof refresh_token!=='string'||refresh_token.length<10||refresh_token.length>4096)throw new ProviderError('GOOGLE_REFRESH_INVALID',400);
   const lease=row?crypto.randomUUID():null;if(lease&&!await this.repository.lock(owner,lease))throw new ProviderError('GOOGLE_REFRESH_BUSY',429);
   try{const value=await this.exchange(refresh_token,subject);
    await this.repository.save(owner,await this.cipher.seal(owner,value),lease);
    return{configured:true,access_token:value.access_token,expires_at:value.expires_at};
   }finally{if(lease)await this.repository.unlock(owner,lease);}
  }
  if(!row||row.revoked_at)throw new ProviderError('GOOGLE_REAUTH_REQUIRED',409);
  const current=await this.cipher.open(owner,row.ciphertext);
  if(current.subject!==subject)throw new ProviderError('GOOGLE_IDENTITY_MISMATCH',403);
  // Concurrent 401 retries use the already renewed token instead of refreshing twice.
  if(current.expires_at>this.now()+90000&&(!force||rejected_token&&rejected_token!==current.access_token))return{configured:true,access_token:current.access_token,expires_at:current.expires_at};
  const lease=crypto.randomUUID();if(!await this.repository.lock(owner,lease))throw new ProviderError('GOOGLE_REFRESH_BUSY',429);
  try{
   const latest=await this.cipher.open(owner,(await this.repository.get(owner)).ciphertext);
   if(latest.expires_at>this.now()+90000&&(!force||rejected_token&&rejected_token!==latest.access_token))return{configured:true,access_token:latest.access_token,expires_at:latest.expires_at};
   const renewed=await this.exchange(latest.refresh_token,subject);
   await this.repository.save(owner,await this.cipher.seal(owner,renewed),lease);
   return{configured:true,access_token:renewed.access_token,expires_at:renewed.expires_at};
  }catch(error){if(error.message==='GOOGLE_REAUTH_REQUIRED')await this.repository.revoke(owner,lease);throw error;}
  finally{await this.repository.unlock(owner,lease);}
 }
}
