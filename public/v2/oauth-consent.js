import{createClient}from'../vendor/supabase-client.mjs';
import{LocalStore}from'./store.js';
import{PinAccess}from'./pin-auth.js';
import{TRIP}from'./config.js';
const status=document.querySelector('#status'),panel=document.querySelector('#consent'),authorizationId=new URL(location.href).searchParams.get('authorization_id');
const client=createClient('https://cslludzuejkhsydqiabx.supabase.co','sb_publishable_8k8xhMZtkay30ZB45aPjGw_4u69Dp0U',{auth:{storageKey:'av2.pin.auth',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
let store,credentials,details;
async function load(){panel.hidden=true;try{
 if(!navigator.onLine)throw Error('La autorización requiere conexión. Tus textos guardados siguen disponibles en Agenda.');
 if(!authorizationId||!/^[a-zA-Z0-9_-]{8,200}$/.test(authorizationId))throw Error('Abre esta página desde la conexión OAuth del cliente.');
 store??=await new LocalStore().open();store.pinMode=true;const cfg=(await store.get('meta','trip-config'))?.value;if(cfg&&!Object.isFrozen(TRIP))Object.assign(TRIP,cfg);
 await new PinAccess(store,client).validate();credentials={p_trip:TRIP.id,p_device:store.device,p_token:store.deviceToken};
 const access=await client.rpc('av2_schedule_access',credentials);if(access.error)throw Error('No se pudo verificar el acceso al viaje.');
 const result=await client.auth.oauth.getAuthorizationDetails(authorizationId);if(result.error||!result.data||!('client'in result.data))throw Error('Solicitud OAuth no disponible o caducada. Inicia una conexión nueva desde ChatGPT.');
 details=result.data;document.querySelector('#client-name').textContent=details.client.name||'Cliente OAuth';document.querySelector('#client-url').textContent=details.client.uri||'Sin sitio declarado';
 document.querySelector('#write-access').disabled=!access.data.can_edit;document.querySelector('#write-access').checked=false;
 status.textContent='Revisa el cliente y el alcance antes de autorizar.';panel.hidden=false;
 }catch{status.textContent='No se pudo preparar la autorización. Abre Agenda e inicia sesión; después vuelve a comprobar. Si persiste, revisa la configuración OAuth Server.';}}
document.querySelector('#retry').onclick=load;
document.querySelector('#approve').onclick=async()=>{if(!details||panel.hidden)return;const button=document.querySelector('#approve');button.disabled=true;try{
 const grant=await client.functions.invoke('av2-remote-content/authorize',{body:{authorization_id:authorizationId,credentials,can_write:document.querySelector('#write-access').checked}});if(grant.error||!grant.data?.granted)throw Error('No se guardó el permiso.');
 const approved=await client.auth.oauth.approveAuthorization(authorizationId,{skipBrowserRedirect:true});if(approved.error||!approved.data?.redirect_url)throw Error('No se completó OAuth.');
 const target=new URL(approved.data.redirect_url);if(target.protocol!=='https:')throw Error('Retorno OAuth no seguro.');location.assign(target.href);
 }catch{status.textContent='No se completó la autorización. No se enviaron cambios de contenido. Inicia una conexión nueva si la solicitud caducó.';button.disabled=false;}};
document.querySelector('#deny').onclick=async()=>{try{await client.auth.oauth.denyAuthorization(authorizationId);status.textContent='Solicitud rechazada.';panel.hidden=true;}catch{status.textContent='No se pudo rechazar la solicitud; no autorices el cliente.';}};
load();
