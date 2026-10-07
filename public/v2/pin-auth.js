import {TRIP} from './config.js';
export async function detectDevice(installation,navigatorObject=navigator){
 const ua=navigatorObject.userAgent||'',hints=navigatorObject.userAgentData;
 let high={};try{high=await hints?.getHighEntropyValues(['model','platformVersion','architecture'])||{};}catch{/* Optional hints never prevent login. */}
 const platform=hints?.platform||(/Android/i.test(ua)?'Android':/Windows/i.test(ua)?'Windows':/iPhone|iPad/i.test(ua)?'iOS':/Mac/i.test(ua)?'macOS':/Linux/i.test(ua)?'Linux':'Equipo');
 const browser=/Edg\//.test(ua)?'Edge':/Chrome\//.test(ua)?'Chrome':/Firefox\//.test(ua)?'Firefox':/Safari\//.test(ua)?'Safari':'Navegador';
 const mobile=hints?.mobile??/Android|iPhone|iPad|Mobile/i.test(ua),model=String(high.model||'').trim();
 const detected={mobile,platform,browser,browser_version:(ua.match(/(?:Edg|Chrome|Firefox|Version)\/([\d.]+)/)||[])[1]||'',model,platform_version:high.platformVersion||'',architecture:high.architecture||''};
 return{detected,friendly_name:model?`${model} · ${platform}`:`${mobile?'Equipo':'PC'} ${platform} · ${browser} · ${installation.slice(-4).toUpperCase()}`};
}
export class PinAccess{
 constructor(store,client){this.store=store;this.client=client;}
 async session(){let session=(await this.client.auth.getSession()).data.session;if(!session){const r=await this.client.functions.invoke('av2-pin-auth',{body:{action:'restore',trip_id:TRIP.id,installation_id:this.store.installation,device_id:this.store.device,device_token:this.store.deviceToken}});if(r.error){let code;try{code=(await r.error.context.json()).error;}catch{}if(['DEVICE_REVOKED','USER_INACTIVE','PIN_CHANGED'].includes(code))await this.lock(false);throw Error(code||'ACCESS_UNAVAILABLE');}const restored=await this.client.auth.setSession(r.data.session);if(restored.error)throw Error('ACCESS_UNAVAILABLE');session=restored.data.session;}return session;}

 async bind(result,login=false){await this.store.bindDevice(result.device);this.store.activeUser={...result.user,authorized:true,epoch:login?crypto.randomUUID():this.store.activeUser?.epoch||crypto.randomUUID()};await this.store.put('meta',{id:'active-user',value:this.store.activeUser});
  if(result.legacy_owner_user_id)await this.store.transaction(['outbox'],tx=>{const r=tx.objectStore('outbox').getAll();r.onsuccess=()=>{for(const operation of r.result)if(!operation.actor_user)tx.objectStore('outbox').put({...operation,actor_user:result.legacy_owner_user_id,installation_id:this.store.installation});};});return result;
 }
 async login(pin){if(!this.store.deviceToken){this.store.deviceToken=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');await this.store.put('meta',{id:'device-token',value:this.store.deviceToken});}
  const info=await detectDevice(this.store.installation);const{data,error}=await this.client.functions.invoke('av2-pin-auth',{body:{pin,trip_id:TRIP.id,installation_id:this.store.installation,device_token:this.store.deviceToken,...info,app_version:'pin-auth-1'}});
  pin='';if(error){let code;try{code=(await error.context.json()).error;}catch{}throw Error(code||'ACCESS_UNAVAILABLE');}const session=await this.client.auth.setSession(data.session);if(session.error)throw Error('ACCESS_UNAVAILABLE');return this.bind(data,true);
 }
 async validate(retry=true){this.store.activeUser=(await this.store.get('meta','active-user'))?.value||null;this.store.device=(await this.store.get('meta','device'))?.value||this.store.device;this.store.deviceToken=(await this.store.get('meta','device-token'))?.value||this.store.deviceToken;if(!this.store.activeUser?.authorized)throw Error('DEVICE_REVOKED');const epoch=this.store.activeUser.epoch;await this.session();const {data,error}=await this.client.rpc('av2_pin_validate',{p_trip:TRIP.id,p_device:this.store.device,p_token:this.store.deviceToken});if(error)throw Error('ACCESS_UNAVAILABLE');if(data?.error){const latest=(await this.store.get('meta','active-user'))?.value;if(latest?.authorized&&latest.epoch!==epoch){if(retry)return this.validate(false);throw Error('ACCESS_UNAVAILABLE');}await this.lock(false);throw Error(data.error);}await this.bind(data);return data;}
 async lock(server=true){const credentials={p_trip:TRIP.id,p_device:this.store.device,p_token:this.store.deviceToken};this.store.activeUser=null;await this.store.put('meta',{id:'active-user',value:null});if(server&&navigator.onLine)await this.client.rpc('av2_pin_lock',credentials);}
}
