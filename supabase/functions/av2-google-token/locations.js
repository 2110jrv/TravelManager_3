import{allowedMapsUrl,pointFromMapsUrl,plusPoint}from'./location-parser.js';
const cleanName=url=>{try{const raw=decodeURIComponent(new URL(url).pathname.match(/\/maps\/place\/([^/]+)/)?.[1]||'').replaceAll('+',' ').trim();return raw&&!/[°]|^[-+\d.,\s]+$/.test(raw)?raw.slice(0,250):null;}catch{return null;}};
export async function resolveMaps(input,request=fetch){
 if(!allowedMapsUrl(input))return{input,point:null,name:null};let url=input;
 const signal=AbortSignal.timeout(12000);
 try{for(let hop=0;hop<6;hop++){
  if(!allowedMapsUrl(url))break;
  const point=pointFromMapsUrl(url)||plusPoint(new URL(url).searchParams.get('query')||new URL(url).searchParams.get('q'));
  if(point)return{input,point,name:cleanName(url),source:'google-maps'};
  const response=await request(url,{redirect:'manual',signal,headers:{'Accept-Language':'en'}});
  if(response.status<300||response.status>=400){await response.body?.cancel();break;}
  const target=response.headers.get('location');await response.body?.cancel();if(!target)break;url=new URL(target,url).href;
 }}catch{/* No guessed coordinates on timeout, invalid redirect or provider failure. */}
 return{input,point:null,name:null};
}
export async function resolveLocations(inputs,repository,request=fetch){
 if(!Array.isArray(inputs)||inputs.length>16||inputs.some(x=>typeof x!=='string'||x.length>4096||!allowedMapsUrl(x)))throw Error('INVALID_MAP_INPUT');
 const result=[];for(let offset=0;offset<inputs.length;offset+=4)result.push(...await Promise.all(inputs.slice(offset,offset+4).map(async input=>{const cached=await repository.get(input);if(cached)return cached;const value=await resolveMaps(input,request);if(value.point)await repository.save(value);return value;})));return result;
}
