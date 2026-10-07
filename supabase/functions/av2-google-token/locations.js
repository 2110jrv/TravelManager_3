import {allowedMapsUrl,pointFromMapsUrl,plusPoint,validPoint} from './location-parser.js';
const cleanName=url=>{try{const raw=decodeURIComponent(new URL(url).pathname.match(/\/maps\/place\/([^/]+)/)?.[1]||'').replaceAll('+',' ').trim();return raw&&!/[°]|^[-+\d.,\s]+$/.test(raw)?raw.slice(0,250):null;}catch{return null;}};
const placeId=url=>{const u=new URL(url),id=u.searchParams.get('query_place_id')||decodeURIComponent(url).match(/!1s(ChI[A-Za-z0-9_-]+)/)?.[1];return id&&/^[A-Za-z0-9_-]{10,250}$/.test(id)?id:null;};
export function postalDetails(html,point){for(const match of String(html).matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{const data=JSON.parse(match[1]),entries=Array.isArray(data)?data:data['@graph']||[data];for(const entry of entries){const a=entry.address;if(a&&typeof a==='object'&&typeof a.addressLocality==='string'&&point&&validPoint(Number(entry.geo?.latitude),Number(entry.geo?.longitude))&&Math.abs(Number(entry.geo.latitude)-point.lat)<0.00005&&Math.abs(Number(entry.geo.longitude)-point.lng)<0.00005){const fields=['streetAddress','addressLocality','postalCode','addressRegion','addressCountry'].map(k=>a[k]).filter(v=>typeof v==='string'&&v.trim());return{address:fields.join(', ').slice(0,500),city:a.addressLocality.slice(0,100)};}}}catch{/* Ignore unverified or malformed metadata. */}}return{};}
export async function resolveMaps(input,request=fetch,details=false){
 if(!allowedMapsUrl(input))return{input,point:null,name:null};let url=input;
 const signal=AbortSignal.timeout(12000);
 try{for(let hop=0;hop<6;hop++){
  if(!allowedMapsUrl(url))break;
  const point=pointFromMapsUrl(url)||plusPoint(new URL(url).searchParams.get('query')||new URL(url).searchParams.get('q'));
  if(point){let extra={};if(details){try{const response=await request(url,{redirect:'manual',signal,headers:{'Accept-Language':'en'}});if(response.ok&&response.headers.get('content-type')?.includes('text/html')){const reader=response.body?.getReader();let html='',size=0;if(reader){for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>2000000)break;html+=new TextDecoder().decode(chunk.value);}await reader.cancel();extra=postalDetails(html,point);}}else await response.body?.cancel();}catch{/* A precise pin remains usable without address metadata. */}}return{input,point,name:cleanName(url),place_id:placeId(url),source:'google-maps',...extra};}
  const response=await request(url,{redirect:'manual',signal,headers:{'Accept-Language':'en'}});
  if(response.status<300||response.status>=400){await response.body?.cancel();break;}
  const target=response.headers.get('location');await response.body?.cancel();if(!target)break;url=new URL(target,url).href;
 }}catch{/* No guessed coordinates on timeout, invalid redirect or provider failure. */}
 return{input,point:null,name:null};
}
export async function resolveLocations(inputs,repository,request=fetch,details=false){
 if(!Array.isArray(inputs)||inputs.length>16||inputs.some(x=>typeof x!=='string'||x.length>4096||!allowedMapsUrl(x)))throw Error('INVALID_MAP_INPUT');
 const result=[];for(let offset=0;offset<inputs.length;offset+=4)result.push(...await Promise.all(inputs.slice(offset,offset+4).map(async input=>{const cached=await repository.get(input);if(cached)return cached;const value=await resolveMaps(input,request,details);if(value.point)await repository.save(value);return value;})));return result;
}
