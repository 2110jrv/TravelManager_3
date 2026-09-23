import {readFile} from 'node:fs/promises';

const SUPABASE_URL='https://cslludzuejkhsydqiabx.supabase.co';
const ADMIN_ID='d492c11f-90c9-4994-baa2-4a9d54bdc2f7';
const TRIP_ID='1aafae82-4ff7-423b-ade2-25170e8b0dd4';
const source=await readFile('public/src/supabaseClient.js','utf8');
const API_KEY=source.match(/SUPABASE_PUBLISHABLE_KEY\s*=\s*'([^']+)'/)?.[1];
const env=Object.fromEntries((await readFile('.env.test.local','utf8')).split(/\r?\n/).filter(line=>line&&!line.trim().startsWith('#')).map(line=>{const i=line.indexOf('=');return [line.slice(0,i).trim(),line.slice(i+1).trim()]}));

function hiddenPrompt(label){return new Promise((resolve,reject)=>{const input=process.stdin;let value='';const finish=(error=null)=>{input.setRawMode?.(false);input.pause();input.off('data',onData);process.stdout.write('\n');error?reject(error):resolve(value)};const onData=chunk=>{for(const char of String(chunk)){if(char==='\u0003')return finish(new Error('Operación cancelada.'));if(char==='\r'||char==='\n')return finish();if(char==='\u007f'||char==='\b'){value=value.slice(0,-1);continue}if(/[0-9]/.test(char)&&value.length<6)value+=char}};process.stdout.write(label);input.setEncoding('utf8');input.setRawMode?.(true);input.resume();input.on('data',onData)})}
async function json(response){const text=await response.text();try{return text?JSON.parse(text):null}catch{return null}}
async function authLogin(){const response=await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:API_KEY,'content-type':'application/json'},body:JSON.stringify({email:env.SUPABASE_TEST_ADMIN_EMAIL,password:env.SUPABASE_TEST_ADMIN_PASSWORD})});const data=await json(response);if(!response.ok||!data?.access_token)throw Error('No se pudo autenticar la cuenta ADMIN local.');return data}
async function functionCall(token,body){const response=await fetch(`${SUPABASE_URL}/functions/v1/admin-user-management`,{method:'POST',headers:{apikey:API_KEY,authorization:`Bearer ${token||API_KEY}`,'content-type':'application/json'},body:JSON.stringify(body)});return {response,data:await json(response)}}
async function bootstrap(tokenHash){const response=await fetch(`${SUPABASE_URL}/auth/v1/verify`,{method:'POST',headers:{apikey:API_KEY,'content-type':'application/json'},body:JSON.stringify({type:'magiclink',token_hash:tokenHash})});const data=await json(response);if(!response.ok||!data?.access_token)throw Error('El bootstrap de sesión no devolvió una sesión válida.');return data}
async function main(){
  if(!API_KEY||!env.SUPABASE_TEST_ADMIN_EMAIL||!env.SUPABASE_TEST_ADMIN_PASSWORD)throw Error('Faltan credenciales ADMIN locales requeridas.');
  let pin=await hiddenPrompt('Nuevo PIN ADMIN de 6 dígitos: ');if(!/^\d{6}$/.test(pin))throw Error('El PIN debe tener exactamente 6 dígitos.');
  let confirmation=await hiddenPrompt('Confirma el PIN: ');if(pin!==confirmation)throw Error('Los PIN no coinciden.');
  const auth=await authLogin();
  const set=await functionCall(auth.access_token,{action:'set_pin',tripId:TRIP_ID,userId:ADMIN_ID,role:'ADMIN',accessStatus:'ACTIVE',pin});
  if(!set.response.ok){if(set.data?.error==='PIN_ALREADY_ASSIGNED')throw Error('Ese PIN ya está asignado. Usa otro.');throw Error('El backend no pudo asignar el PIN ADMIN.');}
  const verified=await functionCall('',{action:'verify_pin_login',pin});
  if(!verified.response.ok||!verified.data?.session?.token_hash)throw Error('El login live del PIN ADMIN fue rechazado.');
  const session=await bootstrap(verified.data.session.token_hash);
  const userResponse=await fetch(`${SUPABASE_URL}/auth/v1/user`,{headers:{apikey:API_KEY,authorization:`Bearer ${session.access_token}`}});const user=await json(userResponse);
  if(!userResponse.ok||user?.id!==ADMIN_ID)throw Error('La sesión live no corresponde a la cuenta ADMIN esperada.');
  const membershipResponse=await fetch(`${SUPABASE_URL}/rest/v1/av_trip_memberships?trip_id=eq.${TRIP_ID}&user_id=eq.${ADMIN_ID}&select=role,status`,{headers:{apikey:API_KEY,authorization:`Bearer ${session.access_token}`}});const memberships=await json(membershipResponse);if(!membershipResponse.ok||memberships?.[0]?.role!=='ADMIN'||memberships?.[0]?.status!=='ACTIVE')throw Error('La sesión live no tiene rol ADMIN ACTIVE.');
  const accessResponse=await fetch(`${SUPABASE_URL}/rest/v1/rpc/av_get_private_access`,{method:'POST',headers:{apikey:API_KEY,authorization:`Bearer ${session.access_token}`,'content-type':'application/json'},body:JSON.stringify({p_user_id:ADMIN_ID})});const access=await json(accessResponse);if(!accessResponse.ok||access?.access_status!=='ACTIVE'||!access?.pin_lookup_hmac||access.failed_pin_attempts!==0||access.pin_locked_until!==null)throw Error('El estado privado ADMIN no quedó ACTIVE y desbloqueado.');
  pin='';confirmation='';return 'ACCESO ADMIN CONFIGURADO CORRECTAMENTE.\nYa puedes entrar a Agenda Viajera con tu nuevo PIN.';
}
try{const result=await main();console.log(result)}catch(error){console.error(`ERROR: ${String(error?.message||'No se pudo configurar el acceso ADMIN.')}`);process.exitCode=1}
