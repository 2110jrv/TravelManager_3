import {createClient} from 'npm:@supabase/supabase-js@2.45.4';
import {ProviderLifecycle,ProviderError,credentialCipher} from './lifecycle.js';
import {resolveLocations} from './locations.js';
import {allowedMapsUrl} from './location-parser.js';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store','Pragma':'no-cache'}});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
 try{
  const authorization=req.headers.get('authorization');if(!authorization?.startsWith('Bearer '))return json({error:'SESSION_REQUIRED'},401);
  const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const client=createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}});
  const {data:{user},error}=await client.auth.getUser();if(error||!user)return json({error:'SESSION_REQUIRED'},401);
  const body=await req.json();const admin=createClient(url,service,{auth:{persistSession:false}});
  let ownerMaintenance=false;if(body.action==='import'&&user.identities?.some(identity=>identity.provider==='google')){const owner=await admin.from('av2_trip_users').select('id').eq('trip_id',body.p_trip).eq('user_id',user.id).eq('role','OWNER').is('deleted_at',null).maybeSingle();ownerMaintenance=!!owner.data&&!owner.error;}
  const {data:status,error:deviceError}=await client.rpc('av2_device_status',{p_trip:body.p_trip,p_device:body.p_device,p_token:body.p_token});
  if(!ownerMaintenance&&(deviceError||status!=='ACTIVE'))return json({error:'AV2_DEVICE_NOT_AUTHORIZED'},403);
  if(body.action==='resolve_locations'){
   if(!Array.isArray(body.inputs)||body.inputs.length>16||body.inputs.some((input:unknown)=>typeof input!=='string'||input.length>4096||!allowedMapsUrl(input)))return json({error:'INVALID_MAP_INPUT'},400);
   const admin=createClient(url,service,{auth:{persistSession:false}}),cache=()=>admin.from('av2_map_locations');
   const repository={get:async(input:string)=>{const{data,error}=await cache().select('latitude,longitude,display_name,place_id,resolved_address,resolved_city,details_checked').eq('trip_id',body.p_trip).eq('source_url',input).maybeSingle();if(error)throw Error('MAP_CACHE_UNAVAILABLE');return data&&(!body.details||data.details_checked)?{input,point:{lat:data.latitude,lng:data.longitude},name:data.display_name,place_id:data.place_id,address:data.resolved_address,city:data.resolved_city,source:'google-maps'}:null;},save:async(value:any)=>{const{error}=await cache().upsert({trip_id:body.p_trip,source_url:value.input,latitude:value.point.lat,longitude:value.point.lng,display_name:value.name,place_id:value.place_id||null,...(body.details?{resolved_address:value.address||null,resolved_city:value.city||null,details_checked:true}:{})});if(error)throw Error('MAP_CACHE_UNAVAILABLE');}};
   try{return json({locations:await resolveLocations(body.inputs,repository,fetch,body.details===true)});}catch{return json({error:'MAP_LOCATIONS_UNAVAILABLE'},503);}
  }
  let providerUser=user;
  const pinDevice=await admin.from('av2_user_devices').select('id').eq('device_id',body.p_device).maybeSingle();
  if(pinDevice.data&&!ownerMaintenance){
   if(!['access','status'].includes(body.action))return json({error:'ACTION_NOT_ALLOWED'},403);
   const owner=await admin.from('av2_trip_users').select('user_id').eq('trip_id',body.p_trip).eq('role','OWNER').is('deleted_at',null).single();
   if(owner.error)return json({error:'GOOGLE_STORAGE_UNAVAILABLE'},503);
   providerUser=(await admin.auth.admin.getUserById(owner.data.user_id)).data.user!;
  }
  const subject=providerUser?.identities?.find(identity=>identity.provider==='google')?.identity_data?.sub;
  if(!subject)return json({error:'GOOGLE_IDENTITY_REQUIRED'},403);
  const table=()=>admin.from('av2_google_credentials');
  const checked=async(result:PromiseLike<any>)=>{const value=await result;if(value.error)throw new ProviderError('GOOGLE_STORAGE_UNAVAILABLE');return value.data;};
  const repository={
   get:async(owner:string)=>checked(table().select('ciphertext,revoked_at').eq('user_id',owner).maybeSingle()),
   save:async(owner:string,ciphertext:unknown,lease?:string)=>{if(lease)await checked(table().update({ciphertext,revoked_at:null,updated_at:new Date().toISOString()}).eq('user_id',owner).eq('lease_id',lease));else await checked(table().upsert({user_id:owner,ciphertext,revoked_at:null,updated_at:new Date().toISOString()}));},
   lock:async(owner:string,lease:string)=>!!await checked(admin.rpc('av2_google_refresh_lock',{p_user:owner,p_lease:lease})),
   revoke:async(owner:string,lease:string)=>checked(table().update({revoked_at:new Date().toISOString()}).eq('user_id',owner).eq('lease_id',lease)),
   unlock:async(owner:string,lease:string)=>checked(table().update({lease_id:null,lease_until:null}).eq('user_id',owner).eq('lease_id',lease))
  };
  const lifecycle=new ProviderLifecycle({repository,cipher:await credentialCipher(Deno.env.get('AV2_GOOGLE_CREDENTIAL_KEY')),clientId:Deno.env.get('AV2_GOOGLE_CLIENT_ID'),clientSecret:Deno.env.get('AV2_GOOGLE_CLIENT_SECRET')});
  return json(await lifecycle.run(providerUser.id,String(subject),body));
 }catch(error){if(error instanceof ProviderError)return json({error:error.message},error.status);return json({error:'GOOGLE_BACKEND_UNAVAILABLE'},503);}
});
