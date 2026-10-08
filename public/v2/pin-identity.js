import {allowedMapsUrl,pointFromMapsUrl,validPoint} from './location.js';
const text=value=>typeof value==='string'?value.trim():'';
export function pointKey(point){const rawLat=point?.lat??point?.latitude,rawLng=point?.lng??point?.longitude;if(rawLat==null||rawLng==null||String(rawLat).trim()===''||String(rawLng).trim()==='')return null;const lat=Number(rawLat),lng=Number(rawLng);return validPoint(lat,lng)?`${lat.toFixed(6)},${lng.toFixed(6)}`:null;}
export function mapsIdentity(value){
 if(!allowedMapsUrl(value))return null;
 const url=new URL(value);let decoded;try{decoded=decodeURIComponent(url.pathname+url.search);}catch{return null;}
 const place=url.searchParams.get('query_place_id')||url.searchParams.get('place_id')||decoded.match(/!1s(ChI[A-Za-z0-9_-]+)/)?.[1];
 if(place)return `place:${place}`;
 const cid=url.searchParams.get('cid')||url.searchParams.get('ludocid');if(cid&&/^\d+$/.test(cid))return `cid:${cid}`;
 const fid=decoded.match(/!1s(0x[\da-f]+:0x[\da-f]+)/i)?.[1];if(fid)return `fid:${fid.toLowerCase()}`;
 const point=pointFromMapsUrl(value);if(point)return `point:${pointKey(point)}`;
 // Short-link tokens identify pins; tracking parameters do not.
 if(['maps.app.goo.gl','goo.gl'].includes(url.hostname))return `${url.hostname}${url.pathname.replace(/\/+$/,'')}`;
 // Search words and viewport coordinates do not identify unique places.
 return null;
}
export function pinLocality(pin){
 for(const key of ['resolved_city','city','locality','municipality','addressLocality'])if(text(pin?.[key]))return text(pin[key]);
 for(const address of [pin?.address,pin?.resolved_address,pin?.location_address])if(address&&typeof address==='object'){
  for(const key of ['addressLocality','locality','city','municipality'])if(text(address[key]))return text(address[key]);
 }
 const component=pin?.address_components?.find(x=>x.types?.includes('locality')||x.types?.includes('postal_town'));if(text(component?.long_name))return text(component.long_name);
 // Only a complete Italian postal address supplies an explicit locality.
 // Station/attraction names without postal structure are never cities.
 for(const value of [pin?.resolved_address,pin?.address,pin?.location_address,pin?.display_name,pin?.name]){
  const match=text(value).match(/,\s*\d{5}\s+([^,\d]+?)\s+[A-Z]{2}\s*,\s*(?:Italy|Italia)\s*$/i);
  if(match)return match[1].trim();
 }
 return '';
}
