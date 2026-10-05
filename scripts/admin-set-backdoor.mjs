import {spawnSync} from 'node:child_process';
import {dirname,join} from 'node:path';
import {readFile} from 'node:fs/promises';

const projectRef='cslludzuejkhsydqiabx';
const encoder=new TextEncoder();
const b64=bytes=>Buffer.from(bytes).toString('base64');

async function hashPin(pin){
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const iterations=120000;
  const key=await crypto.subtle.importKey('raw',encoder.encode(pin),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations,hash:'SHA-256'},key,256);
  return `pbkdf2$${iterations}$${b64(salt)}$${b64(new Uint8Array(bits))}`;
}

function ask(label){
  return new Promise((resolve,reject)=>{
    process.stdout.write(label);
    const chunks=[];
    const onData=chunk=>{
      for(const char of String(chunk)){
        if(char==='\u0003'){finish(new Error('Operación cancelada.'));return;}
        if(char==='\r'||char==='\n'){finish();return;}
        if(char==='\u007f'||char==='\b')chunks.pop();
        else if(/\d/.test(char)&&chunks.length<64)chunks.push(char);
      }
    };
    const finish=error=>{
      process.stdin.off('data',onData);
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
      process.stdout.write('\n');
      error?reject(error):resolve(chunks.join(''));
    };
    process.stdin.setEncoding('utf8');
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.on('data',onData);
  });
}

function npxCliPath(){
  if(process.platform!=='win32')return 'npx';
  return join(dirname(process.execPath),'node_modules','npm','bin','npx-cli.js');
}

function configureSecret(encoded){
  const windows=process.platform==='win32';
  const result=spawnSync(windows?process.execPath:'npx',
    windows
      ? [npxCliPath(),'supabase','secrets','set',`BACKDOOR_PIN_HASH=${encoded}`,'--project-ref',projectRef]
      : ['supabase','secrets','set',`BACKDOOR_PIN_HASH=${encoded}`,'--project-ref',projectRef],
    {stdio:['inherit','pipe','pipe'],shell:false,encoding:'utf8',windowsHide:true});
  const stdout=String(result.stdout||'').replaceAll(encoded,'[redacted]');
  const stderr=String(result.stderr||'').replaceAll(encoded,'[redacted]');
  if(result.error)throw new Error(`SUPABASE_CLI_${result.error.code||'ERROR'}`);
  if(stdout)process.stdout.write(stdout);
  if(result.status!==0){
    if(stderr)process.stderr.write(stderr);
    throw new Error(`SUPABASE_CLI_EXIT_${result.status}`);
  }
  if(stderr)process.stderr.write(stderr);
}

async function supabaseConfig(){
  const source=await readFile('public/src/supabaseClient.js','utf8');
  const url=source.match(/SUPABASE_URL\s*=\s*'([^']+)'/)?.[1];
  const key=source.match(/SUPABASE_PUBLISHABLE_KEY\s*=\s*'([^']+)'/)?.[1];
  if(!url||!key)throw new Error('SUPABASE_PUBLIC_CONFIG_MISSING');
  return {url,key};
}

async function verifyBackdoorLive(pin){
  const {url,key}=await supabaseConfig();
  await new Promise(resolve=>setTimeout(resolve,1000));
  const response=await fetch(`${url}/functions/v1/admin-user-management`,{
    method:'POST',
    headers:{apikey:key,'content-type':'application/json'},
    body:JSON.stringify({action:'verify_backdoor_login',pin})
  });
  let data=null;
  try{data=await response.json();}catch{}
  if(response.status!==200||data?.scope!=='USER_MANAGER_ONLY'){
    const code=typeof data?.error==='string'?data.error.replace(/[^A-Z0-9_]/gi,'').slice(0,48):`HTTP_${response.status}`;
    throw new Error(`LIVE_VERIFY_${response.status}_${code||'SCOPE_MISSING'}`);
  }
}

function shortCode(error){
  const value=String(error?.message||error||'UNKNOWN');
  return value.replace(/[^A-Z0-9_.-]/gi,'_').slice(0,96)||'UNKNOWN';
}

async function main(){
  const pin=await ask('PIN maestro: ');
  const confirmation=await ask('\nConfirma PIN maestro: ');
  if(pin!==confirmation||!/^[0-9]{5,64}$/.test(pin))throw new Error('INPUT_INVALID');
  const encoded=await hashPin(pin);
  configureSecret(encoded);
  try{
    await verifyBackdoorLive(pin);
    console.log('BACKDOOR CONFIGURADO Y VERIFICADO.');
  }catch(error){
    console.log(`BACKDOOR CONFIGURADO PERO NO VERIFICADO.\n${shortCode(error)}`);
    process.exitCode=1;
  }
}

try{await main();}
catch(error){
  console.log(`BACKDOOR CONFIGURADO PERO NO VERIFICADO.\n${shortCode(error)}`);
  process.exitCode=1;
}
