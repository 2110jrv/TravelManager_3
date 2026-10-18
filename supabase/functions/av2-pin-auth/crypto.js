const enc=new TextEncoder();
export const hex=bytes=>Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
export const randomSecret=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
export function equalSecret(a,b){const x=enc.encode(a||''),y=enc.encode(b||'');let diff=x.length^y.length;for(let i=0;i<Math.max(x.length,y.length);i++)diff|=(x[i]||0)^(y[i]||0);return diff===0;}
export async function hashPin(pin,salt,pepper){const key=await crypto.subtle.importKey('raw',enc.encode(String(pin)+'\0'+pepper),'PBKDF2',false,['deriveBits']);return hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',iterations:600000,salt:enc.encode(salt)},key,256));}
export async function contextHash(value,pepper){return hex(await crypto.subtle.digest('SHA-256',enc.encode(value+'\0'+pepper)));}
