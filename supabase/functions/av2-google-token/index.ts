import {createClient} from 'npm:@supabase/supabase-js@2.45.4';
import {ProviderLifecycle,ProviderError,credentialCipher} from './lifecycle.js';
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
  const body=await req.json();const {data:status,error:deviceError}=await client.rpc('av2_device_status',{p_trip:body.p_trip,p_device:body.p_device,p_token:body.p_token});
  if(deviceError||status!=='ACTIVE')return json({error:'AV2_DEVICE_NOT_AUTHORIZED'},403);
  const subject=user.identities?.find(identity=>identity.provider==='google')?.identity_data?.sub;
  if(!subject)return json({error:'GOOGLE_IDENTITY_REQUIRED'},403);
  const admin=createClient(url,service,{auth:{persistSession:false}}),table=()=>admin.from('av2_google_credentials');
  const checked=async(result:PromiseLike<any>)=>{const value=await result;if(value.error)throw new ProviderError('GOOGLE_STORAGE_UNAVAILABLE');return value.data;};
  const repository={
   get:async(owner:string)=>checked(table().select('ciphertext,revoked_at').eq('user_id',owner).maybeSingle()),
   save:async(owner:string,ciphertext:unknown,lease?:string)=>{if(lease)await checked(table().update({ciphertext,revoked_at:null,updated_at:new Date().toISOString()}).eq('user_id',owner).eq('lease_id',lease));else await checked(table().upsert({user_id:owner,ciphertext,revoked_at:null,updated_at:new Date().toISOString()}));},
   lock:async(owner:string,lease:string)=>!!await checked(admin.rpc('av2_google_refresh_lock',{p_user:owner,p_lease:lease})),
   revoke:async(owner:string,lease:string)=>checked(table().update({revoked_at:new Date().toISOString()}).eq('user_id',owner).eq('lease_id',lease)),
   unlock:async(owner:string,lease:string)=>checked(table().update({lease_id:null,lease_until:null}).eq('user_id',owner).eq('lease_id',lease))
  };
  const lifecycle=new ProviderLifecycle({repository,cipher:await credentialCipher(Deno.env.get('AV2_GOOGLE_CREDENTIAL_KEY')),clientId:Deno.env.get('AV2_GOOGLE_CLIENT_ID'),clientSecret:Deno.env.get('AV2_GOOGLE_CLIENT_SECRET')});
  return json(await lifecycle.run(user.id,String(subject),body));
 }catch(error){if(error instanceof ProviderError)return json({error:error.message},error.status);return json({error:'GOOGLE_BACKEND_UNAVAILABLE'},503);}
});
