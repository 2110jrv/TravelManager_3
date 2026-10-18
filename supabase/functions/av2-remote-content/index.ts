import {createClient} from 'npm:@supabase/supabase-js@2.117.0';
import {contentCall,toolDefinitions,ContentError,WRITE_TOOLS} from './content.js';
import {credentialCipher} from '../av2-google-token/lifecycle.js';
const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!;
const resource=url+'/functions/v1/av2-remote-content';
const uuid=(s:unknown)=>typeof s==='string'&&/^[a-f0-9-]{36}$/i.test(s);
const reply=(data:unknown,status=200,extra={})=>new Response(data===null?null:JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'https://2110jrv.github.io','Access-Control-Allow-Headers':'authorization,apikey,content-type,mcp-protocol-version','Access-Control-Allow-Methods':'POST,GET,OPTIONS',...extra}});
Deno.serve(async req=>{
 const path=new URL(req.url).pathname;
 // Only discovery is public. All MCP methods, including tools/list, require auth.
 if(req.method==='GET'&&path.endsWith('/.well-known/oauth-protected-resource'))return reply({resource,authorization_servers:[url+'/auth/v1'],bearer_methods_supported:['header'],scopes_supported:['openid','email','profile']});
 if(req.method==='OPTIONS')return reply(null,204);
 if(req.method!=='POST')return reply({error:'METHOD_NOT_ALLOWED'},405);
 const authorization=req.headers.get('authorization');
 const unauthorized=()=>reply({error:'SESSION_REQUIRED'},401,{'WWW-Authenticate':'Bearer resource_metadata="'+resource+'/.well-known/oauth-protected-resource"'});
 if(!authorization?.startsWith('Bearer '))return unauthorized();
 let rpcId:unknown=null,isMcp=false;
 try{
  const client=createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const identity=await client.auth.getUser();if(identity.error||!identity.data.user)return unauthorized();
  const text=await req.text();if(new TextEncoder().encode(text).length>170000)throw new ContentError('REQUEST_TOO_LARGE',413);
  let body;try{body=JSON.parse(text);}catch{throw new ContentError('INVALID_JSON');}
  if(!body||typeof body!=='object'||Array.isArray(body))throw new ContentError('INVALID_REQUEST');
  isMcp=body.jsonrpc==='2.0';rpcId=body.id;
  const rpc=async(name:string,args:unknown)=>{const r=await client.rpc(name,args);if(r.error){const code=r.error.message.match(/(?:REMOTE_[A-Z_]+|AV2_[A-Z_]+|DEVICE_REVOKED|USER_INACTIVE|PIN_CHANGED|ACTOR_MISMATCH)/)?.[0]||'REMOTE_UNAVAILABLE';throw new ContentError(code,/CONFLICT|CHANGED|REUSED/.test(code)?409:/READ_ONLY|REVOKED|PRIVATE|AUTH|ACTOR/.test(code)?403:400);}return r.data;};
  const admin=()=>createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  const cipher=()=>credentialCipher(Deno.env.get('AV2_REMOTE_ENCRYPTION_KEY'));
  let credentials=path.endsWith('/api')||path.endsWith('/authorize')||path.endsWith('/revoke')?body.credentials:null;
  let grant:any=null;
  if(!credentials){
   let claims;try{claims=JSON.parse(atob(authorization.slice(7).split('.')[1].replaceAll('-','+').replaceAll('_','/')));}catch{return unauthorized();}
   if(!uuid(claims.client_id))throw new ContentError('OAUTH_CLIENT_GRANT_REQUIRED',403);
   const rows=await admin().from('av2_remote_grants').select('*').eq('auth_user_id',identity.data.user.id).eq('client_id',claims.client_id).is('revoked_at',null).gt('expires_at',new Date().toISOString());
   if(rows.error||rows.data?.length!==1)throw new ContentError('OAUTH_CLIENT_GRANT_REQUIRED',403);
   grant=rows.data[0];credentials=await(await cipher()).open(identity.data.user.id+':'+grant.client_id+':'+grant.trip_id,grant.cipher);
  }
  if(!credentials||!uuid(credentials.p_trip)||!uuid(credentials.p_device)||typeof credentials.p_token!=='string'||!/^[a-f0-9]{64}$/i.test(credentials.p_token)||Object.keys(credentials).some(k=>!['p_trip','p_device','p_token'].includes(k)))throw new ContentError('DEVICE_CREDENTIALS_REQUIRED',403);
  const access=await rpc('av2_schedule_access',credentials);
  if(grant&&(grant.actor_user!==access.user_id||grant.device_id!==credentials.p_device||grant.trip_id!==credentials.p_trip))throw new ContentError('OAUTH_GRANT_REVOKED',403);
  const canWrite=access.can_edit===true&&(!grant||grant.can_write===true);
  if(path.endsWith('/authorize')){
   if(typeof body.authorization_id!=='string'||!/^[a-zA-Z0-9_-]{8,200}$/.test(body.authorization_id)||typeof body.can_write!=='boolean'||body.can_write&&!access.can_edit)throw new ContentError('INVALID_AUTHORIZATION',403);
   const details=await client.auth.oauth.getAuthorizationDetails(body.authorization_id);
   if(details.error||!details.data||!('client' in details.data)||!uuid(details.data.client.id))throw new ContentError('OAUTH_AUTHORIZATION_UNAVAILABLE',409);
   const clientId=details.data.client.id;
   const sealed=await(await cipher()).seal(identity.data.user.id+':'+clientId+':'+credentials.p_trip,credentials);
   const saved=await admin().from('av2_remote_grants').upsert({auth_user_id:identity.data.user.id,client_id:clientId,trip_id:credentials.p_trip,actor_user:access.user_id,device_id:credentials.p_device,cipher:sealed,can_write:body.can_write,expires_at:new Date(Date.now()+30*86400000).toISOString(),revoked_at:null});
   if(saved.error)throw new ContentError('GRANT_SAVE_FAILED',503);
   return reply({client_id:clientId,granted:true,expires_in_days:30});
  }
  if(path.endsWith('/revoke')){
   if(!uuid(body.client_id))throw new ContentError('INVALID_CLIENT_ID');
   const r=await admin().from('av2_remote_grants').update({revoked_at:new Date().toISOString()}).eq('auth_user_id',identity.data.user.id).eq('client_id',body.client_id).eq('trip_id',credentials.p_trip);
   if(r.error)throw new ContentError('REVOCATION_FAILED',503);return reply({revoked:true});
  }
  if(isMcp){
   if(!grant)throw new ContentError('OAUTH_CLIENT_GRANT_REQUIRED',403);
   if(body.method==='initialize')return reply({jsonrpc:'2.0',id:rpcId,result:{protocolVersion:['2025-03-26','2025-06-18'].includes(body.params?.protocolVersion)?body.params.protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'Agenda Viajera private content',version:'remote-022'}}});
   if(body.method==='notifications/initialized')return reply(null,202);
   if(body.method==='tools/list')return reply({jsonrpc:'2.0',id:rpcId,result:{tools:toolDefinitions().filter(t=>canWrite||!WRITE_TOOLS.includes(t.name))}});
   if(body.method!=='tools/call')throw new ContentError('METHOD_NOT_FOUND',404);
  }else if(!path.endsWith('/api'))throw new ContentError('MCP_REQUEST_REQUIRED');
  const tool=isMcp?body.params?.name:body.tool,args=isMcp?body.params?.arguments:body.arguments;
  const itinerary=async()=>{
   const config=await rpc('av2_trip_configuration',credentials);
   const events:any[]=[];let page:string|undefined;
   do{const params=new URLSearchParams({singleEvents:'true',showDeleted:'false',maxResults:'2500',timeMin:config.start+'T00:00:00Z',timeMax:config.end+'T23:59:59Z'});if(page)params.set('pageToken',page);
    const r=await client.functions.invoke('av2-google-token',{headers:{Authorization:authorization},body:{...credentials,action:'google_read',path:'calendar/v3/calendars/'+encodeURIComponent(config.calendarId)+'/events?'+params}});
    if(r.error)throw new ContentError('CALENDAR_READ_UNAVAILABLE',503);
    const raw=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(r.data.body),c=>c.charCodeAt(0))));events.push(...raw.items||[]);page=raw.nextPageToken;
   }while(page);
   return{source:'Google Calendar',timezone:config.timezone,events};
  };
  const result=await contentCall(tool,args,{rpc,credentials,canWrite,itinerary});
  return reply(isMcp?{jsonrpc:'2.0',id:rpcId,result:{content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result}}:result);
 }catch(e){const error=e instanceof ContentError?e:new ContentError('REMOTE_UNAVAILABLE',503);return reply(isMcp?{jsonrpc:'2.0',id:rpcId,error:{code:error.status===404?-32601:-32602,message:error.message}}:{error:error.message},error.status);}
});
