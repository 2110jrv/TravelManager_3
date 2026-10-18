// Pure location parsing shared by the browser and the server resolver.
export const validPoint=(lat,lng)=>Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180;
const decimal='([-+]?\\d{1,3}\\.\\d{4,})';
export function explicitPoint(event){
 const data=event.gps||event.coordinates||event.extendedProperties?.private||{};
 // Derived coordinates are valid only for the input that produced them.
 if(!data.source||data.source==='explicit')if(data.lat!=null&&data.lng!=null&&validPoint(Number(data.lat),Number(data.lng)))return{lat:Number(data.lat),lng:Number(data.lng)};
 const location=event.location||'',text=`${location} ${event.description||''}`.replace(/<[^>]*>/g,' ');
 const patterns=[new RegExp('^\\s*'+decimal+'\\s*[,;]\\s*'+decimal+'\\s*$'),new RegExp('\\bGPS\\s*[:=]\\s*'+decimal+'\\s*[,;]\\s*'+decimal,'i'),new RegExp('\\b(?:LAT|LATITUDE)\\s*=\\s*'+decimal+'\\s+(?:LNG|LON|LONGITUDE)\\s*=\\s*'+decimal,'i'),new RegExp('geo:'+decimal+','+decimal,'i')];
 for(const pattern of patterns){const match=pattern.exec(patterns.indexOf(pattern)===0?location:text);if(match&&validPoint(Number(match[1]),Number(match[2])))return{lat:Number(match[1]),lng:Number(match[2])};}return null;
}
export function allowedMapsUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&((u.hostname==='maps.app.goo.gl'&&/^\/[a-zA-Z0-9]+\/?$/.test(u.pathname))||(u.hostname==='goo.gl'&&u.pathname.startsWith('/maps/'))||(['google.com','www.google.com'].includes(u.hostname)&&/^\/maps(?:\/|$)/.test(u.pathname))||u.hostname==='maps.google.com');}catch{return false;}}
export function mapsUrls(text){return [...String(text||'').replace(/&amp;/g,'&').matchAll(/https:\/\/[^\s<>"']+/g)].map(m=>m[0].replace(/[).,;]+$/,'')).filter(allowedMapsUrl);}
export function pointFromMapsUrl(value){
 if(!allowedMapsUrl(value))return null;const u=new URL(value);if(u.pathname.startsWith('/maps/dir'))return null;let decoded;try{decoded=decodeURIComponent(u.pathname+u.search);}catch{return null;}
 const pairs=[...decoded.matchAll(new RegExp('!3d'+decimal+'!4d'+decimal,'g'))].map(m=>({lat:Number(m[1]),lng:Number(m[2])}));
 if(pairs.length&&pairs.every(p=>validPoint(p.lat,p.lng)&&p.lat===pairs[0].lat&&p.lng===pairs[0].lng))return pairs[0];if(pairs.length)return null;
 for(const key of ['query','q']){const query=u.searchParams.get(key)||'',m=new RegExp('^'+decimal+'\\s*,\\s*'+decimal+'$').exec(query);if(m&&validPoint(Number(m[1]),Number(m[2])))return{lat:Number(m[1]),lng:Number(m[2])};}return null;
}
// Full Plus Code pair/grid decoding follows Google's Open Location Code spec:
// https://github.com/google/open-location-code/blob/main/Documentation/Specification/specification.md
export function plusPoint(text){
 const alphabet='23456789CFGHJMPQRVWX',code=String(text||'').toUpperCase().match(/\b[23456789CFGHJMPQRVWX]{8}\+[23456789CFGHJMPQRVWX]{2,7}\b/)?.[0];if(!code)return null;
 const chars=code.replace('+','');if(alphabet.indexOf(chars[0])>=9||alphabet.indexOf(chars[1])>=18)return null;
 let lat=-90,lng=-180,latSize=20,lngSize=20;
 for(let i=0;i<10;i+=2){lat+=alphabet.indexOf(chars[i])*latSize;lng+=alphabet.indexOf(chars[i+1])*lngSize;if(i<8){latSize/=20;lngSize/=20;}}
 for(let i=10;i<chars.length;i++){const index=alphabet.indexOf(chars[i]);latSize/=5;lngSize/=4;lat+=Math.floor(index/4)*latSize;lng+=(index%4)*lngSize;}
 const point={lat:lat+latSize/2,lng:lng+lngSize/2};return validPoint(point.lat,point.lng)?point:null;
}
export function locationInput(event){const explicit=explicitPoint(event);if(explicit)return{key:`gps:${explicit.lat},${explicit.lng}`,point:explicit,source:'explicit'};const url=mapsUrls(event.location)[0]||mapsUrls(event.description)[0];if(url)return{key:url,url,point:pointFromMapsUrl(url),source:'google-maps'};const point=plusPoint(`${event.location||''} ${event.description||''}`);return point?{key:`plus:${point.lat},${point.lng}`,point,source:'plus-code'}:null;}
export function locationLabel(event){
 const input=locationInput(event),resolved=event.location_key===input?.key;
 return readableLocation(event.resolvedPlaceName||(resolved?event.location_name:null))||readableLocation(event.resolvedAddress||(resolved?event.location_address:null))||readableLocation(event.location)||'Ubicación por confirmar';
}
export function readableLocation(value){return String(value||'').replace(/https?:\/\/[^\s<>]+/gi,'').replace(/<[^>]*>/g,'').replace(/\b[23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]{2,7}\b/gi,'').replace(/(?:GPS\s*[:=]\s*)?[-+]?\d{1,3}\.\d+\s*[,;]\s*[-+]?\d{1,3}\.\d+/gi,'').replace(/\b(?:LAT(?:ITUDE)?|LNG|LON(?:GITUDE)?)\s*=\s*[-+]?\d+\.\d+/gi,'').replace(/^GPS\s*[:=]?\s*$/i,'').trim();}
export function locationAddress(event){return readableLocation(event.resolvedAddress||(event.location_key===locationInput(event)?.key?event.location_address:null));}
